import {
  COLLISION_FRACTURE_END_MS,
  COLLISION_TRANSFER_END_MS,
} from '../src/rendering/collisionHandoffLayer'
import { getCollisionEffectProfile } from '../src/rendering/collisionEffectProfile'
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
import type { BodyState } from '../src/types'

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

function getRemnantSilhouetteBounds(
  state: ReturnType<typeof getCollisionRemnantPresentationState>,
  physicalRadius: number,
) {
  const radialVariation = state.deformation * (0.34 + 0.19 + 0.14)
  const axisRadius = physicalRadius * state.scale * (1 - state.compression)
  const perpendicularRadius = physicalRadius * state.scale * (1 + state.compression * 0.16)
  const minimumRadius = Math.min(axisRadius, perpendicularRadius) * (1 - radialVariation)
  const maximumRadius = Math.max(axisRadius, perpendicularRadius) * (1 + radialVariation)
  return {
    minimumRadius,
    maximumRadius,
    aspectRatio: maximumRadius / Math.max(minimumRadius, 1e-9),
  }
}

function testInitialRemnantKeepsSourceScaleContinuity() {
  const hidden = getCollisionRemnantPresentationState(COLLISION_REMNANT_FORMATION_START_MS, 0.5)
  const early = getCollisionRemnantPresentationState(COLLISION_REMNANT_FORMATION_START_MS + 180, 0.5)
  const sourceRadius = 0.28
  const resultRadius = 0.30
  const earlyVisualRadius = resultRadius * early.scale
  const silhouette = getRemnantSilhouetteBounds(early, resultRadius)

  assert(hidden.opacity === 0, 'remnant must remain visually unowned at formation start')
  assert(
    hidden.scale >= COLLISION_REMNANT_CORE_SCALE_MIN,
    'formation core must begin near the physical remnant radius instead of collapsing to a tiny sphere',
  )
  assert(
    earlyVisualRadius >= sourceRadius * 0.90 && earlyVisualRadius <= sourceRadius * 1.05,
    'first visible remnant radius must stay continuous with the last source silhouette',
  )
  assert(
    hidden.deformation === COLLISION_REMNANT_DEFORMATION_START &&
      hidden.compression === COLLISION_REMNANT_COMPRESSION_START,
    'formation must still begin as an irregular anisotropic core',
  )
  assert(early.opacity > 0 && early.opacity < 0.2, 'early core must emerge gradually')
  assert(early.deformation > 0.16, 'early visible core must retain irregularity')
  assert(early.compression > 0.11, 'early visible core must remain anisotropically compressed')
  assert(
    silhouette.aspectRatio < 1.7,
    'early remnant contact/perpendicular axes must not collapse into an extreme elongated shape',
  )
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
    1 - settleStart.scale <= 0.025,
    'REMNANT_SETTLE must not contain a second visible expansion stage',
  )
  assert(
    settleMid.deformation < settleStart.deformation &&
      settleMid.compression < settleStart.compression &&
      settleMid.heat < settleStart.heat,
    'settling must reduce shape instability and thermal unrest together',
  )
}

function testFrameToFrameSilhouetteMovementIsBounded() {
  const resultRadius = 0.30
  let previous = getRemnantSilhouetteBounds(
    getCollisionRemnantPresentationState(COLLISION_REMNANT_FORMATION_START_MS, 0.61),
    resultRadius,
  )

  for (
    let elapsedMs = COLLISION_REMNANT_FORMATION_START_MS + 16;
    elapsedMs <= COLLISION_REMNANT_SETTLE_END_MS;
    elapsedMs += 16
  ) {
    const next = getRemnantSilhouetteBounds(
      getCollisionRemnantPresentationState(elapsedMs, 0.61),
      resultRadius,
    )
    const maximumStep = Math.abs(next.maximumRadius - previous.maximumRadius) /
      Math.max(previous.maximumRadius, 1e-9)
    const minimumStep = Math.abs(next.minimumRadius - previous.minimumRadius) /
      Math.max(previous.minimumRadius, 1e-9)
    assert(maximumStep < 0.02, `${elapsedMs}ms: outer remnant silhouette jumps between adjacent frames`)
    assert(minimumStep < 0.02, `${elapsedMs}ms: contact-axis remnant silhouette jumps between adjacent frames`)
    previous = next
  }
}

function testNonStellarImpactSheetAspectRatioIsBounded() {
  const compressionShear: BodyState = {
    id: 'regression:solid:compression-shear',
    name: 'Compression shear',
    color: '#d49a63',
    mass: 0,
    radius: 0.13,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age: 0.08,
    lifetime: 0.82,
    effectVisual: {
      kind: 'compressionShear',
      direction: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      stellarCollision: false,
      stretch: 8,
      widthScale: 0.12,
    },
  }
  const profile = getCollisionEffectProfile(compressionShear)
  const aspectRatio = profile.anisotropicStretch / Math.max(profile.widthScale, 1e-9)

  assert(profile.anisotropicStretch <= 1.90, 'solid compression sheet stretch must stay bounded')
  assert(profile.widthScale >= 0.64, 'solid compression sheet must retain enough contact width')
  assert(aspectRatio <= 3, 'solid collision impact must not render as a narrow light pillar')
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
  testInitialRemnantKeepsSourceScaleContinuity,
  testFormationAndSettlingAreContinuous,
  testFrameToFrameSilhouetteMovementIsBounded,
  testNonStellarImpactSheetAspectRatioIsBounded,
  testLateTransferOverlapsSyntheticDebrisOwnership,
  testStableStateMatchesPhysicalBodyExactly,
]

for (const test of tests) test()
console.log(`remnant formation regression checks passed (${tests.length})`)
