import { findDirectTrackingCandidate } from '../src/trackingSelection'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeBody(id: string, bodyType: BodyState['bodyType'] = 'star'): BodyState {
  return {
    id,
    name: id,
    color: '#ffffff',
    mass: 1,
    radius: 0.2,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function testLivingOriginalBodyRemainsTrackable() {
  const alpha = makeBody('Alpha')
  const beta = makeBody('Beta')
  assert(
    findDirectTrackingCandidate([alpha, beta], 'Alpha')?.id === 'Alpha',
    'a still-living original body must remain directly trackable',
  )
}

function testAbsorbedBodyDoesNotTransferTrackingToMergedDescendant() {
  const merged = makeBody('Alpha+Beta')
  assert(
    findDirectTrackingCandidate([merged], 'Alpha') === null,
    'tracking Alpha must stop after absorption instead of transferring to Alpha+Beta',
  )
  assert(
    findDirectTrackingCandidate([merged], 'Beta') === null,
    'tracking Beta must stop after absorption instead of transferring to Alpha+Beta',
  )
}

function testDestroyedBodyDoesNotTransferTrackingToFragment() {
  const fragment = makeBody('Alpha', 'fragment')
  assert(
    findDirectTrackingCandidate([fragment], 'Alpha') === null,
    'a destroyed body must not keep tracking through a fragment that reuses its id',
  )
}

function testUnrelatedBodyIsNeverSelectedAsFallback() {
  const gamma = makeBody('Gamma')
  assert(
    findDirectTrackingCandidate([gamma], 'Alpha') === null,
    'generic tracking must stay empty instead of falling back to an unrelated body',
  )
}

const tests = [
  testLivingOriginalBodyRemainsTrackable,
  testAbsorbedBodyDoesNotTransferTrackingToMergedDescendant,
  testDestroyedBodyDoesNotTransferTrackingToFragment,
  testUnrelatedBodyIsNeverSelectedAsFallback,
]

for (const test of tests) test()
console.log(`tracking regression checks passed (${tests.length})`)
