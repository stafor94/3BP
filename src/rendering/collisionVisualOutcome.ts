import type { BodyState, Vec3 } from '../types'

export type CollisionVisualOutcome =
  | 'survivor'
  | 'absorbed'
  | 'disrupted'
  | 'merged-survivor'

export type CollisionVisualTransition = {
  source: BodyState
  outcome: CollisionVisualOutcome
  resultId: string | null
  contactNormal: Vec3
  contactPoint: Vec3
}

/**
 * The core non-stellar classifier leaves a deliberate gap between ordinary
 * merge/absorb ejecta (<= 13% of system mass) and disruption ejecta (>= 22%).
 * Visual classification uses the actual before/after mass result inside that
 * gap instead of treating an id/lineage change as proof of destruction.
 */
export const COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD = 0.17

function lineageParts(bodyId: string) {
  return bodyId.split('+').map((part) => part.trim()).filter(Boolean)
}

export function isCollisionVisualDescendant(candidateId: string, sourceId: string) {
  const candidateParts = new Set(lineageParts(candidateId))
  const sourceParts = lineageParts(sourceId)
  return sourceParts.length > 0 && sourceParts.every((part) => candidateParts.has(part))
}

function isNonStellarSource(body: BodyState) {
  return body.bodyType !== 'star' && body.bodyType !== 'effect' && body.bodyType !== 'fragment'
}

function isNonStellarResult(body: BodyState) {
  return body.bodyType !== 'star' && body.bodyType !== 'effect' && body.bodyType !== 'fragment'
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length > 1e-10) {
    return { x: value.x / length, y: value.y / length, z: value.z / length }
  }

  const fallbackLength = Math.hypot(fallback.x, fallback.y, fallback.z)
  if (fallbackLength > 1e-10) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
      z: fallback.z / fallbackLength,
    }
  }
  return { x: 1, y: 0, z: 0 }
}

function getContactGeometry(source: BodyState, partner: BodyState | undefined) {
  if (!partner) {
    const contactNormal = normalize(source.velocity, { x: 1, y: 0, z: 0 })
    return {
      contactNormal,
      contactPoint: {
        x: source.position.x + contactNormal.x * source.radius,
        y: source.position.y + contactNormal.y * source.radius,
        z: source.position.z + contactNormal.z * source.radius,
      },
    }
  }

  const delta = {
    x: partner.position.x - source.position.x,
    y: partner.position.y - source.position.y,
    z: partner.position.z - source.position.z,
  }
  const relativeVelocity = {
    x: partner.velocity.x - source.velocity.x,
    y: partner.velocity.y - source.velocity.y,
    z: partner.velocity.z - source.velocity.z,
  }
  const contactNormal = normalize(delta, relativeVelocity)
  const sourceSurface = {
    x: source.position.x + contactNormal.x * source.radius,
    y: source.position.y + contactNormal.y * source.radius,
    z: source.position.z + contactNormal.z * source.radius,
  }
  const partnerSurface = {
    x: partner.position.x - contactNormal.x * partner.radius,
    y: partner.position.y - contactNormal.y * partner.radius,
    z: partner.position.z - contactNormal.z * partner.radius,
  }

  return {
    contactNormal,
    contactPoint: {
      x: (sourceSurface.x + partnerSurface.x) * 0.5,
      y: (sourceSurface.y + partnerSurface.y) * 0.5,
      z: (sourceSurface.z + partnerSurface.z) * 0.5,
    },
  }
}

function nearestLineagePartner(
  source: BodyState,
  previous: BodyState[],
  candidateId: string,
) {
  return previous
    .filter((body) =>
      body.id !== source.id &&
      body.bodyType !== 'effect' &&
      isCollisionVisualDescendant(candidateId, body.id),
    )
    .sort((a, b) => {
      const distanceA = Math.hypot(
        a.position.x - source.position.x,
        a.position.y - source.position.y,
        a.position.z - source.position.z,
      )
      const distanceB = Math.hypot(
        b.position.x - source.position.x,
        b.position.y - source.position.y,
        b.position.z - source.position.z,
      )
      return distanceA - distanceB
    })[0]
}

function transitionFor(
  source: BodyState,
  outcome: CollisionVisualOutcome,
  resultId: string | null,
  partner: BodyState | undefined,
): CollisionVisualTransition {
  const { contactNormal, contactPoint } = getContactGeometry(source, partner)
  return {
    source: {
      ...source,
      position: { ...source.position },
      velocity: { ...source.velocity },
      trackingContinuationIds: source.trackingContinuationIds
        ? [...source.trackingContinuationIds]
        : undefined,
    },
    outcome,
    resultId,
    contactNormal,
    contactPoint,
  }
}

export function findCollisionVisualTransitions(
  previous: BodyState[],
  current: BodyState[],
): CollisionVisualTransition[] {
  const previousIds = new Set(previous.map((body) => body.id))
  const currentIds = new Set(current.map((body) => body.id))
  const transitions: CollisionVisualTransition[] = []
  const transitionedSourceIds = new Set<string>()

  const newResults = current.filter((body) =>
    isNonStellarResult(body) &&
    !previousIds.has(body.id) &&
    body.id.includes('+'),
  )

  for (const result of newResults) {
    const sources = previous.filter((source) =>
      isNonStellarSource(source) &&
      !currentIds.has(source.id) &&
      isCollisionVisualDescendant(result.id, source.id),
    )
    if (sources.length === 0) continue

    const incomingMass = sources.reduce((sum, source) => sum + Math.max(0, source.mass), 0)
    const massLossFraction = incomingMass > 1e-12
      ? Math.max(0, incomingMass - Math.max(0, result.mass)) / incomingMass
      : 0
    const disrupted = massLossFraction >= COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD
    const dominant = sources
      .slice()
      .sort((a, b) => b.mass - a.mass || b.radius - a.radius || a.id.localeCompare(b.id))[0]

    for (const source of sources) {
      const partner = nearestLineagePartner(source, previous, result.id)
      const outcome: CollisionVisualOutcome = disrupted
        ? 'disrupted'
        : source.id === dominant.id
          ? 'merged-survivor'
          : 'absorbed'
      transitions.push(transitionFor(source, outcome, result.id, partner))
      transitionedSourceIds.add(source.id)
    }
  }

  // A disruption can end in fragments without a retained non-fragment result.
  // Lineage only associates those pieces with the source; the absence of any
  // surviving result plus real fragment/ejecta output is the destruction proof.
  for (const source of previous) {
    if (
      !isNonStellarSource(source) ||
      currentIds.has(source.id) ||
      transitionedSourceIds.has(source.id)
    ) continue

    const descendants = current.filter((candidate) =>
      candidate.id !== source.id &&
      isCollisionVisualDescendant(candidate.id, source.id),
    )
    const fragmentDescendants = descendants.filter((candidate) =>
      candidate.bodyType === 'fragment' ||
      (candidate.bodyType === 'effect' && candidate.mass > 0),
    )
    const hasSurvivingBody = descendants.some(isNonStellarResult)
    if (hasSurvivingBody || fragmentDescendants.length === 0) continue

    const partner = previous
      .filter((candidate) => candidate.id !== source.id && candidate.bodyType !== 'effect')
      .find((candidate) => fragmentDescendants.some((fragment) =>
        isCollisionVisualDescendant(fragment.id, candidate.id),
      ))
    transitions.push(transitionFor(source, 'disrupted', null, partner))
  }

  return transitions
}

export function getCollisionResultTransitions(
  transitions: CollisionVisualTransition[],
  resultId: string,
) {
  return transitions.filter((transition) => transition.resultId === resultId)
}
