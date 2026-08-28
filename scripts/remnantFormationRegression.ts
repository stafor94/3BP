import { COLLISION_TRANSFER_END_MS } from '../src/rendering/collisionHandoffLayer'
import { getCollisionEffectProfile } from '../src/rendering/collisionEffectProfile'
import { COLLISION_REMNANT_SETTLE_END_MS, getCollisionVisualLifecycle } from '../src/rendering/collisionVisualOutcome'
import {
  COLLISION_REMNANT_VISIBLE_OPACITY_THRESHOLD,
  getCollisionEffectSilhouetteMetrics,
  getCollisionRemnantContinuityState,
  getCollisionRemnantSilhouetteMetrics,
} from '../src/rendering/collisionVisualContinuity'
import { getDisruptionChunkOpacity } from '../src/rendering/disruptionChunkVisual'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeEffect(kind: 'contactFlash' | 'compressionShear', stellarCollision: boolean): BodyState {
  return {
    id: `regression:${stellarCollision ? 'stellar' : 'solid'}:${kind}`,
    name: kind,
    color: '#d49a63',
    mass: 0,
    radius: 0.13,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age: 0.08,
    lifetime: kind === 'contactFlash' ? 0.72 : 0.82,
    effectVisual: {
      kind,
      direction: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      stellarCollision,
      stretch: kind === 'contactFlash' ? 3.8 : 7.2,
      widthScale: 0.22,
      tailLength: kind === 'compressionShear' ? 0.7 : 0,
    },
  }
}

function testSourceToRemnantOwnershipOverlap() {
  const sourceRadius = 0.28
  const resultRadius = 0.30
  const initial = getCollisionRemnantContinuityState(0, sourceRadius, resultRadius, 0.5)
  const impactEnd = getCollisionRemnantContinuityState(260, sourceRadius, resultRadius, 0.5)
  const chunksAtImpact = getDisruptionChunkOpacity(getCollisionVisualLifecycle(0))
  const chunksAtImpactEnd = getDisruptionChunkOpacity(getCollisionVisualLifecycle(260))
  assert(initial.opacity >= 0.30 && initial.opacity < COLLISION_REMNANT_VISIBLE_OPACITY_THRESHOLD,
    'result must own a low-opacity source-sized silhouette from its first draw')
  assert(impactEnd.opacity > initial.opacity, 'result ownership must rise before the old 520ms reveal boundary')
  assert(chunksAtImpact >= 0.45 && chunksAtImpactEnd >= 0.65,
    'existing source chunks must overlap the early result ownership window')
  const metrics = getCollisionRemnantSilhouetteMetrics(initial, resultRadius)
  assert(Math.abs(metrics.equivalentRadius - sourceRadius) < 1e-9,
    'first result draw must inherit the source equivalent radius instead of a tiny core')
}

function testFirstMeaningfulRemnantMatchesSourceSilhouette() {
  const sourceRadius = 0.28
  const resultRadius = 0.30
  let firstVisible: ReturnType<typeof getCollisionRemnantContinuityState> | null = null
  let firstVisibleMs = 0
  for (let elapsedMs = 0; elapsedMs <= COLLISION_REMNANT_SETTLE_END_MS; elapsedMs += 16) {
    const state = getCollisionRemnantContinuityState(elapsedMs, sourceRadius, resultRadius, 0.5)
    if (state.opacity >= COLLISION_REMNANT_VISIBLE_OPACITY_THRESHOLD) {
      firstVisible = state
      firstVisibleMs = elapsedMs
      break
    }
  }
  assert(firstVisible, 'remnant must cross the meaningful visibility threshold')
  const metrics = getCollisionRemnantSilhouetteMetrics(firstVisible, resultRadius)
  const equivalentRatio = metrics.equivalentRadius / sourceRadius
  const boundingRatio = metrics.boundingRadius / sourceRadius
  assert(equivalentRatio >= 0.90 && equivalentRatio <= 1.05,
    `${firstVisibleMs}ms: first meaningful remnant equivalent radius must stay within 90-105% of source`)
  assert(boundingRatio <= 1.08,
    `${firstVisibleMs}ms: first meaningful remnant bounding radius must stay close to the source silhouette`)
  assert(metrics.aspectRatio <= 1.12,
    `${firstVisibleMs}ms: first meaningful remnant must not read as a crushed core`)
}

function testFrameLevelRadiusContinuity() {
  const sourceRadius = 0.28
  const resultRadius = 0.30
  let previousRadius = sourceRadius
  for (let elapsedMs = 0; elapsedMs <= 1000; elapsedMs += 16) {
    const state = getCollisionRemnantContinuityState(elapsedMs, sourceRadius, resultRadius, 0.61)
    const metrics = getCollisionRemnantSilhouetteMetrics(state, resultRadius)
    const delta = Math.abs(metrics.equivalentRadius - previousRadius) / Math.max(previousRadius, 1e-9)
    assert(delta < 0.02, `${elapsedMs}ms: adjacent-frame remnant radius jumps by ${(delta * 100).toFixed(2)}%`)
    previousRadius = metrics.equivalentRadius
  }
}

