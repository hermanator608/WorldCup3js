import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { WSContext } from 'hono/ws'
import { serveStatic } from '@hono/node-server/serve-static'
import type { ClientEvent, ControlsState, ServerState, RoundState } from '@repo/models'
import RAPIER from '@dimforge/rapier3d-compat'
import equal from 'fast-deep-equal'
import { createCube, removeCube, type Cube } from './cubes.js'
import { createBall, removeBall, type Ball } from './ball.js'
import { createGoal } from './goal.js'
import fs from 'fs'

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
let minBallCount = 5
const balls = new Map<string, Ball>()
const ballControllers = new Map<string, string>() // Track which cube controls each ball
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
const BALL_CONTROL_COOLDOWN = 500; // .5 second cooldown after kicking

// Round management
const ROUND_DURATION = 60 // 60 seconds per round
const TIME_BETWEEN_ROUNDS = 30 // 30 seconds between rounds

interface RoundTimer {
  startTime: number;
  endTime: number;
  isActive: boolean;
}

let roundTimer: RoundTimer | undefined;
let lastUpdateTime = Date.now();

let roundState: RoundState = {
  isActive: false,
  timeRemaining: ROUND_DURATION,
  winner: undefined,
  timeTillNextRound: TIME_BETWEEN_ROUNDS
}

function updateTimers() {
  const now = Date.now();
  // Only update timers every 500ms to reduce state updates
  if (now - lastUpdateTime < 500) return;
  
  lastUpdateTime = now;
  
  if (!roundTimer) return;
  
  const timeLeft = Math.ceil((roundTimer.endTime - now) / 1000);
  
  if (roundTimer.isActive) {
    if (roundState.timeRemaining !== timeLeft) {
      roundState.timeRemaining = Math.max(0, timeLeft);
      if (timeLeft <= 0) {
        endRound();
      }
    }
  } else {
    if (roundState.timeTillNextRound !== timeLeft) {
      roundState.timeTillNextRound = Math.max(0, timeLeft);
      if (timeLeft <= 0) {
        startNewRound();
      }
    }
  }
}

function startNewRound() {
  // Reset all cube scores
  for (const cube of cubes.values()) {
    cube.score = 0;
  }
  
  const now = Date.now();
  roundTimer = {
    startTime: now,
    endTime: now + (ROUND_DURATION * 1000),
    isActive: true
  };
  
  roundState = {
    isActive: true,
    timeRemaining: ROUND_DURATION,
    winner: undefined,
    timeTillNextRound: TIME_BETWEEN_ROUNDS
  };
}

