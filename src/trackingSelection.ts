import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

export function findDirectTrackingCandidate(bodies: BodyState[], sourceId: string) {
  return bodies.find((body) => body.id === sourceId && isTrackablePhysicalBody(body)) ?? null
}

/**
 * Ordinary tracking is deliberately stricter than collision-watch lineage.
 * Prefer the exact same body id. If it disappeared, only a remnant that the
 * physics layer explicitly marked as the larger body's absorption successor may
 * inherit tracking. Merely sharing `Alpha` inside `Alpha+Beta` is not enough.
 */
export function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = findDirectTrackingCandidate(bodies, sourceId)
  if (exact) return exact

  return bodies.find((body) =>
    isTrackablePhysicalBody(body) &&
    body.trackingContinuationIds?.includes(sourceId),
  ) ?? null
}
