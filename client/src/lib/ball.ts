import * as THREE from 'three'

export function createBall(ballId: string, color: number): THREE.Mesh {
    const ballGeometry = new THREE.SphereGeometry(0.5, 32, 32)
    const ballMaterial = new THREE.MeshStandardMaterial({ color: color })
    const ball = new THREE.Mesh(ballGeometry, ballMaterial)
    ball.name = `ball-${ballId}`
    return ball
}