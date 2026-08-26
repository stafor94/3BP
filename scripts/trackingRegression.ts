import { stepBodies } from '../src/physics/fragmentAwareEngine'
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

function testUnmarkedMergedDescendantNeverInheritsOrdinaryTracking() {
  const merged = makeBody('Alpha+Beta')
  assert(
    findDirectTrackingCandidate([merged], 'Alpha') === null,
    'a merged descendant must not count as the exact original body',
  )
  assert(
    findTrackingCandidate([merged], 'Alpha') === null,
    'lineage-like ids alone must not transfer ordinary tracking',
  )
}

function testExplicitAbsorptionContinuationCanInheritTracking() {
  const remnant = makeBody('Alpha+Beta')
  remnant.trackingContinuationIds = ['Alpha']
  assert(
    findTrackingCandidate([remnant], 'Alpha')?.id === remnant.id,
    'an explicitly marked absorption remnant must inherit tracking',
  )
  assert(
    findTrackingCandidate([remnant], 'Beta') === null,
    'an unmarked collision partner must not inherit tracking through the remnant',
  )
}

function testChainedAbsorptionKeepsAuthorizedLineage() {
  const nextRemnant = makeBody('Alpha+Beta+debris')
  nextRemnant.trackingContinuationIds = ['Alpha']

  assert(
    findTrackingCandidate([nextRemnant], 'Alpha+Beta')?.id === nextRemnant.id,
    'a previously authorized remnant id must follow a later remnant that still carries the original explicit continuation lineage',
  )
  assert(
    findTrackingCandidate([nextRemnant], 'Beta+Gamma') === null,
    'chained tracking must not invent continuity for an unmarked lineage',
  )
}

function testLargerAbsorberContinuesOrdinaryTracking() {
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
    'the larger absorber must be marked as an allowed tracking predecessor',
  )
  assert(
    remnant.trackingContinuationIds?.includes('Small') !== true,
    'the smaller absorbed body must not be marked as a tracking predecessor',
  )
  assert(
    findTrackingCandidate(after, 'Large')?.id === remnant.id,
    'tracking the larger absorber must continue onto the absorption remnant',
  )
  assert(
    findTrackingCandidate(after, 'Small') === null,
    'tracking the smaller absorbed body must stop',
  )
}

function testDestroyedBodyDoesNotTransferTrackingToFragment() {
  const fragment = makeBody('Alpha', 'fragment')
  fragment.trackingContinuationIds = ['Alpha']
  assert(
    findTrackingCandidate([fragment], 'Alpha') === null,
    'a destroyed body must not keep tracking through a fragment',
  )
}

function testUnrelatedBodyIsNeverSelectedAsFallback() {
  const gamma = makeBody('Gamma')
  assert(
    findTrackingCandidate([gamma], 'Alpha') === null,
    'generic tracking must stay empty instead of falling back to an unrelated body',
  )
}

const tests = [
  testLivingOriginalBodyRemainsTrackable,
  testUnmarkedMergedDescendantNeverInheritsOrdinaryTracking,
  testExplicitAbsorptionContinuationCanInheritTracking,
  testChainedAbsorptionKeepsAuthorizedLineage,
  testLargerAbsorberContinuesOrdinaryTracking,
  testDestroyedBodyDoesNotTransferTrackingToFragment,
  testUnrelatedBodyIsNeverSelectedAsFallback,
]

for (const test of tests) test()
console.log(`tracking regression checks passed (${tests.length})`)
