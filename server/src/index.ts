import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { WSContext } from 'hono/ws'
import { serveStatic } from '@hono/node-server/serve-static'
import type { ControlsState, ServerState } from '@repo/models'
import RAPIER from '@dimforge/rapier3d-compat'
import equal from 'fast-deep-equal'
import { createCube, removeCube, type Cube } from './cubes.js'
import { createBall, removeBall, type Ball } from './ball.js'
import { createGoal } from './goal.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// For __dirname in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

declare module 'hono/ws' {
  interface WSContext {
    connectionId?: string
  }
}

let world: RAPIER.World
const debug = !!process.env.GAME_DEBUG
const app = new Hono()
const connections: Record<string, WSContext> = {}
const cubes = new Map<string, Cube>()
const minBallCount = 3
const balls = new Map<string, Ball>()
const ballControllers = new Map<string, string>() // Track which cube controls each ball
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

let eventQueue: RAPIER.EventQueue | undefined

// Particle system for goal celebrations
const particles = new Map<string, {
  color: number,
  position: { x: number, y: number, z: number },
  velocity: { x: number, y: number, z: number },
  lifetime: number
}>()

function createGoalParticles(position: { x: number, y: number, z: number }, color: number) {
  // Create 50 particles in a sphere pattern
  for (let i = 0; i < 50; i++) {
    const particleId = crypto.randomUUID()
    // Random direction in a sphere
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const speed = 5 + Math.random() * 5
    
    particles.set(particleId, {
      color,
      position: { ...position },
      velocity: {
        x: speed * Math.sin(phi) * Math.cos(theta),
        y: speed * Math.sin(phi) * Math.sin(theta),
        z: speed * Math.cos(phi)
      },
      lifetime: 1.0 // 1 second lifetime
    })
  }
}

function updateParticles(deltaTime: number) {
  // Update and remove expired particles
  for (const [id, particle] of particles) {
    particle.lifetime -= deltaTime
    if (particle.lifetime <= 0) {
      particles.delete(id)
      continue
    }

    // Update position based on velocity
    particle.position.x += particle.velocity.x * deltaTime
    particle.position.y += particle.velocity.y * deltaTime
    particle.position.z += particle.velocity.z * deltaTime

    // Apply gravity
    particle.velocity.y -= 9.81 * deltaTime
  }
}

