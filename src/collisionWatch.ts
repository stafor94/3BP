import { getEffectiveBodyType } from './bodyTypes'
import { bodyCarriesCollisionLineage } from './collisionIdentity'
import { getCollisionContactDistance } from './physics/collisionContact'
import type { BodyState, BodyType, StellarCollisionOutcome } from './types'

const CONTACT_EPSILON = 1e-8
const COLLISION_RESULT_AGE_EPSILON = 1e-9
const STELLAR_IMPACT_PEAK_COMPRESSION_RATIO = 0.075

/**
 * UI-facing projection of collision outcomes that already exist in the engine.
 * `mergeOrAbsorb` is intentionally a presentation bucket because the persisted
 * post-collision topology does not distinguish those two single-remnant modes.
 */
export type CollisionWatchOutcome =
  | StellarCollisionOutcome
  | 'disrupt'
  | 'hitRun'
  | 'mergeOrAbsorb'

export function isBodyDescendedFrom(bodyId: string, sourceId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return sourceId.split('+').every((part) => bodyParts.has(part))
}

export function resolveBodyDescendant(bodies: BodyState[], sourceId: string) {
  const exact = bodies.find((body) => body.bodyType !== 'effect' && body.id === sourceId)
  if (exact) return exact

  return bodies
    .filter((body) => body.bodyType !== 'effect' && bodyCarriesCollisionLineage(body, sourceId))
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
    bodyCarriesCollisionLineage(body, sourceAId) &&
    bodyCarriesCollisionLineage(body, sourceBId),
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

function getCompressionRatio(a: BodyState, b: BodyState) {
  const distance = Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
  const contactDistance = getCollisionContactDistance(a, b)
  const overlap = Math.max(0, contactDistance - distance)
  return overlap / Math.max(Math.min(a.radius, b.radius), 1e-9)
}

function isStellarPair(a: BodyState, b: BodyState) {
  return getEffectiveBodyType(a) === 'star' && getEffectiveBodyType(b) === 'star'
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

function hasCollisionFlashForCompositeRemnant(bodies: BodyState[], remnantId: string) {
  const prefix = `${remnantId}+flash`
  return bodies.some((body) =>
    body.bodyType === 'effect' &&
    body.name === 'Collision flash' &&
    body.id.startsWith(prefix),
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

export function resolveCollisionWatchOutcome(
  bodies: BodyState[],
  sourceAId: string,
  sourceBId: string,
  sourceAType: BodyType,
  sourceBType: BodyType,
): CollisionWatchOutcome | null {
  if (!hasTargetPairCollisionResult(bodies, sourceAId, sourceBId)) return null

  const descendantA = resolveBodyDescendant(bodies, sourceAId)
  const descendantB = resolveBodyDescendant(bodies, sourceBId)
  if (!descendantA || !descendantB) return null

  if (sourceAType === 'star' && sourceBType === 'star') {
    const stellarOutcome = descendantA.stellarCollisionOutcome ?? descendantB.stellarCollisionOutcome
    if (stellarOutcome) return stellarOutcome
  }

  if (descendantA.id === descendantB.id) {
    // Non-stellar `disrupt` creates a composite remnant with the same immediate
    // pair id used by its collision flash. `merge` / `absorb` preserve one input
    // identity instead, so the flash has an extra peer id before `+flash`.
    // This keeps the UI projection correct even if either source already carries
    // lineage from an earlier third-party collision.
    return hasCollisionFlashForCompositeRemnant(bodies, descendantA.id)
      ? 'disrupt'
      : 'mergeOrAbsorb'
  }

  return 'hitRun'
}

export function didCollisionWatchTargetImpact(
  previousBodies: BodyState[],
  nextBodies: BodyState[],
  sourceAId: string,
  sourceBId: string,
  stepDt: number,
) {
  const previousA = resolveBodyDescendant(previousBodies, sourceAId)
  const previousB = resolveBodyDescendant(previousBodies, sourceBId)
  const nextA = resolveBodyDescendant(nextBodies, sourceAId)
  const nextB = resolveBodyDescendant(nextBodies, sourceBId)

  // Star↔star impact must be observed while both source silhouettes still exist.
  // The staged impact bridge deliberately raises compression before the solver is
  // allowed to reveal a remnant, so collision-watch can enter its impact phase and
  // bring flash/shear/plasma to peak before any 2→1 topology change is visible.
  if (
    previousA && previousB && previousA.id !== previousB.id &&
    nextA && nextB && nextA.id !== nextB.id &&
    isStellarPair(previousA, previousB) &&
    isStellarPair(nextA, nextB)
  ) {
    const previousCompression = getCompressionRatio(previousA, previousB)
    const nextCompression = getCompressionRatio(nextA, nextB)
    if (
      previousCompression < STELLAR_IMPACT_PEAK_COMPRESSION_RATIO &&
      nextCompression >= STELLAR_IMPACT_PEAK_COMPRESSION_RATIO
    ) {
      return true
    }
  }

  // Lineage merge remains only a fallback for watches that were attached too late
  // to observe the compression-threshold crossing (or for legacy callers).
  if (areSourceLineagesMerged(nextBodies, sourceAId, sourceBId)) return true

  if (!previousA || !previousB || previousA.id === previousB.id) return false
  if (!isAtOrInsideContact(previousA, previousB)) return false
  if (!nextA || !nextB || nextA.id === nextB.id) return false
  if ((nextA.collisionCooldown ?? 0) <= 0 || (nextB.collisionCooldown ?? 0) <= 0) return false

  return hasCollisionFlashForPair(
    nextBodies,
    previousA.id,
    previousB.id,
    Math.max(stepDt, 0),
  )
}
