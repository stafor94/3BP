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

function testMergedDescendantNeverInheritsOrdinaryTracking() {
  const merged = makeBody('Alpha+Beta')
  merged.trackingContinuationIds = ['Alpha']
  assert(
    findDirectTrackingCandidate([merged], 'Alpha') === null,
    'a merged descendant must not count as the exact original body',
  )
  assert(
    findTrackingCandidate([merged], 'Alpha') === null,
    'ordinary tracking must ignore absorption-continuity metadata',
  )
}

function testLargerAbsorberAlsoStopsOrdinaryTracking() {
  const large = makeBody('Large', 'planet', 1, 0.2)
  const small = makeBody('Small', 'moon', 0.1, 0.08)
  large.position = { x: -0.13, y: 0, z: 0 }
  small.position = { x: 0.13, y: 0, z: 0 }

  const after = stepBodies([large, small], 0.0015)
  const remnant = after.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.id.includes('Large') &&
    body.id.includes('Small'),
  )

  assert(remnant, 'planet-moon absorption must produce a physical remnant')
  assert(
    findTrackingCandidate(after, 'Large') === null,
    'even the larger absorber must stop ordinary tracking when its exact id disappears',
  )
  assert(
    findTrackingCandidate(after, 'Small') === null,
    'the absorbed smaller body must stop ordinary tracking',
  )
}

function testDestroyedBodyDoesNotTransferTrackingToFragment() {
  const fragment = makeBody('Alpha', 'fragment')
  assert(
    findTrackingCandidate([fragment], 'Alpha') === null,
    'a destroyed body must not keep tracking through a fragment that reuses its id',
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
  testMergedDescendantNeverInheritsOrdinaryTracking,
  testLargerAbsorberAlsoStopsOrdinaryTracking,
  testDestroyedBodyDoesNotTransferTrackingToFragment,
  testUnrelatedBodyIsNeverSelectedAsFallback,
]

for (const test of tests) test()
console.log(`tracking regression checks passed (${tests.length})`)
