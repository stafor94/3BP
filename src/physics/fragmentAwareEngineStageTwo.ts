import { getEffectiveBodyType } from '../bodyTypes'
import type { BodyState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { stepBodies as stepFragmentAwareBodies } from './fragmentAwareEngineCore'

// The core engine already resolves swept collisions at first physical contact.
// This guard owns only the short-lived non-stellar impact bridge returned before
// that exact physical outcome is revealed. Limiting overlap as a fraction of the
// smaller current body radius keeps an intact/partially collapsed collider near
// the contact surface instead of letting its center sink deep into its partner.
export const MAX_NON_STELLAR_NORMALIZED_PENETRATION = 0.18

const POSITION_EPSILON = 1e-12

function isCorrectableSolid(body: BodyState) {
  return body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    getEffectiveBodyType(body) !== 'star'
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length > POSITION_EPSILON) {
    return { x: value.x / length, y: value.y / length, z: value.z / length }
  }
  const fallbackLength = Math.hypot(fallback.x, fallback.y, fallback.z)
  if (fallbackLength > POSITION_EPSILON) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
      z: fallback.z / fallbackLength,
    }
  }
  return { x: 1, y: 0, z: 0 }
}

function limitPairPenetration(a: BodyState, b: BodyState) {
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const distance = Math.hypot(delta.x, delta.y, delta.z)
  const contactDistance = getCollisionContactDistance(a, b)
  const penetration = contactDistance - distance
  if (penetration <= 0) return

  const minimumRadius = Math.max(Math.min(a.radius, b.radius), POSITION_EPSILON)
  const maximumPenetration = minimumRadius * MAX_NON_STELLAR_NORMALIZED_PENETRATION
  if (penetration <= maximumPenetration + POSITION_EPSILON) return

  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    y: b.velocity.y - a.velocity.y,
    z: b.velocity.z - a.velocity.z,
  }
  const normal = normalize(delta, relativeVelocity)
  const correction = penetration - maximumPenetration
  const totalMass = Math.max(a.mass + b.mass, POSITION_EPSILON)
  const weightA = b.mass / totalMass
  const weightB = a.mass / totalMass

  // Correct only the excess overlap and split the displacement by inverse
  // center-of-mass weights. Velocities, mass, momentum, collision outcome and
  // the core solver's exact contact frame remain untouched.
  a.position = {
    x: a.position.x - normal.x * correction * weightA,
    y: a.position.y - normal.y * correction * weightA,
    z: a.position.z - normal.z * correction * weightA,
  }
  b.position = {
    x: b.position.x + normal.x * correction * weightB,
    y: b.position.y + normal.y * correction * weightB,
    z: b.position.z + normal.z * correction * weightB,
  }
}

function limitNonStellarPenetration(bodies: BodyState[]) {
  const solids = bodies.filter(isCorrectableSolid)
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      limitPairPenetration(solids[i], solids[j])
    }
  }
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const next = stepFragmentAwareBodies(input, dt)

  // The core transition tracker keys the returned array by identity. Mutate only
  // positions in-place so its phase-1 collision/fragment continuity state stays
  // attached to the exact frame chain and the eventual solver handoff still uses
  // its own contact-time frame rather than this presentation correction.
  limitNonStellarPenetration(next)
  return next
}
