import {
  COLLISION_FRACTURE_END_MS,
  COLLISION_HANDOFF_DURATION_MS,
  COLLISION_IMPACT_HOLD_END_MS,
  COLLISION_TRANSFER_END_MS,
  getCollisionTransferParticleOpacity,
} from '../src/rendering/collisionHandoffLayer'
import { getCollisionVisualLifecycle } from '../src/rendering/collisionVisualOutcome'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function testOpacityBelongsToTransferParticlesNotSourceSphere() {
  assert(getCollisionTransferParticleOpacity(0) === 0, 'impact starts without a replacement sphere fade')
  assert(
    getCollisionTransferParticleOpacity(COLLISION_IMPACT_HOLD_END_MS) > 0,
    'impact boundary may begin contact-local transfer emission',
  )
  assert(
    getCollisionTransferParticleOpacity(COLLISION_FRACTURE_END_MS) > 0.45,
    'fracture completion must keep transfer data readable',
  )
  assert(
    getCollisionVisualLifecycle(COLLISION_FRACTURE_END_MS).phase === 'TRANSFER',
    'opacity handoff must be driven by explicit TRANSFER state',
  )
  assert(
    getCollisionTransferParticleOpacity(COLLISION_TRANSFER_END_MS) > 0,
    'transfer particles may persist into REMNANT_SETTLE without preserving a sphere',
  )
  assert(
    getCollisionTransferParticleOpacity(COLLISION_HANDOFF_DURATION_MS) === 0,
    'transfer particle opacity must end with the lifecycle',
  )
}

testOpacityBelongsToTransferParticlesNotSourceSphere()
console.log('collision handoff transfer opacity regression passed')
