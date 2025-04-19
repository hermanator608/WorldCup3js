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
  cubes: Map<string, THREE.Mesh | THREE.Group> = new Map()
  serverState = $state<ServerState>({ connectionIds: [], cubes: {}, balls: {} })
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
        }
      } else {
        // Create new ball
        const ball = createBall(ballId, state.balls[ballId].color)
        this.balls.set(ballId, ball)
        this.scene.add(ball)
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

          // Update animation based on movement
          if ((cube as any).mixer) {
            const actions = (cube as any).actions as Record<string, THREE.AnimationAction>
            const currentAction = (cube as any).currentAction as string
            const isMoving = serverStateCube.moving
            
            // Determine target action
            const targetAction = isMoving ? 'run_forward' : 'idle'
            
            // Only transition if the action needs to change
            if (targetAction !== currentAction && actions[targetAction]) {
              // Fade out current action
              if (actions[currentAction]) {
                actions[currentAction].fadeOut(0.2);
              }
              
              // Fade in and play new action
              actions[targetAction].reset();
              actions[targetAction].fadeIn(0.2);
              actions[targetAction].play();
              
              // Update current action
              (cube as any).currentAction = targetAction
            }
          }

          const newScore = serverStateCube.score
          const scoreLabel = cube.children.find(child => child.name.startsWith('score-')) as THREE.Sprite
          if (scoreLabel && newScore !== parseInt(scoreLabel.name.split('-')[1])) {
            // Update score label
            const material = scoreLabel.material as THREE.SpriteMaterial
            const texture = material.map as THREE.CanvasTexture
            const canvas = texture.image as HTMLCanvasElement
            const context = canvas.getContext('2d')
            if (context) {
              context.clearRect(0, 0, canvas.width, canvas.height)
              context.fillStyle = 'white'
              context.font = '24px Arial'
              context.textAlign = 'center'
              context.textBaseline = 'middle'
              context.fillText(`Score: ${newScore}`, canvas.width / 2, canvas.height / 2)
              texture.needsUpdate = true
              scoreLabel.name = `score-${newScore}`
            }
          }
        }
      } else {
        // If the users cube is not in the state, they have not joined the game yet
        if (!serverStateCube) {
          continue
        }

        // Create new cube
        createCube(id, state.cubes[id].color, state.cubes[id].name, state.cubes[id].score).then((cube) => {
          this.cubes.set(id, cube)
          this.scene.add(cube)
          
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
        
        // Remove mixer from our list
        if ((cube as any).mixer) {
          const index = this.mixers.indexOf((cube as any).mixer)
          if (index !== -1) {
            this.mixers.splice(index, 1)
          }
        }
      }
    }

    // Clean up balls that are no longer in the state
    for (const [id, ball] of this.balls) {
      if (!state.balls[id]) {
        this.scene.remove(ball)
        this.balls.delete(id)
      }
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
