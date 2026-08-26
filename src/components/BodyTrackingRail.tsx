import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { translations, type Language } from '../i18n'
import { isTrackingMassEligible } from '../trackingMassPolicy'
import { findTrackingCandidate } from '../trackingSelection'
import { publishTrackedBodyTelemetry } from '../trackingTelemetry'
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
  candidate: BodyState | null
}

function cloneTrackingBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
  }
}

function isInitialTrackingBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect' && !body.id.includes('+')
}

function buildTrackingEntries(bodies: BodyState[], sourceBodies: BodyState[]): TrackingEntry[] {
  return sourceBodies.map((source) => ({
    source,
    candidate: findTrackingCandidate(bodies, source.id),
  }))
}

function resolveTrackingSourceId(
  bodies: BodyState[],
  sourceBodies: BodyState[],
  trackedBodyId: string | null,
  preferredSourceId: string | null,
) {
  if (!trackedBodyId) return null

  const trackedCandidate = findTrackingCandidate(bodies, trackedBodyId)

  if (preferredSourceId) {
    const preferredSource = sourceBodies.find((body) => body.id === preferredSourceId)
    const preferredCandidate = preferredSource
      ? findTrackingCandidate(bodies, preferredSource.id)
      : null
    if (
      preferredCandidate &&
      (
        preferredCandidate.id === trackedBodyId ||
        preferredSourceId === trackedBodyId ||
        trackedCandidate?.id === preferredCandidate.id
      )
    ) {
      return preferredSourceId
    }
  }

  const exactSource = sourceBodies.find((body) => body.id === trackedBodyId)
  if (exactSource && findTrackingCandidate(bodies, exactSource.id)) return exactSource.id

  return sourceBodies.find((source) => {
    const sourceCandidate = findTrackingCandidate(bodies, source.id)
    return sourceCandidate?.id === trackedBodyId ||
      (trackedCandidate !== null && sourceCandidate?.id === trackedCandidate.id)
  })?.id ?? null
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
  const resolvedTrackingSourceId = resolveTrackingSourceId(
    bodies,
    sourceBodies,
    trackedBodyId,
    trackingSourceId,
  )

  useEffect(() => {
    setTrackingSourceId((current) =>
      resolveTrackingSourceId(bodies, sourceBodies, trackedBodyId, current),
    )
  }, [bodies, trackedBodyId, sourceBodies])

  useEffect(() => () => publishTrackedBodyTelemetry(null), [])

  const getTrackingState = (source: BodyState, candidate?: BodyState | null) => {
    const resolvedCandidate = candidate ?? findTrackingCandidate(bodies, source.id)
    const scaleRatio = bodyScale / Math.max(sourceScaleRef.current, 1e-9)
    const initialMassAtCurrentScale = source.mass * scaleRatio
    const canTrack = Boolean(
      resolvedCandidate && isTrackingMassEligible(resolvedCandidate.mass, initialMassAtCurrentScale),
    )
    return { candidate: resolvedCandidate, canTrack }
  }

  // Keep the original source snapshot stable while the simulation runs so a
  // collision descendant cannot reset the 50% threshold to its current mass.
  // Telemetry follows only while the original source remains trackable.
  useLayoutEffect(() => {
    if (!trackedBodyId) {
      publishTrackedBodyTelemetry(null)
      return
    }

    if (!resolvedTrackingSourceId) {
      publishTrackedBodyTelemetry(null)
      setTrackingSourceId(null)
      onTrackedBodyChange(null)
      return
    }

    const entry = trackingEntries.find((item) => item.source.id === resolvedTrackingSourceId)
    const state = entry ? getTrackingState(entry.source, entry.candidate) : null
    if (!entry || !state?.candidate || !state.canTrack) {
      publishTrackedBodyTelemetry(null)
      setTrackingSourceId(null)
      onTrackedBodyChange(null)
      return
    }

    publishTrackedBodyTelemetry(state.candidate)
  }, [bodies, bodyScale, onTrackedBodyChange, resolvedTrackingSourceId, sourceBodies, trackedBodyId])

  if (trackingEntries.length === 0) return null

  return (
    <div className="body-tracking-rail" role="group" aria-label={t.trackBody}>
      {trackingEntries.map(({ source, candidate }) => {
        const { canTrack } = getTrackingState(source, candidate)
        const isTracked = resolvedTrackingSourceId === source.id && trackedBodyId !== null
        const displayBody = candidate ?? source
        const bodyType = displayBody.bodyType ?? source.bodyType ?? 'planet'
        return (
          <button
            key={source.id}
            type="button"
            className={`body-tracking-button${isTracked ? ' active' : ''}`}
            disabled={!canTrack}
            aria-label={`${source.name} ${t.trackBody}`}
            aria-pressed={isTracked}
            title={source.name}
            onClick={() => {
              if (isTracked) {
                setTrackingSourceId(null)
                publishTrackedBodyTelemetry(null)
                onTrackedBodyChange(null)
                return
              }
              if (!candidate || !canTrack) return
              setTrackingSourceId(source.id)
              onTrackedBodyChange(candidate.id)
            }}
          >
            <span
              className={`body-tracking-glyph ${bodyType}`}
              style={{ backgroundColor: displayBody.color, color: displayBody.color }}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </div>
  )
}
