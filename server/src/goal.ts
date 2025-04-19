import RAPIER from '@dimforge/rapier3d-compat'

// Create goal colliders
const goalWidth = 15
const goalHeight = 5
const goalDepth = 3

export function createGoal(world: RAPIER.World): RAPIER.Collider {
  // Create a static rigid body for the goal
  const goalBodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(0, goalHeight/2, -20 - goalDepth/2)
  const goalBody = world.createRigidBody(goalBodyDesc)

  // Left post
  const leftPostCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, 0.1)
    .setTranslation(-goalWidth/2, 0, goalDepth/2)
  world.createCollider(leftPostCollider, goalBody)

  // Right post
  const rightPostCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, 0.1)
    .setTranslation(goalWidth/2, 0, goalDepth/2)
  world.createCollider(rightPostCollider, goalBody)

  // Crossbar
  const crossbarCollider = RAPIER.ColliderDesc.cuboid(goalWidth/2, 0.1, 0.1)
    .setTranslation(0, goalHeight/2, goalDepth/2)
  world.createCollider(crossbarCollider, goalBody)

  // Back of goal
  const backCollider = RAPIER.ColliderDesc.cuboid(goalWidth/2, goalHeight/2, 0.1)
    .setTranslation(0, 0, -goalDepth/2)
  world.createCollider(backCollider, goalBody)

  // Left side of goal
  const leftSideCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, goalDepth/2)
    .setTranslation(-goalWidth/2, 0, 0)
  world.createCollider(leftSideCollider, goalBody)

  // Right side of goal
  const rightSideCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, goalDepth/2)
    .setTranslation(goalWidth/2, 0, 0)
  world.createCollider(rightSideCollider, goalBody)

  // Top of goal
  const topCollider = RAPIER.ColliderDesc.cuboid(goalWidth/2, 0.1, goalDepth/2)
    .setTranslation(0, goalHeight/2, 0)
  world.createCollider(topCollider, goalBody)

  // Create goal sensor
  const goalSensor = RAPIER.ColliderDesc.cuboid(goalWidth/2 - 0.1, goalHeight/2 - 0.1, .1)
    .setTranslation(0, 0, goalDepth/2 - 0.5) // Position at the goal line
    .setSensor(true) // Make it a sensor so objects pass through
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL); // Enable collision events
  const goalSensorCollider = world.createCollider(goalSensor, goalBody);

  return goalSensorCollider;
}
