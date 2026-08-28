import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import type { BodyState, Vec3 } from '../types'

export type CollisionVisualOutcome =
  | 'survivor'
  | 'absorbed'
  | 'disrupted'
  | 'merged-survivor'

export type CollisionVisualPhase =
  | 'IMPACT'
  | 'FRACTURE'
  | 'TRANSFER'
  | 'REMNANT_SETTLE'

export type CollisionVisualLifecycle = {
  phase: CollisionVisualPhase
  phaseProgress: number
  elapsedMs: number
  progress: number
  isComplete: boolean
}

export type CollisionRemnantVisualPhase = 'FORMING' | 'SETTLING' | 'STABLE'

export type CollisionRemnantVisualLifecycle = {
  phase: CollisionRemnantVisualPhase
  phaseProgress: number
  elapsedMs: number
  formationProgress: number
  settleProgress: number
  isComplete: boolean
}

export const COLLISION_VISUAL_TIMING_MS = {
  impactEnd: 260,
  fractureEnd: 1050,
  transferEnd: 1900,
  remnantSettleEnd: 2600,
} as const

export const COLLISION_REMNANT_FORMATION_START_MS = 520
export const COLLISION_REMNANT_SETTLE_START_MS = COLLISION_VISUAL_TIMING_MS.transferEnd
export const COLLISION_REMNANT_SETTLE_END_MS = COLLISION_VISUAL_TIMING_MS.remnantSettleEnd

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

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function phaseProgress(elapsedMs: number, startMs: number, endMs: number) {
  return smooth01((elapsedMs - startMs) / Math.max(1, endMs - startMs))
}

export function getCollisionVisualLifecycle(elapsedMs: number): CollisionVisualLifecycle {
  const elapsed = Math.max(0, elapsedMs)
  const timing = COLLISION_VISUAL_TIMING_MS
  let phase: CollisionVisualPhase
  let currentPhaseProgress: number

  if (elapsed < timing.impactEnd) {
    phase = 'IMPACT'
    currentPhaseProgress = phaseProgress(elapsed, 0, timing.impactEnd)
  } else if (elapsed < timing.fractureEnd) {
    phase = 'FRACTURE'
    currentPhaseProgress = phaseProgress(elapsed, timing.impactEnd, timing.fractureEnd)
  } else if (elapsed < timing.transferEnd) {
    phase = 'TRANSFER'
    currentPhaseProgress = phaseProgress(elapsed, timing.fractureEnd, timing.transferEnd)
  } else {
    phase = 'REMNANT_SETTLE'
    currentPhaseProgress = phaseProgress(elapsed, timing.transferEnd, timing.remnantSettleEnd)
  }

  return {
    phase,
    phaseProgress: currentPhaseProgress,
    elapsedMs: elapsed,
    progress: smooth01(elapsed / timing.remnantSettleEnd),
    isComplete: elapsed >= timing.remnantSettleEnd,
  }
}

export function getCollisionRemnantVisualLifecycle(
  elapsedMs: number,
): CollisionRemnantVisualLifecycle {
  const elapsed = Math.max(0, elapsedMs)
  const formationProgress = elapsed <= COLLISION_REMNANT_FORMATION_START_MS
    ? 0
    : phaseProgress(
      elapsed,
      COLLISION_REMNANT_FORMATION_START_MS,
      COLLISION_REMNANT_SETTLE_START_MS,
    )
  const settleProgress = elapsed <= COLLISION_REMNANT_SETTLE_START_MS
    ? 0
    : phaseProgress(
      elapsed,
      COLLISION_REMNANT_SETTLE_START_MS,
      COLLISION_REMNANT_SETTLE_END_MS,
    )

  if (elapsed < COLLISION_REMNANT_SETTLE_START_MS) {
    return {
      phase: 'FORMING',
      phaseProgress: formationProgress,
      elapsedMs: elapsed,
      formationProgress,
      settleProgress: 0,
      isComplete: false,
    }
  }
  if (elapsed < COLLISION_REMNANT_SETTLE_END_MS) {
    return {
      phase: 'SETTLING',
      phaseProgress: settleProgress,
      elapsedMs: elapsed,
      formationProgress: 1,
      settleProgress,
      isComplete: false,
    }
  }
  return {
    phase: 'STABLE',
    phaseProgress: 1,
    elapsedMs: elapsed,
    formationProgress: 1,
    settleProgress: 1,
    isComplete: true,
  }
}

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
  result: BodyState,
) {
  return previous
    .filter((body) =>
      body.id !== source.id &&
      body.bodyType !== 'effect' &&
      bodyCarriesCollisionLineage(result, body.id),
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

function findCollisionResultIdentitySources(
  result: BodyState,
  previous: BodyState[],
  currentIds: Set<string>,
) {
  return previous.filter((source) =>
    source.bodyType !== 'effect' &&
    bodyCarriesCollisionLineage(result, source.id) &&
    (source.id === result.id || !currentIds.has(source.id)),
  )
}

export function findCollisionVisualTransitions(
  previous: BodyState[],
  current: BodyState[],
): CollisionVisualTransition[] {
  const currentIds = new Set(current.map((body) => body.id))
  const transitions: CollisionVisualTransition[] = []
  const transitionedSourceIds = new Set<string>()

  const resultCandidates = current.filter(isNonStellarResult)

  for (const result of resultCandidates) {
    const identitySources = findCollisionResultIdentitySources(result, previous, currentIds)
    if (identitySources.length < 2) continue
    const sources = identitySources.filter(isNonStellarSource)
    if (sources.length === 0) continue

    const incomingMass = sources.reduce((sum, source) => sum + Math.max(0, source.mass), 0)
    const massLossFraction = incomingMass > 1e-12
      ? Math.max(0, incomingMass - Math.max(0, result.mass)) / incomingMass
      : 0
    const disrupted = massLossFraction >= COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD
    const preservedIdentitySource = sources.find((source) => source.id === result.id)
    const dominant = preservedIdentitySource ?? sources
      .slice()
      .sort((a, b) => b.mass - a.mass || b.radius - a.radius || a.id.localeCompare(b.id))[0]

    for (const source of sources) {
      const partner = nearestLineagePartner(source, previous, result)
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
      bodyCarriesCollisionLineage(candidate, source.id),
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
        bodyCarriesCollisionLineage(fragment, candidate.id),
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
