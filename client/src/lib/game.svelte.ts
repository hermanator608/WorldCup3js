import * as THREE from 'three'
import { createCube } from './cube'
import type { ServerState, ControlsState } from '@repo/models'
import { generateField } from './field'
import { createBall } from './ball'
import { createGoal } from './goal'

let instance: Game | undefined

export class Game {
  canvas: HTMLCanvasElement | undefined
  renderer: THREE.WebGLRenderer | undefined
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  needRender = false
  balls: Map<string, THREE.Mesh> = new Map()
  cubes: Map<string, THREE.Mesh> = new Map()
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

  static getInstance(guiVars: any): Game {
    if (!instance) {
      instance = new Game(guiVars)
    }
    return instance
  }

  private constructor(guiVars: any) {
    this.guiVars = guiVars
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.camera.position.set(0, 18, 25)
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
      if (this.cubes.has(id)) {
        // Update existing cubes position
        const cube = this.cubes.get(id)
        if (cube) {
          cube.position.set(
            state.cubes[id].position.x,
            state.cubes[id].position.y,
            state.cubes[id].position.z,
          )
          // Convert quaternion to Euler angles
          const quaternion = new THREE.Quaternion(
            state.cubes[id].rotation.x,
            state.cubes[id].rotation.y,
            state.cubes[id].rotation.z,
            state.cubes[id].rotation.w
          )
          cube.setRotationFromQuaternion(quaternion)
          
          // Ensure arrow stays on top
          const arrow = cube.children[0] as THREE.Mesh;
          if (arrow) {
            arrow.rotation.x = Math.PI / 2; // Keep arrow pointing forward
            arrow.rotation.y = 0;
            arrow.rotation.z = 0;
          }
        }
      } else {
        // Create new cube
        const cube = createCube(id, state.cubes[id].color)
        this.cubes.set(id, cube)
        this.scene.add(cube)
      }
    }
    // Clean up cubes that are no longer in the state
    for (const [id, cube] of this.cubes) {
      if (!state.connectionIds.includes(id)) {
        this.scene.remove(cube)
        this.cubes.delete(id)
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
