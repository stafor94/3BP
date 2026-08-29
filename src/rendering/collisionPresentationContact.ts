import { getEffectiveBodyType } from '../bodyTypes'
import type { BodyState, Vec3 } from '../types'
import { getBodyPresentationRadius } from './bodyPresentationRadius'

const MAX_PRESENTATION_OVERLAP_RATIO = 0.14

type ContactBridge = {
  aId: string
  bId: string
  separation: number
}

const activeContacts = new Map<string, ContactBridge>()

function key(a: BodyState, b: BodyState) {
  return a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

function isPresentationSolid(body: BodyState) {
  return body.bodyType !== 'effect' && body.bodyType !== 'fragment' &&
    getEffectiveBodyType(body) !== 'star'
}

function isApproaching(a: BodyState, b: BodyState) {
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    y: b.velocity.y - a.velocity.y,
    z: b.velocity.z - a.velocity.z,
  }
  return delta.x * relativeVelocity.x + delta.y * relativeVelocity.y +
    delta.z * relativeVelocity.z < 0
}

function presentedPair(a: BodyState, b: BodyState, separation: number): [BodyState, BodyState] {
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const physicalSeparation = Math.max(distance(a.position, b.position), 1e-12)
  const normal = {
    x: delta.x / physicalSeparation,
    y: delta.y / physicalSeparation,
    z: delta.z / physicalSeparation,
  }
  const totalMass = Math.max(a.mass + b.mass, 1e-12)
  const center = {
    x: (a.position.x * a.mass + b.position.x * b.mass) / totalMass,
    y: (a.position.y * a.mass + b.position.y * b.mass) / totalMass,
    z: (a.position.z * a.mass + b.position.z * b.mass) / totalMass,
  }
  return [
    {
      ...a,
      position: {
        x: center.x - normal.x * separation * b.mass / totalMass,
        y: center.y - normal.y * separation * b.mass / totalMass,
        z: center.z - normal.z * separation * b.mass / totalMass,
      },
    },
    {
      ...b,
      position: {
        x: center.x + normal.x * separation * a.mass / totalMass,
        y: center.y + normal.y * separation * a.mass / totalMass,
        z: center.z + normal.z * separation * a.mass / totalMass,
      },
    },
  ]
}

/**
 * Keeps the rendered contact shell separate from collision physics. The returned
 * clones are consumed only by the renderer; callers retain the untouched body
 * array as the next solver input.
 */
export function getCollisionPresentationContactBodies(bodies: BodyState[]) {
  const byId = new Map(bodies.map((body) => [body.id, body]))
  for (const [pairKey, contact] of activeContacts) {
    if (!byId.has(contact.aId) || !byId.has(contact.bId)) activeContacts.delete(pairKey)
  }

  const solids = bodies.filter(isPresentationSolid)
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const a = solids[i]
      const b = solids[j]
      const pairKey = key(a, b)
      const presentationContact = getBodyPresentationRadius(a.radius) +
        getBodyPresentationRadius(b.radius)
      const physicalSeparation = distance(a.position, b.position)
      if (!activeContacts.has(pairKey) && physicalSeparation <= presentationContact && isApproaching(a, b)) {
        activeContacts.set(pairKey, { aId: a.id, bId: b.id, separation: physicalSeparation })
      }
    }
  }

  const rendered = new Map(bodies.map((body) => [body.id, body]))
  for (const contact of activeContacts.values()) {
    const a = byId.get(contact.aId)
    const b = byId.get(contact.bId)
    if (!a || !b) continue
    const contactDistance = getBodyPresentationRadius(a.radius) + getBodyPresentationRadius(b.radius)
    const minimumSeparation = contactDistance - Math.min(
      getBodyPresentationRadius(a.radius),
      getBodyPresentationRadius(b.radius),
    ) * MAX_PRESENTATION_OVERLAP_RATIO
    const physicalSeparation = distance(a.position, b.position)
    contact.separation = Math.min(contact.separation, Math.max(physicalSeparation, minimumSeparation))
    const [presentedA, presentedB] = presentedPair(a, b, contact.separation)
    rendered.set(a.id, presentedA)
    rendered.set(b.id, presentedB)
  }
  return bodies.map((body) => rendered.get(body.id) ?? body)
}

export function resetCollisionPresentationContactState() {
  activeContacts.clear()
}
