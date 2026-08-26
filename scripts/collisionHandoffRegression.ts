import {
  COLLISION_BREAKUP_END_MS,
  COLLISION_FRACTURE_END_MS,
  COLLISION_HANDOFF_DURATION_MS,
  COLLISION_IMPACT_HOLD_END_MS,
  COLLISION_PRODUCT_REVEAL_DELAY_MS,
  COLLISION_PRODUCT_REVEAL_DURATION_MS,
  findCollisionHandoffSources,
  getCollisionHandoffFractureProgress,
  getCollisionHandoffParticleProgress,
  getCollisionHandoffProgress,
  getCollisionHandoffSourceOpacity,
  getCollisionProductRevealProgress,
} from '../src/rendering/collisionHandoffLayer'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function body(id: string, bodyType: BodyState['bodyType'] = 'planet'): BodyState {
  return {
    id,
    name: id,
    color: '#88aaff',
    mass: bodyType === 'effect' ? 0 : 1,
    radius: 0.2,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function testHandoffDurationAndPhases() {
  assert(COLLISION_HANDOFF_DURATION_MS === 1500, 'solid-body handoff must run for the configured 1.5 seconds')
  assert(COLLISION_HANDOFF_DURATION_MS >= 1000, 'solid-body handoff must never finish in under one second')
  assert(COLLISION_IMPACT_HOLD_END_MS === 180, 'impact hold should preserve the source for the opening 180ms')
  assert(COLLISION_FRACTURE_END_MS === 650, 'fracture propagation phase must remain distinct')
  assert(COLLISION_BREAKUP_END_MS === 1100, 'structural breakup must precede the final result reveal phase')
  assert(COLLISION_PRODUCT_REVEAL_DURATION_MS === COLLISION_HANDOFF_DURATION_MS, 'products must converge only at the handoff end')
}

function testHandoffProgressIsSmoothAndBounded() {
  assert(getCollisionHandoffProgress(-100) === 0, 'handoff progress must clamp before start')
  const midpoint = getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS / 2)
  assert(midpoint > 0.45 && midpoint < 0.55, 'handoff midpoint must remain near the smoothstep midpoint')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS) === 1, 'handoff must finish at its configured duration')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS * 2) === 1, 'handoff progress must clamp after completion')
}

function testSourceSurfaceSurvivesOpeningPhase() {
  const early = COLLISION_HANDOFF_DURATION_MS * 0.15
  assert(getCollisionHandoffSourceOpacity(0) >= 0.98, 'source surface must start effectively fully opaque')
  assert(getCollisionHandoffSourceOpacity(early) >= 0.98, 'source opacity must remain effectively intact through the first 15%')
  assert(getCollisionHandoffFractureProgress(COLLISION_IMPACT_HOLD_END_MS) === 0, 'fracture must not begin during impact hold')
  assert(
    getCollisionHandoffFractureProgress(COLLISION_IMPACT_HOLD_END_MS + 120) > 0,
    'fracture propagation must begin before structural breakup',
  )
}

function testDebrisEmissionWaitsForVisibleFracture() {
  assert(getCollisionHandoffParticleProgress(0) === 0, 'debris must not burst at contact')
  assert(
    getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS * 0.18) === 0,
    'debris must remain hidden through roughly the first 18% of the handoff',
  )
  const middle = getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS * 0.6)
  assert(middle > 0 && middle < 1, 'debris emission must progress smoothly through breakup')
  assert(
    getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS) === 1,
    'debris separation progress must finish with the outgoing source handoff',
  )
}

function testCollisionProductRevealIsDelayedAndProgressive() {
  assert(COLLISION_PRODUCT_REVEAL_DELAY_MS >= 150, 'collision product reveal must be delayed by at least 150ms')
  assert(COLLISION_PRODUCT_REVEAL_DELAY_MS <= 350, 'collision product reveal delay should remain near the requested early-fracture window')
  assert(
    getCollisionProductRevealProgress(COLLISION_PRODUCT_REVEAL_DELAY_MS) === 0,
    'new collision products must remain fully hidden through the reveal delay',
  )
  const midpoint = getCollisionProductRevealProgress(
    (COLLISION_PRODUCT_REVEAL_DELAY_MS + COLLISION_PRODUCT_REVEAL_DURATION_MS) / 2,
  )
  assert(midpoint > 0.45 && midpoint < 0.55, 'collision products must crossfade through a smooth midpoint')
  assert(
    getCollisionProductRevealProgress(COLLISION_PRODUCT_REVEAL_DURATION_MS) === 1,
    'new collision products must become fully revealed only by the handoff end',
  )
}

