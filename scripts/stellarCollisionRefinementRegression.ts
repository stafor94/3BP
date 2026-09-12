import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import { getStellarCollisionEjectaDirection } from '../src/physics/stellarEjectaDirection'
import {
  getStellarCollisionContactDurationSeconds,
  getStellarCollisionTimeline,
  STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
} from '../src/stellarCollisionTimeline'
import type { BodyState, StellarCollisionOutcome, Vec3 } from '../src/types'

const EPSILON = 1e-9

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function length(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function totalMomentum(bodies: BodyState[]) {
  return bodies.reduce((sum, body) => ({
    x: sum.x + body.velocity.x * body.mass,
    y: sum.y + body.velocity.y * body.mass,
    z: sum.z + body.velocity.z * body.mass,
  }), { x: 0, y: 0, z: 0 })
}

function totalMass(bodies: BodyState[]) {
  return bodies.reduce((sum, body) => sum + body.mass, 0)
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  x: number,
  velocity: Vec3,
  color = '#ffd36b',
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity,
    bodyType: 'star',
  }
}

function assertFiniteUnitDirection(direction: Vec3, label: string, is2d = false) {
  assert(
    Number.isFinite(direction.x) && Number.isFinite(direction.y) && Number.isFinite(direction.z),
    `${label}: direction must stay finite`,
  )
  assert(Math.abs(length(direction) - 1) <= 1e-9, `${label}: direction must stay normalized`)
  if (is2d) assert(Math.abs(direction.z) <= 1e-12, `${label}: 2D direction left the simulation plane`)
}

function directionInput(
  outcome: StellarCollisionOutcome,
  grazing: number,
  index: number,
  overrides: Partial<Parameters<typeof getStellarCollisionEjectaDirection>[0]> = {},
): Parameters<typeof getStellarCollisionEjectaDirection>[0] {
  return {
    seed: 'integration-direction-seed',
    index,
    count: 10,
    is2d: true,
    normal: { x: 1, y: 0, z: 0 },
    tangent: { x: 0, y: 1, z: 0 },
    grazing,
    speedRatio: 1.35,
    outcome,
    massAsymmetry: 0.42,
    strippedDirection: { x: -0.18, y: 0.98, z: 0 },
    relativeDirection: { x: -0.52, y: 0.85, z: 0 },
    dominantTangentSign: 1,
    sourceIsSmaller: index % 2 === 0,
    large: index < 3,
    ...overrides,
  }
}

function testTimelineBoundariesAndPauseAreDeterministic() {
  for (const outcome of ['merge', 'hitAndRun', 'partialDisruption'] as const) {
    const contact = getStellarCollisionContactDurationSeconds(outcome)
    const total = contact + STELLAR_COLLISION_SETTLE_DURATION_SECONDS
    const samples = [
      0,
      contact * 0.5,
      Math.max(0, contact - 1e-9),
      contact,
      contact + STELLAR_COLLISION_SETTLE_DURATION_SECONDS * 0.5,
      total,
      total + 0.1,
    ].map((eventAgeSeconds) => getStellarCollisionTimeline({
      eventAgeSeconds,
      contactDurationSeconds: contact,
    }))

    for (const timeline of samples) {
      for (const value of [
        timeline.eventAgeSeconds,
        timeline.contactProgress,
        timeline.transferClockProgress,
        timeline.transferProgress,
        timeline.settleProgress,
        timeline.releaseProgress,
      ]) assert(Number.isFinite(value), `${outcome}: timeline values must remain finite`)
      assert(timeline.contactProgress >= 0 && timeline.contactProgress <= 1, `${outcome}: contact progress bounds`)
      assert(timeline.transferProgress >= 0 && timeline.transferProgress <= 1, `${outcome}: transfer progress bounds`)
      assert(timeline.settleProgress >= 0 && timeline.settleProgress <= 1, `${outcome}: settle progress bounds`)
    }

    assert(samples[0].contactProgress === 0, `${outcome}: contact starts at zero`)
    assert(samples[3].contactProgress === 1, `${outcome}: contact completes at its boundary`)
    assert(samples[3].settleProgress === 0, `${outcome}: settle starts without rewinding event time`)
    assert(samples[5].isComplete && samples[5].settleProgress === 1, `${outcome}: full event completes at total duration`)
    assert(samples[6].isComplete && samples[6].settleProgress === 1, `${outcome}: overshoot remains completed`)

    for (let index = 1; index < samples.length; index += 1) {
      assert(samples[index].contactProgress + EPSILON >= samples[index - 1].contactProgress,
        `${outcome}: contact progress must not rewind`)
      assert(samples[index].transferProgress + EPSILON >= samples[index - 1].transferProgress,
        `${outcome}: transfer progress must not rewind`)
      assert(samples[index].settleProgress + EPSILON >= samples[index - 1].settleProgress,
        `${outcome}: settle progress must not rewind`)
    }

    const pausedA = getStellarCollisionTimeline({ eventAgeSeconds: contact * 0.73, contactDurationSeconds: contact })
    const pausedB = getStellarCollisionTimeline({ eventAgeSeconds: contact * 0.73, contactDurationSeconds: contact })
    assert(JSON.stringify(pausedA) === JSON.stringify(pausedB), `${outcome}: identical simulation time must be stable`)
  }

  const sanitized = getStellarCollisionTimeline({ eventAgeSeconds: Number.NaN, contactDurationSeconds: Number.NaN })
  assert(sanitized.eventAgeSeconds === 0 && sanitized.contactDurationSeconds === 0,
    'non-finite timeline input must normalize instead of producing NaN')
}

