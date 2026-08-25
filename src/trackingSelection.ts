import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

export function findDirectTrackingCandidate(bodies: BodyState[], sourceId: string) {
  return bodies.find((body) => body.id === sourceId && isTrackablePhysicalBody(body)) ?? null
}
