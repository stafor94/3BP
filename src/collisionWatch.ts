import { getCollisionContactDistance } from './physics/collisionContact'
import type { BodyState } from './types'

const CONTACT_EPSILON = 1e-8
const COLLISION_RESULT_AGE_EPSILON = 1e-9

export function isBodyDescendedFrom(bodyId: string, sourceId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return sourceId.split('+').every((part) => bodyParts.has(part))
}

export function resolveBodyDescendant(bodies: BodyState[], sourceId: string) {
  const exact = bodies.find((body) => body.bodyType !== 'effect' && body.id === sourceId)
  if (exact) return exact

  return bodies
    .filter((body) => body.bodyType !== 'effect' && isBodyDescendedFrom(body.id, sourceId))
    .reduce<BodyState | undefined>((largest, body) => {
      if (!largest) return body
      if (body.mass !== largest.mass) return body.mass > largest.mass ? body : largest
      if (body.radius !== largest.radius) return body.radius > largest.radius ? body : largest
      return body.id.localeCompare(largest.id) < 0 ? body : largest
    }, undefined)
}

export function areSourceLineagesMerged(
  bodies: BodyState[],
  sourceAId: string,
  sourceBId: string,
) {
  const descendantA = resolveBodyDescendant(bodies, sourceAId)
  const descendantB = resolveBodyDescendant(bodies, sourceBId)
  if (descendantA && descendantB && descendantA.id === descendantB.id) return true

  return bodies.some((body) =>
    body.bodyType !== 'effect' &&
    isBodyDescendedFrom(body.id, sourceAId) &&
    isBodyDescendedFrom(body.id, sourceBId),
  )
}

function isAtOrInsideContact(a: BodyState, b: BodyState) {
  const distance = Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
  return distance <= getCollisionContactDistance(a, b) + CONTACT_EPSILON
}

function hasCollisionFlashForPair(
  bodies: BodyState[],
  bodyAId: string,
  bodyBId: string,
  maxAge = Number.POSITIVE_INFINITY,
) {
  const prefixAB = `${bodyAId}+${bodyBId}+flash`
  const prefixBA = `${bodyBId}+${bodyAId}+flash`

  return bodies.some((body) =>
    body.bodyType === 'effect' &&
    body.name === 'Collision flash' &&
    ((body.id.startsWith(prefixAB) || body.id.startsWith(prefixBA))) &&
    (body.age ?? 0) <= maxAge + COLLISION_RESULT_AGE_EPSILON,
  )
}

export function hasTargetPairCollisionResult(
  bodies: BodyState[],
  sourceAId: string,
  sourceBId: string,
) {
  if (areSourceLineagesMerged(bodies, sourceAId, sourceBId)) return true

  const descendantA = resolveBodyDescendant(bodies, sourceAId)
  const descendantB = resolveBodyDescendant(bodies, sourceBId)
  if (!descendantA || !descendantB || descendantA.id === descendantB.id) return false

  return (descendantA.collisionCooldown ?? 0) > 0 &&
    (descendantB.collisionCooldown ?? 0) > 0 &&
    hasCollisionFlashForPair(bodies, descendantA.id, descendantB.id)
}

export function didCollisionWatchTargetImpact(
  previousBodies: BodyState[],
  nextBodies: BodyState[],
  sourceAId: string,
  sourceBId: string,
  stepDt: number,
) {
  if (areSourceLineagesMerged(nextBodies, sourceAId, sourceBId)) return true

  const previousA = resolveBodyDescendant(previousBodies, sourceAId)
  const previousB = resolveBodyDescendant(previousBodies, sourceBId)
  if (!previousA || !previousB || previousA.id === previousB.id) return false
  if (!isAtOrInsideContact(previousA, previousB)) return false

  const nextA = resolveBodyDescendant(nextBodies, sourceAId)
  const nextB = resolveBodyDescendant(nextBodies, sourceBId)
  if (!nextA || !nextB || nextA.id === nextB.id) return false
  if ((nextA.collisionCooldown ?? 0) <= 0 || (nextB.collisionCooldown ?? 0) <= 0) return false

  return hasCollisionFlashForPair(
    nextBodies,
    previousA.id,
    previousB.id,
    Math.max(stepDt, 0),
  )
}