function testSourceAndResultOverlapBeforeFinalRetirement() {
  const revealTime = COLLISION_BREAKUP_END_MS
  assert(
    getCollisionProductRevealProgress(revealTime) > 0,
    'collision products must already be crossfading by structural breakup',
  )
  assert(
    getCollisionHandoffSourceOpacity(revealTime) > 0,
    'the original source must still coexist with products during result reveal',
  )
  assert(
    getCollisionHandoffSourceOpacity(COLLISION_HANDOFF_DURATION_MS - 1) > 0,
    'source must retire only at the very end of the handoff',
  )
  assert(
    getCollisionHandoffSourceOpacity(COLLISION_HANDOFF_DURATION_MS) === 0,
    'source must be completely retired at handoff completion',
  )
}

function testMergeRetiresBothOriginalBodies() {
  const alpha = body('Alpha')
  const beta = body('Beta', 'moon')
  const remnant = body('Alpha+Beta')
  const retired = findCollisionHandoffSources([alpha, beta], [remnant])
  assert(retired.length === 2, 'a merge must create a visual handoff for both disappearing originals')
  assert(retired.some((candidate) => candidate.id === 'Alpha'), 'Alpha must participate in the merge handoff')
  assert(retired.some((candidate) => candidate.id === 'Beta'), 'Beta must participate in the merge handoff')
}

function testDestructionIntoFragmentsCreatesHandoff() {
  const alpha = body('Alpha')
  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment')
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment')
  const retired = findCollisionHandoffSources([alpha], [fragmentA, fragmentB])
  assert(retired.length === 1 && retired[0].id === 'Alpha', 'fragment descendants must keep a staged source body during destruction')
}

function testStellarMergeStaysOnDedicatedTopologyPath() {
  const alpha = body('Alpha', 'star')
  const beta = body('Beta', 'star')
  const remnant = body('Alpha+Beta', 'star')
  assert(
    findCollisionHandoffSources([alpha, beta], [remnant]).length === 0,
    'stellar mergers must use the dedicated topology mask instead of the generic solid-body handoff',
  )
}

function testUnrelatedPresetReplacementDoesNotCreateHandoff() {
  const alpha = body('Alpha')
  const gamma = body('Gamma')
  assert(
    findCollisionHandoffSources([alpha], [gamma]).length === 0,
    'unrelated setup changes must not be mistaken for collision destruction',
  )
}

function testTransientBodiesDoNotRetireAsCelestialGhosts() {
  const fragment = body('Alpha+Beta+fragment-0', 'fragment')
  const effect = body('Alpha+Beta+flash', 'effect')
  const descendant = body('Alpha+Beta+fragment-0+Gamma', 'fragment')
  assert(
    findCollisionHandoffSources([fragment, effect], [descendant]).length === 0,
    'fragment expiry and effect cleanup must not spawn full-body handoff ghosts',
  )
}

const tests = [
  testHandoffDurationAndPhases,
  testHandoffProgressIsSmoothAndBounded,
  testSourceSurfaceSurvivesOpeningPhase,
  testDebrisEmissionWaitsForVisibleFracture,
  testCollisionProductRevealIsDelayedAndProgressive,
  testSourceAndResultOverlapBeforeFinalRetirement,
  testMergeRetiresBothOriginalBodies,
  testDestructionIntoFragmentsCreatesHandoff,
  testStellarMergeStaysOnDedicatedTopologyPath,
  testUnrelatedPresetReplacementDoesNotCreateHandoff,
  testTransientBodiesDoNotRetireAsCelestialGhosts,
]

for (const test of tests) test()
console.log(`collision handoff regression checks passed (${tests.length})`)
