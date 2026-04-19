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
import { createGoal, GOAL_WIDTH, GOAL_HEIGHT, GOAL_CENTER_Z, GOAL_DEPTH } from './goal.js'
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
const allTimeBestByName = new Map<string, { score: number; color: number }>()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
const BALL_CONTROL_COOLDOWN = 500; // .5 second cooldown after kicking
const GOAL_BALL_VANISH_MS = 1000;
const RESET_COOLDOWN_MS = 5000

// Jump tuning: one-shot on press (no hold-to-fly)
// Note: cube body's y is effectively its "feet" height (collider is offset up).
const JUMP_IMPULSE = 8
const JUMP_COOLDOWN_MS = 250
const GROUNDED_Y_EPS = 0.25

// Goalie catch / kick-back behavior
// Note: tuned for reliability first; tighten once it feels right.
const GOALIE_CATCH_RADIUS = 1.9
// Vertical catch window is measured from the goalie's "feet" (rigid body y).
// Goalie capsule is tall, so allow catching well above waist height.
const GOALIE_CATCH_HEIGHT = 4.6
const GOALIE_CATCH_MIN_Y = -0.2
const GOALIE_CATCH_FRONT_ONLY_Z = 2.5
const GOALIE_CATCH_HOLD_MS = 450
const GOALIE_CATCH_COOLDOWN_MS = 900
// Lobbed kick-back: more up, less straight/flat.
const GOALIE_KICK_SPEED = 6
const GOALIE_KICK_UP = 14
const GOALIE_KICK_NO_PICKUP_MS = 700
const GOALIE_KICK_NO_GOALIE_COLLISION_MS = 350
const GOALIE_RELEASE_OFFSET = 2.3
const GOALIE_RELEASE_Y = 1.6
// membership=2 (balls), filter=1|2|4 (world/balls/goalie)
const BALL_COLLISION_GROUPS = 0x00020007
// membership=2 (balls), filter=1|2 (world/balls) - temporarily exclude goalie (4)
const BALL_COLLISION_GROUPS_NO_GOALIE = 0x00020003

function toFloat32Array(value: unknown): Float32Array {
  if (value instanceof Float32Array) return value
  if (Array.isArray(value)) return new Float32Array(value)
  if (value && typeof value === 'object') return new Float32Array(Object.values(value as Record<string, number>))
  return new Float32Array()
}

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

// Track jump edge + cooldown per connection
const prevJumpHeld = new Map<string, boolean>()
const lastJumpAtMs = new Map<string, number>()

// Track reset cooldown per connection
const lastResetAtMs = new Map<string, number>()

// Particle system for goal celebrations
const particles = new Map<string, {
  color: number,
  position: { x: number, y: number, z: number },
  velocity: { x: number, y: number, z: number },
  lifetime: number
}>()

// Prevent immediate ball pickup right after certain events (e.g., goalie kick)
const ballPickupDisabledUntilMs = new Map<string, number>()
// Prevent immediate collision with the goalie right after a goalie kick (avoid kick releasing while overlapping)
const ballNoGoalieCollisionUntilMs = new Map<string, number>()

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

