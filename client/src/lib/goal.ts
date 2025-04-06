import * as THREE from 'three'

export function createGoal(): THREE.Group {
    const goalGroup = new THREE.Group()
    
    // Goal dimensions
    const width = 15
    const height = 5
    const depth = 3
    
    // Create goal material
    const goalMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0.2
    })
    
    // Create goal posts and crossbar
    const postGeometry = new THREE.BoxGeometry(0.2, height, 0.2)
    const crossbarGeometry = new THREE.BoxGeometry(width, 0.2, 0.2)
    
    // Left post
    const leftPost = new THREE.Mesh(postGeometry, goalMaterial)
    leftPost.position.set(-width/2, height/2, 0)
    leftPost.castShadow = true
    goalGroup.add(leftPost)
    
    // Right post
    const rightPost = new THREE.Mesh(postGeometry, goalMaterial)
    rightPost.position.set(width/2, height/2, 0)
    rightPost.castShadow = true
    goalGroup.add(rightPost)
    
    // Crossbar
    const crossbar = new THREE.Mesh(crossbarGeometry, goalMaterial)
    crossbar.position.set(0, height, 0)
    crossbar.castShadow = true
    goalGroup.add(crossbar)
    
    // Net
    const netMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7,
        roughness: 0.9,
        metalness: 0.1
    })
    
    // Create net using a grid of lines
    const netGeometry = new THREE.BufferGeometry()
    const netPositions = []
    
    // Create vertical net lines
    for (let x = -width/2; x <= width/2; x += 0.5) {
        netPositions.push(x, 0, -depth)
        netPositions.push(x, height, -depth)
    }
    
    // Create horizontal net lines
    for (let y = 2; y <= height; y += 0.5) {
        netPositions.push(-width/2, y, 0)
        netPositions.push(width/2, y, 0)
    }
    
    // Create depth net lines
    for (let z = 0; z <= depth; z += 0.5) {
        // Bottom
        netPositions.push(-width/2, 0, -z)
        netPositions.push(width/2, 0, -z)
        // Top  
        netPositions.push(-width/2, height, -z)
        netPositions.push(width/2, height, -z)
        // Left
        netPositions.push(-width/2, 0, -z)
        netPositions.push(-width/2, height, -z)
        // Right
        netPositions.push(width/2, 0, -z)
        netPositions.push(width/2, height, -z)
    }
    
    netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netPositions, 3))
    
    const net = new THREE.LineSegments(netGeometry, netMaterial)
    goalGroup.add(net)
    
    return goalGroup
} 
