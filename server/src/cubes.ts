import RAPIER from '@dimforge/rapier3d-compat'
export interface Cube {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  color: number
  name: string
  score: number
  kicking: boolean
  ballControlCooldown: number // Timestamp when cube can control balls again
}

export function createCube(world: RAPIER.World, name: string, isKinematic: boolean = false, colliderHeight: number = 1, colliderRadius: number = 1): Cube {
  // Create a dynamic rigidBody with a random position
  const rigidBodyDesc = isKinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic()
  rigidBodyDesc
    .setTranslation(
      Math.random() * 10.0 - 5.0,
      10.0,
      Math.random() * 10.0 - 5.0,
    )
    .enabledRotations(false, true, false)  // Lock X and Z rotation, allow only Y rotation
    .setAngularDamping(5.0) // Add angular damping to prevent infinite spinning
    .setLinearDamping(2.0); // Reduced linear damping for smoother movement
  const rigidBody = world.createRigidBody(rigidBodyDesc)

  // Create a cuboid collider attached to the dynamic rigidBody.
  const colliderDesc = RAPIER.ColliderDesc.capsule(colliderHeight/2, colliderRadius)
    .setMass(1)
    .setTranslation(0, colliderHeight/2 + colliderRadius, 0) // Offset collider up by half its height
    .setFriction(0.5)        // Reduced friction for smoother movement
    .setRestitution(0.0);    // No bouncing
  const collider = world.createCollider(colliderDesc, rigidBody)

  collider.setCollisionGroups(0x00010001) // Group 1

  // Random color
  const color = Math.floor(Math.random() * 16777215)

  return { 
    body: rigidBody, 
    collider, 
    color, 
    name, 
    score: 0, 
    kicking: false,
    ballControlCooldown: 0 
  }
}

export function removeCube(world: RAPIER.World, cube: Cube) {
  world.removeRigidBody(cube.body)
  world.removeCollider(cube.collider, true)
}