// WebSocket endpoint
app.get(
  '/ws',
  upgradeWebSocket(() => {
    return {
      onOpen: (_, ws) => {
        const connectionId = crypto.randomUUID()
        console.log(`New connection: ${connectionId}`)
        connections[connectionId] = ws
        ws.connectionId = connectionId
        const cube = createCube(world)
        cubes.set(connectionId, cube)
      },
      onMessage(event, ws) {
        if (!ws.connectionId || !connections[ws.connectionId]) {
          console.error('Connection ID not found on server')
          return
        }

        // console.log(`Message from client: ${ws.connectionId}`)
        const data = JSON.parse(event.data.toString())
        // console.log(data)

        const cube = cubes.get(ws.connectionId)

        if (!cube) {
          console.error('Cube not found on server')
          return
        }

        if (data.type === 'move') {
          const { forward, backward, left, right, jump, mouseRotation }: ControlsState = data.controls
          const force = {
            x: 0,
            y: (cube.body.translation().y < 1 && jump ? 20 : 0),
            z: 0,
          }

          // Get the cube's current rotation
          const rotation = cube.body.rotation()
          
          // Calculate movement direction based on rotation
          if (forward || backward || left || right) {
            // Get the forward and right vectors from the rotation
            const forwardVector = {
              x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
              y: 2 * (rotation.y * rotation.z - rotation.w * rotation.x),
              z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)
            }
            
            const rightVector = {
              x: -(1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z)), // Inverted x
              y: -(2 * (rotation.x * rotation.y + rotation.w * rotation.z)),    // Inverted y
              z: -(2 * (rotation.x * rotation.z - rotation.w * rotation.y))     // Inverted z
            }
            
            // Calculate the movement direction
            const moveDirection = {
              x: (right ? 1 : left ? -1 : 0) * rightVector.x + (forward ? 1 : backward ? -1 : 0) * forwardVector.x,
              y: 0, // We don't want vertical movement from rotation
              z: (right ? 1 : left ? -1 : 0) * rightVector.z + (forward ? 1 : backward ? -1 : 0) * forwardVector.z
            }
            
            // Apply the force in the calculated direction
            force.x = moveDirection.x * 10.0
            force.z = moveDirection.z * 10.0
          }
          
          cube.body.resetForces(true)
          cube.body.addForce(force, true)

          // Apply rotation based on mouse position
          if (mouseRotation) {
            // Get the cube's current position
            const cubePos = cube.body.translation()
            
            // Calculate the direction vector from cube to target
            const direction = {
              x: mouseRotation.x - cubePos.x,
              y: 0, // We only want horizontal rotation
              z: mouseRotation.y - cubePos.z
            }
            
            // Calculate the angle in radians
            const angle = Math.atan2(direction.x, direction.z)
            
            // Create rotation quaternion for Y-axis rotation only
            const rotation = new RAPIER.Quaternion(
              0, // x
              Math.sin(angle/2), // y
              0, // z
              Math.cos(angle/2)  // w
            )
            
            cube.body.setRotation(rotation, true)
          }
        } else if (data.type === 'kick') {
          console.info('Kick', data.power)
          // Find the ball controlled by this cube
          for (const [ballId, controllerId] of ballControllers) {
            if (controllerId === ws.connectionId) {
              const ball = balls.get(ballId)
              if (ball) {
                // Get cube's forward direction
                const rotation = cube.body.rotation()
                const forwardVector = {
                  x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
                  z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)
                }
                
                // Scale the 0-1 power value to appropriate kick velocities
                const maxKickSpeed = 40.0;
                const maxUpwardSpeed = 12.0;
                
                // Apply kick force in the forward direction with power
                const kickVelocity = {
                  x: forwardVector.x * data.power * maxKickSpeed,
                  y: data.power * maxUpwardSpeed,
                  z: forwardVector.z * data.power * maxKickSpeed
                }
                
                ball.body.setLinvel(kickVelocity, true)
                
                // Release control of the ball
                ballControllers.delete(ballId)
              }
            }
          }
        }
      },
      onClose: (_, ws) => {
        const connectionId = ws.connectionId
        if (connectionId && connections[connectionId]) {
          delete connections[connectionId]
          const cube = cubes.get(connectionId)
          if (cube) {
            removeCube(world, cube)
            cubes.delete(connectionId)
          }
          console.log(`Connection closed: ${connectionId}`)
        } else {
          console.log('Connection closed but ID not found')
        }
      },
    }
  }),
)

// Test route
app.get('/test', (c) => {
  console.log('Test route hit')
  return c.json({ message: 'Server is working!', timestamp: new Date().toISOString() })
})

// Serve static files from the client's build directory
const staticRoot = path.join(__dirname, '../../client/build')
console.log('Static file root path:', staticRoot)

console.log('Contents of static root:')
console.log(fs.readdirSync(staticRoot))

