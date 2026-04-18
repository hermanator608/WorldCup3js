import RAPIER from '@dimforge/rapier3d-compat'

// Create goal colliders
export const GOAL_WIDTH = 15
export const GOAL_HEIGHT = 5
export const GOAL_DEPTH = 3

// World-space placement (matches previous hard-coded layout)
export const GOAL_CENTER_Z = -20

// Collision groups
// membership=16 (goal sensor), filter=2 (balls)
const GOAL_SENSOR_GROUPS = 0x00100002

export function createGoal(world: RAPIER.World): RAPIER.Collider {
  // Create a static rigid body for the goal
  const goalBodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(0, GOAL_HEIGHT/2, GOAL_CENTER_Z - GOAL_DEPTH/2)
  const goalBody = world.createRigidBody(goalBodyDesc)

  // Left post
  const leftPostCollider = RAPIER.ColliderDesc.cuboid(0.1, GOAL_HEIGHT/2, 0.1)
    .setTranslation(-GOAL_WIDTH/2, 0, GOAL_DEPTH/2)
  world.createCollider(leftPostCollider, goalBody)

  // Right post
  const rightPostCollider = RAPIER.ColliderDesc.cuboid(0.1, GOAL_HEIGHT/2, 0.1)
    .setTranslation(GOAL_WIDTH/2, 0, GOAL_DEPTH/2)
  world.createCollider(rightPostCollider, goalBody)

  // Crossbar
  const crossbarCollider = RAPIER.ColliderDesc.cuboid(GOAL_WIDTH/2, 0.1, 0.1)
    .setTranslation(0, GOAL_HEIGHT/2, GOAL_DEPTH/2)
  world.createCollider(crossbarCollider, goalBody)

  // Back of goal
  const backCollider = RAPIER.ColliderDesc.cuboid(GOAL_WIDTH/2, GOAL_HEIGHT/2, 0.1)
    .setTranslation(0, 0, -GOAL_DEPTH/2)
  world.createCollider(backCollider, goalBody)

  // Left side of goal
  const leftSideCollider = RAPIER.ColliderDesc.cuboid(0.1, GOAL_HEIGHT/2, GOAL_DEPTH/2)
    .setTranslation(-GOAL_WIDTH/2, 0, 0)
  world.createCollider(leftSideCollider, goalBody)

  // Right side of goal
  const rightSideCollider = RAPIER.ColliderDesc.cuboid(0.1, GOAL_HEIGHT/2, GOAL_DEPTH/2)
    .setTranslation(GOAL_WIDTH/2, 0, 0)
  world.createCollider(rightSideCollider, goalBody)

  // Top of goal
  const topCollider = RAPIER.ColliderDesc.cuboid(GOAL_WIDTH/2, 0.1, GOAL_DEPTH/2)
    .setTranslation(0, GOAL_HEIGHT/2, 0)
  world.createCollider(topCollider, goalBody)

  // Create goal sensor
  // Make this thicker along Z to avoid missed events at higher speeds / discrete steps.
  const goalSensor = RAPIER.ColliderDesc.cuboid(GOAL_WIDTH/2 - 0.1, GOAL_HEIGHT/2 - 0.1, 0.75)
    .setTranslation(0, 0, GOAL_DEPTH/2 - 0.5) // Position near the goal line
    .setSensor(true) // Make it a sensor so objects pass through
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL); // Enable collision events
  const goalSensorCollider = world.createCollider(goalSensor, goalBody);

  // Ensure the sensor interacts with balls regardless of other groups.
  goalSensorCollider.setCollisionGroups(GOAL_SENSOR_GROUPS)

  return goalSensorCollider;
}