function testDirectionFrameIsFiniteDeterministicAndContinuous() {
  const outcomes = ['merge', 'hitAndRun', 'partialDisruption'] as const
  for (const outcome of outcomes) {
    for (const grazing of [0, 0.28, 0.6, 0.82, 0.98]) {
      for (let index = 0; index < 10; index += 1) {
        const input = directionInput(outcome, grazing, index)
        const first = getStellarCollisionEjectaDirection(input)
        const second = getStellarCollisionEjectaDirection(input)
        assertFiniteUnitDirection(first, `${outcome}/${grazing}/${index}`, true)
        assert(JSON.stringify(first) === JSON.stringify(second), `${outcome}/${grazing}/${index}: same seed must reproduce direction`)
      }
    }
  }

  for (const boundary of [0.28, 0.6, 0.82]) {
    for (let index = 0; index < 10; index += 1) {
      const below = getStellarCollisionEjectaDirection(directionInput('hitAndRun', boundary - 1e-4, index))
      const above = getStellarCollisionEjectaDirection(directionInput('hitAndRun', boundary + 1e-4, index))
      assert(dot(below, above) > 0.995,
        `grazing=${boundary}: nearby collision inputs must not flip the full direction distribution`)
    }
  }

  for (let index = 0; index < 10; index += 1) {
    const direction3d = getStellarCollisionEjectaDirection(directionInput('partialDisruption', 0.5, index, {
      is2d: false,
      normal: { x: 0, y: 0, z: 1 },
      tangent: { x: 0, y: 0, z: 1 },
      strippedDirection: { x: 0.4, y: 0.8, z: 0.2 },
      relativeDirection: { x: -0.6, y: 0.5, z: -0.1 },
    }))
    assertFiniteUnitDirection(direction3d, `3D-degenerate/${index}`)
  }
}

function testHeadOnBalanceAndOutcomeSpecificGrazingShape() {
  const headOn = Array.from({ length: 10 }, (_, index) =>
    getStellarCollisionEjectaDirection(directionInput('merge', 0, index)))
  const positive = headOn.filter((direction) => direction.y > 0).length
  const negative = headOn.filter((direction) => direction.y < 0).length
  assert(Math.abs(positive - negative) <= 1,
    `near-head-on 2D splash must not acquire an index-driven one-sided bias: ${positive}/${negative}`)

  const grazingByOutcome = Object.fromEntries(
    (['merge', 'hitAndRun', 'partialDisruption'] as const).map((outcome) => [
      outcome,
      Array.from({ length: 10 }, (_, index) =>
        getStellarCollisionEjectaDirection(directionInput(outcome, 0.94, index))),
    ]),
  ) as Record<StellarCollisionOutcome, Vec3[]>

  const hitRun = grazingByOutcome.hitAndRun
  const hitRunDominant = hitRun.filter((direction) => direction.y > 0.15).length
  const hitRunCounter = hitRun.filter((direction) => direction.y < -0.15).length
  assert(hitRunDominant >= 7 && hitRunCounter >= 1,
    `hit-and-run must retain a dominant stripping stream plus sparse counter-stream: ${hitRunDominant}/${hitRunCounter}`)

  const angularDifference = (first: Vec3[], second: Vec3[]) => first.reduce(
    (sum, direction, index) => sum + (1 - dot(direction, second[index])),
    0,
  )
  assert(angularDifference(grazingByOutcome.merge, grazingByOutcome.hitAndRun) > 0.1,
    'merge and hit-and-run must not use the same renamed fan distribution')
  assert(angularDifference(grazingByOutcome.hitAndRun, grazingByOutcome.partialDisruption) > 0.1,
    'hit-and-run and partial disruption must retain distinct direction distributions')

  const smallerDamage = Array.from({ length: 10 }, (_, index) =>
    getStellarCollisionEjectaDirection(directionInput('partialDisruption', 0.9, index, { sourceIsSmaller: true })))
  const largerDamage = Array.from({ length: 10 }, (_, index) =>
    getStellarCollisionEjectaDirection(directionInput('partialDisruption', 0.9, index, { sourceIsSmaller: false })))
  assert(angularDifference(smallerDamage, largerDamage) > 0.01,
    'partial disruption must actually use damaged-source asymmetry in direction shaping')
}