app.use("*", serveStatic({
  root: staticRoot,
  rewriteRequestPath: (path) => {
    const clean = path.split('?')[0];
    const isFile = path.includes('.'); // crude but works

    const rewritten = isFile ? clean.replace(/^\//, '') : 'index.html'; // strip leading slash
    console.log(`Request path: ${path} → rewritten: ${rewritten}`);
    return rewritten;
  },
  onNotFound: (path, c) => {
    console.log(`${path} is not found, you accessed ${c.req.path}`)
  }
}));

const server = serve(app, (info) => {
  console.log(`Server running on port ${info.port}`)
})
injectWebSocket(server)

RAPIER.init().then(() => {
  const gravity = { x: 0.0, y: -9.81, z: 0.0 }
  world = new RAPIER.World(gravity)

  // Create event queue for collision detection
  eventQueue = new RAPIER.EventQueue(true)

  // Create the ground
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0)
  world.createCollider(groundColliderDesc)

  const goalSensorCollider = createGoal(world)

  const ballId = crypto.randomUUID()
  const ball = createBall(world);
  balls.set(ballId, ball)

  const timeStep = 1 / 60 // Fixed time step (60 FPS)
  let lastTime = Date.now()
  let lastState: ServerState

  function gameLoop() {
    const currentTime = Date.now()
    let deltaTime = (currentTime - lastTime) / 1000
    lastTime = currentTime

    // Catch-up simulation to handle long loop times
    while (deltaTime > 0) {
      const step = Math.min(deltaTime, timeStep)
      world.step(eventQueue!)
      deltaTime -= step
    }

    // Update particles
    updateParticles(timeStep)

    // Process collision events
    eventQueue!.drainCollisionEvents((handle1, handle2, started) => {
      console.log('Collision event:', { handle1, handle2, started })
      const c1 = world.getCollider(handle1)
      const c2 = world.getCollider(handle2)

      // Check if one of the colliders is the goal sensor
      if (c1 === goalSensorCollider || c2 === goalSensorCollider) {
        console.log('Goal sensor collision detected!')
        const ballCollider = c1 === goalSensorCollider ? c2 : c1
        
        // Find the ball that collided with the goal sensor
        for (const [ballId, ball] of balls) {
          if (ball.collider === ballCollider) {
            console.log('GOAL! Ball found:', ballId)
            // Create celebration particles
            const ballPos = ball.body.translation()
            createGoalParticles(ballPos, ball.color)
            
            // Mark the ball for removal in the next physics step
            ball.markedForRemoval = true
            ball.removalTime = Date.now() + 1000 // Remove after 1 second
            break
          }
        }
        return
      }

      if (started) {
        console.log('Checking cube-ball collisions')
        // Handle other collisions (cube-ball interactions)
        for (const [cubeId, cube] of cubes) {
          if (cube.collider === c1 || cube.collider === c2) {
            for (const [ballId, ball] of balls) {
              if (ball.collider === c1 || ball.collider === c2) {
                // If ball is not already controlled
                if (!ballControllers.has(ballId)) {
                  // Get cube's forward direction
                  const rotation = cube.body.rotation()
                  const forwardVector = {
                    x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
                    y: 0, // We don't use this for forward direction
                    z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)
                  }
                  
                  // Position ball in front of cube
                  const ballOffset = 1.5 // Distance in front of cube
                  const cubePos = cube.body.translation()
                  const targetPos = {
                    x: cubePos.x + forwardVector.x * ballOffset,
                    y: cubePos.y + forwardVector.y * ballOffset,
                    z: cubePos.z + forwardVector.z * ballOffset
                  }
                  
                  // Set ball position and velocity
                  ball.body.setTranslation(targetPos, true)
                  ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
                  
                  console.log('Ball collected by cube:', ballId, cubeId)
                  // Assign control to this cube
                  ballControllers.set(ballId, cubeId)
                }
              }
            }
          }
        }
      }
    })

    // Process ball removals during the physics step
    for (const [ballId, ball] of balls) {
      if (ball.markedForRemoval && ball.removalTime && Date.now() >= ball.removalTime) {
        removeBall(world, ball)
        balls.delete(ballId)
        ballControllers.delete(ballId)
      }
    }

    let debugData = undefined
    if (debug) {
      const { vertices, colors } = world.debugRender()
      debugData = { vertices, colors }
    }

    // Validate ball is present
    for (const [ballId, { body }] of balls) {
      const position = body.translation()
      if (position.y < -10) {
        removeBall(world, balls.get(ballId)!)
        balls.delete(ballId)
        ballControllers.delete(ballId)
      }
    }

    if (balls.size < minBallCount){
      for (let i = balls.size; i < minBallCount; i++) {
        const ballId = crypto.randomUUID()
        const ball = createBall(world)
        balls.set(ballId, ball)
      }
    }

    // Check for cube-ball collisions and control
    for (const [cubeId, cube] of cubes) {
      const cubePos = cube.body.translation()
      const cubeRadius = 0.5 // Approximate cube size
      
      // Skip if this cube already controls a ball
      const alreadyControlsBall = Array.from(ballControllers.values()).includes(cubeId)
      if (alreadyControlsBall) continue
      
      for (const [ballId, ball] of balls) {
        const ballPos = ball.body.translation()
        const ballRadius = 0.5 // Approximate ball size
        
        // Calculate distance between cube and ball
        const dx = cubePos.x - ballPos.x
        const dy = cubePos.y - ballPos.y
        const dz = cubePos.z - ballPos.z
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
        
        // If ball is not controlled and cube is close enough
        if (!ballControllers.has(ballId) && distance < cubeRadius + ballRadius) {
          // Get cube's forward direction
          const rotation = cube.body.rotation()
          const forwardVector = {
            x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
            y: 0, // We don't use this for forward direction
            z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)
          }
          
          // Position ball in front of cube
          const ballOffset = 1.5 // Distance in front of cube
          const targetPos = {
            x: cubePos.x + forwardVector.x * ballOffset,
            y: cubePos.y + forwardVector.y * ballOffset,
            z: cubePos.z + forwardVector.z * ballOffset
          }
          
          // Set ball position and velocity
          ball.body.setTranslation(targetPos, true)
          ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          
          // Assign control to this cube
          ballControllers.set(ballId, cubeId)
          break // Exit the ball loop once we've assigned control
        }
      }
    }

    // Update controlled balls' positions
    for (const [ballId, controllerId] of ballControllers) {
      const cube = cubes.get(controllerId)
      const ball = balls.get(ballId)
      
      if (cube && ball) {
        const cubePos = cube.body.translation()
        const rotation = cube.body.rotation()
        
        // Get cube's forward direction
        const forwardVector = {
          x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
          y: 0, // We don't use this for forward direction
          z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)
        }
        
        // Position ball in front of cube
        const ballOffset = 1.5 // Distance in front of cube
        const targetPos = {
          x: cubePos.x + forwardVector.x * ballOffset,
          y: cubePos.y + forwardVector.y * ballOffset,
          z: cubePos.z + forwardVector.z * ballOffset
        }
        
        // Move ball to target position
        ball.body.setTranslation(targetPos, true)
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      }
    }

    const connectionIds: string[] = Object.keys(connections)

    // Get cube positions
    const cubeData: Record<
      string,
      {
        position: { x: number; y: number; z: number }
        rotation: { x: number; y: number; z: number; w: number }
        color: number
      }
    > = {}
    for (const [id, { body, color }] of cubes) {
      const position = body.translation()
      const rotation = body.rotation()
      cubeData[id] = { position, rotation, color }
    }

    const ballData: Record<
      string,
      {
        position: { x: number; y: number; z: number }
        rotation: { x: number; y: number; z: number; w: number }
        color: number
      }
    > = {}
    for (const [id, { body, color }] of balls) {
      const position = body.translation()
      const rotation = body.rotation()
      ballData[id] = { position, rotation, color }
    }

    // Include particles in the state update
    const particleData = Array.from(particles.entries()).map(([id, particle]) => ({
      id,
      color: particle.color,
      position: particle.position
    }))

    const state: ServerState = {
      ...(debug ? { debugData } : {}),
      connectionIds,
      cubes: cubeData,
      balls: ballData,
      particles: particleData
    }

    if (!equal(state, lastState)) {
      for (const ws of Object.values(connections)) {
        ws.send(JSON.stringify(state))
      }
      lastState = state
    }

    setTimeout(gameLoop, timeStep * 1000)
  }

  gameLoop()
})
