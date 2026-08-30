import { bodyCarriesCollisionLineage } from '../src/collisionIdentity'
import { getConservationSnapshot } from '../src/physics/conservationDiagnostics'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import { stepBodies as stepStageTwoBodies } from '../src/physics/fragmentAwareEngineStageTwo'
import type { BodyState, Vec3 } from '../src/types'

const DT = 0.0015
const PRIMARY_ID = 'directionality-primary'
const IMPACTOR_ID = 'directionality-impactor'

type Stepper = (input: BodyState[], dt: number) => BodyState[]

type Scenario = {
  name: string
  impactorVelocity: Vec3
}

type EjectaMetric = {
  idPattern: string
  radius: number
  surfaceGap: number
  outwardSpeed: number
  travelAlignment: number
  tangentAlignment: number
  tangentSignedSpeed: number
}

type RunResult = {
  frame: BodyState[]
  metrics: EjectaMetric[]
  minimumSurfaceGap: number
  macroOutwardSpeed: number
  macroTravelAlignment: number
  macroTangentAlignment: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function length(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const valueLength = length(value)
  if (valueLength > 1e-12) return scale(value, 1 / valueLength)
  const fallbackLength = length(fallback)
  return fallbackLength > 1e-12
    ? scale(fallback, 1 / fallbackLength)
    : { x: 1, y: 0, z: 0 }
}

function projectToPlane(value: Vec3, normal: Vec3) {
  return subtract(value, scale(normal, dot(value, normal)))
}

function makeFixture(scenario: Scenario): BodyState[] {
  const primary: BodyState = {
    id: PRIMARY_ID,
    name: 'Janus',
    color: '#c87545',
    mass: 0.35,
    radius: 0.0688,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }
  const impactor: BodyState = {
    id: IMPACTOR_ID,
    name: 'Luna',
    color: '#65cce2',
    mass: 0.0019,
    radius: 0.0187,
    position: { x: primary.radius + 0.0187 - 1e-6, y: 0, z: 0 },
    velocity: { ...scenario.impactorVelocity },
    bodyType: 'moon',
  }
  return [primary, impactor]
}

function isCollisionEjecta(body: BodyState) {
  return body.mass > 0 &&
    (body.bodyType === 'fragment' || body.name === 'Collision spark') &&
    bodyCarriesCollisionLineage(body, PRIMARY_ID) &&
    bodyCarriesCollisionLineage(body, IMPACTOR_ID)
}

function getRemnant(frame: BodyState[]) {
  return frame.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, PRIMARY_ID) &&
    bodyCarriesCollisionLineage(body, IMPACTOR_ID),
  )
}

function collisionIdPattern(id: string) {
  return id.replace(/(flash|shock|afterglow|plasma|fx|frag)\d+(?=-|$)/g, '$1#')
}

function resolve(stepper: Stepper, scenario: Scenario) {
  let frame = makeFixture(scenario)
  for (let step = 0; step < 80; step += 1) {
    frame = stepper(frame, DT)
    const remnant = getRemnant(frame)
    const ejecta = frame.filter(isCollisionEjecta)
    if (remnant && ejecta.length >= 2) return frame
  }
  throw new Error(`${scenario.name} did not resolve with physical ejecta within 80 steps`)
}

function analyze(frame: BodyState[], scenario: Scenario): RunResult {
  const initial = makeFixture(scenario)
  const primary = initial.find((body) => body.id === PRIMARY_ID)!
  const impactor = initial.find((body) => body.id === IMPACTOR_ID)!
  const remnant = getRemnant(frame)
  assert(remnant, `${scenario.name} must have a lineage remnant`)
  const ejecta = frame
    .filter(isCollisionEjecta)
    .slice()
    .sort((a, b) => b.radius - a.radius || b.mass - a.mass || a.id.localeCompare(b.id))
  assert(ejecta.length >= 2, `${scenario.name} must have at least two mass-bearing ejecta`)

  const outwardNormal = normalize(
    subtract(impactor.position, primary.position),
    { x: 1, y: 0, z: 0 },
  )
  const travel = subtract(impactor.velocity, primary.velocity)
  const travelDirection = normalize(travel, scale(outwardNormal, -1))
  const tangentDirection = normalize(
    projectToPlane(travel, outwardNormal),
    { x: 0, y: 1, z: 0 },
  )

  const metrics = ejecta.map((body) => {
    const relativeVelocity = subtract(body.velocity, remnant.velocity)
    const relativeDirection = normalize(relativeVelocity, outwardNormal)
    const separation = length(subtract(body.position, remnant.position))
    return {
      idPattern: collisionIdPattern(body.id),
      radius: body.radius,
      surfaceGap: separation - body.radius - remnant.radius,
      outwardSpeed: dot(relativeVelocity, outwardNormal),
      travelAlignment: dot(relativeDirection, travelDirection),
      tangentAlignment: dot(relativeDirection, tangentDirection),
      tangentSignedSpeed: dot(relativeVelocity, tangentDirection),
    }
  })
  const macro = metrics.slice(0, Math.min(2, metrics.length))
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

  return {
    frame,
    metrics,
    minimumSurfaceGap: Math.min(...metrics.map((metric) => metric.surfaceGap)),
    macroOutwardSpeed: average(macro.map((metric) => metric.outwardSpeed)),
    macroTravelAlignment: average(macro.map((metric) => metric.travelAlignment)),
    macroTangentAlignment: average(macro.map((metric) => metric.tangentAlignment)),
  }
}

