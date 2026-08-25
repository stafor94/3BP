import { useEffect, useRef, useState } from 'react'
import { translations, type Language } from '../i18n'
import type { BodyCount, BodyState, PresetId, SpaceMode } from '../types'
import '../body-tracking-rail.css'

type Props = {
  bodies: BodyState[]
  bodyCount: BodyCount
  bodyScale: number
  preset: PresetId
  spaceMode: SpaceMode
  isRunning: boolean
  language: Language
  trackedBodyId: string | null
  onTrackedBodyChange: (bodyId: string | null) => void
}

type TrackingEntry = {
  source: BodyState
  candidate: BodyState
}

const TRACKING_MIN_MASS_RATIO = 0.5

function cloneTrackingBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
  }
}

function isInitialTrackingBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect' && !body.id.includes('+')
}

function isTrackablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

function isBodyDescendedFrom(bodyId: string, sourceId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return sourceId.split('+').every((part) => bodyParts.has(part))
}

function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = bodies.find((body) => body.id === sourceId && isTrackablePhysicalBody(body))
  if (exact) return exact

  return bodies
    .filter((body) => isTrackablePhysicalBody(body) && isBodyDescendedFrom(body.id, sourceId))
    .reduce<BodyState | null>(
      (largest, body) => (!largest || body.mass > largest.mass ? body : largest),
      null,
    )
}

function shouldUseSourceForCandidate(
  currentSource: BodyState,
  nextSource: BodyState,
  candidate: BodyState,
) {
  if (currentSource.id === candidate.id) return false
  if (nextSource.id === candidate.id) return true

  const currentColorMatches = currentSource.color.toLowerCase() === candidate.color.toLowerCase()
  const nextColorMatches = nextSource.color.toLowerCase() === candidate.color.toLowerCase()
  if (currentColorMatches !== nextColorMatches) return nextColorMatches

  return nextSource.mass > currentSource.mass
}

function buildTrackingEntries(bodies: BodyState[], sourceBodies: BodyState[]) {
  const entriesByCandidateId = new Map<string, TrackingEntry>()

  for (const source of sourceBodies) {
    const candidate = findTrackingCandidate(bodies, source.id)
    if (!candidate) continue

    const existing = entriesByCandidateId.get(candidate.id)
    if (!existing || shouldUseSourceForCandidate(existing.source, source, candidate)) {
      entriesByCandidateId.set(candidate.id, { source, candidate })
    }
  }

  return Array.from(entriesByCandidateId.values())
}

function resolveTrackingSourceId(
  bodies: BodyState[],
  sourceBodies: BodyState[],
  trackedBodyId: string | null,
  preferredSourceId: string | null,
) {
  if (!trackedBodyId) return null

  if (preferredSourceId) {
    const preferredSource = sourceBodies.find((body) => body.id === preferredSourceId)
    const preferredCandidate = preferredSource
      ? findTrackingCandidate(bodies, preferredSource.id)
      : null
    if (preferredCandidate?.id === trackedBodyId) return preferredSourceId
  }

  const exactSource = sourceBodies.find((body) => body.id === trackedBodyId)
  if (exactSource) return exactSource.id

  return sourceBodies.find((body) => isBodyDescendedFrom(trackedBodyId, body.id))?.id ?? null
}

export function BodyTrackingRail({
  bodies,
  bodyCount,
  bodyScale,
  preset,
  spaceMode,
  isRunning,
  language,
  trackedBodyId,
  onTrackedBodyChange,
}: Props) {
  const t = translations[language]
  const [sourceBodies, setSourceBodies] = useState<BodyState[]>(() =>
    bodies.filter(isInitialTrackingBody).map(cloneTrackingBody),
  )
  const [trackingSourceId, setTrackingSourceId] = useState<string | null>(null)
  const setupKeyRef = useRef(`${preset}:${bodyCount}:${spaceMode}`)
  const sourceScaleRef = useRef(bodyScale)

  useEffect(() => {
    const setupKey = `${preset}:${bodyCount}:${spaceMode}`
    const setupChanged = setupKeyRef.current !== setupKey
    const initialBodies = bodies.filter(isInitialTrackingBody)
    const isCleanInitialSet = initialBodies.length === bodyCount && initialBodies.length === bodies.length

    if (setupChanged) setupKeyRef.current = setupKey

    if (setupChanged || (!isRunning && isCleanInitialSet)) {
      sourceScaleRef.current = bodyScale
      setSourceBodies(initialBodies.map(cloneTrackingBody))
    }
  }, [bodies, bodyCount, bodyScale, isRunning, preset, spaceMode])

  const trackingEntries = buildTrackingEntries(bodies, sourceBodies)
  const visibleSourceBodies = trackingEntries.map((entry) => entry.source)
  const resolvedTrackingSourceId = resolveTrackingSourceId(
    bodies,
    visibleSourceBodies,
    trackedBodyId,
    trackingSourceId,
  )

  useEffect(() => {
    setTrackingSourceId((current) =>
      resolveTrackingSourceId(bodies, visibleSourceBodies, trackedBodyId, current),
    )
  }, [bodies, trackedBodyId, sourceBodies])

  const getTrackingState = (source: BodyState, candidate?: BodyState | null) => {
    const resolvedCandidate = candidate ?? findTrackingCandidate(bodies, source.id)
    const scaleRatio = bodyScale / Math.max(sourceScaleRef.current, 1e-9)
    const initialMassAtCurrentScale = source.mass * scaleRatio
    const canTrack = Boolean(
      resolvedCandidate &&
      resolvedCandidate.mass > initialMassAtCurrentScale * TRACKING_MIN_MASS_RATIO + 1e-12,
    )
    return { candidate: resolvedCandidate, canTrack }
  }

  useEffect(() => {
    if (!resolvedTrackingSourceId || !trackedBodyId) return

    const entry = trackingEntries.find((item) => item.source.id === resolvedTrackingSourceId)
    if (!entry || !getTrackingState(entry.source, entry.candidate).canTrack) {
      setTrackingSourceId(null)
      onTrackedBodyChange(null)
    }
  }, [bodies, bodyScale, onTrackedBodyChange, resolvedTrackingSourceId, sourceBodies, trackedBodyId])

  if (trackingEntries.length === 0) return null

  return (
    <div className="body-tracking-rail" role="group" aria-label={t.trackBody}>
      {trackingEntries.map(({ source, candidate }) => {
        const { canTrack } = getTrackingState(source, candidate)
        const isTracked = resolvedTrackingSourceId === source.id && trackedBodyId !== null
        const bodyType = candidate.bodyType ?? source.bodyType ?? 'planet'
        return (
          <button
            key={candidate.id}
            type="button"
            className={`body-tracking-button${isTracked ? ' active' : ''}`}
            disabled={!canTrack}
            aria-label={`${candidate.name} ${t.trackBody}`}
            aria-pressed={isTracked}
            title={candidate.name}
            onClick={() => {
              if (!canTrack) return
              setTrackingSourceId(source.id)
              onTrackedBodyChange(candidate.id)
            }}
          >
            <span
              className={`body-tracking-glyph ${bodyType}`}
              style={{ backgroundColor: candidate.color, color: candidate.color }}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </div>
  )
}
