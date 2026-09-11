import {
  COLLISION_FRACTURE_END_MS,
  COLLISION_HANDOFF_DURATION_MS,
  COLLISION_IMPACT_HOLD_END_MS,
  COLLISION_TRANSFER_END_MS,
  getCollisionTransferParticleOpacity,
  getDisruptionContactPatchTravelScale,
  getDisruptionTransferParticleOpacity,
  getDisruptionTransferPointSize,
} from '../src/rendering/collisionHandoffLayer'
import { getCollisionVisualLifecycle } from '../src/rendering/collisionVisualOutcome'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function testOpacityBelongsToTransferParticlesNotSourceSphere() {
  assert(getCollisionTransferParticleOpacity(0) === 0, 'generic transfer starts without a replacement sphere fade')
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

function testDisruptionContactPatchIsVisibleBeforeRemnantFormation() {
  assert(
    getDisruptionTransferParticleOpacity(0) >= 0.24,
    'disruption must show contact-local transfer immediately after source removal',
  )
  assert(
    getDisruptionTransferParticleOpacity(COLLISION_IMPACT_HOLD_END_MS) >= 0.30,
    'disruption contact patch must remain readable at the IMPACT/FRACTURE boundary',
  )
  assert(
    getDisruptionContactPatchTravelScale(0) >= 0.05,
    'disruption particles must not collapse to one point at handoff start',
  )
  assert(
    getDisruptionContactPatchTravelScale(COLLISION_IMPACT_HOLD_END_MS) >= 0.12,
    'disruption particles must occupy a contact patch before fracture propagation',
  )
  assert(
    getDisruptionContactPatchTravelScale(COLLISION_FRACTURE_END_MS) === 0,
    'temporary contact-patch spread must hand ownership to fracture travel',
  )
  assert(
    getDisruptionTransferPointSize(COLLISION_IMPACT_HOLD_END_MS) >= 3.8,
    'disruption contact patch point sprites must remain connected at the IMPACT/FRACTURE boundary',
  )
  assert(
    getDisruptionTransferPointSize(520) >= 3.4,
    'early fracture particles must stay visually connected before remnant formation becomes readable',
  )
  assert(
    getDisruptionTransferPointSize(COLLISION_FRACTURE_END_MS) < 2.5,
    'contact-patch point-size boost must retire by fracture completion',
  )
  assert(
    getDisruptionTransferParticleOpacity(COLLISION_HANDOFF_DURATION_MS) === 0,
    'disruption contact particles must still retire with the handoff lifecycle',
  )
}

testOpacityBelongsToTransferParticlesNotSourceSphere()
testDisruptionContactPatchIsVisibleBeforeRemnantFormation()
console.log('collision handoff transfer opacity regression passed')
