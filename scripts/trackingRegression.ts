import {
  areSourceLineagesMerged,
  resolveBodyDescendant,
} from '../src/collisionWatch'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import {
  isCollisionCameraJustReleased,
  shouldResetTrackingFocus,
} from '../src/rendering/trackingCameraHandoff'
import { isTrackingMassEligible } from '../src/trackingMassPolicy'
import { findDirectTrackingCandidate, findTrackingCandidate } from '../src/trackingSelection'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeBody(
  id: string,
  bodyType: BodyState['bodyType'] = 'star',
  mass = 1,
  radius = 0.2,
): BodyState {
  return {
    id,
    name: id,
    color: '#ffffff',
    mass,
    radius,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function testLivingOriginalBodyRemainsTrackable() {
  const alpha = makeBody('Alpha')
  const beta = makeBody('Beta')
  assert(
    findTrackingCandidate([alpha, beta], 'Alpha')?.id === 'Alpha',
    'a still-living original body must remain trackable',
  )
}

function testGenericCollisionDescendantDoesNotInheritUserTracking() {
  const merged = makeBody('Alpha+Beta', 'planet', 0.8)
  assert(
    findDirectTrackingCandidate([merged], 'Alpha') === null,
    'a collision descendant must not count as the exact original body',
  )
  assert(
    findTrackingCandidate([merged], 'Alpha') === null,
    'generic collision lineage must not automatically inherit ordinary user tracking',
  )
}

function testExplicitTwoToOneContinuationCarriesBothSources() {
  const remnant = makeBody('Alpha', 'planet', 0.82)
  remnant.collisionLineageIds = ['Alpha', 'Beta']
  remnant.trackingContinuationIds = ['Alpha', 'Beta']

  assert(findTrackingCandidate([remnant], 'Alpha')?.id === 'Alpha', 'primary source must keep its id')
  assert(
    findTrackingCandidate([remnant], 'Beta')?.id === 'Alpha',
    'absorbed or merged secondary tracking must transfer to the surviving primary',
  )
  assert(
    resolveBodyDescendant([remnant], 'Beta')?.id === 'Alpha',
    'collision lineage must resolve the secondary source onto the primary remnant',
  )
  assert(
    areSourceLineagesMerged([remnant], 'Alpha', 'Beta'),
    'collision watch must recognize both source lineages inside a stable-id remnant',
  )
}

function testChainedTwoToOneContinuationKeepsAllSources() {
  const remnant = makeBody('Alpha', 'planet', 0.78)
  remnant.collisionLineageIds = ['Alpha', 'Beta', 'Gamma']
  remnant.trackingContinuationIds = ['Alpha', 'Beta', 'Gamma']

  for (const sourceId of ['Alpha', 'Beta', 'Gamma']) {
    assert(
      findTrackingCandidate([remnant], sourceId)?.id === 'Alpha',
      `${sourceId} tracking must resolve to the surviving chained primary`,
    )
    assert(
      resolveBodyDescendant([remnant], sourceId)?.id === 'Alpha',
      `${sourceId} collision lineage must resolve to the surviving chained primary`,
    )
  }
}

function testAbsorptionPreservesLargerPrimaryAndTransfersBothTracks() {
  const large = makeBody('Large', 'planet', 1, 0.2)
  const small = makeBody('Small', 'moon', 0.1, 0.08)
  large.position = { x: -0.13, y: 0, z: 0 }
  small.position = { x: 0.13, y: 0, z: 0 }

  let after: BodyState[] = [large, small]
  for (let step = 0; step < 24; step += 1) after = stepBodies(after, 0.0015)

  const remnant = after.find((body) =>
    body.id === 'Large' &&
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.trackingContinuationIds?.includes('Small'),
  )

  assert(remnant, 'planet-moon absorption must preserve the larger primary id')
  assert(
    remnant.collisionLineageIds?.includes('Large') === true &&
      remnant.collisionLineageIds?.includes('Small') === true,
    'absorption remnant must carry both physical collision lineages',
  )
  assert(
    remnant.trackingContinuationIds?.includes('Large') === true &&
      remnant.trackingContinuationIds?.includes('Small') === true,
    'absorption remnant must authorize tracking continuation from both sources',
  )
  assert(findTrackingCandidate(after, 'Large')?.id === 'Large', 'primary tracking must remain on Large')
  assert(
    findTrackingCandidate(after, 'Small')?.id === 'Large',
    'tracking the absorbed Small body must transfer to Large',
  )
}

function testEqualMassMergePreservesCollisionPrimaryAndBothTracks() {
  const atlas = makeBody('Atlas', 'planet', 0.4013, 0.0754)
  const selene = makeBody('Selene', 'planet', 0.4013, 0.0754)
  atlas.position = { x: -0.073, y: 0, z: 0 }
  selene.position = { x: 0.073, y: 0, z: 0 }

  let after: BodyState[] = [atlas, selene]
  for (let step = 0; step < 24; step += 1) after = stepBodies(after, 0.0015)

  const remnant = after.find((body) =>
    body.id === 'Atlas' &&
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.trackingContinuationIds?.includes('Selene'),
  )

  assert(remnant, 'equal-mass merge must preserve the first/tied collision primary id')
  assert(
    remnant.trackingContinuationIds?.includes('Atlas') === true &&
      remnant.trackingContinuationIds?.includes('Selene') === true,
    'a true merge must explicitly continue both merged source ids',
  )
  assert(findTrackingCandidate(after, 'Atlas')?.id === 'Atlas', 'Atlas tracking must stay on Atlas')
  assert(
    findTrackingCandidate(after, 'Selene')?.id === 'Atlas',
    'Selene tracking must transfer onto the surviving Atlas identity',
  )
  assert(
    isTrackingMassEligible(remnant.mass, atlas.mass) &&
      isTrackingMassEligible(remnant.mass, selene.mass),
    'merge continuation must remain subject to and pass the existing 50% initial-mass gate',
  )
}

function testDestroyedBodyNeverFallsBackToFragments() {
  const smallFragment = makeBody('Alpha+Beta+fragment-0', 'fragment', 0.02, 0.04)
  const largeFragment = makeBody('Alpha+Beta+fragment-1', 'fragment', 0.8, 0.17)
  const effect = makeBody('Alpha+Beta+flash', 'effect', 0, 0.1)

  assert(
    findTrackingCandidate([smallFragment, largeFragment, effect], 'Alpha') === null,
    'a disrupted body must not transfer ordinary tracking to even a large surviving fragment',
  )
  assert(
    findTrackingCandidate([effect], 'Alpha') === null,
    'render-only effects must never become tracking targets',
  )
}

function testFragmentCannotOverrideAuthorizedPhysicalRemnant() {
  const remnant = makeBody('Alpha', 'planet', 0.61, 0.15)
  remnant.trackingContinuationIds = ['Alpha', 'Beta']
  const fragment = makeBody('Alpha+Beta+fragment-0', 'fragment', 0.9, 0.18)
  assert(
    findTrackingCandidate([fragment, remnant], 'Beta')?.id === remnant.id,
    'only the authorized physical remnant may continue tracking even when a fragment is larger',
  )
}

function testUnrelatedBodyIsNeverSelectedAsFallback() {
  const gamma = makeBody('Gamma')
  assert(
    findTrackingCandidate([gamma], 'Alpha') === null,
    'generic tracking must stay empty instead of falling back to an unrelated body',
  )
}

function testOriginalHalfMassCutoffIsInclusiveAtBoundary() {
  assert(isTrackingMassEligible(0.500001, 1), 'more than half original mass must remain trackable')
  assert(isTrackingMassEligible(0.5, 1), 'exactly half original mass must remain trackable')
  assert(!isTrackingMassEligible(0.499, 1), 'below half original mass must disengage immediately')
}

function testBelowHalfMassCannotUseAuthorizedDescendant() {
  const remnant = makeBody('Alpha', 'planet', 0.49, 0.14)
  remnant.trackingContinuationIds = ['Alpha', 'Beta']
  const candidate = findTrackingCandidate([remnant], 'Beta')
  assert(candidate?.id === remnant.id, 'fixture must expose the authorized descendant before mass gate')
  assert(
    !isTrackingMassEligible(candidate.mass, 1),
    'the initial-mass gate must reject an authorized descendant below 50%',
  )
}

function testBodyScaleEquivalentMassKeepsSameEligibilityRatio() {
  assert(isTrackingMassEligible(1.0, 2.0), 'equal bodyScale must preserve the 50% boundary')
  assert(!isTrackingMassEligible(0.98, 2.0), 'bodyScale must not reset the captured baseline')
}

function testCollisionCameraReleaseForcesExistingTrackingFocusReset() {
  const initialMass = 1
  const sourceId = 'Beta'
  const remnant = makeBody('Alpha', 'planet', 0.72, 0.18)
  remnant.trackingContinuationIds = ['Alpha', sourceId]
  const candidate = findTrackingCandidate([remnant], sourceId)

  assert(candidate?.id === 'Alpha', 'secondary source tracking must resolve to physical primary')
  assert(isTrackingMassEligible(candidate.mass, initialMass), 'fixture continuation must pass mass gate')

  const collisionCameraJustReleased = isCollisionCameraJustReleased(true, false, true)
  assert(collisionCameraJustReleased, 'collision camera release must be detected while tracking remains valid')
  assert(
    shouldResetTrackingFocus(false, collisionCameraJustReleased),
    'collision-camera release must restart tracking focus even after a physical target transfer',
  )
  assert(initialMass === 1, 'camera handoff must not rewrite the captured tracking baseline mass')
}

function testCollisionCameraReleaseDoesNotReviveBelowHalfTracking() {
  const initialMass = 1
  const remnant = makeBody('Alpha', 'planet', 0.49, 0.14)
  remnant.trackingContinuationIds = ['Alpha', 'Beta']
  const candidate = findTrackingCandidate([remnant], 'Beta')

  assert(candidate?.id === 'Alpha', 'fixture must expose continuation before mass gate')
  assert(!isTrackingMassEligible(candidate.mass, initialMass), 'below-50% continuation must stay ineligible')
  assert(
    !isCollisionCameraJustReleased(true, false, false),
    'camera handoff must not restart tracking after the mass gate clears tracking',
  )
}

const tests = [
  testLivingOriginalBodyRemainsTrackable,
  testGenericCollisionDescendantDoesNotInheritUserTracking,
  testExplicitTwoToOneContinuationCarriesBothSources,
  testChainedTwoToOneContinuationKeepsAllSources,
  testAbsorptionPreservesLargerPrimaryAndTransfersBothTracks,
  testEqualMassMergePreservesCollisionPrimaryAndBothTracks,
  testDestroyedBodyNeverFallsBackToFragments,
  testFragmentCannotOverrideAuthorizedPhysicalRemnant,
  testUnrelatedBodyIsNeverSelectedAsFallback,
  testOriginalHalfMassCutoffIsInclusiveAtBoundary,
  testBelowHalfMassCannotUseAuthorizedDescendant,
  testBodyScaleEquivalentMassKeepsSameEligibilityRatio,
  testCollisionCameraReleaseForcesExistingTrackingFocusReset,
  testCollisionCameraReleaseDoesNotReviveBelowHalfTracking,
]

for (const test of tests) test()
console.log(`tracking regression checks passed (${tests.length})`)
