import {
  COLLISION_ABSORPTION_DURATION_MS,
  COLLISION_BREAKUP_END_MS,
  COLLISION_FRACTURE_END_MS,
  COLLISION_HANDOFF_DURATION_MS,
  COLLISION_IMPACT_HOLD_END_MS,
  COLLISION_PRODUCT_REVEAL_DELAY_MS,
  COLLISION_PRODUCT_REVEAL_DURATION_MS,
  findCollisionAbsorptionSources,
  findCollisionHandoffSources,
  getCollisionAbsorptionOpacity,
  getCollisionAbsorptionProgress,
  getCollisionHandoffBreakupProgress,
  getCollisionHandoffFractureProgress,
  getCollisionHandoffParticleProgress,
  getCollisionHandoffProgress,
  getCollisionHandoffSourceOpacity,
  getCollisionProductRevealProgress,
} from '../src/rendering/collisionHandoffLayer'
import {
  COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD,
  findCollisionVisualTransitions,
} from '../src/rendering/collisionVisualOutcome'
import {
  SURVIVOR_IMPACT_DURATION_MS,
  SURVIVOR_IMPACT_MAX_SURFACE_FRACTION,
  SURVIVOR_IMPACT_MIN_DOT,
  getSurvivorImpactEnvelope,
} from '../src/rendering/liveCollisionVfxBridge'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function body(
  id: string,
  bodyType: BodyState['bodyType'] = 'planet',
  mass = bodyType === 'effect' ? 0 : 1,
  x = 0,
): BodyState {
  return {
    id,
    name: id,
    color: '#88aaff',
    mass,
    radius: mass < 0.2 ? 0.08 : 0.2,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function testHandoffDurationAndPhases() {
  assert(COLLISION_HANDOFF_DURATION_MS === 1500, 'solid-body disruption handoff must run for 1.5 seconds')
  assert(COLLISION_IMPACT_HOLD_END_MS === 180, 'impact hold should preserve the source for 180ms')
  assert(COLLISION_FRACTURE_END_MS === 650, 'fracture propagation phase must remain distinct')
  assert(COLLISION_BREAKUP_END_MS === 1100, 'structural breakup must precede final reveal')
  assert(COLLISION_PRODUCT_REVEAL_DURATION_MS === COLLISION_HANDOFF_DURATION_MS, 'products converge at handoff end')
}

function testHandoffProgressIsSmoothAndBounded() {
  assert(getCollisionHandoffProgress(-100) === 0, 'handoff progress must clamp before start')
  const midpoint = getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS / 2)
  assert(midpoint > 0.45 && midpoint < 0.55, 'handoff midpoint must remain near smoothstep midpoint')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS) === 1, 'handoff must finish on time')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS * 2) === 1, 'handoff must clamp after completion')
}

function testSourceSurfaceSurvivesOpeningPhase() {
  const early = COLLISION_HANDOFF_DURATION_MS * 0.15
  assert(getCollisionHandoffSourceOpacity(0) >= 0.98, 'disrupted source must start effectively opaque')
  assert(getCollisionHandoffSourceOpacity(early) >= 0.98, 'disrupted source opacity must survive opening phase')
  assert(getCollisionHandoffFractureProgress(COLLISION_IMPACT_HOLD_END_MS) === 0, 'fracture must wait for impact hold')
  assert(getCollisionHandoffFractureProgress(COLLISION_IMPACT_HOLD_END_MS + 120) > 0, 'fracture must precede breakup')
  assert(getCollisionHandoffBreakupProgress(COLLISION_FRACTURE_END_MS) === 0, 'breakup must wait for fracture phase')
  assert(
    getCollisionHandoffBreakupProgress(780) > 0 && getCollisionHandoffBreakupProgress(780) < 0.35,
    'mid-breakup must begin gently',
  )
  assert(getCollisionHandoffBreakupProgress(COLLISION_BREAKUP_END_MS) === 1, 'breakup must finish at 1100ms')
}

function testDebrisEmissionWaitsForVisibleFracture() {
  assert(getCollisionHandoffParticleProgress(0) === 0, 'debris must not burst at contact')
  assert(getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS * 0.18) === 0, 'debris must wait through opening hold')
  const middle = getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS * 0.6)
  assert(middle > 0 && middle < 1, 'debris must progress smoothly through breakup')
  assert(getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS) === 1, 'debris progress must finish with handoff')
}

