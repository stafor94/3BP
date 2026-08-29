import { getConservationSnapshot } from '../src/physics/conservationDiagnostics'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepProductionBodies } from '../src/physics/fragmentAwareEngine'
import type { BodyState, BodyType, Vec3 } from '../src/types'

const MASS_RELATIVE_TOLERANCE = 1e-12
const MOMENTUM_RELATIVE_TOLERANCE = 1e-10
const CORE_COLLISION_DT = 1e-8
const PRODUCTION_STEP_DT = 0.0015

type Axis = keyof Vec3

type CollisionScenario = {
  name: string
  bodies: [BodyState, BodyState]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected} ± ${tolerance}, got ${actual}`)
  }
}

function makeBody(
  id: string,
  mass: number,
  radius: number,
  x: number,
  velocity: Vec3,
  bodyType: BodyType,
): BodyState {
  return {
    id,
    name: id,
    color: '#ffffff',
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { ...velocity },
    bodyType,
  }
}

function momentumScale(bodies: readonly BodyState[], axis: Axis) {
  return bodies.reduce(
    (sum, body) => sum + Math.abs(body.velocity[axis] * body.mass),
    0,
  )
}

function assertConserved(beforeBodies: readonly BodyState[], afterBodies: readonly BodyState[], label: string) {
  const before = getConservationSnapshot(beforeBodies)
  const after = getConservationSnapshot(afterBodies)
  const massTolerance = MASS_RELATIVE_TOLERANCE * Math.max(1, Math.abs(before.totalMass))

  assertClose(
    after.totalMass,
    before.totalMass,
    massTolerance,
    `${label} total mass must be conserved across the represented collision result`,
  )

  for (const axis of ['x', 'y', 'z'] as const) {
    const tolerance = MOMENTUM_RELATIVE_TOLERANCE * Math.max(1, momentumScale(beforeBodies, axis))
    assertClose(
      after.linearMomentum[axis],
      before.linearMomentum[axis],
      tolerance,
      `${label} ${axis}-momentum must be conserved`,
    )
  }
}

function findSingleRemnant(bodies: readonly BodyState[], label: string) {
  const remnants = bodies.filter((body) =>
    body.mass > 0 && body.bodyType !== 'fragment' && body.bodyType !== 'effect',
  )
  assert(remnants.length === 1, `${label} must resolve to one physical remnant, got ${remnants.length}`)
  return remnants[0]
}

function assertRemnantVelocityBalancesEjecta(
  beforeBodies: readonly BodyState[],
  afterBodies: readonly BodyState[],
  label: string,
) {
  const before = getConservationSnapshot(beforeBodies)
  const remnant = findSingleRemnant(afterBodies, label)
  const ejecta = afterBodies.filter((body) => body !== remnant && body.mass > 0)
  const ejectaState = getConservationSnapshot(ejecta)
  assert(ejectaState.totalMass > 0, `${label} must exercise mass-carrying collision ejecta`)

  const expectedVelocity: Vec3 = {
    x: (before.linearMomentum.x - ejectaState.linearMomentum.x) / remnant.mass,
    y: (before.linearMomentum.y - ejectaState.linearMomentum.y) / remnant.mass,
    z: (before.linearMomentum.z - ejectaState.linearMomentum.z) / remnant.mass,
  }

  for (const axis of ['x', 'y', 'z'] as const) {
    const tolerance = MOMENTUM_RELATIVE_TOLERANCE * Math.max(1, Math.abs(expectedVelocity[axis]))
    assertClose(
      remnant.velocity[axis],
      expectedVelocity[axis],
      tolerance,
      `${label} remnant ${axis}-velocity must balance represented ejecta momentum`,
    )
  }
}

function runCoreScenario(scenario: CollisionScenario) {
  const result = stepCoreBodies(scenario.bodies, CORE_COLLISION_DT)
  assertConserved(scenario.bodies, result, scenario.name)
  assertRemnantVelocityBalancesEjecta(scenario.bodies, result, scenario.name)
  return result
}

function testCoreCollisionConservationMatrix() {
  const scenarios: CollisionScenario[] = [
    {
      name: 'similar-mass opposing merge',
      bodies: [
        makeBody(
          'similar-a',
          0.21,
          0.18,
          -0.17499975,
          { x: 0.35, y: 0.07, z: -0.03 },
          'planet',
        ),
        makeBody(
          'similar-b',
          0.18,
          0.17,
          0.17499975,
          { x: -0.22, y: -0.02, z: 0.04 },
          'planet',
        ),
      ],
    },
    {
      name: 'extreme-mass-ratio stationary-target absorption',
      bodies: [
        makeBody(
          'stationary-planet',
          0.3,
          0.22,
          -0.12999975,
          { x: 0, y: 0, z: 0 },
          'planet',
        ),
        makeBody(
          'small-moon',
          0.002,
          0.04,
          0.12999975,
          { x: -0.18, y: 0.01, z: -0.005 },
          'moon',
        ),
      ],
    },
    {
      name: 'very-low-relative-speed merge',
      bodies: [
        makeBody(
          'slow-a',
          0.15,
          0.16,
          -0.15499975,
          { x: 1.000001, y: -0.4, z: 0.2 },
          'planet',
        ),
        makeBody(
          'slow-b',
          0.14,
          0.15,
          0.15499975,
          { x: 0.999999, y: -0.4, z: 0.2 },
          'planet',
        ),
      ],
    },
    {
      name: 'high-relative-speed disruption',
      bodies: [
        makeBody(
          'fast-a',
          0.18,
          0.17,
          -0.16499975,
          { x: 2.8, y: 0.15, z: -0.08 },
          'planet',
        ),
        makeBody(
          'fast-b',
          0.16,
          0.16,
          0.16499975,
          { x: -2.3, y: -0.12, z: 0.05 },
          'planet',
        ),
      ],
    },
  ]

  for (const scenario of scenarios) runCoreScenario(scenario)
}

function testMassCarryingEffectsParticipateInDiagnostics() {
  const scenario: CollisionScenario = {
    name: 'mass-carrying effect ejecta',
    bodies: [
      makeBody(
        'effect-carrier-planet',
        0.3,
        0.22,
        -0.12999975,
        { x: 0, y: 0, z: 0 },
        'planet',
      ),
      makeBody(
        'effect-carrier-moon',
        0.002,
        0.04,
        0.12999975,
        { x: -0.18, y: 0, z: 0 },
        'moon',
      ),
    ],
  }

  const result = runCoreScenario(scenario)
  const massCarryingEffects = result.filter((body) => body.bodyType === 'effect' && body.mass > 0)
  assert(
    massCarryingEffects.length > 0,
    'extreme mass-ratio absorption must cover the engine path where transient effects carry ejecta mass',
  )
}

function testProductionAbsorptionWrapperPreservesConservation() {
  const initial: [BodyState, BodyState] = [
    makeBody(
      'production-planet',
      0.3,
      0.22,
      -0.12999975,
      { x: 0, y: 0, z: 0 },
      'planet',
    ),
    makeBody(
      'production-moon',
      0.002,
      0.04,
      0.12999975,
      { x: -0.18, y: 0.01, z: 0 },
      'moon',
    ),
  ]

  let frame: BodyState[] = initial
  let resolved: BodyState[] | null = null

  for (let step = 0; step < 40; step += 1) {
    frame = stepProductionBodies(frame, PRODUCTION_STEP_DT)
    const sourceBodiesStillPresent = initial.filter((source) =>
      frame.some((body) => body.id === source.id && body.bodyType !== 'effect'),
    ).length
    if (sourceBodiesStillPresent < 2) {
      resolved = frame
      break
    }
  }

  assert(resolved, 'production absorption staging must resolve within the regression window')
  assertConserved(initial, resolved, 'production extreme-mass-ratio absorption')
  assertRemnantVelocityBalancesEjecta(initial, resolved, 'production extreme-mass-ratio absorption')
  assert(
    resolved.some((body) => body.bodyType === 'effect' && body.mass > 0),
    'production absorption result must retain its represented mass-carrying ejecta for the conservation snapshot',
  )
}

const tests = [
  testCoreCollisionConservationMatrix,
  testMassCarryingEffectsParticipateInDiagnostics,
  testProductionAbsorptionWrapperPreservesConservation,
]

for (const test of tests) test()
console.log(`collision conservation regression checks passed (${tests.length})`)