function testStellarPhysicalOutcomesPreserveMassAndMomentum() {
  const fixtures: Array<{ name: string; expected: StellarCollisionOutcome; bodies: BodyState[] }> = [
    {
      name: 'hit-and-run',
      expected: 'hitAndRun',
      bodies: [
        makeStar('stage7-hit-a', 1, 0.3, -0.2999995, { x: 0.15, y: -1.65, z: 0 }, '#ff8b68'),
        makeStar('stage7-hit-b', 1, 0.3, 0.2999995, { x: -0.15, y: 1.65, z: 0 }, '#b8d8ff'),
      ],
    },
    {
      name: 'partial-disruption',
      expected: 'partialDisruption',
      bodies: [
        makeStar('stage7-partial-a', 0.6, 0.24, -0.2799995, { x: 1.05, y: -1.2, z: 0 }, '#ffaf5f'),
        makeStar('stage7-partial-b', 1.3, 0.32, 0.2799995, { x: -1.05, y: 1.2, z: 0 }, '#fff4e8'),
      ],
    },
  ]

  for (const fixture of fixtures) {
    const beforeMass = totalMass(fixture.bodies)
    const beforeMomentum = totalMomentum(fixture.bodies)
    const result = stepCoreBodies(fixture.bodies, 1e-8)
    const stars = result.filter((body) => body.bodyType === 'star')
    const plasma = result.filter((body) => body.effectVisual?.kind === 'stellarPlasma')
    assert(stars.length === 2, `${fixture.name}: separated outcome must keep both stars`)
    assert(stars.every((body) => body.stellarCollisionOutcome === fixture.expected),
      `${fixture.name}: actual solver outcome must match the representative scenario`)
    assert(plasma.length > 0, `${fixture.name}: representative collision must emit stellar plasma`)

    for (const body of plasma) {
      const direction = body.effectVisual?.direction
      assert(direction, `${fixture.name}: plasma must expose physical travel direction metadata`)
      assertFiniteUnitDirection(direction, `${fixture.name}/${body.id}`, true)
      assert(
        Number.isFinite(body.velocity.x) && Number.isFinite(body.velocity.y) && Number.isFinite(body.velocity.z),
        `${fixture.name}/${body.id}: velocity must stay finite`,
      )
      assert(Math.abs(body.velocity.z) <= 1e-12, `${fixture.name}/${body.id}: 2D velocity left the simulation plane`)
    }

    const afterMomentum = totalMomentum(result)
    assert(Math.abs(totalMass(result) - beforeMass) <= 1e-9,
      `${fixture.name}: represented ejecta direction change altered total mass`)
    assert(length(subtract(afterMomentum, beforeMomentum)) <= 2e-7,
      `${fixture.name}: existing survivor/remnant correction no longer preserves linear momentum`)
  }
}

function makeExactContactPair(prefix: string): BodyState[] {
  return [
    makeStar(`${prefix}-a`, 1, 0.3, -0.3, { x: 0.3, y: 0, z: 0 }, '#7ea7ff'),
    makeStar(`${prefix}-b`, 1, 0.3, 0.3, { x: -0.3, y: 0, z: 0 }, '#ffaf5f'),
  ]
}