function testCollisionProductRevealIsDelayedAndProgressive() {
  assert(COLLISION_PRODUCT_REVEAL_DELAY_MS >= 150, 'product reveal must retain the requested delay')
  assert(COLLISION_PRODUCT_REVEAL_DELAY_MS <= 350, 'product reveal delay should remain in early fracture window')
  assert(getCollisionProductRevealProgress(COLLISION_PRODUCT_REVEAL_DELAY_MS) === 0, 'products remain hidden through delay')
  const midpoint = getCollisionProductRevealProgress(
    (COLLISION_PRODUCT_REVEAL_DELAY_MS + COLLISION_PRODUCT_REVEAL_DURATION_MS) / 2,
  )
  assert(midpoint > 0.45 && midpoint < 0.55, 'product reveal should crossfade smoothly')
  assert(getCollisionProductRevealProgress(COLLISION_PRODUCT_REVEAL_DURATION_MS) === 1, 'products reveal by handoff end')
}

function testSurvivorAbsorptionDoesNotCreateDestructionHandoff() {
  const primary = body('Primary', 'planet', 1, 0)
  const impactor = body('Impactor', 'moon', 0.08, 0.28)
  const remnant = body('Primary+Impactor', 'planet', 1.04, 0.01)
  const debris = body('Primary+Impactor+frag1-0', 'fragment', 0.04, 0.25)
  const previous = [primary, impactor]
  const current = [remnant, debris]
  const transitions = findCollisionVisualTransitions(previous, current)

  assert(findCollisionHandoffSources(previous, current).length === 0, 'survivor absorption must not instantiate destruction handoff')
  const survivor = transitions.find((transition) => transition.source.id === primary.id)
  const absorbed = transitions.find((transition) => transition.source.id === impactor.id)
  assert(survivor?.outcome === 'merged-survivor', 'dominant body must be classified as merged-survivor')
  assert(absorbed?.outcome === 'absorbed', 'small impactor must be classified as absorbed')
  assert(
    findCollisionAbsorptionSources(previous, current).map((candidate) => candidate.id).join(',') === impactor.id,
    'only the small impactor may use the short absorption handoff',
  )
}

function testActualDisruptionCreatesDestructionHandoff() {
  const alpha = body('Alpha', 'planet', 1, -0.2)
  const beta = body('Beta', 'planet', 1, 0.2)
  const remnant = body('Alpha+Beta', 'planet', 1.18, 0)
  const fragmentA = body('Alpha+Beta+frag1-0', 'fragment', 0.45, -0.05)
  const fragmentB = body('Alpha+Beta+frag1-1', 'fragment', 0.37, 0.06)
  const retired = findCollisionHandoffSources([alpha, beta], [remnant, fragmentA, fragmentB])
  assert(retired.length === 2, 'actual disruption must hand off both disrupted originals')
  assert(retired.some((candidate) => candidate.id === alpha.id), 'Alpha must participate in disruption handoff')
  assert(retired.some((candidate) => candidate.id === beta.id), 'Beta must participate in disruption handoff')
}

function testLineageChangeAloneIsNotDestructionEvidence() {
  const alpha = body('Alpha', 'planet', 1, -0.2)
  const beta = body('Beta', 'moon', 0.2, 0.2)
  const remnant = body('Alpha+Beta', 'planet', 1.12, 0)
  assert(
    findCollisionHandoffSources([alpha, beta], [remnant]).length === 0,
    'a new lineage id with low actual mass loss must never imply destruction',
  )
}

function testOutcomeThresholdSitsBetweenMergeAndDisruptionBands() {
  assert(
    COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD > 0.13 &&
      COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD < 0.22,
    'visual disruption threshold must stay inside the core classifier gap',
  )
}

function testContactNormalComesFromPhysicalPair() {
  const alpha = body('Alpha', 'planet', 1, -0.2)
  const beta = body('Beta', 'moon', 0.1, 0.2)
  const remnant = body('Alpha+Beta', 'planet', 1.06, 0)
  const transitions = findCollisionVisualTransitions([alpha, beta], [remnant])
  const alphaTransition = transitions.find((transition) => transition.source.id === alpha.id)
  const betaTransition = transitions.find((transition) => transition.source.id === beta.id)
  assert(alphaTransition?.contactNormal.x !== undefined && alphaTransition.contactNormal.x > 0.99, 'Alpha contact normal must point toward Beta')
  assert(betaTransition?.contactNormal.x !== undefined && betaTransition.contactNormal.x < -0.99, 'Beta contact normal must point toward Alpha')
}

