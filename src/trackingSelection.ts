import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

export function findDirectTrackingCandidate(bodies: BodyState[], sourceId: string) {
  return bodies.find((body) => body.id === sourceId && isTrackablePhysicalBody(body)) ?? null
}

function getSourceLineageIds(sourceId: string) {
  return new Set([
    sourceId,
    ...sourceId.split('+').map((part) => part.trim()).filter(Boolean),
  ])
}

/**
 * Ordinary/manual tracking prefers the exact selected physical body. If that
 * exact id disappeared during an absorption collision, only a physical remnant
 * explicitly marked by the physics layer as that body's tracking continuation
 * may inherit the selection. Generic merged descendants, fragments, effects,
 * and unrelated bodies are never selected as fallbacks.
 *
 * A tracked remnant id can itself become stale after a later absorption. In that
 * case, keep following only when the new physical remnant still carries an
 * explicit continuation id from the already-authorized tracked lineage. This
 * preserves the original tracking permission without turning generic merge ids
 * into an implicit fallback.
 */
export function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = findDirectTrackingCandidate(bodies, sourceId)
  if (exact) return exact

  const directContinuation = bodies.find((body) =>
    isTrackablePhysicalBody(body) &&
    body.trackingContinuationIds?.includes(sourceId),
  )
  if (directContinuation) return directContinuation

  const sourceLineageIds = getSourceLineageIds(sourceId)
  return bodies.find((body) =>
    isTrackablePhysicalBody(body) &&
    body.trackingContinuationIds?.some((continuationId) => sourceLineageIds.has(continuationId)),
  ) ?? null
}
