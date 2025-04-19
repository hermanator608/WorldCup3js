import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Create a texture loader
const gltfLoader = new GLTFLoader()

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const fontSize = isTouchDevice ? 60 : 60;

export const createCube = (id: string, color: number, name?: string, score?: number, scale?: number): Promise<THREE.Group<THREE.Object3DEventMap>> => {
  // Load the GLB model
  return gltfLoader.loadAsync('/soccer_player.glb').then((gltf) => {
    console.log('GLB model loaded')
    const model = gltf.scene
    model.name = id
    
    // Scale the model to appropriate size
    if (scale) {
      model.scale.set(scale, scale, scale)
    } else {
      model.scale.set(0.90, 0.90, 0.90)
    }
    
    // Shift the model up by half the physics collider height (0.5) to align bottoms
    model.position.y = -5;
    
    // Apply the color to the model's materials
    model.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        const material = new THREE.MeshStandardMaterial({
          opacity: 0.1,
          color: color,
          roughness: 0.4,
          metalness: 0.2
        })
        child.material = material
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    // Set up animations if they exist
    if (gltf.animations && gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(model)
      const actions: Record<string, THREE.AnimationAction> = {}
      
      // Create actions for each animation
      gltf.animations.forEach((clip) => {
        const action = mixer.clipAction(clip)
        
        // Configure animation based on type
        if (clip.name === 'kick') {
          action.setLoop(THREE.LoopOnce, 1)    // Play kick animation only once
          action.clampWhenFinished = false;    // Don't hold the last frame
          action.setDuration(0.3);             // Speed up the kick animation
        } else {
          action.setLoop(THREE.LoopRepeat, Infinity)
        }
        
        action.setEffectiveTimeScale(1.0)
        action.setEffectiveWeight(1.0)
        
        if (!actions[clip.name]) {
          actions[clip.name] = action
        }
      })
      
      // Start with idle animation
      if (actions['idle']) {
        actions['idle'].play()
      }
      
      // Store mixer and actions on the model for later use
      (model as any).mixer = mixer;
      (model as any).actions = actions;
      (model as any).currentAction = 'idle'
    }

    if (name !== undefined) {
      // Create initial name label with empty string
      const nameLabel = createCubeNameLabel(name)
      if (nameLabel) {
        model.add(nameLabel)
      }
    }

    if (score !== undefined) {
      // Create score label
      const scoreLabel = createCubeScoreLabel(score)
      if (scoreLabel) {
        model.add(scoreLabel)
      }
    }
    
    return model
  })
}

export const createCubeNameLabel = (name: string): THREE.Sprite | undefined => {
  // Create name label
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context) {
    canvas.width = 256
    canvas.height = 64
    context.fillStyle = 'white'
    context.font = `${fontSize}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(name, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(2, 0.5, 1)
    sprite.position.set(0, 4, 0) // Position above the cube

    sprite.name = name

    return sprite
  }
}

export const createCubeScoreLabel = (score: number): THREE.Sprite | undefined => {
  // Create score label
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context) {
    canvas.width = 256
    canvas.height = 64
    context.fillStyle = 'white'
    context.font = `${fontSize}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(2, 0.5, 1)
    sprite.position.set(0, 3.3, 0) // Position above the name label

    sprite.name = `score-${score}`

    return sprite
  }
}