function testFragmentOnlyDisruptionStillCreatesHandoff() {
  const alpha = body('Alpha', 'planet', 1, 0)
  const beta = body('Beta', 'moon', 0.2, 0.25)
  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment', 0.21, 0.04)
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment', 0.13, -0.06)
  const retired = findCollisionHandoffSources([alpha, beta], [beta, fragmentA, fragmentB])
  assert(retired.length === 1 && retired[0].id === alpha.id, 'fragment-only destruction must still stage the missing physical source')
}

function testStellarMergeStaysOnDedicatedTopologyPath() {
  const alpha = body('Alpha', 'star', 1, -0.2)
  const beta = body('Beta', 'star', 1, 0.2)
  const remnant = body('Alpha+Beta', 'star', 1.9, 0)
  assert(findCollisionHandoffSources([alpha, beta], [remnant]).length === 0, 'stellar mergers must stay off generic handoff path')
}

function testUnrelatedPresetReplacementDoesNotCreateHandoff() {
  const alpha = body('Alpha')
  const gamma = body('Gamma')
  assert(findCollisionHandoffSources([alpha], [gamma]).length === 0, 'unrelated setup changes must not become collision destruction')
}

function testTransientBodiesDoNotRetireAsCelestialGhosts() {
  const fragment = body('Alpha+Beta+fragment-0', 'fragment')
  const effect = body('Alpha+Beta+flash', 'effect')
  const descendant = body('Alpha+Beta+fragment-0+Gamma', 'fragment')
  assert(findCollisionHandoffSources([fragment, effect], [descendant]).length === 0, 'transient cleanup must not spawn full-body ghosts')
}

function testAbsorbedBodyRetiresQuicklyWithoutFractureTimeline() {
  assert(COLLISION_ABSORPTION_DURATION_MS === 700, 'absorbed body should retire within the requested 700ms window')
  assert(getCollisionAbsorptionProgress(0) === 0, 'absorption begins from the real source surface')
  assert(getCollisionAbsorptionProgress(COLLISION_ABSORPTION_DURATION_MS) === 1, 'absorption must complete by 700ms')
  assert(getCollisionAbsorptionOpacity(300) > 0, 'absorbed body should still be visible during compression')
  assert(getCollisionAbsorptionOpacity(COLLISION_ABSORPTION_DURATION_MS) === 0, 'absorbed body must be gone by 700ms')
}

function testSurvivorImpactIsLocalAndShortLived() {
  assert(SURVIVOR_IMPACT_DURATION_MS === 700, 'survivor impact must decay within 700ms')
  assert(SURVIVOR_IMPACT_MIN_DOT >= 0.76, 'impact cap must not spread over more than roughly 12% of the sphere')
  assert(SURVIVOR_IMPACT_MAX_SURFACE_FRACTION >= 0.05 && SURVIVOR_IMPACT_MAX_SURFACE_FRACTION <= 0.12, 'impact cap must remain within 5-12% of full surface')
  assert(getSurvivorImpactEnvelope(0).flash > 0.9, 'contact must begin with a bright local flash')
  assert(getSurvivorImpactEnvelope(150).heat > 0.6, '100-300ms must retain local crack/heat')
  assert(getSurvivorImpactEnvelope(350).heat < getSurvivorImpactEnvelope(150).heat, 'impact heat must decay after 300ms')
  assert(getSurvivorImpactEnvelope(700).heat === 0, 'survivor surface must return to normal by 700ms')
  assert(getSurvivorImpactEnvelope(700).flash === 0, 'survivor flash must be gone by 700ms')
}

const tests = [
  testHandoffDurationAndPhases,
  testHandoffProgressIsSmoothAndBounded,
  testSourceSurfaceSurvivesOpeningPhase,
  testDebrisEmissionWaitsForVisibleFracture,
  testCollisionProductRevealIsDelayedAndProgressive,
  testSurvivorAbsorptionDoesNotCreateDestructionHandoff,
  testActualDisruptionCreatesDestructionHandoff,
  testLineageChangeAloneIsNotDestructionEvidence,
  testOutcomeThresholdSitsBetweenMergeAndDisruptionBands,
  testContactNormalComesFromPhysicalPair,
  testFragmentOnlyDisruptionStillCreatesHandoff,
  testStellarMergeStaysOnDedicatedTopologyPath,
  testUnrelatedPresetReplacementDoesNotCreateHandoff,
  testTransientBodiesDoNotRetireAsCelestialGhosts,
  testAbsorbedBodyRetiresQuicklyWithoutFractureTimeline,
  testSurvivorImpactIsLocalAndShortLived,
]

for (const test of tests) test()
console.log(`collision handoff regression checks passed (${tests.length})`)
