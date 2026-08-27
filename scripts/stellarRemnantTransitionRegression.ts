import { bodyCarriesCollisionLineage } from '../src/collisionIdentity'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import {
  deriveStellarRemnantTransition,
  getStellarRemnantVisualTransform,
  type StellarRemnantTransition,
} from '../src/rendering/stellarRemnantPresentation'
import type { BodyState, Vec3 } from '../src/types'

const STEP_DT = 0.0015

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertNear(actual: number, expected: number, tolerance: number, message: string) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`)
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  position: Vec3,
  velocity: Vec3,
): BodyState {
  return {
    id,
    name: id,
    color: '#ffd36b',
    mass,
    radius,
    position,
    velocity,
    bodyType: 'star',
  }
}

function stepUntil(
  initial: BodyState[],
  predicate: (bodies: BodyState[]) => boolean,
  maxSteps = 64,
) {
  let previous = initial
  for (let step = 1; step <= maxSteps; step += 1) {
    const current = stepFragmentAwareBodies(previous, STEP_DT)
    if (predicate(current)) return { previous, current, step }
    previous = current
  }
  throw new Error(`transition condition was not reached within ${maxSteps} steps`)
}

function findMergedStar(bodies: BodyState[], firstId: string, secondId: string) {
  return bodies.find((body) => (
    body.bodyType === 'star' &&
    body.stellarCollisionOutcome === 'merge' &&
    bodyCarriesCollisionLineage(body, firstId) &&
    bodyCarriesCollisionLineage(body, secondId)
  ))
}

function getTransition(
  previous: BodyState[],
  current: BodyState[],
  body: BodyState | undefined,
) {
  assert(body, 'expected stellar collision result body')
  const transition = deriveStellarRemnantTransition(previous, current, body)
  assert(transition, `expected remnant presentation transition for ${body.id}`)
  return transition
}

function assertSettlesWithoutRadiusOvershoot(transition: StellarRemnantTransition) {
  const minimumRadius = Math.min(transition.sourceVisualRadius, transition.targetVisualRadius) - 1e-9
  const maximumRadius = Math.max(transition.sourceVisualRadius, transition.targetVisualRadius) + 1e-9
  let previousProgress = -1

  for (const fraction of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const transform = getStellarRemnantVisualTransform(transition, transition.durationMs * fraction)
    assert(
      transform.relaxationProgress >= previousProgress,
      'critically damped relaxation progress must be monotonic',
    )
    assert(
      transform.displayRadius >= minimumRadius && transform.displayRadius <= maximumRadius,
      'display radius must settle between source and physical target without overshoot',
    )
    previousProgress = transform.relaxationProgress
  }

  const stable = getStellarRemnantVisualTransform(transition, transition.durationMs)
  assertNear(stable.displayRadius, transition.targetVisualRadius, 1e-10, 'stable display radius')
  assertNear(stable.scale.x, 1, 1e-10, 'stable impact-axis scale')
  assertNear(stable.scale.y, 1, 1e-10, 'stable transverse scale y')
  assertNear(stable.scale.z, 1, 1e-10, 'stable transverse scale z')
}

function testEqualMassHeadOnMergeRelaxesFromUnsettledRemnant() {
  const a = makeStar(
    'remnant-equal-a',
    1,
    0.3,
    { x: -0.3, y: 0, z: 0 },
    { x: 0.3, y: 0, z: 0 },
  )
  const b = makeStar(
    'remnant-equal-b',
    1,
    0.3,
    { x: 0.3, y: 0, z: 0 },
    { x: -0.3, y: 0, z: 0 },
  )

  const resolved = stepUntil([a, b], (bodies) => Boolean(findMergedStar(bodies, a.id, b.id)))
  const remnant = findMergedStar(resolved.current, a.id, b.id)
  const physicalRadius = remnant?.radius ?? 0
  const transition = getTransition(resolved.previous, resolved.current, remnant)

  assert(remnant?.id === a.id, 'equal-mass merge must keep the collision primary identity')
  assert(transition.role === 'remnant', 'merge must create the strong remnant relaxation profile')
  assert(transition.outcome === 'merge', 'merge transition must retain collision outcome')
  assertNear(transition.targetVisualRadius, physicalRadius, 1e-12, 'visual target must equal physical radius')
  assert(transition.durationMs >= 1100, 'merge should retain an observable remnant relaxation window')
  assert(transition.deformation01 >= 0.95, 'merge should receive the strongest unsettled deformation')

  const initial = getStellarRemnantVisualTransform(transition, 0)
  assert(
    initial.scale.x > initial.scale.y * 1.12,
    'fresh merged remnant should be elongated along the impact direction instead of a perfect sphere',
  )
  assertNear(remnant?.radius ?? 0, physicalRadius, 1e-12, 'presentation math must not mutate physical radius')
  assertSettlesWithoutRadiusOvershoot(transition)
}

function testUnequalMassMergeKeepsPhysicalTargetSeparate() {
  const a = makeStar(
    'remnant-unequal-a',
    1,
    0.3,
    { x: -0.285, y: 0, z: 0 },
    { x: 0.2, y: 0, z: 0 },
  )
  const b = makeStar(
    'remnant-unequal-b',
    0.85,
    0.27,
    { x: 0.285, y: 0, z: 0 },
    { x: -0.2, y: 0, z: 0 },
  )

  const resolved = stepUntil([a, b], (bodies) => Boolean(findMergedStar(bodies, a.id, b.id)))
  const remnant = findMergedStar(resolved.current, a.id, b.id)
  const transition = getTransition(resolved.previous, resolved.current, remnant)

  assert(remnant?.id === a.id, 'unequal merge must keep the larger collision primary identity')
  assertNear(transition.massRatio, 0.85, 0.01, 'presentation metadata should preserve mass ratio')
  assert(transition.massLoss >= 0, 'merge presentation mass loss must be non-negative')
  assertNear(
    transition.targetVisualRadius,
    remnant?.radius ?? 0,
    1e-12,
    'unequal merge visual target must remain the solver radius',
  )
  assertSettlesWithoutRadiusOvershoot(transition)
}

function resolveGrazingHitAndRun() {
  const a = makeStar(
    'remnant-hitrun-a',
    1,
    0.3,
    { x: -0.2999995, y: 0, z: 0 },
    { x: 0.15, y: -1.65, z: 0 },
  )
  const b = makeStar(
    'remnant-hitrun-b',
    1,
    0.3,
    { x: 0.2999995, y: 0, z: 0 },
    { x: -0.15, y: 1.65, z: 0 },
  )

  const resolved = stepUntil([a, b], (bodies) => {
    const survivorA = bodies.find((body) => body.id === a.id)
    const survivorB = bodies.find((body) => body.id === b.id)
    return survivorA?.stellarCollisionOutcome === 'hitAndRun' &&
      survivorB?.stellarCollisionOutcome === 'hitAndRun'
  })
  return { a, b, ...resolved }
}

function testHitAndRunUsesMildIndependentRelaxation() {
  const resolved = resolveGrazingHitAndRun()
  const survivorA = resolved.current.find((body) => body.id === resolved.a.id)
  const survivorB = resolved.current.find((body) => body.id === resolved.b.id)
  const transitionA = getTransition(resolved.previous, resolved.current, survivorA)
  const transitionB = getTransition(resolved.previous, resolved.current, survivorB)

  assert(transitionA.role === 'survivor' && transitionB.role === 'survivor', 'hit-and-run must keep two survivor transitions')
  assert(transitionA.outcome === 'hitAndRun' && transitionB.outcome === 'hitAndRun', 'hit-and-run profile must stay distinct from merge')
  assert(transitionA.durationMs < 800 && transitionB.durationMs < 800, 'hit-and-run disturbance should relax faster than a merge')
  assert(transitionA.deformation01 < 0.55 && transitionB.deformation01 < 0.55, 'hit-and-run deformation must remain mild')
  assert(transitionA.impactParameter > 0.85, 'grazing hit-and-run should retain a high impact parameter')
  assertSettlesWithoutRadiusOvershoot(transitionA)
  assertSettlesWithoutRadiusOvershoot(transitionB)
}

function testPartialDisruptionRelaxesEachSurvivor() {
  const smaller = makeStar(
    'remnant-partial-small',
    0.6,
    0.24,
    { x: -0.2799995, y: 0, z: 0 },
    { x: 1.05, y: -1.2, z: 0 },
  )
  const larger = makeStar(
    'remnant-partial-large',
    1.3,
    0.32,
    { x: 0.2799995, y: 0, z: 0 },
    { x: -1.05, y: 1.2, z: 0 },
  )

  const resolved = stepUntil([smaller, larger], (bodies) => {
    const smallResult = bodies.find((body) => body.id === smaller.id)
    const largeResult = bodies.find((body) => body.id === larger.id)
    return smallResult?.stellarCollisionOutcome === 'partialDisruption' &&
      largeResult?.stellarCollisionOutcome === 'partialDisruption'
  })
  const smallResult = resolved.current.find((body) => body.id === smaller.id)
  const largeResult = resolved.current.find((body) => body.id === larger.id)
  const smallTransition = getTransition(resolved.previous, resolved.current, smallResult)
  const largeTransition = getTransition(resolved.previous, resolved.current, largeResult)

  assert(smallTransition.outcome === 'partialDisruption', 'smaller stripped star should retain partial-disruption transition')
  assert(largeTransition.outcome === 'partialDisruption', 'larger survivor should retain partial-disruption transition')
  assert(smallTransition.durationMs > 800 && smallTransition.durationMs < 1100, 'partial disruption should have intermediate relaxation duration')
  assert(
    smallTransition.deformation01 > largeTransition.deformation01,
    'more strongly stripped survivor should receive the stronger visual relaxation',
  )
  assert(smallTransition.massLoss > largeTransition.massLoss, 'presentation metadata should reflect stronger stripping of the smaller star')
  assertNear(smallTransition.targetVisualRadius, smallResult?.radius ?? 0, 1e-12, 'small survivor target radius')
  assertNear(largeTransition.targetVisualRadius, largeResult?.radius ?? 0, 1e-12, 'large survivor target radius')
  assertSettlesWithoutRadiusOvershoot(smallTransition)
  assertSettlesWithoutRadiusOvershoot(largeTransition)
}

function testConsecutiveCollisionGetsFreshTransitionToken() {
  const first = resolveGrazingHitAndRun()
  const survivorA = first.current.find((body) => body.id === first.a.id)
  const survivorB = first.current.find((body) => body.id === first.b.id)
  assert(survivorA && survivorB, 'first hit-and-run must retain both stars')
  const firstToken = survivorA.transientHeatToken
  assert(firstToken, 'first collision should have a presentation token')

  const contactDistance = survivorA.radius + survivorB.radius
  const secondA: BodyState = {
    ...survivorA,
    position: { x: -contactDistance / 2, y: 0, z: 0 },
    velocity: { x: 0.2, y: 0, z: 0 },
    collisionCooldown: 0,
  }
  const secondB: BodyState = {
    ...survivorB,
    position: { x: contactDistance / 2, y: 0, z: 0 },
    velocity: { x: -0.2, y: 0, z: 0 },
    collisionCooldown: 0,
  }

  const second = stepUntil([secondA, secondB], (bodies) => Boolean(findMergedStar(bodies, secondA.id, secondB.id)))
  const remnant = findMergedStar(second.current, secondA.id, secondB.id)
  const transition = getTransition(second.previous, second.current, remnant)

  assert(transition.token !== firstToken, 'a later collision must create a fresh transition token instead of reusing old state')
  assert(transition.outcome === 'merge', 'second collision should independently enter merge relaxation')
}

function testThreeDimensionalImpactPreservesDeformationAxis() {
  const invSqrt3 = 1 / Math.sqrt(3)
  const offset = 0.3 * invSqrt3
  const speed = 0.25 * invSqrt3
  const a = makeStar(
    'remnant-3d-a',
    1,
    0.3,
    { x: -offset, y: -offset, z: -offset },
    { x: speed, y: speed, z: speed },
  )
  const b = makeStar(
    'remnant-3d-b',
    1,
    0.3,
    { x: offset, y: offset, z: offset },
    { x: -speed, y: -speed, z: -speed },
  )

  const resolved = stepUntil([a, b], (bodies) => Boolean(findMergedStar(bodies, a.id, b.id)))
  const remnant = findMergedStar(resolved.current, a.id, b.id)
  const transition = getTransition(resolved.previous, resolved.current, remnant)
  const normalLength = Math.hypot(
    transition.impactNormal.x,
    transition.impactNormal.y,
    transition.impactNormal.z,
  )

  assertNear(normalLength, 1, 1e-8, '3D impact normal should remain normalized')
  assert(Math.abs(transition.impactNormal.z) > 0.4, '3D impact should retain a non-planar deformation axis')
  assertSettlesWithoutRadiusOvershoot(transition)
}

function testRelaxationProgressUsesWallClockOnly() {
  const transition: StellarRemnantTransition = {
    token: 'clock-test',
    outcome: 'merge',
    role: 'remnant',
    impactNormal: { x: 1, y: 0, z: 0 },
    impactSpeed: 1,
    impactParameter: 0,
    massRatio: 1,
    massLoss: 0,
    sourceVisualRadius: 0.34,
    targetVisualRadius: 0.4,
    deformation01: 1,
    durationMs: 1200,
  }

  const beforeSpeedChange = getStellarRemnantVisualTransform(transition, 420)
  const afterSpeedChange = getStellarRemnantVisualTransform(transition, 420)
  assertNear(
    beforeSpeedChange.relaxationProgress,
    afterSpeedChange.relaxationProgress,
    1e-12,
    'simulation speed must not enter remnant relaxation progress',
  )
  assert(
    beforeSpeedChange.relaxationProgress > 0 && beforeSpeedChange.relaxationProgress < 1,
    'wall-clock relaxation should remain active during the post-impact window',
  )
}

testEqualMassHeadOnMergeRelaxesFromUnsettledRemnant()
testUnequalMassMergeKeepsPhysicalTargetSeparate()
testHitAndRunUsesMildIndependentRelaxation()
testPartialDisruptionRelaxesEachSurvivor()
testConsecutiveCollisionGetsFreshTransitionToken()
testThreeDimensionalImpactPreservesDeformationAxis()
testRelaxationProgressUsesWallClockOnly()

console.log('stellar remnant transition regression checks passed')
