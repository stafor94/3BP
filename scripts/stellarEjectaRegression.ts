import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import type { BodyState, Vec3 } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: Vec3, scalar: number): Vec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function magnitude(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = magnitude(value)
  if (length > 1e-10) return scale(value, 1 / length)
  const fallbackLength = magnitude(fallback)
  return fallbackLength > 1e-10 ? scale(fallback, 1 / fallbackLength) : { x: 1, y: 0, z: 0 }
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  x: number,
  color: string,
  velocity: Vec3,
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

function getPlasma(result: BodyState[]) {
  return result.filter((body) => body.effectVisual?.kind === 'stellarPlasma')
}

function getCollisionBasis(a: BodyState, b: BodyState) {
  const normal = normalize(sub(b.position, a.position), { x: 1, y: 0, z: 0 })
  const relativeVelocity = sub(b.velocity, a.velocity)
  const tangentVelocity = sub(relativeVelocity, scale(normal, dot(relativeVelocity, normal)))
  const tangent = normalize(tangentVelocity, { x: 0, y: 1, z: 0 })
  return { normal, tangent }
}

function totalMomentum(bodies: BodyState[]) {
  return bodies.reduce(
    (sum, body) => add(sum, scale(body.velocity, body.mass)),
    { x: 0, y: 0, z: 0 },
  )
}

function assertVecClose(actual: Vec3, expected: Vec3, tolerance: number, message: string) {
  const error = magnitude(sub(actual, expected))
  if (error > tolerance) throw new Error(`${message}: error ${error}`)
}

function compactPlasma(plasma: BodyState[]) {
  return plasma.map((body) => ({
    color: body.color,
    mass: body.mass,
    radius: body.radius,
    position: body.position,
    velocity: body.velocity,
    direction: body.effectVisual?.direction,
    stretch: body.effectVisual?.stretch,
    widthScale: body.effectVisual?.widthScale,
    tailLength: body.effectVisual?.tailLength,
    turbulence: body.effectVisual?.turbulence,
    phaseOffset: body.effectVisual?.phaseOffset,
  }))
}

function testHeadOnEjectaFavorsSplashPlaneAndContactPatch() {
  const a = makeStar(
    'ejecta-head-a',
    1,
    0.3,
    -0.2999995,
    '#ff805f',
    { x: 0.3, y: 0, z: 0 },
  )
  const b = makeStar(
    'ejecta-head-b',
    1,
    0.3,
    0.2999995,
    '#8ab7ff',
    { x: -0.3, y: 0, z: 0 },
  )
  const { normal } = getCollisionBasis(a, b)
  const result = stepCoreBodies([a, b], 1e-8)
  const plasma = getPlasma(result)

  assert(plasma.length >= 6, 'head-on stellar collision should emit enough plasma samples for directional regression')
  const normalProjections = plasma.map((body) => Math.abs(dot(body.effectVisual!.direction, normal)))
  const sidewaysCount = normalProjections.filter((projection) => projection < 0.48).length
  const averageNormalProjection = normalProjections.reduce((sum, value) => sum + value, 0) / normalProjections.length
  assert(
    sidewaysCount / plasma.length >= 0.75,
    `head-on ejecta should mostly stay in the splash plane, got ${sidewaysCount}/${plasma.length}`,
  )
  assert(
    averageNormalProjection < 0.38,
    `head-on ejecta normal projection is too radial: ${averageNormalProjection}`,
  )

  const roundedPositions = new Set(plasma.map((body) => (
    `${body.position.x.toFixed(5)}:${body.position.y.toFixed(5)}:${body.position.z.toFixed(5)}`
  )))
  assert(
    roundedPositions.size >= Math.min(5, plasma.length),
    'stellar ejecta spawn points must have meaningful contact-patch spatial variance',
  )

  plasma.forEach((body) => {
    const source = body.color === a.color ? a : body.color === b.color ? b : null
    assert(source, `plasma color must identify one of the stellar source bodies: ${body.color}`)
    const contactNormal = source === a ? normal : scale(normal, -1)
    const fromSource = normalize(sub(body.position, source.position), contactNormal)
    assert(
      dot(fromSource, contactNormal) > 0.9,
      'stellar ejecta must spawn on the source body hemisphere facing the collision',
    )
  })

  assertVecClose(
    totalMomentum(result),
    totalMomentum([a, b]),
    2e-7,
    'contact-patch and directional changes must preserve collision momentum',
  )
}

function testGrazingEjectaFormsDominantStrippingPlume() {
  const a = makeStar(
    'ejecta-graze-a',
    1,
    0.3,
    -0.2999995,
    '#ff8b68',
    { x: 0.15, y: -1.65, z: 0 },
  )
  const b = makeStar(
    'ejecta-graze-b',
    1,
    0.3,
    0.2999995,
    '#b8d8ff',
    { x: -0.15, y: 1.65, z: 0 },
  )
  const { tangent } = getCollisionBasis(a, b)
  const result = stepCoreBodies([a, b], 1e-8)
  const plasma = getPlasma(result)
  assert(plasma.length >= 6, 'grazing stellar collision should emit enough plasma samples for plume regression')

  const projections = plasma.map((body) => dot(body.effectVisual!.direction, tangent))
  const positive = projections.filter((projection) => projection > 0.15).length
  const negative = projections.filter((projection) => projection < -0.15).length
  const dominant = Math.max(positive, negative)
  const counter = Math.min(positive, negative)
  assert(
    dominant / plasma.length >= 0.7,
    `grazing ejecta must strongly favor one tangent direction, got ${dominant}/${plasma.length}`,
  )
  assert(counter >= 1, 'grazing ejecta should retain a sparse counter-stream instead of becoming perfectly one-sided')
  assert(
    counter < dominant,
    `grazing counter-stream must remain subordinate to the primary plume: ${counter} vs ${dominant}`,
  )

  const sourceCounts = plasma.reduce((counts, body) => {
    if (body.color === a.color) counts.a += 1
    if (body.color === b.color) counts.b += 1
    return counts
  }, { a: 0, b: 0 })
  assert(sourceCounts.a + sourceCounts.b === plasma.length, 'every stellar plasma sample must retain a source-body color')
}

function testEjectaIsDeterministicForSameInitialState() {
  const a = makeStar(
    'ejecta-repeat-a',
    0.6,
    0.24,
    -0.2799995,
    '#ffaf5f',
    { x: 1.05, y: -1.2, z: 0 },
  )
  const b = makeStar(
    'ejecta-repeat-b',
    1.3,
    0.32,
    0.2799995,
    '#fff4e8',
    { x: -1.05, y: 1.2, z: 0 },
  )

  const first = compactPlasma(getPlasma(stepCoreBodies([a, b], 1e-8)))
  const second = compactPlasma(getPlasma(stepCoreBodies([a, b], 1e-8)))
  assert(first.length > 0, 'deterministic fixture must produce stellar plasma')
  assert(
    JSON.stringify(first) === JSON.stringify(second),
    'same stellar collision initial state must reproduce ejecta source, patch, direction, and kick values',
  )
}

testHeadOnEjectaFavorsSplashPlaneAndContactPatch()
testGrazingEjectaFormsDominantStrippingPlume()
testEjectaIsDeterministicForSameInitialState()

console.log('stellar ejecta regression checks passed')
