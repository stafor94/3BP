import type { BodyState } from './types'

export function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'effect'
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

function isLineageDescendant(candidateId: string, sourceId: string) {
  const candidateParts = new Set(candidateId.split('+').map((part) => part.trim()).filter(Boolean))
  const sourceParts = sourceId.split('+').map((part) => part.trim()).filter(Boolean)
  return sourceParts.length > 0 && sourceParts.every((part) => candidateParts.has(part))
}

function selectBestTrackingCandidate(candidates: BodyState[]) {
  return [...candidates].sort((a, b) => {
    const aFragment = a.bodyType === 'fragment' ? 1 : 0
    const bFragment = b.bodyType === 'fragment' ? 1 : 0
    if (aFragment !== bFragment) return aFragment - bFragment
    if (Math.abs(a.mass - b.mass) > 1e-12) return b.mass - a.mass
    if (Math.abs(a.radius - b.radius) > 1e-12) return b.radius - a.radius
    return a.id.localeCompare(b.id)
  })[0] ?? null
}

/**
 * Tracking follows the user's selected physical lineage until the user changes
 * or clears the selection. Exact bodies win first, then explicit physics-layer
 * continuations, then ordinary collision descendants. When a destructive
 * collision leaves only fragments, the largest surviving fragment becomes the
 * deterministic continuation instead of dropping tracking in the middle of the
 * event. Rendering-only effect bodies are never valid tracking targets.
 */
export function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = findDirectTrackingCandidate(bodies, sourceId)
  if (exact) return exact

  const sourceLineageIds = getSourceLineageIds(sourceId)
  const explicitContinuations = bodies.filter((body) =>
    isTrackablePhysicalBody(body) &&
    body.trackingContinuationIds?.some((continuationId) => sourceLineageIds.has(continuationId)),
  )
  const explicit = selectBestTrackingCandidate(explicitContinuations)
  if (explicit) return explicit

  return selectBestTrackingCandidate(
    bodies.filter((body) =>
      isTrackablePhysicalBody(body) && isLineageDescendant(body.id, sourceId),
    ),
  )
}
