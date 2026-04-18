import RAPIER from '@dimforge/rapier3d-compat'
export interface Ball {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  color: number
  markedForRemoval?: boolean
  removalTime?: number
  whoLastControlledId?: string
}

export function createBall(world: RAPIER.World): Ball {
  // Create a dynamic rigidBody with a random position
  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setCcdEnabled(true)
    .setTranslation(
      Math.random() * 10.0 - 5.0,
      10.0,
      Math.random() * 10.0 - 5.0,
    );
  const rigidBody = world.createRigidBody(rigidBodyDesc);

  // Create a sphereical collider attached to the dynamic rigidBody.
  const colliderDesc = RAPIER.ColliderDesc.ball(0.5)
  const collider = world.createCollider(colliderDesc, rigidBody)
  collider.setRestitution(0.7); // Make the ball bouncy
  // membership=2 (balls), filter=1 (players/goal/ground default) | 2 (balls) | 4 (goalie)
  collider.setCollisionGroups(0x00020007);

  // Random color
  const color = Math.floor(Math.random() * 16777215)

  return { body: rigidBody, collider, color }
}

export function removeBall(world: RAPIER.World, ball: Ball) {
  world.removeRigidBody(ball.body)
  world.removeCollider(ball.collider, true)
}
