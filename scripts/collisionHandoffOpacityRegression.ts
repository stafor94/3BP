import {
  COLLISION_BREAKUP_END_MS,
  COLLISION_FRACTURE_END_MS,
  COLLISION_HANDOFF_DURATION_MS,
  getCollisionHandoffSourceOpacity,
} from '../src/rendering/collisionHandoffLayer'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function testBreakupTransfersVisualOwnershipWithoutShorteningHandoff() {
  assert(
    getCollisionHandoffSourceOpacity(COLLISION_FRACTURE_END_MS) >= 0.98,
    'source surface must remain effectively opaque through the fracture phase',
  )

  const midBreakupOpacity = getCollisionHandoffSourceOpacity(1500)
  assert(
    midBreakupOpacity >= 0.45 && midBreakupOpacity <= 0.62,
    'mid-breakup source ownership must cross-fade instead of staying fully opaque',
  )

  const breakupEndOpacity = getCollisionHandoffSourceOpacity(COLLISION_BREAKUP_END_MS)
  assert(
    breakupEndOpacity >= 0.08 && breakupEndOpacity <= 0.16,
    'physical result must visually dominate by breakup completion',
  )

  assert(
    getCollisionHandoffSourceOpacity(2200) < breakupEndOpacity,
    'late source fade must continue after breakup ownership transfer',
  )
  assert(
    getCollisionHandoffSourceOpacity(COLLISION_HANDOFF_DURATION_MS) === 0,
    'source snapshot must still use the full 2.6 second lifecycle',
  )
}

testBreakupTransfersVisualOwnershipWithoutShorteningHandoff()
console.log('collision handoff opacity regression passed')
