import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import type { BodyState, Vec3 } from '../src/types'

const MIN_RENDER_RADIUS = 0.025
const IMPACT_MAX_OVERLAP_RATIO = 0.14
const IMPACT_DURATION = 0.024
const CONTACT_RESOLUTION_OVERLAP = 1e-6
const CONTACT_RESOLUTION_DT = 1e-8
const STAGING_DT = 0.0015

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function vectorLength(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(value: Vec3, factor: number): Vec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor }
}

function normalize(value: Vec3): Vec3 {
  const length = Math.max(vectorLength(value), 1e-12)
  return scale(value, 1 / length)
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function displayedRadius(body: BodyState) {
  return Math.max(body.radius, MIN_RENDER_RADIUS)
}

function centerOfMass(a: BodyState, b: BodyState): Vec3 {
  const totalMass = a.mass + b.mass
  return {
    x: (a.position.x * a.mass + b.position.x * b.mass) / totalMass,
    y: (a.position.y * a.mass + b.position.y * b.mass) / totalMass,
    z: (a.position.z * a.mass + b.position.z * b.mass) / totalMass,
  }
}

function centerVelocity(a: BodyState, b: BodyState): Vec3 {
  const totalMass = a.mass + b.mass
  return {
    x: (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass,
    y: (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass,
    z: (a.velocity.z * a.mass + b.velocity.z * b.mass) / totalMass,
  }
}

function makeContactPair({
  idPrefix,
  radiusA,
  radiusB,
  massA,
  massB,
  typeA = 'planet',
  typeB = 'planet',
  center = { x: 0, y: 0, z: 0 },
  normal = { x: 1, y: 0, z: 0 },
  pairVelocity = { x: 0, y: 0, z: 0 },
  closingSpeed = 0.2,
}: {
  idPrefix: string
  radiusA: number
  radiusB: number
  massA: number
  massB: number
  typeA?: 'planet' | 'moon'
  typeB?: 'planet' | 'moon'
  center?: Vec3
  normal?: Vec3
  pairVelocity?: Vec3
  closingSpeed?: number
}): [BodyState, BodyState] {
  const unitNormal = normalize(normal)
  const totalMass = massA + massB
  const physicalContact = radiusA + radiusB
  const separation = physicalContact - CONTACT_RESOLUTION_OVERLAP
  const positionA = add(center, scale(unitNormal, -separation * (massB / totalMass)))
  const positionB = add(center, scale(unitNormal, separation * (massA / totalMass)))
  const velocityA = add(pairVelocity, scale(unitNormal, closingSpeed * (massB / totalMass)))
  const velocityB = add(pairVelocity, scale(unitNormal, -closingSpeed * (massA / totalMass)))

  return [
    {
      id: `${idPrefix}-a`,
      name: `${idPrefix}-a`,
      color: '#8ca0b4',
      mass: massA,
      radius: radiusA,
      position: positionA,
      velocity: velocityA,
      bodyType: typeA,
    },
    {
      id: `${idPrefix}-b`,
      name: `${idPrefix}-b`,
      color: '#b49b83',
      mass: massB,
      radius: radiusB,
      position: positionB,
      velocity: velocityB,
      bodyType: typeB,
    },
  ]
}

function getPair(frame: BodyState[], aId: string, bId: string) {
  const a = frame.find((body) => body.id === aId)
  const b = frame.find((body) => body.id === bId)
  assert(a && b, `staging frame must retain ${aId} and ${bId}`)
  return { a, b }
}

function stepStaging(pair: [BodyState, BodyState], steps: number) {
  let frame: BodyState[] = pair
  for (let index = 0; index < steps; index += 1) {
    frame = stepFragmentAwareBodies(frame, STAGING_DT)
  }
  return frame
}

function resolveStagingWithoutOvershoot(pair: [BodyState, BodyState]) {
  let frame: BodyState[] = pair
  for (let index = 0; index < 15; index += 1) {
    frame = stepFragmentAwareBodies(frame, STAGING_DT)
  }

  // Enter the existing 1e-12 handoff tolerance from just below the exact
  // duration so resolveTransition receives zero overshoot. This isolates the
  // physical contact frame from any post-resolution evolution.
  return stepFragmentAwareBodies(frame, STAGING_DT - 5e-13)
}

function visualPenetration(a: BodyState, b: BodyState) {
  const distance = vectorLength(subtract(b.position, a.position))
  return displayedRadius(a) + displayedRadius(b) - distance
}

function assertPresentationOverlapBound(a: BodyState, b: BodyState, label: string) {
  const penetration = visualPenetration(a, b)
  const allowed = Math.min(displayedRadius(a), displayedRadius(b)) * IMPACT_MAX_OVERLAP_RATIO
  assert(
    penetration >= -1e-9,
    `${label}: staged silhouettes must not open an artificial visible gap (${penetration})`,
  )
  assert(
    penetration <= allowed + 1e-9,
    `${label}: visual penetration ${penetration} exceeds presentation allowance ${allowed}`,
  )
}

function testSmallSmallUsesRenderedContactDistance() {
  const pair = makeContactPair({
    idPrefix: 'small-small',
    radiusA: 0.018,
    radiusB: 0.017,
    massA: 0.02,
    massB: 0.02,
  })
  const sourceRadii = pair.map((body) => body.radius)
  const frame = stepStaging(pair, 10)
  const { a, b } = getPair(frame, pair[0].id, pair[1].id)

  assertPresentationOverlapBound(a, b, 'small-small')
  assertClose(a.radius, sourceRadii[0], 1e-12, 'small-small body A physical radius must not change')
  assertClose(b.radius, sourceRadii[1], 1e-12, 'small-small body B physical radius must not change')

  const visualContact = displayedRadius(pair[0]) + displayedRadius(pair[1])
  const legacyLateDistance = pair[0].radius + pair[1].radius -
    Math.min(pair[0].radius, pair[1].radius) * IMPACT_MAX_OVERLAP_RATIO
  const legacyPenetration = visualContact - legacyLateDistance
  const stagedPenetration = visualPenetration(a, b)
  assert(
    stagedPenetration < legacyPenetration * 0.25,
    'small-small presentation correction must remove the deep legacy penetration',
  )

  return { legacyPenetration, stagedPenetration }
}

function testSmallNormalCorrectsAsymmetricallyWithoutMovingCom() {
  const pair = makeContactPair({
    idPrefix: 'small-normal',
    radiusA: 0.018,
    radiusB: 0.04,
    massA: 0.02,
    massB: 0.2,
  })
  const sourceCenter = centerOfMass(pair[0], pair[1])
  const velocity = centerVelocity(pair[0], pair[1])
  const frame = stepStaging(pair, 1)
  const { a, b } = getPair(frame, pair[0].id, pair[1].id)

  assertPresentationOverlapBound(a, b, 'small-normal')
  const expectedCenter = add(sourceCenter, scale(velocity, STAGING_DT))
  const stagedCenter = centerOfMass(a, b)
  assertClose(stagedCenter.x, expectedCenter.x, 1e-10, 'small-normal COM x must stay continuous')
  assertClose(stagedCenter.y, expectedCenter.y, 1e-10, 'small-normal COM y must stay continuous')
  assertClose(stagedCenter.z, expectedCenter.z, 1e-10, 'small-normal COM z must stay continuous')

  const physicalContact = pair[0].radius + pair[1].radius
  const totalMass = pair[0].mass + pair[1].mass
  const physicalA = expectedCenter.x - physicalContact * (pair[1].mass / totalMass)
  const physicalB = expectedCenter.x + physicalContact * (pair[0].mass / totalMass)
  const correctionA = Math.abs(a.position.x - physicalA)
  const correctionB = Math.abs(b.position.x - physicalB)
  assert(
    correctionA > correctionB * 5,
    'small-normal correction should move the low-mass small body much more than the normal primary',
  )
}

function testNormalNormalKeepsLegacyGeometryEnvelope() {
  const pair = makeContactPair({
    idPrefix: 'normal-normal',
    radiusA: 0.04,
    radiusB: 0.05,
    massA: 0.05,
    massB: 0.07,
  })
  const frame = stepStaging(pair, 10)
  const { a, b } = getPair(frame, pair[0].id, pair[1].id)
  const distance = vectorLength(subtract(b.position, a.position))
  const physicalContact = pair[0].radius + pair[1].radius
  const maxLegacyOverlap = Math.min(pair[0].radius, pair[1].radius) * IMPACT_MAX_OVERLAP_RATIO

  assertClose(displayedRadius(pair[0]), pair[0].radius, 1e-12, 'normal A display radius must equal physical radius')
  assertClose(displayedRadius(pair[1]), pair[1].radius, 1e-12, 'normal B display radius must equal physical radius')
  assert(
    distance <= physicalContact + 1e-9 && distance >= physicalContact - maxLegacyOverlap - 1e-9,
    `normal-normal staging must stay in the legacy physical-contact envelope: ${distance}`,
  )
}

function makePhysicalResolutionFrame(pair: [BodyState, BodyState]) {
  const a = pair[0]
  const b = pair[1]
  const normal = normalize(subtract(b.position, a.position))
  const totalMass = a.mass + b.mass
  const center = add(centerOfMass(a, b), scale(centerVelocity(a, b), IMPACT_DURATION))
  const contactDistance = a.radius + b.radius - CONTACT_RESOLUTION_OVERLAP

  return [
    {
      ...a,
      position: add(center, scale(normal, -contactDistance * (b.mass / totalMass))),
    },
    {
      ...b,
      position: add(center, scale(normal, contactDistance * (a.mass / totalMass))),
    },
  ]
}

function testSolverIsolationKeepsPhysicalOutcome() {
  const pair = makeContactPair({
    idPrefix: 'solver-isolation',
    radiusA: 0.018,
    radiusB: 0.017,
    massA: 0.02,
    massB: 0.02,
    closingSpeed: 0.35,
  })
  const baseline = stepCoreBodies(makePhysicalResolutionFrame(pair), CONTACT_RESOLUTION_DT)
  const stagedResolved = resolveStagingWithoutOvershoot(pair)
  const baselinePhysical = baseline.filter((body) => body.bodyType !== 'effect')
  const stagedPhysical = stagedResolved.filter((body) => body.bodyType !== 'effect')
  const baselineById = new Map(baselinePhysical.map((body) => [body.id, body]))
  const stagedById = new Map(stagedPhysical.map((body) => [body.id, body]))

  assert(
    baselineById.size === stagedById.size &&
      [...baselineById.keys()].every((id) => stagedById.has(id)),
    'display-radius staging must not change the physical collision outcome/body set',
  )

  for (const [id, expected] of baselineById) {
    const actual = stagedById.get(id)
    assert(actual, `solver isolation result missing ${id}`)
    assertClose(actual.mass, expected.mass, 1e-10, `${id} mass must match physical baseline`)
    assertClose(actual.radius, expected.radius, 1e-10, `${id} physical radius must match physical baseline`)
    assertClose(actual.velocity.x, expected.velocity.x, 1e-10, `${id} velocity x must match physical baseline`)
    assertClose(actual.velocity.y, expected.velocity.y, 1e-10, `${id} velocity y must match physical baseline`)
    assertClose(actual.velocity.z, expected.velocity.z, 1e-10, `${id} velocity z must match physical baseline`)
  }
}

function testMovingCollisionPreservesPairMotionAndDirection() {
  const normal = normalize({ x: 0.6, y: 0.8, z: 0.1 })
  const pairVelocity = { x: 0.17, y: -0.09, z: 0.04 }
  const pair = makeContactPair({
    idPrefix: 'moving-small',
    radiusA: 0.018,
    radiusB: 0.017,
    massA: 0.018,
    massB: 0.024,
    center: { x: 1.2, y: -0.4, z: 0.3 },
    normal,
    pairVelocity,
    closingSpeed: 0.28,
  })
  const sourceCenter = centerOfMass(pair[0], pair[1])
  const frame = stepStaging(pair, 1)
  const { a, b } = getPair(frame, pair[0].id, pair[1].id)
  const stagedCenter = centerOfMass(a, b)
  const expectedCenter = add(sourceCenter, scale(pairVelocity, STAGING_DT))
  const stagedNormal = normalize(subtract(b.position, a.position))

  assertPresentationOverlapBound(a, b, 'moving-small')
  assertClose(stagedCenter.x, expectedCenter.x, 1e-10, 'moving collision COM x must follow pair drift')
  assertClose(stagedCenter.y, expectedCenter.y, 1e-10, 'moving collision COM y must follow pair drift')
  assertClose(stagedCenter.z, expectedCenter.z, 1e-10, 'moving collision COM z must follow pair drift')
  assert(
    dot(stagedNormal, normal) > 0.999999999,
    'moving collision display correction must preserve the collision direction',
  )
}

const smallSmallMetrics = testSmallSmallUsesRenderedContactDistance()
testSmallNormalCorrectsAsymmetricallyWithoutMovingCom()
testNormalNormalKeepsLegacyGeometryEnvelope()
testSolverIsolationKeepsPhysicalOutcome()
testMovingCollisionPreservesPairMotionAndDirection()

console.log('collision presentation radius regression checks passed (5)')
console.log(JSON.stringify({
  smallSmallLegacyVisualPenetration: smallSmallMetrics.legacyPenetration,
  smallSmallCorrectedVisualPenetration: smallSmallMetrics.stagedPenetration,
}))
