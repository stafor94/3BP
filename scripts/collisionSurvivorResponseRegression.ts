import { stepBodies } from '../src/physics/fragmentAwareEngine'
import { stepBodies as stepStageThreeBodies } from '../src/physics/fragmentAwareEngineStageThree'
import {
  findCollisionVisualTransitions,
  type CollisionVisualTransition,
} from '../src/rendering/collisionVisualOutcome'
import {
  getCollisionSurvivorResponseProfile,
  getSurvivorResponseEnvelope,
  SURVIVOR_RESPONSE_DURATION_MS,
} from '../src/rendering/collisionSurvivorResponse'
import type { BodyState, Vec3 } from '../src/types'

const DT = 0.0015
const PRIMARY_ID = 'survivor-response-primary'
const IMPACTOR_ID = 'survivor-response-impactor'

type Scenario = {
  name: 'representative' | 'head-on' | 'oblique'
  impactorVelocity: Vec3
}

type ResolvedCollision = {
  before: BodyState[]
  after: BodyState[]
  result: BodyState
  transition: CollisionVisualTransition
  partner: CollisionVisualTransition
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeFixture(scenario: Scenario): BodyState[] {
  const primaryRadius = 0.0688
  const impactorRadius = 0.0187
  return [
    {
      id: PRIMARY_ID,
      name: 'Janus',
      color: '#c87545',
      mass: 0.35,
      radius: primaryRadius,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      bodyType: 'planet',
    },
    {
      id: IMPACTOR_ID,
      name: 'Luna',
      color: '#65cce2',
      mass: 0.0019,
      radius: impactorRadius,
      position: { x: primaryRadius + impactorRadius - 1e-6, y: 0, z: 0 },
      velocity: { ...scenario.impactorVelocity },
      bodyType: 'moon',
    },
  ]
}

function selectResponseTransition(transitions: CollisionVisualTransition[]) {
  return transitions.find((transition) =>
    transition.outcome === 'merged-survivor' || transition.outcome === 'survivor',
  ) ?? transitions
    .filter((transition) => transition.outcome === 'disrupted')
    .slice()
    .sort((a, b) =>
      b.source.mass - a.source.mass ||
      b.source.radius - a.source.radius ||
      a.source.id.localeCompare(b.source.id),
    )[0]
}

function resolveScenario(scenario: Scenario): ResolvedCollision {
  let frame = makeFixture(scenario)
  for (let step = 0; step < 100; step += 1) {
    const before = frame
    const after = stepBodies(before, DT)
    const transitions = findCollisionVisualTransitions(before, after)
    const resultIds = Array.from(new Set(
      transitions
        .map((transition) => transition.resultId)
        .filter((id): id is string => Boolean(id)),
    ))

    for (const resultId of resultIds) {
      const resultTransitions = transitions.filter((transition) => transition.resultId === resultId)
      if (resultTransitions.length < 2) continue
      const transition = selectResponseTransition(resultTransitions)
      if (!transition) continue
      const partner = resultTransitions
        .filter((candidate) => candidate.source.id !== transition.source.id)
        .slice()
        .sort((a, b) =>
          a.source.mass - b.source.mass ||
          a.source.radius - b.source.radius ||
          a.source.id.localeCompare(b.source.id),
        )[0]
      const result = after.find((body) =>
        body.id === resultId &&
        body.bodyType !== 'effect' &&
        body.bodyType !== 'fragment' &&
        body.bodyType !== 'star'
      )
      if (partner && result) return { before, after, result, transition, partner }
    }
    frame = after
  }
  throw new Error(`${scenario.name} did not produce a survivor/remnant response transition`)
}

function metricSnapshot(resolved: ResolvedCollision) {
  const profile = getCollisionSurvivorResponseProfile(
    resolved.transition.source,
    resolved.partner.source,
    resolved.result,
    resolved.transition.contactNormal,
    resolved.transition.presentationHeadOn,
    0,
    true,
  )
  return {
    headOn: profile.headOn,
    grazing: profile.grazing,
    massRatio: profile.massRatio,
    radiusRatio: profile.radiusRatio,
    relativeSpeed: profile.relativeSpeed,
    speedRatio: profile.speedRatio,
    recoilDelta: profile.recoilDelta,
    recoilSpeed: profile.recoilSpeed,
    normalRecoilSpeed: profile.normalRecoilSpeed,
    tangentialRecoilSpeed: profile.tangentialRecoilSpeed,
    baseCompression: profile.baseCompression,
    baseShear: profile.baseShear,
  }
}

assert(
  stepBodies === stepStageThreeBodies,
  'Stage 4 must not replace or wrap the Stage 3 physics stepper',
)

const scenarios: Scenario[] = [
  {
    name: 'representative',
    impactorVelocity: { x: -0.21708, y: 2.4022115380623745, z: 0 },
  },
  {
    name: 'head-on',
    impactorVelocity: { x: -2.35, y: 0.12, z: 0 },
  },
  {
    name: 'oblique',
    impactorVelocity: { x: -1.35, y: 1.75, z: 0 },
  },
]

const report: Record<string, ReturnType<typeof metricSnapshot>> = {}

for (const scenario of scenarios) {
  const resolved = resolveScenario(scenario)
  const beforeResult = JSON.stringify(resolved.result)
  const profile = getCollisionSurvivorResponseProfile(
    resolved.transition.source,
    resolved.partner.source,
    resolved.result,
    resolved.transition.contactNormal,
    resolved.transition.presentationHeadOn,
    0,
    true,
  )
  assert(
    JSON.stringify(resolved.result) === beforeResult,
    `${scenario.name}: presentation profile must not mutate the physical result`,
  )
  assert(profile.eligible, `${scenario.name}: asymmetric survivor response should be eligible`)
  assert(profile.recoilSpeed > 0, `${scenario.name}: actual survivor recoil must be observed`)
  assert(
    profile.baseCompression > 0,
    `${scenario.name}: actual collision geometry/recoil must produce local compression`,
  )

  const mid = getCollisionSurvivorResponseProfile(
    resolved.transition.source,
    resolved.partner.source,
    resolved.result,
    resolved.transition.contactNormal,
    resolved.transition.presentationHeadOn,
    SURVIVOR_RESPONSE_DURATION_MS * 0.5,
    true,
  )
  const settled = getCollisionSurvivorResponseProfile(
    resolved.transition.source,
    resolved.partner.source,
    resolved.result,
    resolved.transition.contactNormal,
    resolved.transition.presentationHeadOn,
    SURVIVOR_RESPONSE_DURATION_MS,
    true,
  )
  assert(
    profile.compression > mid.compression && mid.compression > settled.compression,
    `${scenario.name}: compression must settle monotonically without wobble`,
  )
  assert(
    settled.compression === 0 && settled.shear === 0,
    `${scenario.name}: local surface response must fully settle`,
  )

  report[scenario.name] = metricSnapshot(resolved)

  const replay = metricSnapshot(resolveScenario(scenario))
  const first = report[scenario.name]
  for (const key of [
    'headOn',
    'grazing',
    'massRatio',
    'radiusRatio',
    'relativeSpeed',
    'speedRatio',
    'recoilSpeed',
    'normalRecoilSpeed',
    'tangentialRecoilSpeed',
    'baseCompression',
    'baseShear',
  ] as const) {
    assert(
      Math.abs(first[key] - replay[key]) <= 1e-12,
      `${scenario.name}: ${key} response metric must remain deterministic`,
    )
  }
}

const headOn = report['head-on']
const oblique = report['oblique']
const representative = report['representative']
assert(
  headOn.headOn > oblique.headOn && oblique.headOn > representative.headOn,
  'head-on/oblique/grazing geometry ordering must be preserved',
)
assert(
  headOn.baseShear < oblique.baseShear && oblique.baseShear < representative.baseShear,
  'grazing impacts must carry progressively stronger tangential surface response',
)
assert(
  headOn.baseCompression > representative.baseCompression,
  'near head-on impact should favor normal compression over grazing response',
)
assert(
  getSurvivorResponseEnvelope(0) === 1 &&
  getSurvivorResponseEnvelope(SURVIVOR_RESPONSE_DURATION_MS) === 0,
  'survivor response envelope endpoints must be stable',
)

console.log(JSON.stringify(report, null, 2))
console.log('collision survivor response regression passed')