function assertConservation(scenario: Scenario, frame: BodyState[], label: string) {
  const before = getConservationSnapshot(makeFixture(scenario))
  const after = getConservationSnapshot(frame)
  assert(
    Math.abs(after.totalMass - before.totalMass) <= 1e-10,
    `${label} mass changed: ${before.totalMass} -> ${after.totalMass}`,
  )
  for (const axis of ['x', 'y', 'z'] as const) {
    assert(
      Math.abs(after.linearMomentum[axis] - before.linearMomentum[axis]) <= 1e-8,
      `${label} ${axis}-momentum changed: ${before.linearMomentum[axis]} -> ${after.linearMomentum[axis]}`,
    )
  }
}

function snapshot(frame: BodyState[]) {
  return frame
    .filter((body) => body.mass > 0)
    .map((body) => ({
      idPattern: collisionIdPattern(body.id),
      bodyType: body.bodyType,
      name: body.name,
      mass: body.mass,
      radius: body.radius,
      position: { ...body.position },
      velocity: { ...body.velocity },
    }))
    .sort((a, b) => a.idPattern.localeCompare(b.idPattern))
}

const scenarios: Scenario[] = [
  {
    name: 'representative-grazing',
    impactorVelocity: { x: -0.21708, y: 2.4022115380623745, z: 0 },
  },
  {
    name: 'near-head-on',
    impactorVelocity: { x: -2.35, y: 0.12, z: 0 },
  },
  {
    name: 'oblique',
    impactorVelocity: { x: -1.35, y: 1.75, z: 0 },
  },
]

const report: Record<string, object> = {}

for (const scenario of scenarios) {
  const stageTwo = analyze(resolve(stepStageTwoBodies, scenario), scenario)
  const afterFrame = resolve(stepBodies, scenario)
  const after = analyze(afterFrame, scenario)

  report[scenario.name] = {
    stage2: {
      minimumSurfaceGap: stageTwo.minimumSurfaceGap,
      macroOutwardSpeed: stageTwo.macroOutwardSpeed,
      macroTravelAlignment: stageTwo.macroTravelAlignment,
      macroTangentAlignment: stageTwo.macroTangentAlignment,
    },
    after: {
      minimumSurfaceGap: after.minimumSurfaceGap,
      macroOutwardSpeed: after.macroOutwardSpeed,
      macroTravelAlignment: after.macroTravelAlignment,
      macroTangentAlignment: after.macroTangentAlignment,
    },
  }

  assertConservation(scenario, afterFrame, scenario.name)
  assert(
    after.minimumSurfaceGap > 0,
    `${scenario.name} fresh ejecta must start outside the physical remnant: ${after.minimumSurfaceGap}`,
  )

  if (scenario.name !== 'near-head-on') {
    assert(
      after.metrics.slice(0, 2).every((metric) => metric.outwardSpeed > 0),
      `${scenario.name} macro ejecta must initially move outward from the remnant`,
    )
    assert(
      after.macroTangentAlignment >= 0.45,
      `${scenario.name} macro ejecta lost impactor tangential motion: ${after.macroTangentAlignment}`,
    )
    assert(
      after.macroTangentAlignment >= stageTwo.macroTangentAlignment + 0.15,
      `${scenario.name} directionality did not improve over stage 2: ` +
        `${stageTwo.macroTangentAlignment} -> ${after.macroTangentAlignment}`,
    )
  } else {
    const normalSpeeds = after.metrics.map((metric) => metric.outwardSpeed)
    assert(
      normalSpeeds.some((speed) => speed > 0) && normalSpeeds.some((speed) => speed < 0),
      'near-head-on ejecta must preserve the established two-sided collision-normal response',
    )
    assert(
      Math.abs(after.macroOutwardSpeed - stageTwo.macroOutwardSpeed) <= 1e-10 &&
      Math.abs(after.macroTravelAlignment - stageTwo.macroTravelAlignment) <= 1e-10,
      'stage 3 must not rewrite the established near-head-on ejecta velocity distribution',
    )
  }

  const replay = resolve(stepBodies, scenario)
  assert(
    JSON.stringify(snapshot(afterFrame)) === JSON.stringify(snapshot(replay)),
    `${scenario.name} stage-3 ejecta shaping must remain deterministic`,
  )
}

console.log(JSON.stringify(report, null, 2))
console.log('collision ejecta directionality regression passed')
