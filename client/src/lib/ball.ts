import * as THREE from 'three'

// Create a texture loader
const textureLoader = new THREE.TextureLoader()

// Load the soccer ball texture
const soccerBallTexture = textureLoader.load('/soccerball.jpeg')

export function createBall(ballId: string, color: number, initialPosition: THREE.Vector3): THREE.Mesh {
    // Create a more detailed sphere geometry
    const ballGeometry = new THREE.SphereGeometry(0.5, 64, 64)
    
    // Create a more realistic material with both texture and color
    const ballMaterial = new THREE.MeshStandardMaterial({
        map: soccerBallTexture,
        color: color,
        roughness: 0.7,
        metalness: 0.3,
        transparent: true,
        opacity: 0.9,
        envMapIntensity: 0.5
    })
    
    const ball = new THREE.Mesh(ballGeometry, ballMaterial)
    ball.name = `ball-${ballId}`
    
    ball.position.set(initialPosition.x, initialPosition.y, initialPosition.z)

    // Enable shadows
    ball.castShadow = true
    ball.receiveShadow = true
    
    return ball
}
