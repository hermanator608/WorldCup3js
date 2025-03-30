import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { WSContext } from 'hono/ws'
import type { ControlsState, ServerState } from '@repo/models'
import RAPIER from '@dimforge/rapier3d-compat'
import equal from 'fast-deep-equal'
import { createCube, removeCube, type Cube } from './cubes.js'
import { createBall, removeBall, type Ball } from './ball.js'

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
const balls = new Map<string, Ball>()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

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

        console.log(`Message from client: ${ws.connectionId}`)
        const data = JSON.parse(event.data.toString())
        console.log(data)

        if (data.type === 'move') {
          const cube = cubes.get(ws.connectionId)
          if (cube) {
            const { forward, backward, left, right, jump }: ControlsState = data.controls
            const force = {
              x: (right ? 1 : left ? -1 : 0) * 10.0,
              y: (cube.body.translation().y < 1 && jump ? 20 : 0),
              z: (backward ? 1 : forward ? -1 : 0) * 10.0,
            }
            cube.body.resetForces(true)
            cube.body.addForce(force, true)
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

const server = serve(app)
injectWebSocket(server)

RAPIER.init().then(() => {
  const gravity = { x: 0.0, y: -9.81, z: 0.0 }
  world = new RAPIER.World(gravity)

  // Create the ground
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0)
  world.createCollider(groundColliderDesc)

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
      world.step()
      deltaTime -= step
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
      }
    }

    if (balls.size === 0) {
      const ballId = crypto.randomUUID()
      const ball = createBall(world)
      balls.set(ballId, ball)
    }

    const connectionIds: string[] = Object.keys(connections)

    // Get cube positions
    const cubeData: Record<
      string,
      {
        position: { x: number; y: number; z: number }
        rotation: { x: number; y: number; z: number }
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
        rotation: { x: number; y: number; z: number }
        color: number
      }
    > = {}
    for (const [id, { body, color }] of balls) {
      const position = body.translation()
      const rotation = body.rotation()
      ballData[id] = { position, rotation, color }
    }

    const state: ServerState = {
      ...(debug ? { debugData } : {}),
      connectionIds,
      cubes: cubeData,
      balls: ballData
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
