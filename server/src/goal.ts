import RAPIER from '@dimforge/rapier3d-compat'

// Create goal colliders
const goalWidth = 15
const goalHeight = 5
const goalDepth = 3

export function createGoal(world: RAPIER.World): RAPIER.Collider {
  // Left post
  const leftPostCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, 0.1)
    .setTranslation(-goalWidth/2, goalHeight/2, -20)
  world.createCollider(leftPostCollider)

  // Right post
  const rightPostCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, 0.1)
    .setTranslation(goalWidth/2, goalHeight/2, -20)
  world.createCollider(rightPostCollider)

  // Crossbar
  const crossbarCollider = RAPIER.ColliderDesc.cuboid(goalWidth/2, 0.1, 0.1)
    .setTranslation(0, goalHeight, -20)
  world.createCollider(crossbarCollider)

  // Back of goal
  const backCollider = RAPIER.ColliderDesc.cuboid(goalWidth/2, goalHeight/2, 0.1)
    .setTranslation(0, goalHeight/2, -20 - goalDepth)
  world.createCollider(backCollider)

  // Left side of goal
  const leftSideCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, goalDepth/2)
    .setTranslation(-goalWidth/2, goalHeight/2, -20 - goalDepth/2)
  world.createCollider(leftSideCollider)

  // Right side of goal
  const rightSideCollider = RAPIER.ColliderDesc.cuboid(0.1, goalHeight/2, goalDepth/2)
    .setTranslation(goalWidth/2, goalHeight/2, -20 - goalDepth/2)
  world.createCollider(rightSideCollider)

  // Create goal sensor
  const goalSensor = RAPIER.ColliderDesc.cuboid(goalWidth/2 - 0.1, goalHeight/2 - 0.1, .1)
    .setTranslation(0, goalHeight/2, -20 - .5) // Position at the goal line
    .setSensor(true) // Make it a sensor so objects pass through
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS) // Enable collision events
  const goalSensorCollider = world.createCollider(goalSensor);

  return goalSensorCollider;
}
