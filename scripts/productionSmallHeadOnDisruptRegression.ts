import { bodyCarriesCollisionLineage } from '../src/collisionIdentity'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import { getBodyPresentationRadius } from '../src/rendering/bodyPresentationRadius'
import { getCelestialBodyRenderBodies } from '../src/rendering/collisionEffectRouting'
import { getCollisionEffectProfile } from '../src/rendering/collisionEffectProfile'
import {
  resetCollisionSolidHandoffState,
  sampleCollisionSolidHandoffRenderFrame,
} from '../src/rendering/collisionSolidHandoff'
import { findCollisionVisualTransitions } from '../src/rendering/collisionVisualOutcome'
import type { BodyState, Vec3 } from '../src/types'

const A_ID = 'production-small-head-on-a'
const B_ID = 'production-small-head-on-b'
const DT = 0.0015

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

function momentum(bodies: BodyState[]) {
  return bodies.reduce((sum, body) => ({
    x: sum.x + body.velocity.x * body.mass,
    y: sum.y + body.velocity.y * body.mass,
    z: sum.z + body.velocity.z * body.mass,
  }), { x: 0, y: 0, z: 0 })
}

function makeFixture(): BodyState[] {
  const massA = 0.00199
  const massB = 0.001
  const relativeSpeed = 0.4717
  const totalMass = massA + massB
  return [
    {
      id: A_ID,
      name: 'production moon A',
      color: '#9a765d',
      mass: massA,
      radius: 0.0187,
      position: { x: -0.028, y: 0, z: 0 },
      velocity: { x: relativeSpeed * massB / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
    {
      id: B_ID,
      name: 'production moon B',
      color: '#6f91a5',
      mass: massB,
      radius: 0.0175,
      position: { x: 0.028, y: 0, z: 0 },
      velocity: { x: -relativeSpeed * massA / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
  ]
}

resetCollisionSolidHandoffState()
const initial = makeFixture()
const initialMass = initial.reduce((sum, body) => sum + body.mass, 0)
const initialMomentum = momentum(initial)
const initialCenterVelocity = {
  x: initialMomentum.x / initialMass,
  y: initialMomentum.y / initialMass,
  z: initialMomentum.z / initialMass,
}
const physicalContact = initial[0].radius + initial[1].radius
const presentationContact = getBodyPresentationRadius(initial[0].radius) +
  getBodyPresentationRadius(initial[1].radius)
let bodies = initial
let previousPresentedSeparation: number | null = null
let lastSources: BodyState[] | null = null
let resolved: BodyState[] | null = null

for (let step = 0; step < 80; step += 1) {
  const presented = getCelestialBodyRenderBodies(bodies)
  const a = presented.find((body) => body.id === A_ID)
  const b = presented.find((body) => body.id === B_ID)
  if (a && b) {
    const currentSeparation = separation(a, b)
    if (currentSeparation <= presentationContact + 1e-9) {
      if (previousPresentedSeparation !== null) {
        assert(currentSeparation <= previousPresentedSeparation + 1e-9,
          'presentation separation must not rewind after rendered contact')
      }
      assert(currentSeparation >= presentationContact - 0.025 * 0.14 - 1e-9,
        'presentation solids must remain inside the bounded overlap envelope')
      previousPresentedSeparation = currentSeparation
    }
    lastSources = presented.filter((body) => body.id === A_ID || body.id === B_ID)
  }

  const next = stepBodies(bodies, DT)
  const remnant = next.find((body) =>
    body.bodyType !== 'effect' && body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, A_ID) && bodyCarriesCollisionLineage(body, B_ID))
  if (remnant) {
    resolved = next
    bodies = next
    break
  }
  bodies = next
}

assert(resolved && lastSources?.length === 2, 'production fixture must resolve from two presented sources')
const remnant = resolved.find((body) =>
  body.bodyType !== 'effect' && body.bodyType !== 'fragment' &&
  bodyCarriesCollisionLineage(body, A_ID) && bodyCarriesCollisionLineage(body, B_ID))
assert(remnant, 'production collision must create one lineage-carrying remnant')
const physicalSolids = resolved.filter((body) => body.bodyType !== 'effect' && body.bodyType !== 'fragment')
assert(physicalSolids.length === 1, 'solver state must change immediately from two solids to one')
assert(!resolved.some((body) => body.id === A_ID || body.id === B_ID),
  'solver state must not retain presentation source ghosts')
assert(physicalContact === 0.0362, 'fixture must retain the production physical contact distance')

const transitions = findCollisionVisualTransitions(lastSources, resolved)
assert(transitions.length >= 2 && transitions.every((transition) => transition.outcome === 'disrupted'),
  'production fixture must classify the 2→1 visual outcome as disrupted')

const renderedAfter = getCelestialBodyRenderBodies(resolved)
assert(renderedAfter.some((body) => body.id === remnant.id) &&
  renderedAfter.some((body) => body.id === B_ID) && renderedAfter.length >= 2,
  'first post-solver renderer state must preserve a survivor and collapsing source silhouette')
const handoff = sampleCollisionSolidHandoffRenderFrame()
const metric = handoff.telemetry[remnant.id]
assert(metric && metric.absorbed.length === 1,
  'disrupted 2→1 topology must start the ordinary two-solid handoff')

const sparks = resolved.filter((body) => body.bodyType === 'effect' && body.name === 'Collision spark')
assert(sparks.length > 0, 'production path must expose the real tiny ejecta as collision sparks')
assert(sparks.every((spark) => spark.effectVisual?.sourceMaxRadius === 0.0187),
  'production spark must carry source scale for renderer-only ownership routing')
assert(sparks.every((spark) => getCollisionEffectProfile(spark).fadeAlpha === 0),
  'small high-head-on tangent sparks must hand presentation ownership to the compact contact burst')

const physicalEjectaDirections = sparks.map((spark) => {
  const relative = {
    x: spark.velocity.x - initialCenterVelocity.x,
    y: spark.velocity.y - initialCenterVelocity.y,
    z: spark.velocity.z - initialCenterVelocity.z,
  }
  const speed = length(relative)
  return {
    xShare: speed > 1e-12 ? Math.abs(relative.x) / speed : 0,
    sign: Math.sign(relative.x),
    relative,
  }
})
assert(
  physicalEjectaDirections.every(({ xShare }) => xShare >= 0.8),
  'head-on ejecta physical velocity must be dominated by the collision-normal direction',
)
assert(
  physicalEjectaDirections.some(({ sign }) => sign > 0) &&
  physicalEjectaDirections.some(({ sign }) => sign < 0),
  'head-on ejecta must physically leave both sides of the contact region',
)
assert(
  sparks.every((spark) => physicalSolids.every((solid) =>
    separation(spark, solid) + 1e-9 >= spark.radius + solid.radius
  )),
  'head-on ejecta physical spawn positions must start clear of surviving solid bodies',
)
assert(
  sparks.every((spark, index) => {
    const direction = spark.effectVisual?.direction
    if (!direction) return false
    const relative = physicalEjectaDirections[index].relative
    const speed = Math.max(length(relative), 1e-12)
    const directionLength = Math.max(length(direction), 1e-12)
    const alignment = (
      direction.x * relative.x +
      direction.y * relative.y +
      direction.z * relative.z
    ) / (speed * directionLength)
    return alignment > 0.999
  }),
  'spark presentation direction must match the actual physical ejecta velocity',
)

const finalMass = resolved.reduce((sum, body) => sum + body.mass, 0)
const finalMomentum = momentum(resolved)
assert(Math.abs(finalMass - initialMass) <= initialMass * 1e-9, 'mass must remain conserved')
assert(length({
  x: finalMomentum.x - initialMomentum.x,
  y: finalMomentum.y - initialMomentum.y,
  z: finalMomentum.z - initialMomentum.z,
}) <= 1e-9, 'momentum must remain conserved')

console.log('production small head-on disrupt regression checks passed')
console.log(JSON.stringify({
  remnantId: remnant.id,
  physicalContact,
  presentationContact,
  transitionOutcomes: transitions.map((transition) => transition.outcome),
  sparkCount: sparks.length,
  ejectaNormalShares: physicalEjectaDirections.map(({ xShare }) => xShare),
}))
