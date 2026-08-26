import { stepBodies } from '../src/physics/fragmentAwareEngine'
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

function testMergedDescendantKeepsSelectedLineage() {
  const merged = makeBody('Alpha+Beta')
  assert(
    findDirectTrackingCandidate([merged], 'Alpha') === null,
    'a merged descendant must not count as the exact original body',
  )
  assert(
    findTrackingCandidate([merged], 'Alpha')?.id === merged.id,
    'a merged descendant must continue the selected source lineage',
  )
  assert(
    findTrackingCandidate([merged], 'Beta')?.id === merged.id,
    'either source lineage must remain trackable after a merge',
  )
}

function testExplicitAbsorptionContinuationStillWins() {
  const remnant = makeBody('remnant')
  remnant.trackingContinuationIds = ['Alpha']
  assert(
    findTrackingCandidate([remnant], 'Alpha')?.id === remnant.id,
    'an explicitly marked absorption remnant must inherit tracking',
  )
  assert(
    findTrackingCandidate([remnant], 'Beta') === null,
    'explicit continuation must not invent an unrelated lineage',
  )
}

function testChainedCollisionKeepsAuthorizedLineage() {
  const nextRemnant = makeBody('Alpha+Beta+Gamma')
  nextRemnant.trackingContinuationIds = ['Alpha']

  assert(
    findTrackingCandidate([nextRemnant], 'Alpha+Beta')?.id === nextRemnant.id,
    'a previous remnant lineage must follow a later collision descendant',
  )
  assert(
    findTrackingCandidate([nextRemnant], 'Beta+Delta') === null,
    'chained tracking must not invent lineage parts that are not present',
  )
}

function testBothAbsorptionParticipantsCanFollowTheRemnant() {
  const large = makeBody('Large', 'planet', 1, 0.2)
  const small = makeBody('Small', 'moon', 0.1, 0.08)
  large.position = { x: -0.13, y: 0, z: 0 }
  small.position = { x: 0.13, y: 0, z: 0 }

  let after: BodyState[] = [large, small]
  for (let step = 0; step < 24; step += 1) {
    after = stepBodies(after, 0.0015)
  }
  const remnant = after.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.id.includes('Large') &&
    body.id.includes('Small'),
  )

  assert(remnant, 'planet-moon absorption must produce a physical remnant after the contact presentation bridge')
  assert(
    remnant.trackingContinuationIds?.includes('Large') === true,
    'the physics layer may keep its explicit larger-absorber continuation metadata',
  )
  assert(
    findTrackingCandidate(after, 'Large')?.id === remnant.id,
    'tracking the larger absorber must continue onto the absorption remnant',
  )
  assert(
    findTrackingCandidate(after, 'Small')?.id === remnant.id,
    'tracking the absorbed source must stay on the surviving collision lineage instead of disengaging',
  )
}

function testDestroyedBodyFallsBackToLargestFragment() {
  const smallFragment = makeBody('Alpha+Beta+fragment-0', 'fragment', 0.02, 0.04)
  const largeFragment = makeBody('Alpha+Beta+fragment-1', 'fragment', 0.08, 0.07)
  const effect = makeBody('Alpha+Beta+flash', 'effect', 0, 0.1)

  assert(
    findTrackingCandidate([smallFragment, largeFragment, effect], 'Alpha')?.id === largeFragment.id,
    'a destroyed body with only debris remaining must follow the largest surviving physical fragment',
  )
  assert(
    findTrackingCandidate([effect], 'Alpha') === null,
    'render-only effects must never become tracking targets',
  )
}

function testPhysicalRemnantBeatsLargerFragment() {
  const remnant = makeBody('Alpha+Beta', 'planet', 0.25, 0.15)
  const fragment = makeBody('Alpha+Beta+fragment-0', 'fragment', 0.4, 0.18)
  assert(
    findTrackingCandidate([fragment, remnant], 'Alpha')?.id === remnant.id,
    'a surviving celestial remnant must be preferred over debris even when a fragment has more mass',
  )
}

function testUnrelatedBodyIsNeverSelectedAsFallback() {
  const gamma = makeBody('Gamma')
  assert(
    findTrackingCandidate([gamma], 'Alpha') === null,
    'generic tracking must stay empty instead of falling back to an unrelated body',
  )
}

function testOriginalHalfMassCutoffIsPreserved() {
  assert(
    isTrackingMassEligible(0.500001, 1),
    'a body retaining more than half of its original mass must remain trackable',
  )
  assert(
    !isTrackingMassEligible(0.5, 1),
    'a body at the existing half-mass cutoff must no longer be trackable',
  )
  assert(
    !isTrackingMassEligible(0.49, 1),
    'a body below half of its original mass must not be trackable',
  )
}

const tests = [
  testLivingOriginalBodyRemainsTrackable,
  testMergedDescendantKeepsSelectedLineage,
  testExplicitAbsorptionContinuationStillWins,
  testChainedCollisionKeepsAuthorizedLineage,
  testBothAbsorptionParticipantsCanFollowTheRemnant,
  testDestroyedBodyFallsBackToLargestFragment,
  testPhysicalRemnantBeatsLargerFragment,
  testUnrelatedBodyIsNeverSelectedAsFallback,
  testOriginalHalfMassCutoffIsPreserved,
]

for (const test of tests) test()
console.log(`tracking regression checks passed (${tests.length})`)