function testFragmentAwareOvershootPauseAndFreshEvents() {
  const start = makeExactContactPair('stage7-event-one')
  const contactFrame = stepFragmentAwareBodies(start, 0.0015)
  const contactStars = contactFrame.filter((body) => body.bodyType === 'star')
  const contactState = contactStars[0]?.stellarCollisionPresentation
  assert(contactState?.phase === 'contact', 'exact-contact fixture must enter the production contact bridge')
  const frozen = stepFragmentAwareBodies(contactFrame, 0)
  assert(JSON.stringify(frozen) === JSON.stringify(contactFrame),
    'zero simulation dt must not advance production collision state')

  const overshot = stepFragmentAwareBodies(contactFrame, 0.25)
  const overshotStars = overshot.filter((body) => body.bodyType === 'star')
  assert(overshotStars.length >= 1, 'overshoot must retain the authoritative physical result')
  assert(overshotStars.every((body) => body.stellarCollisionPresentation === undefined),
    'overshoot beyond contact+settle must retire the presentation in the same physics update')
  assert(overshotStars.every((body) =>
    body.stellarCollisionAge !== undefined &&
    body.stellarCollisionContactDurationSeconds !== undefined &&
    body.stellarCollisionAge <=
      body.stellarCollisionContactDurationSeconds + STELLAR_COLLISION_SETTLE_DURATION_SECONDS + 1e-12),
  'completed event metadata must remain finite and capped after overshoot')

  const secondContact = stepFragmentAwareBodies(makeExactContactPair('stage7-event-two'), 0.0015)
  const secondState = secondContact.find((body) => body.bodyType === 'star')?.stellarCollisionPresentation
  assert(secondState?.eventId && contactState.eventId && secondState.eventId !== contactState.eventId,
    'a later physical stellar collision must receive a fresh event id')
}

function testMixedCollisionPreservesPriorStellarEventMetadata() {
  const contactDuration = getStellarCollisionContactDurationSeconds('merge')
  const completedAge = contactDuration + STELLAR_COLLISION_SETTLE_DURATION_SECONDS
  const star: BodyState = {
    ...makeStar('stage7-mixed-star', 1, 0.3, -0.175, { x: 0.22, y: 0, z: 0 }, '#ffd36b'),
    stellarCollisionEventId: 'stellar:prior-event',
    stellarCollisionAge: completedAge,
    stellarCollisionContactDurationSeconds: contactDuration,
    stellarCollisionOutcome: 'merge',
  }
  const moon: BodyState = {
    id: 'stage7-mixed-moon',
    name: 'stage7-mixed-moon',
    color: '#7ea7ff',
    mass: 0.02,
    radius: 0.05,
    position: { x: 0.175, y: 0, z: 0 },
    velocity: { x: -0.22, y: 0, z: 0 },
    bodyType: 'moon',
  }

  const contact = stepFragmentAwareBodies([star, moon], 0.0015)
  const resolved = stepFragmentAwareBodies(contact, 0.05)
  const survivingStar = resolved.find((body) => body.bodyType === 'star')
  assert(survivingStar, 'mixed stellar/non-stellar collision must retain a stellar result')
  assert(survivingStar.stellarCollisionEventId === 'stellar:prior-event',
    'mixed collision must not erase unrelated latest stellar event identity')
  assert(survivingStar.stellarCollisionContactDurationSeconds === contactDuration,
    'mixed collision must not erase unrelated stellar event timing metadata')
}

function testDirectionSamplerHasNoRuntimeEntropy() {
  const source = readFileSync(resolve(process.cwd(), 'src/physics/stellarEjectaDirection.ts'), 'utf8')
  for (const forbidden of ['Math.random(', 'Date.now(', 'performance.now(', 'requestAnimationFrame(']) {
    assert(!source.includes(forbidden), `stellar ejecta direction sampling must not depend on ${forbidden}`)
  }
}

testTimelineBoundariesAndPauseAreDeterministic()
testDirectionFrameIsFiniteDeterministicAndContinuous()
testHeadOnBalanceAndOutcomeSpecificGrazingShape()
testStellarPhysicalOutcomesPreserveMassAndMomentum()
testFragmentAwareOvershootPauseAndFreshEvents()
testMixedCollisionPreservesPriorStellarEventMetadata()
testDirectionSamplerHasNoRuntimeEntropy()

console.log('stellar collision refinement integration regression passed')