function testVisibleGrowthStaysBelowThreePercent() {
  const sourceRadius = 0.28
  const resultRadius = 0.30
  let firstVisibleRadius = 0
  for (let elapsedMs = 0; elapsedMs <= COLLISION_REMNANT_SETTLE_END_MS; elapsedMs += 16) {
    const state = getCollisionRemnantContinuityState(elapsedMs, sourceRadius, resultRadius, 0.37)
    if (state.opacity < COLLISION_REMNANT_VISIBLE_OPACITY_THRESHOLD) continue
    firstVisibleRadius = getCollisionRemnantSilhouetteMetrics(state, resultRadius).equivalentRadius
    break
  }
  assert(firstVisibleRadius > 0, 'visible remnant radius sample must exist')
  const stable = getCollisionRemnantSilhouetteMetrics(
    getCollisionRemnantContinuityState(COLLISION_REMNANT_SETTLE_END_MS, sourceRadius, resultRadius, 0.37),
    resultRadius,
  )
  const growth = stable.equivalentRadius / firstVisibleRadius - 1
  assert(growth <= 0.03,
    `visible remnant growth must stay <= 3%, received ${(growth * 100).toFixed(2)}%`)
}

function testDeformationPreservesEquivalentMass() {
  const sourceRadius = 0.28
  const resultRadius = 0.30
  for (const elapsedMs of [0, 260, 520, 1050, 1880, 2200]) {
    const state = getCollisionRemnantContinuityState(elapsedMs, sourceRadius, resultRadius, 0.73)
    const metrics = getCollisionRemnantSilhouetteMetrics(state, resultRadius)
    const expected = resultRadius * state.scale
    assert(Math.abs(metrics.equivalentRadius - expected) < 1e-9,
      `${elapsedMs}ms: anisotropic deformation must preserve equivalent radius`)
    assert(metrics.aspectRatio < 1.35,
      `${elapsedMs}ms: deformation must remain shape-only rather than collapse one axis`)
  }
}

function testFinalNonStellarImpactTransformCannotBecomePillar() {
  const solidFlash = getCollisionEffectProfile(makeEffect('contactFlash', false))
  const solidShear = getCollisionEffectProfile(makeEffect('compressionShear', false))
  for (const profile of [solidFlash, solidShear]) {
    const metrics = getCollisionEffectSilhouetteMetrics(profile)
    assert(profile.tailLength < 0, `${profile.kind}: solid effect must select the compact final shader path`)
    assert(metrics.transformAspectRatio <= 1.82, `${profile.kind}: final plane transform must remain broad`)
    assert(metrics.finalSilhouetteAspectRatio <= 2.02,
      `${profile.kind}: shader footprint + final transform must stay near the 2:1 pillar limit`)
  }
  const stellarFlash = getCollisionEffectProfile(makeEffect('contactFlash', true))
  assert(stellarFlash.tailLength === 0, 'stellar contact flash must stay on the existing exaggerated shader path')
}

function testLateTransferKeepsChunkOverlapWithoutSecondExpansion() {
  const elapsedMs = 1700
  const remnant = getCollisionRemnantContinuityState(elapsedMs, 0.28, 0.30, 0.5)
  const chunks = getDisruptionChunkOpacity(getCollisionVisualLifecycle(elapsedMs))
  const settleStart = getCollisionRemnantContinuityState(COLLISION_TRANSFER_END_MS, 0.28, 0.30, 0.5)
  assert(remnant.opacity > 0.9, 'late TRANSFER remnant must already be clearly visible')
  assert(chunks > 0.45, 'late TRANSFER must retain the existing solid chunk ownership')
  assert(1 - settleStart.scale <= 0.01,
    'REMNANT_SETTLE must contain less than 1% residual scale convergence')
  assert(remnant.deformation > 0 && remnant.compression > 0,
    'irregular deterministic remnant deformation must remain active before settle')
}

function testStableStateMatchesPhysicalBodyExactly() {
  const stable = getCollisionRemnantContinuityState(COLLISION_REMNANT_SETTLE_END_MS, 0.28, 0.30, 0.91)
  assert(stable.scale === 1, 'stable remnant scale must equal physical body scale')
  assert(stable.opacity === 1, 'stable remnant opacity must equal normal body opacity')
  assert(stable.deformation === 0, 'stable remnant deformation must be zero')
  assert(stable.compression === 0, 'stable remnant compression must be zero')
  assert(stable.heat === 0, 'stable remnant transient heat must be zero')
}

const tests = [
  testSourceToRemnantOwnershipOverlap,
  testFirstMeaningfulRemnantMatchesSourceSilhouette,
  testFrameLevelRadiusContinuity,
  testVisibleGrowthStaysBelowThreePercent,
  testDeformationPreservesEquivalentMass,
  testFinalNonStellarImpactTransformCannotBecomePillar,
  testLateTransferKeepsChunkOverlapWithoutSecondExpansion,
  testStableStateMatchesPhysicalBodyExactly,
]
for (const test of tests) test()
console.log(`remnant formation/continuity regression checks passed (${tests.length})`)
