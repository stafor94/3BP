import { getEffectiveBodyType } from '../bodyTypes'
import { getPostImpactMotionPresentationOffset } from '../physics/fragmentAwareEngineStageTwo'
import type { BodyState, Vec3 } from '../types'
import { getBodyPresentationRadius } from './bodyPresentationRadius'

const MAX_PRESENTATION_OVERLAP_RATIO = 0.14
const PRESENTATION_RADIUS_EPSILON = 1e-9
const PRE_TRANSITION_ABSORPTION_PROGRESS_SCALE = 0.72
const PRE_TRANSITION_ABSORPTION_PROGRESS_MAX = 0.42

type CollisionPreTransitionAbsorptionPresentation = {
  contactNormal: Vec3
  absorptionProgress: number
}

type CollisionPresentationContactBody = BodyState & {
  collisionAbsorptionPresentation?: CollisionPreTransitionAbsorptionPresentation
}

type ContactBridge = {
  aId: string
  bId: string
  separation: number
  radiusA: number
  radiusB: number
  normalAToB: Vec3
  released: boolean
}

const activeContacts = new Map<string, ContactBridge>()

function key(a: BodyState, b: BodyState) {
  return a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length > 1e-12) return { x: value.x / length, y: value.y / length, z: value.z / length }
  const fallbackLength = Math.hypot(fallback.x, fallback.y, fallback.z)
  if (fallbackLength > 1e-12) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
      z: fallback.z / fallbackLength,
    }
  }
  return { x: 1, y: 0, z: 0 }
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

function withPostImpactMotionOffset(body: BodyState): BodyState {
  const offset = getPostImpactMotionPresentationOffset(body)
  if (!offset) return body
  return {
    ...body,
    position: {
      x: body.position.x + offset.x,
      y: body.position.y + offset.y,
      z: body.position.z + offset.z,
    },
  }
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

function getShrinkProgress(radius: number, startRadius: number) {
  if (startRadius <= PRESENTATION_RADIUS_EPSILON) return 0
  return Math.min(1, Math.max(0, 1 - radius / startRadius))
}

function getPreTransitionAbsorptionPresentationProgress(absorptionProgress: number) {
  return Math.min(
    PRE_TRANSITION_ABSORPTION_PROGRESS_MAX,
    Math.max(0, absorptionProgress) * PRE_TRANSITION_ABSORPTION_PROGRESS_SCALE,
  )
}

function withAbsorptionPresentation(
  body: BodyState,
  contactNormal: Vec3,
  absorptionProgress: number,
): CollisionPresentationContactBody {
  return {
    ...body,
    collisionAbsorptionPresentation: {
      contactNormal: { ...contactNormal },
      absorptionProgress,
    },
  }
}

export function getCollisionPreTransitionAbsorptionPresentation(body: BodyState) {
  return (body as CollisionPresentationContactBody).collisionAbsorptionPresentation
}

/**
 * Keeps the rendered contact shell separate from collision physics. The returned
 * clones are consumed only by the renderer; callers retain the untouched body
 * array as the next solver input.
 */
export function getCollisionPresentationContactBodies(bodies: BodyState[]) {
  const motionBodies = bodies.map(withPostImpactMotionOffset)
  const byId = new Map(motionBodies.map((body) => [body.id, body]))
  for (const [pairKey, contact] of activeContacts) {
    if (!byId.has(contact.aId) || !byId.has(contact.bId)) activeContacts.delete(pairKey)
  }

  const solids = motionBodies.filter(isPresentationSolid)
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const a = solids[i]
      const b = solids[j]
      const pairKey = key(a, b)
      const presentationContact = getBodyPresentationRadius(a.radius) +
        getBodyPresentationRadius(b.radius)
      const physicalSeparation = distance(a.position, b.position)
      if (!activeContacts.has(pairKey) && physicalSeparation <= presentationContact && isApproaching(a, b)) {
        activeContacts.set(pairKey, {
          aId: a.id,
          bId: b.id,
          separation: physicalSeparation,
          radiusA: a.radius,
          radiusB: b.radius,
          normalAToB: normalize(
            {
              x: b.position.x - a.position.x,
              y: b.position.y - a.position.y,
              z: b.position.z - a.position.z,
            },
            {
              x: b.velocity.x - a.velocity.x,
              y: b.velocity.y - a.velocity.y,
              z: b.velocity.z - a.velocity.z,
            },
          ),
          released: false,
        })
      }
    }
  }

  const rendered = new Map<string, CollisionPresentationContactBody>(
    motionBodies.map((body) => [body.id, body]),
  )
  for (const contact of activeContacts.values()) {
    const a = byId.get(contact.aId)
    const b = byId.get(contact.bId)
    if (!a || !b) continue

    const shrinkA = getShrinkProgress(a.radius, contact.radiusA)
    const shrinkB = getShrinkProgress(b.radius, contact.radiusB)
    if (shrinkA > 0 || shrinkB > 0) contact.released = true

    // Extreme-mass-ratio absorption already shrinks the smaller source before
    // the physical 2->1 topology change. Keep that physical radius and the
    // phase-1 post-impact position untouched, but expose the existing shrink
    // progress plus the original contact normal to the renderer so contact-side
    // deformation can begin while the source is still visibly large. The
    // presentation curve is capped before topology so enough colored residual
    // remains for the existing collision flash/VFX readability contract.
    if (contact.released) {
      if (shrinkA > 0 || shrinkB > 0) {
        const absorbA = shrinkA > shrinkB + PRESENTATION_RADIUS_EPSILON ||
          (Math.abs(shrinkA - shrinkB) <= PRESENTATION_RADIUS_EPSILON && a.mass < b.mass)
        const source = absorbA ? a : b
        const absorptionProgress = getPreTransitionAbsorptionPresentationProgress(
          absorbA ? shrinkA : shrinkB,
        )
        const contactNormal = absorbA
          ? contact.normalAToB
          : {
            x: -contact.normalAToB.x,
            y: -contact.normalAToB.y,
            z: -contact.normalAToB.z,
          }
        rendered.set(
          source.id,
          withAbsorptionPresentation(source, contactNormal, absorptionProgress),
        )
      }
      continue
    }

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
  return motionBodies.map((body) => rendered.get(body.id) ?? body)
}

export function resetCollisionPresentationContactState() {
  activeContacts.clear()
}
