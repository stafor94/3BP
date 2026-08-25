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

function isBodyDescendedFrom(bodyId: string, sourceId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return sourceId.split('+').every((part) => bodyParts.has(part))
}

function findTrackingCandidate(bodies: BodyState[], sourceId: string) {
  const exact = bodies.find((body) => body.id === sourceId && body.bodyType !== 'effect')
  if (exact) return exact

  return bodies
    .filter((body) => body.bodyType !== 'effect' && isBodyDescendedFrom(body.id, sourceId))
    .reduce<BodyState | null>(
      (largest, body) => (!largest || body.mass > largest.mass ? body : largest),
      null,
    )
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

  useEffect(() => {
    setTrackingSourceId((current) => {
      if (!trackedBodyId) return null

      if (current) {
        const currentSource = sourceBodies.find((body) => body.id === current)
        const currentCandidate = currentSource
          ? findTrackingCandidate(bodies, currentSource.id)
          : null
        if (currentCandidate?.id === trackedBodyId) return current
      }

      const exactSource = sourceBodies.find((body) => body.id === trackedBodyId)
      if (exactSource) return exactSource.id

      return sourceBodies.find((body) => isBodyDescendedFrom(trackedBodyId, body.id))?.id ?? null
    })
  }, [bodies, sourceBodies, trackedBodyId])

  const getTrackingState = (source: BodyState) => {
    const candidate = findTrackingCandidate(bodies, source.id)
    const scaleRatio = bodyScale / Math.max(sourceScaleRef.current, 1e-9)
    const initialMassAtCurrentScale = source.mass * scaleRatio
    const canTrack = Boolean(
      candidate && candidate.mass > initialMassAtCurrentScale * TRACKING_MIN_MASS_RATIO + 1e-12,
    )
    return { candidate, canTrack }
  }

  useEffect(() => {
    if (!trackingSourceId || !trackedBodyId) return

    const source = sourceBodies.find((body) => body.id === trackingSourceId)
    if (!source || !getTrackingState(source).canTrack) {
      setTrackingSourceId(null)
      onTrackedBodyChange(null)
    }
  }, [bodies, bodyScale, onTrackedBodyChange, sourceBodies, trackedBodyId, trackingSourceId])

  if (sourceBodies.length === 0) return null

  return (
    <div className="body-tracking-rail" role="group" aria-label={t.trackBody}>
      {sourceBodies.map((body) => {
        const { candidate, canTrack } = getTrackingState(body)
        const isTracked = trackingSourceId === body.id && trackedBodyId !== null
        const bodyType = body.bodyType ?? 'planet'
        return (
          <button
            key={body.id}
            type="button"
            className={`body-tracking-button${isTracked ? ' active' : ''}`}
            disabled={!canTrack}
            aria-label={`${body.name} ${t.trackBody}`}
            aria-pressed={isTracked}
            title={body.name}
            onClick={() => {
              if (!candidate || !canTrack) return
              setTrackingSourceId(body.id)
              onTrackedBodyChange(candidate.id)
            }}
          >
            <span
              className={`body-tracking-glyph ${bodyType}`}
              style={{ backgroundColor: body.color, color: body.color }}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </div>
  )
}
