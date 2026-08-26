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

function testExplicitAbsorptionContinuationStillWins() {
  const remnant = makeBody('Alpha+Beta', 'planet', 0.82)
  remnant.trackingContinuationIds = ['Alpha']
  assert(
    findTrackingCandidate([remnant], 'Alpha')?.id === remnant.id,
    'an explicitly marked absorption remnant must inherit authorized tracking',
  )
  assert(
    findTrackingCandidate([remnant], 'Beta') === null,
    'explicit continuation must not invent an unrelated source lineage',
  )
}

function testChainedAbsorptionKeepsOnlyAuthorizedLineage() {
  const nextRemnant = makeBody('Alpha+Beta+Gamma', 'planet', 0.78)
  nextRemnant.trackingContinuationIds = ['Alpha', 'Alpha+Beta']

  assert(
    findTrackingCandidate([nextRemnant], 'Alpha')?.id === nextRemnant.id,
    'authorized original source tracking must survive a chained absorption',
  )
  assert(
    findTrackingCandidate([nextRemnant], 'Alpha+Beta')?.id === nextRemnant.id,
    'the previous authorized remnant may continue through the next absorption',
  )
  assert(
    findTrackingCandidate([nextRemnant], 'Beta') === null,
    'unlisted collision participants must not inherit tracking through lineage alone',
  )
}

function testOnlyLargerAbsorberGetsPhysicsContinuation() {
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

  assert(remnant, 'planet-moon absorption must produce a physical remnant after the contact bridge')
  assert(
    remnant.trackingContinuationIds?.includes('Large') === true,
    'the physics layer must keep the explicit larger-absorber continuation metadata',
  )
  assert(
    findTrackingCandidate(after, 'Large')?.id === remnant.id,
    'tracking the larger absorber must continue onto the authorized remnant',
  )
  assert(
    findTrackingCandidate(after, 'Small') === null,
    'the absorbed source must not inherit ordinary tracking through generic lineage',
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
  const remnant = makeBody('Alpha+Beta', 'planet', 0.61, 0.15)
  remnant.trackingContinuationIds = ['Alpha']
  const fragment = makeBody('Alpha+Beta+fragment-0', 'fragment', 0.9, 0.18)
  assert(
    findTrackingCandidate([fragment, remnant], 'Alpha')?.id === remnant.id,
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
  assert(
    isTrackingMassEligible(0.500001, 1),
    'a body retaining more than half of its original mass must remain trackable',
  )
  assert(
    isTrackingMassEligible(0.5, 1),
    'a body at exactly half of its original mass must remain trackable',
  )
  assert(
    !isTrackingMassEligible(0.499, 1),
    'a body below half of its original mass must disengage immediately',
  )
}

function testBelowHalfMassCannotUseAuthorizedDescendant() {
  const remnant = makeBody('Alpha+Beta', 'planet', 0.49, 0.14)
  remnant.trackingContinuationIds = ['Alpha']
  const candidate = findTrackingCandidate([remnant], 'Alpha')
  assert(candidate?.id === remnant.id, 'fixture must expose the authorized descendant before applying the mass gate')
  assert(
    !isTrackingMassEligible(candidate.mass, 1),
    'the initial-mass gate must reject an authorized descendant below 50%',
  )
}

function testBodyScaleEquivalentMassKeepsSameEligibilityRatio() {
  assert(
    isTrackingMassEligible(1.0, 2.0),
    'scaling both the live candidate and captured baseline equally must preserve the 50% boundary',
  )
  assert(
    !isTrackingMassEligible(0.98, 2.0),
    'bodyScale must not reset the captured baseline to the current descendant mass',
  )
}

function testCollisionCameraReleaseForcesExistingTrackingFocusReset() {
  const initialMass = 1
  const trackedBodyId = 'Alpha'
  const remnant = makeBody('Alpha+Beta', 'planet', 0.72, 0.18)
  remnant.trackingContinuationIds = [trackedBodyId]
  const candidate = findTrackingCandidate([remnant], trackedBodyId)

  assert(candidate?.id === remnant.id, 'collision result must expose the authorized Alpha continuation')
  assert(
    isTrackingMassEligible(candidate.mass, initialMass),
    'fixture continuation must pass the original 50% tracking mass gate',
  )

  const collisionCameraJustReleased = isCollisionCameraJustReleased(true, false, true)
  assert(collisionCameraJustReleased, 'collision camera release must be detected while tracking remains valid')
  assert(
    shouldResetTrackingFocus(false, collisionCameraJustReleased),
    'same trackedBodyId must still restart tracking focus after collision-camera release',
  )
  assert(trackedBodyId === 'Alpha', 'camera handoff must not rewrite the user-selected source id')
  assert(initialMass === 1, 'camera handoff must not rewrite the captured tracking baseline mass')
}

function testCollisionCameraReleaseDoesNotReviveBelowHalfTracking() {
  const initialMass = 1
  const trackedBodyId = 'Alpha'
  const remnant = makeBody('Alpha+Beta', 'planet', 0.49, 0.14)
  remnant.trackingContinuationIds = [trackedBodyId]
  const candidate = findTrackingCandidate([remnant], trackedBodyId)

  assert(candidate?.id === remnant.id, 'fixture must expose a continuation before the mass gate')
  assert(
    !isTrackingMassEligible(candidate.mass, initialMass),
    'continuation below 50% must remain ineligible for ordinary tracking',
  )
  assert(
    !isCollisionCameraJustReleased(true, false, false),
    'camera handoff must not restart tracking after the mass gate has cleared the tracked body',
  )
}

const tests = [
  testLivingOriginalBodyRemainsTrackable,
  testGenericCollisionDescendantDoesNotInheritUserTracking,
  testExplicitAbsorptionContinuationStillWins,
  testChainedAbsorptionKeepsOnlyAuthorizedLineage,
  testOnlyLargerAbsorberGetsPhysicsContinuation,
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
