import {
  didCollisionWatchTargetImpact,
  resolveBodyDescendant,
} from '../src/collisionWatch'
import { getCollisionContactDistance } from '../src/physics/collisionContact'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import {
  calculatePerspectiveBodyDistance,
  calculateProjectedBodyRadiusPixels,
  getRenderedBodyRadius,
} from '../src/rendering/cameraFraming'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function distance(a: BodyState, b: BodyState) {
  return Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
}

function makeBody(
  id: string,
  mass: number,
  radius: number,
  x: number,
  bodyType: BodyState['bodyType'] = 'star',
): BodyState {
  return {
    id,
    name: id.replaceAll('+', ' + '),
    color: '#ffffff',
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function makeFlash(id: string, age = 0): BodyState {
  return {
    id,
    name: 'Collision flash',
    color: '#ffffff',
    mass: 0,
    radius: 0.05,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age,
    lifetime: 2,
  }
}

function testContactDistanceUsesVisibleSurface() {
  const star: BodyState = {
    id: 'surface-star',
    name: 'Surface Star',
    color: '#fff0cc',
    mass: 1,
    radius: 0.5,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
  const planet: BodyState = {
    id: 'surface-planet',
    name: 'Surface Planet',
    color: '#88aaff',
    mass: 0.1,
    radius: 0.2,
    position: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }

  assertClose(
    getCollisionContactDistance(star, planet),
    star.radius + planet.radius,
    1e-12,
    'collision boundary must equal the visible radius sum',
  )
}

function testFlashStartsAtImpactSurface() {
  const star: BodyState = {
    id: 'flash-star',
    name: 'Flash Star',
    color: '#fff0cc',
    mass: 10,
    radius: 1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
  const planet: BodyState = {
    id: 'flash-planet',
    name: 'Flash Planet',
    color: '#88aaff',
    mass: 0.1,
    radius: 0.1,
    position: { x: 1.099999, y: 0, z: 0 },
    velocity: { x: -0.4, y: 0, z: 0 },
    bodyType: 'planet',
  }

  const resolved = stepCoreBodies([star, planet], 1e-8)
  const flash = resolved.find((body) => body.bodyType === 'effect' && body.name === 'Collision flash')
  assert(flash, 'collision must create a flash')

  assertClose(
    flash.position.x,
    1,
    2e-4,
    'extreme mass-ratio flash must start at the impact surface instead of the center of mass',
  )
  assertClose(flash.position.y, 0, 1e-8, 'flash y position must stay on the impact point')
  assertClose(flash.position.z, 0, 1e-8, 'flash z position must stay on the impact point')
}

function testHitAndRunSurvivorsDoNotOverlap() {
  const a: BodyState = {
    id: 'grazing-a',
    name: 'Grazing A',
    color: '#99bbff',
    mass: 0.2,
    radius: 0.2,
    position: { x: -0.1999995, y: 0, z: 0 },
    velocity: { x: 0, y: -0.6, z: 0 },
    bodyType: 'planet',
  }
  const b: BodyState = {
    id: 'grazing-b',
    name: 'Grazing B',
    color: '#ffbb99',
    mass: 0.2,
    radius: 0.2,
    position: { x: 0.1999995, y: 0, z: 0 },
    velocity: { x: 0, y: 0.6, z: 0 },
    bodyType: 'planet',
  }

  const resolved = stepCoreBodies([a, b], 1e-8)
  const survivorA = resolved.find((body) => body.id === a.id)
  const survivorB = resolved.find((body) => body.id === b.id)
  assert(survivorA && survivorB, 'grazing equal-mass collision should retain both hit-and-run survivors')
  assert(
    distance(survivorA, survivorB) + 1e-10 >= survivorA.radius + survivorB.radius,
    'hit-and-run survivors must start fully separated',
  )
}

function testStagedImpactKeepsCollidersVisibleBeforeResolution() {
  const star: BodyState = {
    id: 'stage-star',
    name: 'Stage Star',
    color: '#fff0cc',
    mass: 1,
    radius: 0.3,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
  const planet: BodyState = {
    id: 'stage-planet',
    name: 'Stage Planet',
    color: '#88aaff',
    mass: 0.1,
    radius: 0.1,
    position: { x: 0.4005, y: 0, z: 0 },
    velocity: { x: -1, y: 0, z: 0 },
    bodyType: 'planet',
  }

  const dt = 0.0015
  const contactDistance = getCollisionContactDistance(star, planet)
  let frame = stepFragmentAwareBodies([star, planet], dt)
  let resolved = false
  let contactFrames = 0
  let sawVisibleOverlap = false

  for (let step = 0; step < 48; step += 1) {
    const bodyA = frame.find((body) => body.id === star.id)
    const bodyB = frame.find((body) => body.id === planet.id)

    if (bodyA && bodyB) {
      const flash = frame.find((body) => body.bodyType === 'effect' && body.name === 'Collision flash')
      assert(!flash, 'physical collision flash must not appear before the staged impact resolves')

      const separation = distance(bodyA, bodyB)
      assert(
        separation <= contactDistance + 1e-9,
        'staged impact must begin at contact instead of replaying a long pre-contact approach',
      )
      if (separation < contactDistance - 1e-6) sawVisibleOverlap = true

      contactFrames += 1
      frame = stepFragmentAwareBodies(frame, dt)
      continue
    }

    resolved = true
    const flash = frame.find((body) => body.bodyType === 'effect' && body.name === 'Collision flash')
    assert(flash, 'resolved staged collision must expose its physical flash on the result frame')
    break
  }

  assert(resolved, 'staged collision must resolve within its configured impact window')
  assert(
    contactFrames >= 25,
    'contact must remain visible for most of the 0.045 simulated-second impact window',
  )
  assert(sawVisibleOverlap, 'merge impact staging must visibly compress the colliders after contact')
}

function testStellarMergeDeepensBeforeResolution() {
  const starA: BodyState = {
    id: 'stellar-merge-a',
    name: 'Stellar Merge A',
    color: '#fff0cc',
    mass: 1,
    radius: 0.3,
    position: { x: -0.30025, y: 0, z: 0 },
    velocity: { x: 0.2, y: 0, z: 0 },
    bodyType: 'star',
  }
  const starB: BodyState = {
    id: 'stellar-merge-b',
    name: 'Stellar Merge B',
    color: '#ff9977',
    mass: 1,
    radius: 0.3,
    position: { x: 0.30025, y: 0, z: 0 },
    velocity: { x: -0.2, y: 0, z: 0 },
    bodyType: 'star',
  }

  const dt = 0.0015
  const contactDistance = getCollisionContactDistance(starA, starB)
  const minRadius = Math.min(starA.radius, starB.radius)
  let frame = stepFragmentAwareBodies([starA, starB], dt)
  let contactFrames = 0
  let deepestOverlap = 0
  let resolved = false

  for (let step = 0; step < 120; step += 1) {
    const bodyA = frame.find((body) => body.id === starA.id)
    const bodyB = frame.find((body) => body.id === starB.id)

    if (bodyA && bodyB) {
      const overlap = Math.max(0, contactDistance - distance(bodyA, bodyB))
      deepestOverlap = Math.max(deepestOverlap, overlap)
      contactFrames += 1
      frame = stepFragmentAwareBodies(frame, dt)
      continue
    }

    resolved = true
    break
  }

  assert(resolved, 'stellar merge must eventually resolve to its physical result')
  assert(
    contactFrames >= 72,
    'stellar merge should preserve both original stars for most of the 0.12 simulated-second absorption window',
  )
  assert(
    deepestOverlap >= minRadius * 1.5,
    'stellar merge should reach at least 150% of the smaller-star radius before resolving',
  )
  assert(
    deepestOverlap <= minRadius * 1.601,
    'stellar merge display staging must not exceed the configured 160% overlap target',
  )
}

function testCollisionWatchFollowsDescendantLineage() {
  const alpha = makeBody('Alpha', 1, 0.3, -1)
  const beta = makeBody('Beta', 0.5, 0.2, -0.6)
  const gamma = makeBody('Gamma', 0.8, 0.3, 1)
  const alphaBeta = makeBody('Alpha+Beta', 1.48, 0.36, -0.7)

  const resolvedAlpha = resolveBodyDescendant([alphaBeta, gamma], 'Alpha')
  assert(resolvedAlpha?.id === 'Alpha+Beta', 'missing source id must resolve to its largest living descendant')

  const thirdPartyResult = [
    alphaBeta,
    gamma,
    makeFlash('Alpha+Beta+flash1'),
  ]
  assert(
    !didCollisionWatchTargetImpact(
      [alpha, beta, gamma],
      thirdPartyResult,
      'Alpha',
      'Gamma',
      0.0015,
    ),
    'Alpha x Beta must not complete an Alpha x Gamma collision watch',
  )

  const targetContactAlphaBeta = makeBody('Alpha+Beta', 1.48, 0.36, -0.3)
  const targetContactGamma = makeBody('Gamma', 0.8, 0.3, 0.36)
  const mergedTarget = makeBody('Alpha+Beta+Gamma', 2.2, 0.45, 0)
  assert(
    didCollisionWatchTargetImpact(
      [targetContactAlphaBeta, targetContactGamma],
      [mergedTarget, makeFlash('Alpha+Beta+Gamma+flash2')],
      'Alpha',
      'Gamma',
      0.0015,
    ),
    'watch must complete when the two source lineages actually merge',
  )
}

function testCollisionWatchRequiresTargetHitAndRunResult() {
  const alphaBeta = makeBody('Alpha+Beta', 1.4, 0.3, -0.3)
  const gamma = makeBody('Gamma', 1, 0.3, 0.3)
  const previous = [alphaBeta, gamma]

  const unrelatedCooldown = {
    ...alphaBeta,
    collisionCooldown: 0.07,
  }
  assert(
    !didCollisionWatchTargetImpact(
      previous,
      [unrelatedCooldown, gamma, makeFlash('Alpha+Beta+flash7')],
      'Alpha',
      'Gamma',
      0.0015,
    ),
    'third-party cooldown/flash must not complete the watched pair',
  )

  const survivorA = { ...alphaBeta, collisionCooldown: 0.07 }
  const survivorB = { ...gamma, collisionCooldown: 0.07 }
  assert(
    didCollisionWatchTargetImpact(
      previous,
      [survivorA, survivorB, makeFlash('Alpha+Beta+Gamma+flash8')],
      'Alpha',
      'Gamma',
      0.0015,
    ),
    'target hit-and-run must complete only with contact, both cooldowns, and the target pair flash',
  )
}

function testPerspectiveCameraFramingMatchesOneTwentiethWidth() {
  const cases = [
    { width: 1080, height: 1920, radius: 0.3 },
    { width: 1080, height: 1080, radius: 0.8 },
    { width: 1080, height: 607.5, radius: 0.06 },
    { width: 1440, height: 900, radius: 0.001 },
  ]

  for (const testCase of cases) {
    const minRenderRadius = 0.025
    const renderedRadius = getRenderedBodyRadius(testCase.radius, minRenderRadius)
    const distanceToBody = calculatePerspectiveBodyDistance({
      bodyRadius: testCase.radius,
      minRenderRadius,
      verticalFovDegrees: 55,
      viewportWidth: testCase.width,
      viewportHeight: testCase.height,
    })
    const projectedRadius = calculateProjectedBodyRadiusPixels(
      renderedRadius,
      distanceToBody,
      55,
      testCase.width,
      testCase.height,
    )

    assertClose(
      projectedRadius,
      testCase.width / 20,
      1e-7,
      `projected body radius must be width/20 for ${testCase.width}x${testCase.height}`,
    )
  }
}

const tests = [
  testContactDistanceUsesVisibleSurface,
  testFlashStartsAtImpactSurface,
  testHitAndRunSurvivorsDoNotOverlap,
  testStagedImpactKeepsCollidersVisibleBeforeResolution,
  testStellarMergeDeepensBeforeResolution,
  testCollisionWatchFollowsDescendantLineage,
  testCollisionWatchRequiresTargetHitAndRunResult,
  testPerspectiveCameraFramingMatchesOneTwentiethWidth,
]

for (const test of tests) test()
console.log(`physics regression checks passed (${tests.length})`)