function endRound() {
  roundState.isActive = false;
  
  // Find the winner
  let highestScore = -1;
  let winner: RoundState['winner'] = undefined;
  
  for (const [_, cube] of cubes) {
    if (cube.score > highestScore) {
      highestScore = cube.score;
      winner = {
        name: cube.name,
        score: cube.score,
        color: cube.color
      };
    }
  }
  
  roundState.winner = winner;
  roundState.timeTillNextRound = TIME_BETWEEN_ROUNDS;

  const now = Date.now();
  roundTimer = {
    startTime: now,
    endTime: now + (TIME_BETWEEN_ROUNDS * 1000),
    isActive: false
  };
}

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
      },
      onMessage(event, ws) {
        const connectionId = ws.connectionId
        if (!connectionId || !connections[connectionId]) {
          console.error('Connection ID not found on server')
          return
        }

        const data = JSON.parse(event.data.toString()) as ClientEvent

        // Handle New Player Joining
        if (data.type === 'startGame') {
          const name = data.name.trim()
          if (name && name.length > 0) {
            const cube = createCube(world, name);
            cubes.set(connectionId, cube);

            return
          }
        }

        // At this point we know the player has a cube
        const cube = cubes.get(connectionId)

        if (!cube) {
          console.error('Cube not found on server')
          return
        }

        if (data.type === 'move') {
          const { forward, backward, left, right, jump, mouseRotation, joystickRotationAngle }: ControlsState = data.controls
          const force = {
            x: 0,
            y: (cube.body.translation().y < 1 && jump ? 20 : 0),
            z: 0,
          }
          
          // Calculate movement direction based on rotation
          if (forward || backward || left || right) {
          // Get the cube's current rotation
          // const rotation = cube.body.rotation()
          //   // Get the forward and right vectors from the rotation
          //   const forwardVector = {
          //     x: 2 * (rotation.x * rotation.z + rotation.w * rotation.y),
          //     y: 2 * (rotation.y * rotation.z - rotation.w * rotation.x),
          //     z: 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)
          //   }
            
          //   const rightVector = {
          //     x: -(1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z)), // Inverted x
          //     y: -(2 * (rotation.x * rotation.y + rotation.w * rotation.z)),    // Inverted y
          //     z: -(2 * (rotation.x * rotation.z - rotation.w * rotation.y))     // Inverted z
          //   }
            
          //   // Calculate the movement direction
          //   const moveDirection = {
          //     x: (right ? 1 : left ? -1 : 0) * rightVector.x + (forward ? 1 : backward ? -1 : 0) * forwardVector.x,
          //     y: 0, // We don't want vertical movement from rotation
          //     z: (right ? 1 : left ? -1 : 0) * rightVector.z + (forward ? 1 : backward ? -1 : 0) * forwardVector.z
          //   }

            // Apply movement along the world axes
            const moveDirection = {
              x: (right ? 1 : left ? -1 : 0),
              y: 0, // We don't want vertical movement from rotation
              z: (backward ? 1 : forward ? -1 : 0)
            }
            
            // Normalize the movement vector to prevent diagonal speed boost
            const magnitude = Math.sqrt(moveDirection.x ** 2 + moveDirection.z ** 2);
            if (magnitude > 0) {
              moveDirection.x /= magnitude;
              moveDirection.z /= magnitude;
            }

            // Apply the force in the normalized direction
            const speed = 10.0; // Movement speed
            force.x = moveDirection.x * speed;
            force.z = moveDirection.z * speed;
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
              z: mouseRotation.z - cubePos.z
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
          
          if (joystickRotationAngle) {
            // Calculate the rotation quaternion based on joystick angle
            const rotation = new RAPIER.Quaternion(
              0, // x
              Math.sin((joystickRotationAngle + Math.PI/2) /2), // y
              0, // z
              Math.cos((joystickRotationAngle + Math.PI/2) /2)  // w
            )

            cube.body.setRotation(rotation, true)
          }
        } else if (data.type === 'kick') {
          if (data.state === 'start') {
            cube.kicking = true;

            // Check if this kicking player is near any player controlling a ball
            const kickerPos = cube.body.translation();
            const kickRange = 3.0; // Range within which kick can affect other players

            // Look through all ball controllers
            for (const [ballId, controllerId] of ballControllers) {
              // Skip if this is the kicking player's own ball
              if (controllerId === ws.connectionId) continue;

              const controllingCube = cubes.get(controllerId);
              if (controllingCube) {
                const controllerPos = controllingCube.body.translation();
                
                // Calculate distance between kicker and controller
                const dx = kickerPos.x - controllerPos.x;
                const dy = kickerPos.y - controllerPos.y;
                const dz = kickerPos.z - controllerPos.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                // If within range and 50% chance
                if (distance < kickRange && Math.random() < 0.5) {
                  const ball = balls.get(ballId);
                  if (ball) {
                    // Make the ball fly up
                    const upwardForce = 10.0;
                    const randomHorizontalForce = 5.0;
                    ball.body.setLinvel({
                      x: (Math.random() - 0.5) * randomHorizontalForce,
                      y: upwardForce,
                      z: (Math.random() - 0.5) * randomHorizontalForce
                    }, true);

                    // Add random spin
                    const maxSpinSpeed = 20.0;
                    ball.body.setAngvel({
                      x: (Math.random() - 0.5) * maxSpinSpeed,
                      y: (Math.random() - 0.5) * maxSpinSpeed,
                      z: (Math.random() - 0.5) * maxSpinSpeed
                    }, true);

                    // Release control of the ball
                    controllingCube.ballControlCooldown = Date.now() + BALL_CONTROL_COOLDOWN;
                    ballControllers.delete(ballId);
                  }
                }
              }
            }
          } else if (data.state === 'release') {
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
                  
                  // Add random spin to the ball
                  const maxSpinSpeed = 20.0 // Maximum angular velocity
                  const angularVelocity = {
                    x: (Math.random() - 0.5) * maxSpinSpeed * data.power,
                    y: (Math.random() - 0.5) * maxSpinSpeed * data.power,
                    z: (Math.random() - 0.5) * maxSpinSpeed * data.power
                  }
                  ball.body.setAngvel(angularVelocity, true)
                  
                  // Release control of the ball and set cooldown
                  ballControllers.delete(ballId)
                  cube.ballControlCooldown = Date.now() + BALL_CONTROL_COOLDOWN; // .5 second cooldown after kicking
                }
              }
            }

            // Reset kicking state after a short delay to complete the animation
            setTimeout(() => {
              cube.kicking = false;
            }, 300); // Shorter duration to match animation
          }
        }
      },
      onClose: (_, ws) => {
        const connectionId = ws.connectionId
        if (connectionId && connections[connectionId]) {
          delete connections[connectionId]
          const cube = cubes.get(connectionId)
          if (cube) {
            clearCubesBallControllers(connectionId)
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

app.get('/healthcheck', (c) => {
  // Convert Map objects to plain objects with only the data we want to show
  const cubesData = Object.fromEntries(
    Array.from(cubes.entries()).map(([id, cube]) => [
      id,
      {
        name: cube.name,
        color: cube.color,
        score: cube.score,
        position: cube.body.translation(),
        rotation: cube.body.rotation()
      }
    ])
  );

  const ballsData = Object.fromEntries(
    Array.from(balls.entries()).map(([id, ball]) => [
      id,
      {
        color: ball.color,
        position: ball.body.translation(),
        rotation: ball.body.rotation(),
        whoLastControlledId: ball.whoLastControlledId
      }
    ])
  );
  
  return c.json({
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
    minBallCount: minBallCount,
    cubes: cubesData,
    balls: ballsData
  })
})

app.get('/balls/:count', (c) => {
  minBallCount = parseInt(c.req.param('count') || '3');
  return c.json({ message: 'Balls!', timestamp: new Date().toISOString() })
})

// Serve static files from the client's build directory
const staticRoot = '../client/build'
app.use('/*', serveStatic({
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

const server = serve({
  fetch: app.fetch,
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000
}, (info) => {
  console.log(`Server running on port ${info.port}`)
})
injectWebSocket(server)

const clearCubesBallControllers = (cubeId: string) => {
  const ballIdsToDelete = []
  for (const [ballId, controllerId] of ballControllers) {
    if (controllerId === cubeId) {
      ballIdsToDelete.push(ballId)
    }
  }
  for (const ballId of ballIdsToDelete) {
    ballControllers.delete(ballId)
  }
}


RAPIER.init().then(() => {
  const gravity = { x: 0.0, y: -9.81, z: 0.0 }
  world = new RAPIER.World(gravity)

  // Create event queue for collision detection
  eventQueue = new RAPIER.EventQueue(true)

  // Create the ground
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0)
  world.createCollider(groundColliderDesc)

  const goalSensorCollider = createGoal(world)

  // Create goalie
  const goalieCube = createCube(world, "Goalie", true, 2, 1.5); // Taller and wider collider for goalie
  goalieCube.body.setTranslation({ x: 0, y: 0.5, z: -18 }, true); // Position near goal
  
  // Set goalie collision group to 4 and ensure it collides with balls (group 2)
  goalieCube.collider.setCollisionGroups(0x00040002);
  
  // Lock all rotations for the goalie
  goalieCube.body.setEnabledRotations(false, false, false, true);
  
  const goalieMovementRange = 12; // How far the goalie moves side to side
  let goalieDirection = 1; // 1 for right, -1 for left
  const goalieSpeed = 3; // Movement speed

  // Create initial ball
  const ballId = crypto.randomUUID()
  const ball = createBall(world);
  balls.set(ballId, ball)

  const timeStep = 1 / 60 // Fixed time step (60 FPS)
  let lastTime = Date.now()
  let lastState: ServerState

  // Start the first round
  startNewRound();

  function gameLoop() {
    const currentTime = Date.now()
    let deltaTime = (currentTime - lastTime) / 1000
    lastTime = currentTime

    // Move goalie back and forth
    const goaliePos = goalieCube.body.translation();
    if (goaliePos.x > goalieMovementRange / 2) {
      goalieDirection = -1;
    } else if (goaliePos.x < -goalieMovementRange / 2) {
      goalieDirection = 1;
    }
    
    // Update goalie position
    goalieCube.body.setTranslation(
      { 
        x: goaliePos.x + goalieDirection * goalieSpeed * deltaTime,
        y: goaliePos.y,
        z: goaliePos.z
      },
      true
    );
    
    // Keep goalie facing forward
    goalieCube.body.setRotation(new RAPIER.Quaternion(0, 0, 0, 1), true);

    // Catch-up simulation to handle long loop times
    while (deltaTime > 0) {
      const step = Math.min(deltaTime, timeStep)
      world.step(eventQueue!)
      deltaTime -= step
    }

    // Update round timers - separate from physics step
    updateTimers();

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
          if (ball.collider === ballCollider && !ball.markedForRemoval) {
            console.log('GOAL! Ball found:', ballId);
            // Create celebration particles
            const ballPos = ball.body.translation();
            createGoalParticles(ballPos, ball.color);

            const cubeId = ball.whoLastControlledId
            console.log('Cube ID:', cubeId)
            if (cubeId) {
              const cube = cubes.get(cubeId)
              if (cube) {
                cube.score += 1
              }
            }
            
            // Mark the ball for removal in the next physics step
            ball.markedForRemoval = true
            ball.removalTime = Date.now() + 1000 // Remove after 1 second
            break
          }
        }
        return
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
      const cubeRadius = .8 // Approximate cube size
      
      // Skip if this cube already controls a ball or is in cooldown
      const alreadyControlsBall = Array.from(ballControllers.values()).includes(cubeId)
      const inCooldown = cube.ballControlCooldown > Date.now()
      if (alreadyControlsBall || inCooldown) continue
      
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
          
          // Assign control to this cube
          ballControllers.set(ballId, cubeId)
          ball.whoLastControlledId = cubeId
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
        const ballOffset = 1 // Distance in front of cube
        const targetPos = {
          x: cubePos.x + forwardVector.x * ballOffset,
          y: cubePos.y + .5 + forwardVector.y * ballOffset,
          z: cubePos.z + forwardVector.z * ballOffset
        }
        
        // Get cube's velocity
        const cubeVel = cube.body.linvel()
        const speed = Math.sqrt(cubeVel.x * cubeVel.x + cubeVel.z * cubeVel.z)
        
        // Calculate rotation axis based on movement direction
        // The ball should rotate perpendicular to movement direction
        if (speed > 0.01) {
          const rotationSpeed = speed * 2.0 // Adjust this multiplier to control rotation speed
          const rotationAxis = {
            x: cubeVel.z / speed,  // Inverted: positive Z movement = positive X rotation
            y: 0,
            z: -cubeVel.x / speed  // Inverted: positive X movement = negative Z rotation
          }
          
          ball.body.setAngvel({
            x: rotationAxis.x * rotationSpeed,
            y: 0,
            z: rotationAxis.z * rotationSpeed
          }, true)
        } else {
          // Stop rotation when not moving
          ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        }
        
        // Move ball to target position
        ball.body.setTranslation(targetPos, true)
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      }
    }

    const connectionIds: string[] = Object.keys(connections)

    // Get cube positions
    const cubeData: ServerState['cubes'] = {}
    for (const [id, { body, color, name, score, kicking }] of cubes) {
      const position = body.translation()
      const rotation = body.rotation()
      const linvel = body.linvel()
      const threshold = 0.01;
      const isMoving =
        Math.abs(linvel.x) > threshold ||
        Math.abs(linvel.y) > threshold ||
        Math.abs(linvel.z) > threshold;

      cubeData[id] = { position, rotation, color, name, score, moving: isMoving, kicking }
    }

    const ballData: ServerState['balls'] = {}
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
      goalie: {
        position: goalieCube.body.translation(),
        rotation: goalieCube.body.rotation(),
        color: goalieCube.color
      },
      balls: ballData,
      particles: particleData,
      roundState
    }

    if (!equal(state, lastState)) {
      for (const ws of Object.values(connections)) {
        ws.send(JSON.stringify(state))
      }
      lastState = state
    }

    // Schedule next frame
    setTimeout(gameLoop, timeStep * 1000)
  }

  gameLoop()
})
