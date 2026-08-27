import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'effect' && body.bodyType !== 'fragment'
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

function selectBestTrackingCandidate(candidates: BodyState[]) {
  return [...candidates].sort((a, b) => {
    if (Math.abs(a.mass - b.mass) > 1e-12) return b.mass - a.mass
    if (Math.abs(a.radius - b.radius) > 1e-12) return b.radius - a.radius
    return a.id.localeCompare(b.id)
  })[0] ?? null
}

/**
 * Ordinary user tracking is deliberately narrower than generic collision lineage.
 * The exact selected body remains eligible while it exists. If a physical 2→1
 * result replaces it, tracking may continue only through explicit continuation
 * metadata recorded by the physics layer. Generic fragments/effects are never
 * automatic user-tracking targets; App.tsx still applies the initial-mass gate.
 */
export function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = findDirectTrackingCandidate(bodies, sourceId)
  if (exact) return exact

  const sourceLineageIds = getSourceLineageIds(sourceId)
  const explicitContinuations = bodies.filter((body) =>
    isTrackablePhysicalBody(body) &&
    body.trackingContinuationIds?.some((continuationId) => sourceLineageIds.has(continuationId)),
  )
  return selectBestTrackingCandidate(explicitContinuations)
}
