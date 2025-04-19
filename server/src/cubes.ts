import RAPIER from '@dimforge/rapier3d-compat'
export interface Cube {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  color: number
  name: string
  score: number
  kicking: boolean
}

export function createCube(world: RAPIER.World, name: string): Cube {
  // Create a dynamic rigidBody with a random position
  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(
      Math.random() * 10.0 - 5.0,
      10.0,
      Math.random() * 10.0 - 5.0,
    )
    .enabledRotations(false, true, false)  // Lock X and Z rotation, allow only Y rotation
    .setAngularDamping(5.0); // Add angular damping to prevent infinite spinning
  const rigidBody = world.createRigidBody(rigidBodyDesc)

  // Create a cuboid collider attached to the dynamic rigidBody.
  const colliderDesc = RAPIER.ColliderDesc.capsule(1, 0.5)
    .setMass(1)
    .setTranslation(0, 1.5, 0); // Offset collider up by half its height
  const collider = world.createCollider(colliderDesc, rigidBody)

  collider.setCollisionGroups(0x00010001) // Group 1

  // Random color
  const color = Math.floor(Math.random() * 16777215)

  return { body: rigidBody, collider, color, name, score: 0, kicking: false }
}

export function removeCube(world: RAPIER.World, cube: Cube) {
  world.removeRigidBody(cube.body)
  world.removeCollider(cube.collider, true)
}