function registerGoal(ballId: string, ball: Ball) {
  if (ball.markedForRemoval) return

  const ballPos = ball.body.translation();
  createGoalParticles(ballPos, ball.color);

  const cubeId = ball.whoLastControlledId
  if (cubeId) {
    const cube = cubes.get(cubeId)
    if (cube) {
      cube.score += 1

      // All-time leaderboard: store each player's best score across rounds.
      const nameKey = cube.name
      const prev = allTimeBestByName.get(nameKey)
      if (!prev || cube.score > prev.score) {
        allTimeBestByName.set(nameKey, { score: cube.score, color: cube.color })
      }
    }
  }

  ball.markedForRemoval = true
  ball.removalTime = Date.now() + GOAL_BALL_VANISH_MS
  ballControllers.delete(ballId)
  ballPickupDisabledUntilMs.delete(ballId)
  ballNoGoalieCollisionUntilMs.delete(ballId)
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

const resetCube = (cubeId: string, cube: Cube) => {
  // Drop the player back onto the field and clear momentum.
  clearCubesBallControllers(cubeId)

  // Random spawn within a central area.
  const spawn = {
    x: Math.random() * 10.0 - 5.0,
    y: 10.0,
    z: Math.random() * 10.0 - 5.0,
  }

  cube.body.resetForces(true)
  cube.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  cube.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  cube.body.setRotation(new RAPIER.Quaternion(0, 0, 0, 1), true)
  cube.body.setTranslation(spawn, true)
  cube.kicking = false
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

        if (data.type === 'reset') {
          const nowMs = Date.now()
          const lastReset = lastResetAtMs.get(connectionId) ?? 0
          if (nowMs - lastReset < RESET_COOLDOWN_MS) {
            return
          }
          lastResetAtMs.set(connectionId, nowMs)
          resetCube(connectionId, cube)
          return
        }

        if (data.type === 'move') {
          const { forward, backward, left, right, jump, mouseRotation, joystickRotationAngle }: ControlsState = data.controls

          // Jump: only fire on the rising edge of the input and when grounded.
          const wasJumpHeld = prevJumpHeld.get(connectionId) ?? false
          const isJumpHeld = !!jump
          const justPressedJump = isJumpHeld && !wasJumpHeld
          prevJumpHeld.set(connectionId, isJumpHeld)

          if (justPressedJump) {
            const y = cube.body.translation().y
            const vy = cube.body.linvel().y
            const grounded = y <= GROUNDED_Y_EPS && Math.abs(vy) <= 2.0
            const nowMs = Date.now()
            const lastJump = lastJumpAtMs.get(connectionId) ?? 0
            if (grounded && nowMs - lastJump >= JUMP_COOLDOWN_MS) {
              cube.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true)
              lastJumpAtMs.set(connectionId, nowMs)
            }
          }

          const force = {
            x: 0,
            y: 0,
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
            const speed = 20.0; // Increased movement speed
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
          prevJumpHeld.delete(connectionId)
          lastJumpAtMs.delete(connectionId)
          lastResetAtMs.delete(connectionId)
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
RAPIER.init().then(() => {
  const gravity = { x: 0.0, y: -9.81, z: 0.0 }
  world = new RAPIER.World(gravity)

  // Create event queue for collision detection
  eventQueue = new RAPIER.EventQueue(true)

  // Create the ground
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0)
  world.createCollider(groundColliderDesc)

  // Create border walls
  const wallHeight = 3.0;  // Taller walls
  const wallThickness = 2.0;  // Thicker walls
  const floorSize = 25.0;
  
  // Create walls as a fixed rigid body
  const wallsBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  
  // North wall
  const northWallDesc = RAPIER.ColliderDesc.cuboid(floorSize, wallHeight, wallThickness)
    .setTranslation(0, wallHeight, -(floorSize + wallThickness/2));  // Adjusted position
  const northWall = world.createCollider(northWallDesc, wallsBody);
  northWall.setCollisionGroups(0xFFFF0001);  // Collide with everything except balls

  // South wall
  const southWallDesc = RAPIER.ColliderDesc.cuboid(floorSize, wallHeight, wallThickness)
    .setTranslation(0, wallHeight, floorSize + wallThickness/2);  // Adjusted position
  const southWall = world.createCollider(southWallDesc, wallsBody);
  southWall.setCollisionGroups(0xFFFF0001);

  // East wall
  const eastWallDesc = RAPIER.ColliderDesc.cuboid(wallThickness, wallHeight, floorSize)
    .setTranslation(floorSize + wallThickness/2, wallHeight, 0);  // Adjusted position
  const eastWall = world.createCollider(eastWallDesc, wallsBody);
  eastWall.setCollisionGroups(0xFFFF0001);

  // West wall
  const westWallDesc = RAPIER.ColliderDesc.cuboid(wallThickness, wallHeight, floorSize)
    .setTranslation(-(floorSize + wallThickness/2), wallHeight, 0);  // Adjusted position
  const westWall = world.createCollider(westWallDesc, wallsBody);
  westWall.setCollisionGroups(0xFFFF0001);

  const goalSensorCollider = createGoal(world)

  // Create goalie
  const goalieCube = createCube(world, "Goalie", true, 2, 1.5); // Taller and wider collider for goalie
  goalieCube.body.setTranslation({ x: 0, y: 0.5, z: -18 }, true); // Position near goal
  
  // Set goalie collision group to 4 and ensure it collides with balls (group 2)
  goalieCube.collider.setCollisionGroups(0x00040002);
  
  // Lock all rotations for the goalie
  goalieCube.body.setEnabledRotations(false, false, false, true);
  
  const goalieMovementRange = 12; // How far the goalie moves side to side
  const goalieMaxSpeed = 5.5; // Max lateral speed (units/sec)
  const goalieRecenteringSpeed = 1.5; // How fast to drift back to center when idle

  let goalieHeldBallId: string | undefined
  let goalieHoldUntilMs = 0
  let goalieCatchCooldownUntilMs = 0
  let goalieCatchStartedAtMs = 0
  let goalieCatchStartPos: { x: number; y: number; z: number } | undefined

  const GOALIE_CATCH_SETTLE_MS = 250

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  function buildGoalieCatchDebug(goalieP: { x: number; y: number; z: number }) {
    const segments = 24
    const r = GOALIE_CATCH_RADIUS
    const y0 = goalieP.y + GOALIE_CATCH_MIN_Y
    const y1 = goalieP.y + GOALIE_CATCH_HEIGHT
    const zFront = goalieP.z + GOALIE_CATCH_FRONT_ONLY_Z

    const positions: number[] = []
    const colors: number[] = []
    const pushVertex = (x: number, y: number, z: number, cr: number, cg: number, cb: number, ca: number) => {
      positions.push(x, y, z)
      colors.push(cr, cg, cb, ca)
    }
    const addSegment = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      cr: number,
      cg: number,
      cb: number,
      ca: number,
    ) => {
      pushVertex(ax, ay, az, cr, cg, cb, ca)
      pushVertex(bx, by, bz, cr, cg, cb, ca)
    }

    // Catch cylinder (cyan)
    const c = { r: 0.0, g: 1.0, b: 1.0, a: 1.0 }
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2
      const a1 = ((i + 1) / segments) * Math.PI * 2
      const x0 = goalieP.x + Math.cos(a0) * r
      const z0 = goalieP.z + Math.sin(a0) * r
      const x1 = goalieP.x + Math.cos(a1) * r
      const z1 = goalieP.z + Math.sin(a1) * r

      // bottom ring
      addSegment(x0, y0, z0, x1, y0, z1, c.r, c.g, c.b, c.a)
      // top ring
      addSegment(x0, y1, z0, x1, y1, z1, c.r, c.g, c.b, c.a)

      // a few verticals
      if (i % 6 === 0) {
        addSegment(x0, y0, z0, x0, y1, z0, c.r, c.g, c.b, c.a)
      }
    }

    // Front cutoff plane (red rectangle at zFront)
    const p = { r: 1.0, g: 0.2, b: 0.2, a: 1.0 }
    const rx0 = goalieP.x - r
    const rx1 = goalieP.x + r
    addSegment(rx0, y0, zFront, rx1, y0, zFront, p.r, p.g, p.b, p.a)
    addSegment(rx0, y1, zFront, rx1, y1, zFront, p.r, p.g, p.b, p.a)
    addSegment(rx0, y0, zFront, rx0, y1, zFront, p.r, p.g, p.b, p.a)
    addSegment(rx1, y0, zFront, rx1, y1, zFront, p.r, p.g, p.b, p.a)

    return {
      vertices: new Float32Array(positions),
      colors: new Float32Array(colors),
    }
  }

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val))

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

    // Goalkeeper AI: track the most threatening ball and move to intercept.
    const goaliePos = goalieCube.body.translation();
    const interceptZ = goaliePos.z; // save line (goalie plane)
    const goalMouthHalfWidth = GOAL_WIDTH / 2 - 0.75;
    const minX = -goalieMovementRange / 2;
    const maxX = goalieMovementRange / 2;

    let bestBall: { id: string; timeToLine: number; xAtLine: number } | undefined;

    for (const [ballId, ball] of balls) {
      if (ball.markedForRemoval) continue;
      const p = ball.body.translation();
      const v = ball.body.linvel();

      // Only consider balls moving toward the goal (negative Z direction)
      if (v.z >= -0.1) continue;

      // Predict when it reaches the goalie intercept plane (z = interceptZ)
      const t = (interceptZ - p.z) / v.z; // v.z is negative
      if (!Number.isFinite(t) || t <= 0) continue;

      // Ignore very far futures to avoid jittery chasing
      if (t > 2.5) continue;

      const xAtLine = p.x + v.x * t;

      // Prefer shots that would pass through the goal mouth
      const withinMouth = Math.abs(xAtLine) <= goalMouthHalfWidth;
      const score = (withinMouth ? 0 : 10) + t; // smaller is more dangerous

      if (!bestBall || score < bestBall.timeToLine) {
        bestBall = { id: ballId, timeToLine: score, xAtLine };
      }
    }

    let targetX = 0;
    let maxSpeed = goalieRecenteringSpeed;

    if (bestBall) {
      targetX = clamp(bestBall.xAtLine, minX, maxX);
      maxSpeed = goalieMaxSpeed;
    }

    const dx = targetX - goaliePos.x;
    const desiredStep = clamp(dx, -maxSpeed * deltaTime, maxSpeed * deltaTime);
    const newX = clamp(goaliePos.x + desiredStep, minX, maxX);

    goalieCube.body.setTranslation(
      {
        x: newX,
        y: goaliePos.y,
        z: goaliePos.z,
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

    // Goalie catch & kick-back
    const nowMs = Date.now()
    const goalieP = goalieCube.body.translation()

    // Restore ball collision groups after temporary exclusions
    for (const [ballId, untilMs] of ballNoGoalieCollisionUntilMs) {
      if (nowMs < untilMs) continue
      const b = balls.get(ballId)
      if (b && goalieHeldBallId !== ballId && !b.markedForRemoval) {
        b.collider.setCollisionGroups(BALL_COLLISION_GROUPS)
      }
      ballNoGoalieCollisionUntilMs.delete(ballId)
    }

    if (goalieHeldBallId) {
      const heldBall = balls.get(goalieHeldBallId)
      if (!heldBall) {
        goalieHeldBallId = undefined
      } else {
        // Keep the ball "in hands" in front of the goalie while holding.
        // Smoothly settle from catch position to hold position to avoid snapping.
        const holdPos = { x: goalieP.x, y: 1.2, z: goalieP.z + 0.6 }
        const startPos = goalieCatchStartPos ?? holdPos
        const t = clamp((nowMs - goalieCatchStartedAtMs) / GOALIE_CATCH_SETTLE_MS, 0, 1)
        const settledPos = {
          x: lerp(startPos.x, holdPos.x, t),
          y: lerp(startPos.y, holdPos.y, t),
          z: lerp(startPos.z, holdPos.z, t),
        }

        heldBall.body.setTranslation(settledPos, true)
        heldBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        heldBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        heldBall.body.setGravityScale(0, true)
        heldBall.collider.setCollisionGroups(0x00000000)

        if (nowMs >= goalieHoldUntilMs) {
          const kickedBallId = goalieHeldBallId
          // Pick nearest player cube to kick toward; fallback: kick upfield
          let targetPos: { x: number; y: number; z: number } | undefined
          let bestDist2 = Infinity
          for (const cube of cubes.values()) {
            const p = cube.body.translation()
            const dx = p.x - goalieP.x
            const dz = p.z - goalieP.z
            const d2 = dx * dx + dz * dz
            if (d2 < bestDist2) {
              bestDist2 = d2
              targetPos = { x: p.x, y: p.y, z: p.z }
            }
          }

          const dir = targetPos
            ? {
                x: targetPos.x - goalieP.x,
                y: 0,
                z: targetPos.z - goalieP.z,
              }
            : { x: 0, y: 0, z: 1 }

          const mag = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1
          dir.x /= mag
          dir.z /= mag

          // Move ball out of the goalie collider before re-enabling collisions and kicking.
          const releasePos = {
            x: goalieP.x + dir.x * GOALIE_RELEASE_OFFSET,
            y: GOALIE_RELEASE_Y,
            z: goalieP.z + dir.z * GOALIE_RELEASE_OFFSET,
          }
          heldBall.body.setTranslation(releasePos, true)

          heldBall.body.setLinvel(
            {
              x: dir.x * GOALIE_KICK_SPEED,
              y: GOALIE_KICK_UP,
              z: dir.z * GOALIE_KICK_SPEED,
            },
            true
          )
          heldBall.body.setAngvel(
            {
              x: (Math.random() - 0.5) * 10,
              y: (Math.random() - 0.5) * 10,
              z: (Math.random() - 0.5) * 10,
            },
            true
          )

          heldBall.whoLastControlledId = undefined
          heldBall.body.setGravityScale(1, true)
          // Avoid immediate goalie collision while the ball is still very close.
          heldBall.collider.setCollisionGroups(BALL_COLLISION_GROUPS_NO_GOALIE)
          if (kickedBallId) {
            // Give the ball time to actually leave the goalie before a player can re-grab it.
            ballPickupDisabledUntilMs.set(kickedBallId, nowMs + GOALIE_KICK_NO_PICKUP_MS)
            ballNoGoalieCollisionUntilMs.set(kickedBallId, nowMs + GOALIE_KICK_NO_GOALIE_COLLISION_MS)
          }
          goalieCatchCooldownUntilMs = nowMs + GOALIE_CATCH_COOLDOWN_MS
          goalieHeldBallId = undefined
        }
      }
    } else if (nowMs >= goalieCatchCooldownUntilMs) {
      // Try to catch an incoming ball close to the goalie center
      for (const [ballId, ball] of balls) {
        if (ball.markedForRemoval) continue
        if (goalieHeldBallId === ballId) continue
        // Allow catching even if a player is currently controlling/dribbling the ball.

        const p = ball.body.translation()
        // Note: don't require any specific velocity direction; we mainly want a reliable
        // "close to center" catch.

        const dx = p.x - goalieP.x
        const dy = p.y - goalieP.y
        const dz = p.z - goalieP.z
        const distXZ = Math.sqrt(dx * dx + dz * dz)
        if (dz > GOALIE_CATCH_FRONT_ONLY_Z) continue

        const withinHeight = dy >= GOALIE_CATCH_MIN_Y && dy <= GOALIE_CATCH_HEIGHT

        if (distXZ <= GOALIE_CATCH_RADIUS && withinHeight) {
          goalieHeldBallId = ballId
          goalieCatchStartedAtMs = nowMs
          goalieCatchStartPos = { x: p.x, y: p.y, z: p.z }
          goalieHoldUntilMs = nowMs + GOALIE_CATCH_HOLD_MS
          ballControllers.delete(ballId)
          break
        }
      }
    }

    // Update round timers - separate from physics step
    updateTimers();

    // Update particles
    updateParticles(timeStep)

    // Process collision events
    eventQueue!.drainCollisionEvents((handle1, handle2, started) => {
      if (debug) {
        console.log('Collision event:', { handle1, handle2, started })
      }
      const c1 = world.getCollider(handle1)
      const c2 = world.getCollider(handle2)

      // Check if one of the colliders is the goal sensor
      if (c1 === goalSensorCollider || c2 === goalSensorCollider) {
        if (debug) {
          console.log('Goal sensor collision detected!')
        }
        const ballCollider = c1 === goalSensorCollider ? c2 : c1
        
        // Find the ball that collided with the goal sensor
        for (const [ballId, ball] of balls) {
          if (ball.collider === ballCollider && !ball.markedForRemoval) {
            if (debug) {
              console.log('GOAL! Ball found:', ballId);
            }
            registerGoal(ballId, ball)
            break
          }
        }
        return
      }
    })

    // Fallback goal detection (more reliable than physics events when bodies are teleported)
    // Goal line is near the front opening of the goal.
    const goalLineZ = GOAL_CENTER_Z - 0.5
    const goalMinX = -GOAL_WIDTH / 2 + 0.5
    const goalMaxX = GOAL_WIDTH / 2 - 0.5
    const goalMinY = 0.0
    const goalMaxY = GOAL_HEIGHT - 0.25
    const goalBackZ = goalLineZ - GOAL_DEPTH

    for (const [ballId, ball] of balls) {
      if (ball.markedForRemoval) continue
      const p = ball.body.translation()

      const inX = p.x >= goalMinX && p.x <= goalMaxX
      const inY = p.y >= goalMinY && p.y <= goalMaxY
      const inZ = p.z <= goalLineZ && p.z >= goalBackZ

      if (inX && inY && inZ) {
        registerGoal(ballId, ball)
      }
    }

    // Process ball removals during the physics step
    for (const [ballId, ball] of balls) {
      if (ball.markedForRemoval && ball.removalTime && Date.now() >= ball.removalTime) {
        removeBall(world, ball)
        balls.delete(ballId)
        ballControllers.delete(ballId)
        ballPickupDisabledUntilMs.delete(ballId)
        ballNoGoalieCollisionUntilMs.delete(ballId)
      }
    }

    let debugData = undefined
    if (debug) {
      const { vertices, colors } = world.debugRender()
      const baseV = toFloat32Array(vertices)
      const baseC = toFloat32Array(colors)
      const catchDebug = buildGoalieCatchDebug(goalieCube.body.translation())

      const mergedV = new Float32Array(baseV.length + catchDebug.vertices.length)
      mergedV.set(baseV, 0)
      mergedV.set(catchDebug.vertices, baseV.length)

      const mergedC = new Float32Array(baseC.length + catchDebug.colors.length)
      mergedC.set(baseC, 0)
      mergedC.set(catchDebug.colors, baseC.length)

      debugData = { vertices: mergedV, colors: mergedC }
    }

    // Validate ball is present
    for (const [ballId, { body }] of balls) {
      const position = body.translation()
      if (position.y < -10) {
        removeBall(world, balls.get(ballId)!)
        balls.delete(ballId)
        ballControllers.delete(ballId)
        ballPickupDisabledUntilMs.delete(ballId)
        ballNoGoalieCollisionUntilMs.delete(ballId)
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
        if (ball.markedForRemoval) continue
        if (goalieHeldBallId === ballId) continue
        const pickupDisabledUntil = ballPickupDisabledUntilMs.get(ballId) ?? 0
        if (pickupDisabledUntil > Date.now()) continue
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
      if (goalieHeldBallId === ballId) continue
      const cube = cubes.get(controllerId)
      const ball = balls.get(ballId)
      
      if (!cube || !ball || ball.markedForRemoval) {
        ballControllers.delete(ballId)
        continue
      }

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
    for (const [id, ball] of balls) {
      const position = ball.body.translation()
      const rotation = ball.body.rotation()
      ballData[id] = { position, rotation, color: ball.color }
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
      allTimeLeaderboard: Array.from(allTimeBestByName.entries())
        .map(([name, v]) => ({ name, score: v.score, color: v.color }))
        .sort((a, b) => b.score - a.score),
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
