import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

export function findDirectTrackingCandidate(bodies: BodyState[], sourceId: string) {
  return bodies.find((body) => body.id === sourceId && isTrackablePhysicalBody(body)) ?? null
}

/**
 * Ordinary/manual tracking follows only the exact selected physical body.
 * Collision-watch lineage is intentionally handled elsewhere; an absorbed or
 * destroyed body never transfers ordinary tracking to a remnant or fallback.
 */
export function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  return findDirectTrackingCandidate(bodies, sourceId)
}
