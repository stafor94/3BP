import { bodyCarriesCollisionLineage } from '../src/collisionIdentity'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import type { BodyState, Vec3 } from '../src/types'

const A_ID = 'determinism-head-on-a'
const B_ID = 'determinism-head-on-b'
const DT = 0.0015
const SOURCE_MAX_RADIUS = 0.0187
const MIN_EJECTA_SURFACE_GAP = SOURCE_MAX_RADIUS * 0.15

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function length(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function separation(a: BodyState, b: BodyState) {
  return length({
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  })
}

function makeFixture(): BodyState[] {
  const massA = 0.00199
  const massB = 0.001
  const relativeSpeed = 0.4717
  const totalMass = massA + massB
  return [
    {
      id: A_ID,
      name: A_ID,
      color: '#9a765d',
      mass: massA,
      radius: SOURCE_MAX_RADIUS,
      position: { x: -0.028, y: 0, z: 0 },
      velocity: { x: relativeSpeed * massB / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
    {
      id: B_ID,
      name: B_ID,
      color: '#6f91a5',
      mass: massB,
      radius: 0.0175,
      position: { x: 0.028, y: 0, z: 0 },
      velocity: { x: -relativeSpeed * massA / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
  ]
}

function isResolved(frame: BodyState[]) {
  return frame.some((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, A_ID) &&
    bodyCarriesCollisionLineage(body, B_ID),
  )
}

function resolveFixture() {
  let frame = makeFixture()
  for (let step = 0; step < 80; step += 1) {
    frame = stepBodies(frame, DT)
    if (isResolved(frame)) return frame
  }
  throw new Error('determinism fixture did not resolve within 80 steps')
}

function representedMomentum(bodies: BodyState[]) {
  return bodies.reduce((sum, body) => ({
    x: sum.x + body.velocity.x * body.mass,
    y: sum.y + body.velocity.y * body.mass,
    z: sum.z + body.velocity.z * body.mass,
  }), { x: 0, y: 0, z: 0 })
}

function collisionIdPattern(id: string) {
  // Collision serials exist only to keep simultaneous runtime entities unique.
  // Replay determinism concerns the stable lineage/type/index pattern plus exact
  // physical state, not the process-global serial number itself.
  return id.replace(/(flash|shock|afterglow|plasma|fx|frag)\d+(?=-|$)/g, '$1#')
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

const initial = makeFixture()
const initialMass = initial.reduce((sum, body) => sum + body.mass, 0)
const initialMomentum = representedMomentum(initial)
const first = resolveFixture()
const second = resolveFixture()
const firstSnapshot = snapshot(first)
const secondSnapshot = snapshot(second)

assert(
  JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot),
  'identical initial states must resolve to identical fragment count, id patterns, masses, positions, and velocities',
)

const solids = first.filter((body) => body.bodyType !== 'effect' && body.bodyType !== 'fragment')
const ejecta = first.filter((body) =>
  body.mass > 0 &&
  (body.bodyType === 'fragment' || body.name === 'Collision spark'),
)
assert(solids.length > 0, 'resolved fixture must contain a surviving/remnant solid')
assert(ejecta.length >= 2, 'resolved fixture must contain physical mass-bearing ejecta')

for (const fragment of ejecta) {
  for (const solid of solids) {
    const surfaceGap = separation(fragment, solid) - fragment.radius - solid.radius
    assert(
      surfaceGap + 1e-12 >= MIN_EJECTA_SURFACE_GAP,
      `fresh ejecta ${fragment.id} must start with physical clearance beyond non-overlap: ` +
        `gap=${surfaceGap}, required=${MIN_EJECTA_SURFACE_GAP}`,
    )
  }
}

const firstMass = first.reduce((sum, body) => sum + body.mass, 0)
const firstMomentum = representedMomentum(first)
assert(Math.abs(firstMass - initialMass) <= initialMass * 1e-9,
  'clearance shaping must preserve represented mass')
assert(length({
  x: firstMomentum.x - initialMomentum.x,
  y: firstMomentum.y - initialMomentum.y,
  z: firstMomentum.z - initialMomentum.z,
}) <= 1e-9, 'clearance shaping must preserve represented linear momentum')

console.log('collision ejecta clearance/determinism regression passed')
console.log(JSON.stringify({
  massBearingBodyCount: firstSnapshot.length,
  ejectaCount: ejecta.length,
  minimumRequiredSurfaceGap: MIN_EJECTA_SURFACE_GAP,
}))
