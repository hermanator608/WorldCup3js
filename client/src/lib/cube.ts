import * as THREE from 'three'

export function createCube(id: string, color: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  
  // Create a more detailed material with roughness and metalness
  const material = new THREE.MeshStandardMaterial({ 
    color,
    roughness: 0.4,
    metalness: 0.2,
    flatShading: false // Enable smooth shading
  })
  
  const cube = new THREE.Mesh(geometry, material)
  cube.castShadow = true
  cube.receiveShadow = true

  // Create arrow indicator
  const arrowGeometry = new THREE.ConeGeometry(0.2, 0.5, 4)
  const arrowMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0.8
  })
  const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial)
  arrow.castShadow = true
  
  // Position arrow on top of cube
  arrow.position.y = 0.75
  arrow.rotation.x = Math.PI / 2 // Rotate to point forward
  
  // Add arrow to cube
  cube.add(arrow)
  
  return cube
}
