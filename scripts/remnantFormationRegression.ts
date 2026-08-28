import {
  COLLISION_FRACTURE_END_MS,
  COLLISION_TRANSFER_END_MS,
} from '../src/rendering/collisionHandoffLayer'
import {
  COLLISION_REMNANT_FORMATION_START_MS,
  COLLISION_REMNANT_SETTLE_END_MS,
  getCollisionVisualLifecycle,
} from '../src/rendering/collisionVisualOutcome'
import { getDisruptionChunkOpacity } from '../src/rendering/disruptionChunkVisual'
import {
  COLLISION_REMNANT_COMPRESSION_START,
  COLLISION_REMNANT_CORE_SCALE_MIN,
  COLLISION_REMNANT_DEFORMATION_START,
  COLLISION_REMNANT_FORMATION_TARGET_SCALE,
  getCollisionRemnantPresentationState,
} from '../src/rendering/liveCollisionVfxBridge'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function stateDistance(
  a: ReturnType<typeof getCollisionRemnantPresentationState>,
  b: ReturnType<typeof getCollisionRemnantPresentationState>,
) {
  return Math.max(
    Math.abs(a.scale - b.scale),
    Math.abs(a.opacity - b.opacity),
    Math.abs(a.deformation - b.deformation),
    Math.abs(a.compression - b.compression),
    Math.abs(a.heat - b.heat),
  )
}

function testInitialRemnantIsIrregularCoreInsteadOfTinyCompletedSphere() {
  const hidden = getCollisionRemnantPresentationState(COLLISION_REMNANT_FORMATION_START_MS, 0.5)
  const early = getCollisionRemnantPresentationState(COLLISION_REMNANT_FORMATION_START_MS + 180, 0.5)

  assert(hidden.opacity === 0, 'remnant must remain visually unowned at formation start')
  assert(
    hidden.scale >= COLLISION_REMNANT_CORE_SCALE_MIN,
    'formation core must not start from the old tiny 20%-scale sphere',
  )
  assert(
    hidden.deformation === COLLISION_REMNANT_DEFORMATION_START &&
      hidden.compression === COLLISION_REMNANT_COMPRESSION_START,
    'formation must begin as an irregular anisotropic core',
  )
  assert(early.opacity > 0 && early.opacity < 0.2, 'early core must emerge gradually')
  assert(early.deformation > 0.2, 'early visible core must retain strong irregularity')
  assert(early.compression > 0.14, 'early visible core must remain anisotropically compressed')
}

function testFormationAndSettlingAreContinuous() {
  const boundaries = [
    COLLISION_FRACTURE_END_MS,
    COLLISION_TRANSFER_END_MS,
    COLLISION_REMNANT_SETTLE_END_MS,
  ]

  boundaries.forEach((boundary) => {
    const before = getCollisionRemnantPresentationState(boundary - 1, 0.37)
    const after = getCollisionRemnantPresentationState(boundary + 1, 0.37)
    assert(
      stateDistance(before, after) < 0.015,
      `remnant presentation jumps across ${boundary}ms phase boundary`,
    )
  })

  const midFormation = getCollisionRemnantPresentationState(1500, 0.37)
  const settleStart = getCollisionRemnantPresentationState(COLLISION_TRANSFER_END_MS, 0.37)
  const settleMid = getCollisionRemnantPresentationState(2250, 0.37)

  assert(
    midFormation.scale < settleStart.scale && settleStart.scale === COLLISION_REMNANT_FORMATION_TARGET_SCALE,
    'formation must approach the near-final remnant size continuously',
  )
  assert(
    settleMid.scale > settleStart.scale && settleMid.scale < 1,
    'settling must finish the remaining silhouette convergence',
  )
  assert(
    settleMid.deformation < settleStart.deformation &&
      settleMid.compression < settleStart.compression &&
      settleMid.heat < settleStart.heat,
    'settling must reduce shape instability and thermal unrest together',
  )
}

function testLateTransferOverlapsSyntheticDebrisOwnership() {
  const elapsedMs = 1700
  const remnant = getCollisionRemnantPresentationState(elapsedMs, 0.5)
  const chunks = getDisruptionChunkOpacity(getCollisionVisualLifecycle(elapsedMs))

  assert(remnant.opacity > 0.7 && remnant.opacity < 1, 'late TRANSFER must partially reveal the remnant')
  assert(chunks > 0.45, 'late TRANSFER must still retain visible synthetic chunks')
  assert(
    remnant.deformation > 0 && remnant.compression > 0,
    'overlap must show an unfinished remnant rather than a completed sphere',
  )
}

function testStableStateMatchesPhysicalBodyExactly() {
  const stable = getCollisionRemnantPresentationState(COLLISION_REMNANT_SETTLE_END_MS, 0.91)

  assert(stable.scale === 1, 'stable remnant scale must equal the physical body scale')
  assert(stable.opacity === 1, 'stable remnant opacity must equal normal body opacity')
  assert(stable.deformation === 0, 'stable remnant deformation must be zero')
  assert(stable.compression === 0, 'stable remnant anisotropic compression must be zero')
  assert(stable.heat === 0, 'stable remnant transient formation heat must be zero')
}

const tests = [
  testInitialRemnantIsIrregularCoreInsteadOfTinyCompletedSphere,
  testFormationAndSettlingAreContinuous,
  testLateTransferOverlapsSyntheticDebrisOwnership,
  testStableStateMatchesPhysicalBodyExactly,
]

for (const test of tests) test()
console.log(`remnant formation regression checks passed (${tests.length})`)
