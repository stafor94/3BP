import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

export function findDirectTrackingCandidate(bodies: BodyState[], sourceId: string) {
  return bodies.find((body) => body.id === sourceId && isTrackablePhysicalBody(body)) ?? null
}

/**
 * Ordinary/manual tracking prefers the exact selected physical body. If that
 * exact id disappeared during an absorption collision, only a physical remnant
 * explicitly marked by the physics layer as that body's tracking continuation
 * may inherit the selection. Generic merged descendants, fragments, effects,
 * and unrelated bodies are never selected as fallbacks.
 */
export function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = findDirectTrackingCandidate(bodies, sourceId)
  if (exact) return exact

  return bodies.find((body) =>
    isTrackablePhysicalBody(body) &&
    body.trackingContinuationIds?.includes(sourceId),
  ) ?? null
}
