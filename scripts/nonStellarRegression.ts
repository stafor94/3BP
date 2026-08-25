import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function makeBody(
  id: string,
  bodyType: 'star' | 'planet' | 'moon',
  mass: number,
  radius: number,
  x: number,
  velocityX: number,
  color: string,
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { x: velocityX, y: 0, z: 0 },
    bodyType,
  }
}

function totalMass(bodies: BodyState[]) {
  // Ejecta effects can carry real escaped collision mass even though they are
  // intentionally non-gravitating. Immediate result accounting must include it.
  return bodies.reduce((sum, body) => sum + body.mass, 0)
}

function testPlanetCollisionRemainsSolidAndMassConserving() {
  const a = makeBody('planet-a', 'planet', 0.2, 0.12, -0.119999, 0.2, '#4f7896')
  const b = makeBody('planet-b', 'planet', 0.2, 0.12, 0.119999, -0.2, '#a46d4d')
  const initialMass = a.mass + b.mass
  const resolved = stepCoreBodies([a, b], 1e-8)

  assert(
    !resolved.some((body) => body.name === 'Stellar plasma'),
    'planet-planet collisions must never create stellar-plasma ejecta',
  )
  assert(
    resolved.some((body) => body.bodyType === 'fragment' || body.name === 'Collision spark'),
    'planet-planet collisions should expose solid debris or impact sparks',
  )
  assert(
    resolved.every((body) => body.bodyType === 'effect' || body.bodyType === 'planet' || body.bodyType === 'fragment'),
    'planet-planet collisions must not promote a result to a star or moon',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'planet collision immediate result mass must be conserved',
  )
  assert(resolved.length <= 28, 'planet collision result must stay under the dynamic-body cap')
}

function testMoonDisruptionDoesNotBecomeStellar() {
  const a = makeBody('moon-a', 'moon', 0.02, 0.05, -0.049999, 1.5, '#9a958d')
  const b = makeBody('moon-b', 'moon', 0.02, 0.05, 0.049999, -1.5, '#77736f')
  const initialMass = a.mass + b.mass
  const resolved = stepCoreBodies([a, b], 1e-8)

  assert(
    !resolved.some((body) => body.name === 'Stellar plasma'),
    'moon disruption must use solid debris instead of stellar plasma',
  )
  assert(
    resolved.some((body) => body.bodyType === 'fragment'),
    'high-speed moon collision should produce persistent or temporary solid fragments',
  )
  assert(
    !resolved.some((body) => body.bodyType === 'star'),
    'moon collision remnants must never be classified as stars',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'moon collision immediate result mass must be conserved',
  )
  assert(resolved.length <= 28, 'moon collision result must stay under the dynamic-body cap')
}

function testStellarImpactStillUsesPlasmaLanguage() {
  const star = makeBody('star-a', 'star', 1, 0.2, -0.139999, 0.35, '#ffd36b')
  const planet = makeBody('planet-c', 'planet', 0.1, 0.08, 0.139999, -0.35, '#557d91')
  const initialMass = star.mass + planet.mass
  const resolved = stepCoreBodies([star, planet], 1e-8)
  const plasmaMass = resolved
    .filter((body) => body.name === 'Stellar plasma')
    .reduce((sum, body) => sum + body.mass, 0)

  assert(
    resolved.some((body) => body.name === 'Stellar plasma'),
    'star-involved collision should keep the dedicated stellar-plasma ejecta path',
  )
  assert(plasmaMass > 0, 'stellar plasma ejecta should carry the collision mass removed from the remnant')
  assert(
    !resolved.some((body) => body.bodyType === 'fragment'),
    'star-involved collision must not expose asteroid-like solid fragments',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'stellar impact immediate result mass must remain conserved across plasma ejecta',
  )
  assert(resolved.length <= 28, 'stellar collision result must stay under the dynamic-body cap')
}

const tests = [
  testPlanetCollisionRemainsSolidAndMassConserving,
  testMoonDisruptionDoesNotBecomeStellar,
  testStellarImpactStillUsesPlasmaLanguage,
]

for (const test of tests) test()
console.log(`non-stellar regression checks passed (${tests.length})`)
