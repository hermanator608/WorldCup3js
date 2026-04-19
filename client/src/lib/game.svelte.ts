import * as THREE from 'three'
import { createCube, createCubeNameLabel, createCubeScoreLabel } from './cube'
import type { ServerState, ControlsState } from '@repo/models'
import { generateField } from './field'
import { createBall } from './ball'
import { createGoal } from './goal'

let instance: Game | undefined

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

export class Game {
  canvas: HTMLCanvasElement | undefined
  renderer: THREE.WebGLRenderer | undefined
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  needRender = false
  balls: Map<string, THREE.Mesh> = new Map()
  private ballShadows: Map<string, THREE.Mesh> = new Map()
  cubes: Map<string, THREE.Mesh | THREE.Group> = new Map()
  private cubeShadows: Map<string, THREE.Mesh> = new Map()
  goalie: THREE.Mesh | THREE.Group | undefined
  private goalieShadow: THREE.Mesh | undefined
  serverState = $state<ServerState>({ 
    connectionIds: [], 
    cubes: {}, 
    goalie: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      color: 0
    },
    balls: {}, 
    particles: [], 
    roundState: { 
      isActive: false, 
      timeRemaining: 0, 
      timeTillNextRound: 0, 
      winner: undefined 
    } 
  })
  controlsState = $state<ControlsState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    mouseRotation: { x: 0, z: 0 }
  })
  grassMesh: THREE.Mesh | undefined
  guiVars: any
  private particles = new Map<string, THREE.Points>()
  private particleGeometry = new THREE.BufferGeometry()
  private particleMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.2,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    vertexColors: true
  })
  private clock = new THREE.Clock()
  private mixers: THREE.AnimationMixer[] = []
  private lastGoaliePos = new THREE.Vector3()
  private lastGoalieUpdateMs = 0
  private hasGoaliePos = false
  private tmpQuat = new THREE.Quaternion()

  private contactShadowTexture: THREE.CanvasTexture | undefined

  private clamp01(v: number) {
    return Math.max(0, Math.min(1, v))
  }

  private getContactShadowTexture(): THREE.CanvasTexture {
    if (this.contactShadowTexture) return this.contactShadowTexture

    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      // Fallback: 1px opaque pixel
      const fallback = new THREE.CanvasTexture(document.createElement('canvas'))
      this.contactShadowTexture = fallback
      return fallback
    }

    // White color with alpha falloff; we'll tint it black via material.color.
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0.0, 'rgba(255,255,255,0.35)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)')
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)

    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = 2
    texture.needsUpdate = true
    this.contactShadowTexture = texture
    return texture
  }

  private createContactShadowMesh(baseRadius: number): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(1, 32)
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: this.getContactShadowTexture(),
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
    })
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -1

    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 10
    mesh.scale.set(baseRadius, baseRadius, baseRadius)
    return mesh
  }

  private updateContactShadow(mesh: THREE.Mesh, x: number, z: number, heightAboveGround: number, baseRadius: number) {
    // Place slightly above the ground/plane to reduce z-fighting.
    mesh.position.set(x, 0.03, z)

    // As height increases: bigger + fainter.
    const t = this.clamp01(heightAboveGround / 6)
    const scale = baseRadius * (1 + 0.5 * t)
    mesh.scale.set(scale, scale, scale)

    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = 0.7 * (1 - t)
  }

  static getInstance(guiVars: any): Game {
    if (!instance) {
      instance = new Game(guiVars)
    }
    return instance
  }

  private constructor(guiVars: any) {
    this.guiVars = guiVars
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(isTouchDevice ? 60 : 50, window.innerWidth / window.innerHeight, 0.1, 1000)
    isTouchDevice ? this.camera.position.set(0, 25, 25) : this.camera.position.set(0, 18, 25)
    this.camera.lookAt(0, 0, 0)

    $effect(() => {
      this.updateScene(this.serverState)
    })
  }

  public init(canvas: HTMLCanvasElement, viewportSize: { height: number; width: number }): void {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      // alpha: true
    })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setSize(viewportSize.width, viewportSize.height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene.add(this.camera)

    // Ambient light
    const ambientLight = new THREE.AmbientLight()
    ambientLight.color = new THREE.Color(0xffffff)
    ambientLight.intensity = 3; // Reduced ambient light
    this.scene.add(ambientLight)

    // Directional light for shadows and highlights
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0)
    directionalLight.position.set(10, 20, 10)
    directionalLight.castShadow = true
    
    // Configure shadow properties
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 50
    directionalLight.shadow.camera.left = -20
    directionalLight.shadow.camera.right = 20
    directionalLight.shadow.camera.top = 20
    directionalLight.shadow.camera.bottom = -20
    
    this.scene.add(directionalLight)

    // Add a second directional light from the opposite side for better depth
    const backLight = new THREE.DirectionalLight(0xffffff, 0.5)
    backLight.position.set(-10, 10, -10)
    this.scene.add(backLight)

    this.createField();
  }

  public createField(): void {
    const { grassMesh, planeMesh } = generateField(this.guiVars)
    planeMesh.renderOrder = 0
    grassMesh.renderOrder = 0
    this.scene.add(planeMesh)
    this.scene.add(grassMesh)
    this.grassMesh = grassMesh

    // Create and add goal
    const goal = createGoal()
    goal.position.set(0, 0, -20) // Position goal at the end of the field
    this.scene.add(goal)

    // Update the material when the GUI changes
    // $effect(() => {
    //   if (this.grassMesh) {
    //     // TODO: Add wind
    //     // const material = this.grassMesh.material as THREE.ShaderMaterial
    //     // material.uniforms.uWindStrength.value = this.guiVars.windStrength
    //     // material.uniforms.uWindSpeed.value = this.guiVars.windSpeed
    //     // material.uniforms.uWindDirection.value = this.guiVars.windDirection
    //   }
    // })
  }

  public updateControls(state: ControlsState): void {
    this.controlsState = state
  }

  public updateScene(state: ServerState): void {
    for (const ballId in state.balls) {
      if (this.balls.has(ballId)) {
        // Update existing ball position
        const ball = this.balls.get(ballId)
        if (ball) {
          ball.position.set(
            state.balls[ballId].position.x,
            state.balls[ballId].position.y,
            state.balls[ballId].position.z,
          )
          // Convert quaternion to Euler angles
          const quaternion = new THREE.Quaternion(
            state.balls[ballId].rotation.x,
            state.balls[ballId].rotation.y,
            state.balls[ballId].rotation.z,
            state.balls[ballId].rotation.w
          )
          ball.setRotationFromQuaternion(quaternion)

          // Contact shadow
          const shadow = this.ballShadows.get(ballId)
          if (shadow) {
            const h = Math.max(0, ball.position.y - 0.5)
            this.updateContactShadow(shadow, ball.position.x, ball.position.z, h, 0.8)
          }
        }
      } else {
        // Create new ball
        const ball = createBall(ballId, state.balls[ballId].color, new THREE.Vector3(state.balls[ballId].position.x, state.balls[ballId].position.y, state.balls[ballId].position.z))
        ball.renderOrder = 2
        this.balls.set(ballId, ball)
        this.scene.add(ball)

        const shadow = this.createContactShadowMesh(0.8)
        this.ballShadows.set(ballId, shadow)
        this.scene.add(shadow)
        const h = Math.max(0, ball.position.y - 0.5)
        this.updateContactShadow(shadow, ball.position.x, ball.position.z, h, 0.8)
      }
    }

    // Clean up balls that are no longer in the state
    for (const [id, ball] of this.balls) {
      if (!state.balls[id]) {
        this.scene.remove(ball)
        this.balls.delete(id)

        const shadow = this.ballShadows.get(id)
        if (shadow) {
          this.scene.remove(shadow)
          this.ballShadows.delete(id)
          shadow.geometry.dispose()
          ;(shadow.material as THREE.Material).dispose()
        }

        // Best-effort dispose (each ball currently has its own geometry/material)
        ball.geometry.dispose()
        const material = ball.material
        if (Array.isArray(material)) {
          for (const m of material) m.dispose()
        } else {
          material.dispose()
        }
      }
    }

    if (!state.connectionIds?.length || !this.cubes) {
      return
    }

    for (const id of state.connectionIds) {
      const serverStateCube = state.cubes[id]

      if (this.cubes.has(id)) {
        // Update existing cubes position
        const cube = this.cubes.get(id)
        if (cube) {
          cube.position.set(
            serverStateCube.position.x,
            serverStateCube.position.y,
            serverStateCube.position.z,
          )
          // Convert quaternion to Euler angles
          const quaternion = new THREE.Quaternion(
            serverStateCube.rotation.x,
            serverStateCube.rotation.y,
            serverStateCube.rotation.z,
            serverStateCube.rotation.w
          )
          cube.setRotationFromQuaternion(quaternion)

          const shadow = this.cubeShadows.get(id)
          if (shadow) {
            const h = Math.max(0, cube.position.y)
            this.updateContactShadow(shadow, cube.position.x, cube.position.z, h, 1.0)
          }

          // Update animation based on movement
          if ((cube as any).mixer) {
            const actions = (cube as any).actions as Record<string, THREE.AnimationAction>
            const currentAction = (cube as any).currentAction as string
            const isMoving = serverStateCube.moving
            const isKicking = serverStateCube.kicking
            
            // Determine target action
            let targetAction = 'idle'
            if (isKicking) {
              targetAction = 'kick'
            } else if (isMoving) {
              targetAction = 'run_forward'
            }
            
            // Only transition if the action needs to change
            if (targetAction !== currentAction && actions[targetAction]) {
              // Fade out current action
              if (actions[currentAction]) {
                actions[currentAction].fadeOut(0.2);
              }
              
              // Fade in and play new action
              actions[targetAction].reset();
              if (targetAction === 'kick') {
                // actions[targetAction].fadeIn(0.05);
              } else {
                actions[targetAction].fadeIn(0.2);
              }
              actions[targetAction].play();
              
              // Update current action
              (cube as any).currentAction = targetAction
            }
          }

          const newScore = serverStateCube.score
          const scoreLabel = cube.children.find(child => child.name.startsWith('score-')) as THREE.Sprite
          if (scoreLabel && newScore !== parseInt(scoreLabel.name.split('-')[1])) {
            // Remove old score label
            cube.remove(scoreLabel);
            
            // Create and add new score label
            const newScoreLabel = createCubeScoreLabel(newScore);
            if (newScoreLabel) {
              cube.add(newScoreLabel);
            }
          }
        }
      } else {
        // If the users cube is not in the state, they have not joined the game yet
        if (!serverStateCube) {
          continue
        }

        console.log(serverStateCube)

        // Create new cube
        createCube(id, state.cubes[id].color, state.cubes[id].name, state.cubes[id].score).then((cube) => {
          if (this.cubes.has(id)) {
            console.log('Cube already exists', id);
            return
          }
          
          this.cubes.set(id, cube);
          cube.renderOrder = 2
          this.scene.add(cube);

          const shadow = this.createContactShadowMesh(1.0)
          this.cubeShadows.set(id, shadow)
          this.scene.add(shadow)
          const h = Math.max(0, cube.position.y)
          this.updateContactShadow(shadow, cube.position.x, cube.position.z, h, 1.0)
          
          // Add mixer to our list of mixers to update
          if ((cube as any).mixer) {
            this.mixers.push((cube as any).mixer)
          }
        })
      }
    }

    // Clean up cubes that are no longer in the state
    for (const [id, cube] of this.cubes) {
      if (!state.connectionIds.includes(id)) {
        this.scene.remove(cube)
        this.cubes.delete(id)

        const shadow = this.cubeShadows.get(id)
        if (shadow) {
          this.scene.remove(shadow)
          this.cubeShadows.delete(id)
          shadow.geometry.dispose()
          ;(shadow.material as THREE.Material).dispose()
        }
        
        // Remove mixer from our list
        if ((cube as any).mixer) {
          const index = this.mixers.indexOf((cube as any).mixer)
          if (index !== -1) {
            this.mixers.splice(index, 1)
          }
        }
      }
    }

    // Handle goalie
    if (this.goalie) {
      const nowMs = performance.now()
      const nextPos = new THREE.Vector3(
        state.goalie.position.x,
        state.goalie.position.y,
        state.goalie.position.z,
      )

      let isMoving = true
      if (!this.hasGoaliePos) {
        this.hasGoaliePos = true
        this.lastGoalieUpdateMs = nowMs
        this.lastGoaliePos.copy(nextPos)
        isMoving = false
      } else {
        const dt = (nowMs - this.lastGoalieUpdateMs) / 1000
        if (dt > 0) {
          const dist = this.lastGoaliePos.distanceTo(nextPos)
          const speed = dist / dt
          isMoving = speed > 0.15
        } else {
          isMoving = false
        }
        this.lastGoalieUpdateMs = nowMs
        this.lastGoaliePos.copy(nextPos)
      }

      this.goalie.position.copy(nextPos)
      const quaternion = new THREE.Quaternion(
        state.goalie.rotation.x,
        state.goalie.rotation.y,
        state.goalie.rotation.z,
        state.goalie.rotation.w
      )
      this.goalie.setRotationFromQuaternion(quaternion)

      if (this.goalieShadow) {
        const h = Math.max(0, this.goalie.position.y)
        this.updateContactShadow(this.goalieShadow, this.goalie.position.x, this.goalie.position.z, h, 1.2)
      }

      if ((this.goalie as any).mixer) {
        const actions = (this.goalie as any).actions as Record<string, THREE.AnimationAction>
        const currentAction = (this.goalie as any).currentAction as string
        const targetAction = isMoving && actions['run_forward'] ? 'run_forward' : 'idle'

        if (targetAction !== currentAction && actions[targetAction]) {
          if (actions[currentAction]) {
            actions[currentAction].fadeOut(0.2)
          }
          actions[targetAction].reset()
          actions[targetAction].fadeIn(0.2)
          actions[targetAction].play()
          ;(this.goalie as any).currentAction = targetAction
        }
      }
    } else {
      createCube('goalie', state.goalie.color, undefined, undefined, 1.25).then((goalie) => {
        if (this.goalie) return

        this.goalie = goalie
        goalie.renderOrder = 2
        this.scene.add(goalie)
        if ((goalie as any).mixer) {
          this.mixers.push((goalie as any).mixer)
        }

        const shadow = this.createContactShadowMesh(1.2)
        this.goalieShadow = shadow
        this.scene.add(shadow)
        const h = Math.max(0, goalie.position.y)
        this.updateContactShadow(shadow, goalie.position.x, goalie.position.z, h, 1.2)
      })
    }

    // Update particles if they exist in the state
    if (state.particles) {
      this.updateParticles(state.particles)
    }

    this.needRender = true
  }

  public render(): void {
    if (!this.renderer) return
    
    // Update animations
    const delta = this.clock.getDelta()
    for (const mixer of this.mixers) {
      mixer.update(delta)
    }
    
    this.renderer.render(this.scene, this.camera)
  }

  public renderDebug(vertices: Record<number, number>, colors: Record<number, number>) {
    if (!vertices || !colors) {
      console.warn('No debug data to render.')
      return
    }
    const verticesArray = Object.values(vertices) as number[]
    const colorsArray = Object.values(colors) as number[]

    if (verticesArray.length === 0 || colorsArray.length === 0) {
      console.warn('No debug data to render.')
      return
    }

    // Remove existing debug object if any
    const existingDebugObject = this.scene.getObjectByName('rapierDebug')
    if (existingDebugObject) {
      this.scene.remove(existingDebugObject)
    }

    // Create BufferGeometry
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(verticesArray)
    const normalizedColors = new Float32Array(colorsArray)

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(normalizedColors, 4))
    geometry.computeBoundingSphere()

    // Create material
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
    })

    // Create LineSegments and add to scene
    const lineSegments = new THREE.LineSegments(geometry, material)
    lineSegments.name = 'rapierDebug'
    this.scene.add(lineSegments)
    this.needRender = true
  }

  private setupParticles() {
    this.particleGeometry = new THREE.BufferGeometry()
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.2,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      vertexColors: true
    })
  }

  private updateParticles(particles: { color: number, position: { x: number, y: number, z: number } }[]) {
    // Remove old particles
    for (const [id, points] of this.particles) {
      this.scene.remove(points)
      this.particles.delete(id)
    }

    if (particles.length === 0) return

    // Create new particle system
    const positions = new Float32Array(particles.length * 3)
    const colors = new Float32Array(particles.length * 3)

    particles.forEach((particle, i) => {
      // Extract RGB components from the color
      const r = ((particle.color >> 16) & 255) / 255
      const g = ((particle.color >> 8) & 255) / 255
      const b = (particle.color & 255) / 255

      positions[i * 3] = particle.position.x
      positions[i * 3 + 1] = particle.position.y
      positions[i * 3 + 2] = particle.position.z

      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
    })

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const points = new THREE.Points(geometry, this.particleMaterial)
    this.scene.add(points)
    this.particles.set('goalParticles', points)
    this.needRender = true
  }
}
