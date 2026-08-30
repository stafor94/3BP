import { getConservationSnapshot } from '../src/physics/conservationDiagnostics'
import {
  MAX_NON_STELLAR_NORMALIZED_PENETRATION,
  stepBodies,
} from '../src/physics/fragmentAwareEngine'
import { stepBodies as stepPhaseOneBodies } from '../src/physics/fragmentAwareEngineCore'
import type { BodyState } from '../src/types'

const DT = 0.0015
const PRIMARY_ID = 'penetration-primary'
const IMPACTOR_ID = 'penetration-impactor'
const INITIAL_IMPACTOR_RADIUS = 0.0187

type Stepper = (input: BodyState[], dt: number) => BodyState[]

type RunMetrics = {
  peakNormalizedPenetration: number
  peakIntactNormalizedPenetration: number
  finalBodies: BodyState[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeFixture(speedScale: number): BodyState[] {
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
    radius: INITIAL_IMPACTOR_RADIUS,
    position: { x: primary.radius + INITIAL_IMPACTOR_RADIUS - 1e-6, y: 0, z: 0 },
    velocity: {
      x: -0.21708 * speedScale,
      y: 2.4022115380623745 * speedScale,
      z: 0,
    },
    bodyType: 'moon',
  }
  return [primary, impactor]
}

function getNormalizedPenetration(bodies: BodyState[]) {
  const primary = bodies.find((body) => body.id === PRIMARY_ID)
  const impactor = bodies.find((body) => body.id === IMPACTOR_ID)
  if (!primary || !impactor) return null

  const centerDistance = Math.hypot(
    impactor.position.x - primary.position.x,
    impactor.position.y - primary.position.y,
    impactor.position.z - primary.position.z,
  )
  const penetrationDepth = Math.max(0, primary.radius + impactor.radius - centerDistance)
  return {
    normalized: penetrationDepth / Math.max(Math.min(primary.radius, impactor.radius), 1e-9),
    impactorRadius: impactor.radius,
  }
}

function run(stepper: Stepper, speedScale: number): RunMetrics {
  let bodies = makeFixture(speedScale)
  let peakNormalizedPenetration = 0
  let peakIntactNormalizedPenetration = 0

  for (let step = 0; step <= 24; step += 1) {
    const metric = getNormalizedPenetration(bodies)
    if (metric) {
      peakNormalizedPenetration = Math.max(peakNormalizedPenetration, metric.normalized)
      if (metric.impactorRadius >= INITIAL_IMPACTOR_RADIUS * 0.7) {
        peakIntactNormalizedPenetration = Math.max(
          peakIntactNormalizedPenetration,
          metric.normalized,
        )
      }
    }
    if (step < 24) bodies = stepper(bodies, DT)
  }

  return {
    peakNormalizedPenetration,
    peakIntactNormalizedPenetration,
    finalBodies: bodies,
  }
}

function assertConservation(beforeBodies: BodyState[], afterBodies: BodyState[], label: string) {
  const before = getConservationSnapshot(beforeBodies)
  const after = getConservationSnapshot(afterBodies)
  assert(
    Math.abs(after.totalMass - before.totalMass) <= 1e-10,
    `${label} represented mass changed: ${before.totalMass} -> ${after.totalMass}`,
  )
  for (const axis of ['x', 'y', 'z'] as const) {
    assert(
      Math.abs(after.linearMomentum[axis] - before.linearMomentum[axis]) <= 1e-8,
      `${label} ${axis}-momentum changed: ${before.linearMomentum[axis]} -> ${after.linearMomentum[axis]}`,
    )
  }
}

const speedScales = [0.72, 1, 1.65]
const report: Record<string, object> = {}

for (const speedScale of speedScales) {
  const phaseOne = run(stepPhaseOneBodies, speedScale)
  const after = run(stepBodies, speedScale)
  const label = `speed-${speedScale.toFixed(2)}`

  assert(
    after.peakNormalizedPenetration <= MAX_NON_STELLAR_NORMALIZED_PENETRATION + 2e-6,
    `${label} peak normalized penetration exceeded the geometric cap: ${after.peakNormalizedPenetration}`,
  )
  assert(
    after.peakIntactNormalizedPenetration <= MAX_NON_STELLAR_NORMALIZED_PENETRATION + 2e-6,
    `${label} intact-body penetration exceeded the geometric cap: ${after.peakIntactNormalizedPenetration}`,
  )
  assertConservation(makeFixture(speedScale), after.finalBodies, `${label} guarded collision`)

  if (speedScale <= 1) {
    assert(
      phaseOne.peakIntactNormalizedPenetration >= 0.45,
      `${label} fixture no longer reproduces the phase-1 intact penetration baseline`,
    )
    assert(
      after.peakIntactNormalizedPenetration <= phaseOne.peakIntactNormalizedPenetration * 0.45,
      `${label} intact penetration did not materially improve: ${phaseOne.peakIntactNormalizedPenetration} -> ${after.peakIntactNormalizedPenetration}`,
    )
    assert(
      after.peakNormalizedPenetration <= phaseOne.peakNormalizedPenetration * 0.25,
      `${label} total staged penetration did not materially improve: ${phaseOne.peakNormalizedPenetration} -> ${after.peakNormalizedPenetration}`,
    )
  }

  report[label] = {
    phaseOnePeakNormalizedPenetration: phaseOne.peakNormalizedPenetration,
    phaseOnePeakIntactNormalizedPenetration: phaseOne.peakIntactNormalizedPenetration,
    afterPeakNormalizedPenetration: after.peakNormalizedPenetration,
    afterPeakIntactNormalizedPenetration: after.peakIntactNormalizedPenetration,
  }
}

console.log(JSON.stringify(report, null, 2))
console.log('collision penetration regression checks passed')
