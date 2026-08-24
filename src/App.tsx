import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPresetBodyTypes } from './bodyTypes'
import { CollisionAlert } from './components/CollisionAlert'
import { ControlPanel } from './components/ControlPanel'
import { SimulationView } from './components/SimulationView'
import { getOrbital2dPresetOverride } from './orbital2dPresets'
import { getOrbital3dPresetOverride } from './orbital3dPresets'
import { translations, type Language } from './i18n'
import {
  predictUpcomingCollision,
  type CollisionPrediction,
} from './physics/collisionPrediction'
import { stepBodies } from './physics/engine'
import { DEFAULT_PRESET_BY_BODY_COUNT, getPreset, getPresetBodyCount } from './presets'
import type { BodyCount, BodyState, PresetId, SpaceMode, TrailSample, TrailSampleBatch } from './types'

const PHYSICS_DT = 0.0015
const MAX_STEPS_PER_FRAME = 4000
const TRAIL_SAMPLE_INTERVAL = 0.01
const COLLISION_CHECK_INTERVAL_MS = 60
const COLLISION_ALERT_HOLD_MS = 4200
const COLLISION_MISS_GRACE_MS = 180
const COLLISION_CONFIRMATION_COUNT = 2
const COLLISION_REPLAY_LEAD_TIME = 1.2
const COLLISION_WATCH_MUTE_MS = 12000
const MIN_BODY_SCALE = 0.25
const MAX_BODY_SCALE = 4
const LANGUAGE_STORAGE_KEY = '3bp-language'
const TRAIL_ENABLED_STORAGE_KEY = '3bp-trail-enabled'
const TRAIL_DURATION_STORAGE_KEY = '3bp-trail-duration'
const SPACE_MODE_STORAGE_KEY = '3bp-space-mode'
const SHOWCASE_DEFAULT_BY_BODY_COUNT: Partial<Record<BodyCount, PresetId>> = {
  4: 'quadNested',
  5: 'pentaNested',
  6: 'hexaNested',
}

type CollisionReplaySnapshot = {
  pairKey: string
  bodies: BodyState[]
  time: number
}

type CollisionConfirmation = {
  pairKey: string
  count: number
}

type BodyScaleBaseline = {
  mass: number
  radius: number
}

function cloneBodies(input: BodyState[]) {
  return input.map((body) => ({
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
  }))
}

function isScalableBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

function createBodyScaleBaseline(input: BodyState[], scale = 1) {
  const safeScale = Math.max(scale, 1e-9)
  return new Map<string, BodyScaleBaseline>(
    input
      .filter(isScalableBody)
      .map((body) => [body.id, { mass: body.mass / safeScale, radius: body.radius / safeScale }]),
  )
}

function getInitialLanguage(): Language {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return saved === 'en' ? 'en' : 'ko'
}

function getInitialTrailEnabled() {
  return localStorage.getItem(TRAIL_ENABLED_STORAGE_KEY) !== 'false'
}

function getInitialTrailDuration() {
  const saved = Number(localStorage.getItem(TRAIL_DURATION_STORAGE_KEY))
  return Number.isFinite(saved) && saved >= 1 && saved <= 60 ? saved : 8
}

function getInitialSpaceMode(): SpaceMode {
  return localStorage.getItem(SPACE_MODE_STORAGE_KEY) === '2d' ? '2d' : '3d'
}

function isBodyDescendedFrom(bodyId: string, trackedBodyId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return trackedBodyId.split('+').every((part) => bodyParts.has(part))
}

export default function App() {
  const [preset, setPreset] = useState<PresetId>('figure8')
  const [bodyCount, setBodyCount] = useState<BodyCount>(3)
  const [spaceMode, setSpaceMode] = useState<SpaceMode>(getInitialSpaceMode)
  const [bodies, setBodies] = useState<BodyState[]>(() => applyPresetBodyTypes('figure8', getPreset('figure8')))
  const [isRunning, setIsRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [bodyScale, setBodyScale] = useState(1)
  const [time, setTime] = useState(0)
  const [trailVersion, setTrailVersion] = useState(0)
  const [trailEnabled, setTrailEnabled] = useState(getInitialTrailEnabled)
  const [trailDuration, setTrailDuration] = useState(getInitialTrailDuration)
  const [trailSampleBatch, setTrailSampleBatch] = useState<TrailSampleBatch>({ sequence: 0, samples: [] })
  const [trackedBodyId, setTrackedBodyId] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>(getInitialLanguage)
  const [collisionPrediction, setCollisionPrediction] = useState<CollisionPrediction | null>(null)
  const [collisionReplayReady, setCollisionReplayReady] = useState(false)

  const bodiesRef = useRef(bodies)
  const runningRef = useRef(isRunning)
  const speedRef = useRef(speed)
  const bodyScaleRef = useRef(1)
  const bodyScaleBaselineRef = useRef(createBodyScaleBaseline(bodies))
  const trailEnabledRef = useRef(trailEnabled)
  const simulationTimeRef = useRef(0)
  const nextTrailSampleAtRef = useRef(0)
  const trailSampleQueueRef = useRef<TrailSample[]>([])
  const trailBatchSequenceRef = useRef(0)
  const collisionPredictionRef = useRef<CollisionPrediction | null>(null)
  const collisionConfirmationRef = useRef<CollisionConfirmation | null>(null)
  const collisionReplayRef = useRef<CollisionReplaySnapshot | null>(null)
  const collisionLastSeenAtRef = useRef(0)
  const nextCollisionCheckAtRef = useRef(0)
  const collisionWatchMuteUntilRef = useRef(0)
  const t = translations[language]

  useEffect(() => { bodiesRef.current = bodies }, [bodies])
  useEffect(() => { runningRef.current = isRunning }, [isRunning])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language === 'ko' ? 'ko' : 'en'
  }, [language])
  useEffect(() => {
    localStorage.setItem(SPACE_MODE_STORAGE_KEY, spaceMode)
  }, [spaceMode])
  useEffect(() => {
    trailEnabledRef.current = trailEnabled
    trailSampleQueueRef.current = []
    nextTrailSampleAtRef.current = simulationTimeRef.current
    localStorage.setItem(TRAIL_ENABLED_STORAGE_KEY, String(trailEnabled))
  }, [trailEnabled])
  useEffect(() => {
    localStorage.setItem(TRAIL_DURATION_STORAGE_KEY, String(trailDuration))
  }, [trailDuration])
  useEffect(() => {
    setTrackedBodyId((current) => {
      if (!current) return null
      if (bodies.some((body) => body.id === current)) return current

      const largestDescendant = bodies
        .filter((body) => body.bodyType !== 'effect' && isBodyDescendedFrom(body.id, current))
        .reduce<BodyState | null>(
          (largest, body) => (!largest || body.mass > largest.mass ? body : largest),
          null,
        )

      return largestDescendant?.id ?? null
    })
  }, [bodies])

  const resetTrailSampling = useCallback((startTime: number) => {
    simulationTimeRef.current = startTime
    nextTrailSampleAtRef.current = startTime
    trailSampleQueueRef.current = []
    trailBatchSequenceRef.current += 1
    setTrailSampleBatch({ sequence: trailBatchSequenceRef.current, samples: [] })
  }, [])

  const clearCollisionWarning = useCallback(() => {
    collisionPredictionRef.current = null
    collisionConfirmationRef.current = null
    collisionReplayRef.current = null
    collisionLastSeenAtRef.current = 0
    nextCollisionCheckAtRef.current = 0
    collisionWatchMuteUntilRef.current = 0
    setCollisionPrediction(null)
    setCollisionReplayReady(false)
  }, [])

  const loadPreset = useCallback((nextPreset: PresetId, mode: SpaceMode = spaceMode) => {
    setPreset(nextPreset)
    setBodyCount(getPresetBodyCount(nextPreset))
    const raw = mode === '3d'
      ? getOrbital3dPresetOverride(nextPreset) ?? getPreset(nextPreset)
      : getOrbital2dPresetOverride(nextPreset) ?? getPreset(nextPreset)
    const next = applyPresetBodyTypes(nextPreset, raw)
    bodyScaleRef.current = 1
    bodyScaleBaselineRef.current = createBodyScaleBaseline(next)
    setBodyScale(1)
    bodiesRef.current = next
    setBodies(next)
    setTrackedBodyId(next.length === 1 ? next[0].id : null)
    setTime(0)
    setIsRunning(false)
    resetTrailSampling(0)
    clearCollisionWarning()
    setTrailVersion((v) => v + 1)
  }, [clearCollisionWarning, resetTrailSampling, spaceMode])

  const changeSpaceMode = useCallback((mode: SpaceMode) => {
    if (mode === spaceMode) return
    setSpaceMode(mode)
    loadPreset(preset, mode)
  }, [loadPreset, preset, spaceMode])

  const changeBodyCount = useCallback((count: BodyCount) => {
    loadPreset(SHOWCASE_DEFAULT_BY_BODY_COUNT[count] ?? DEFAULT_PRESET_BY_BODY_COUNT[count])
  }, [loadPreset])

  const reset = useCallback(() => loadPreset(preset), [loadPreset, preset])

  const updateBody = useCallback((id: string, next: BodyState) => {
    setIsRunning(false)
    if (isScalableBody(next)) {
      const scale = Math.max(bodyScaleRef.current, 1e-9)
      bodyScaleBaselineRef.current.set(id, {
        mass: next.mass / scale,
        radius: next.radius / scale,
      })
    }
    setBodies((current) => {
      const updated = current.map((body) => (body.id === id ? next : body))
      bodiesRef.current = updated
      return updated
    })
    clearCollisionWarning()
    resetTrailSampling(simulationTimeRef.current)
    setTrailVersion((v) => v + 1)
  }, [clearCollisionWarning, resetTrailSampling])

  const changeBodyScale = useCallback((nextScale: number) => {
    if (!Number.isFinite(nextScale)) return
    const clamped = Math.min(MAX_BODY_SCALE, Math.max(MIN_BODY_SCALE, nextScale))
    const previousScale = Math.max(bodyScaleRef.current, 1e-9)
    if (Math.abs(clamped - previousScale) < 1e-9) return

    const baselines = new Map(bodyScaleBaselineRef.current)
    const nextBodies = bodiesRef.current.map((body) => {
      if (!isScalableBody(body)) return body

      const baseline = baselines.get(body.id) ?? {
        mass: body.mass / previousScale,
        radius: body.radius / previousScale,
      }
      baselines.set(body.id, baseline)

      return {
        ...body,
        mass: Math.max(0.001, baseline.mass * clamped),
        radius: Math.max(0.005, baseline.radius * clamped),
      }
    })

    bodyScaleBaselineRef.current = baselines
    bodyScaleRef.current = clamped
    setBodyScale(clamped)
    bodiesRef.current = nextBodies
    setBodies(nextBodies)
    runningRef.current = false
    setIsRunning(false)
    clearCollisionWarning()
    resetTrailSampling(simulationTimeRef.current)
    setTrailVersion((v) => v + 1)
  }, [clearCollisionWarning, resetTrailSampling])

  const watchCollision = useCallback(() => {
    const prediction = collisionPredictionRef.current
    if (!prediction) return

    const exactA = bodiesRef.current.find((body) => body.id === prediction.bodyAId)
    const exactB = bodiesRef.current.find((body) => body.id === prediction.bodyBId)
    const collisionAlreadyHappened =
      !exactA ||
      !exactB ||
      (exactA.collisionCooldown ?? 0) > 0 ||
      (exactB.collisionCooldown ?? 0) > 0
    const replay = collisionAlreadyHappened && collisionReplayRef.current?.pairKey === prediction.pairKey
      ? collisionReplayRef.current
      : null

    let watchBodies = bodiesRef.current
    if (replay) {
      watchBodies = cloneBodies(replay.bodies)
      bodiesRef.current = watchBodies
      setBodies(watchBodies)
      setTime(replay.time)
      resetTrailSampling(replay.time)
      setTrailVersion((value) => value + 1)
    }

    const candidates = watchBodies.filter((body) =>
      body.id === prediction.bodyAId ||
      body.id === prediction.bodyBId ||
      isBodyDescendedFrom(body.id, prediction.bodyAId) ||
      isBodyDescendedFrom(body.id, prediction.bodyBId),
    )
    const target = candidates.reduce<BodyState | null>(
      (largest, body) => (!largest || body.mass > largest.mass ? body : largest),
      null,
    )
    if (target) setTrackedBodyId(target.id)

    speedRef.current = 0.1
    runningRef.current = true
    setSpeed(0.1)
    setIsRunning(true)

    collisionWatchMuteUntilRef.current = performance.now() + COLLISION_WATCH_MUTE_MS
    collisionPredictionRef.current = null
    collisionConfirmationRef.current = null
    collisionReplayRef.current = null
    collisionLastSeenAtRef.current = 0
    setCollisionPrediction(null)
    setCollisionReplayReady(false)
  }, [resetTrailSampling])

  useEffect(() => {
    let animationFrame = 0
    let previous = performance.now()
    let accumulator = 0
    let publishAccumulator = 0

    const tick = (now: number) => {
      animationFrame = requestAnimationFrame(tick)
      const realDelta = Math.min((now - previous) / 1000, 0.05)
      previous = now
      if (!runningRef.current) return

      if (now >= nextCollisionCheckAtRef.current && now >= collisionWatchMuteUntilRef.current) {
        nextCollisionCheckAtRef.current = now + COLLISION_CHECK_INTERVAL_MS
        const horizon = Math.min(6, Math.max(0.8, speedRef.current * 1.2))
        const upcoming = predictUpcomingCollision(bodiesRef.current, horizon)

        if (upcoming) {
          const previousConfirmation = collisionConfirmationRef.current
          const confirmationCount = previousConfirmation?.pairKey === upcoming.pairKey
            ? previousConfirmation.count + 1
            : 1
          collisionConfirmationRef.current = {
            pairKey: upcoming.pairKey,
            count: confirmationCount,
          }

          if (confirmationCount >= COLLISION_CONFIRMATION_COUNT || upcoming.timeToImpact <= 0.2) {
            const previousPrediction = collisionPredictionRef.current
            if (previousPrediction?.pairKey !== upcoming.pairKey) {
              collisionReplayRef.current = null
              setCollisionReplayReady(false)
            }

            collisionPredictionRef.current = upcoming
            collisionLastSeenAtRef.current = now
            setCollisionPrediction(upcoming)

            if (
              upcoming.timeToImpact <= COLLISION_REPLAY_LEAD_TIME &&
              collisionReplayRef.current?.pairKey !== upcoming.pairKey
            ) {
              collisionReplayRef.current = {
                pairKey: upcoming.pairKey,
                bodies: cloneBodies(bodiesRef.current),
                time: simulationTimeRef.current,
              }
              setCollisionReplayReady(true)
            }
          }
        } else {
          collisionConfirmationRef.current = null
          const activePrediction = collisionPredictionRef.current
          if (activePrediction) {
            const exactAExists = bodiesRef.current.some((body) => body.id === activePrediction.bodyAId)
            const exactBExists = bodiesRef.current.some((body) => body.id === activePrediction.bodyBId)
            const pairStillExists = exactAExists && exactBExists
            const holdMs = pairStillExists ? COLLISION_MISS_GRACE_MS : COLLISION_ALERT_HOLD_MS

            if (now - collisionLastSeenAtRef.current > holdMs) {
              collisionPredictionRef.current = null
              collisionReplayRef.current = null
              collisionLastSeenAtRef.current = 0
              setCollisionPrediction(null)
              setCollisionReplayReady(false)
            }
          }
        }
      }

      accumulator += realDelta * speedRef.current
      publishAccumulator += realDelta
      let steps = 0
      let advanced = 0
      let nextBodies = bodiesRef.current
      let simulationTime = simulationTimeRef.current

      while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        nextBodies = stepBodies(nextBodies, PHYSICS_DT)
        accumulator -= PHYSICS_DT
        advanced += PHYSICS_DT
        simulationTime += PHYSICS_DT
        steps += 1

        if (trailEnabledRef.current && simulationTime + 1e-12 >= nextTrailSampleAtRef.current) {
          const sampleTime = nextTrailSampleAtRef.current
          nextBodies.forEach((body) => {
            trailSampleQueueRef.current.push({
              bodyId: body.id,
              color: body.color,
              position: { ...body.position },
              simulatedAt: sampleTime,
            })
          })
          do {
            nextTrailSampleAtRef.current += TRAIL_SAMPLE_INTERVAL
          } while (nextTrailSampleAtRef.current <= simulationTime)
        }
      }

      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
      if (advanced > 0) {
        simulationTimeRef.current = simulationTime
        bodiesRef.current = nextBodies
        setTime(simulationTime)
      }

      if (publishAccumulator >= 1 / 30 && advanced > 0) {
        setBodies(nextBodies)
        if (trailSampleQueueRef.current.length > 0) {
          trailBatchSequenceRef.current += 1
          setTrailSampleBatch({
            sequence: trailBatchSequenceRef.current,
            samples: trailSampleQueueRef.current,
          })
          trailSampleQueueRef.current = []
        }
        publishAccumulator = 0
      }
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  return (
    <main className="app-shell">
      <label className="language-picker" title={t.language} aria-label={t.language}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 12h17M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.6 8.2 12S9.5 18.4 12 21" />
        </svg>
        <select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={t.language}>
          <option value="ko">{t.korean}</option>
          <option value="en">{t.english}</option>
        </select>
      </label>

      <section className="viewport-shell">
        <SimulationView
          bodies={bodies}
          simulationTime={time}
          trailVersion={trailVersion}
          trailEnabled={trailEnabled}
          trailDuration={trailDuration}
          trailSampleBatch={trailSampleBatch}
          trackedBodyId={trackedBodyId}
        />
        <div className="viewport-badge">
          <span className={isRunning ? 'status-dot running' : 'status-dot'} />
          <span>{isRunning ? `${speed}× ${t.running}` : t.paused}</span>
          <span aria-hidden="true">·</span>
          <span>{t.elapsedTime} {time.toFixed(2)}</span>
        </div>
        {collisionPrediction && (
          <CollisionAlert
            prediction={collisionPrediction}
            language={language}
            replayReady={collisionReplayReady}
            onWatch={watchCollision}
          />
        )}
      </section>
      <ControlPanel
        bodies={bodies}
        bodyCount={bodyCount}
        spaceMode={spaceMode}
        isRunning={isRunning}
        speed={speed}
        bodyScale={bodyScale}
        preset={preset}
        language={language}
        trailEnabled={trailEnabled}
        trailDuration={trailDuration}
        trackedBodyId={trackedBodyId}
        onTrailEnabledChange={setTrailEnabled}
        onTrailDurationChange={setTrailDuration}
        onTrackedBodyChange={setTrackedBodyId}
        onRunningChange={setIsRunning}
        onSpeedChange={setSpeed}
        onBodyScaleChange={changeBodyScale}
        onSpaceModeChange={changeSpaceMode}
        onBodyCountChange={changeBodyCount}
        onPresetChange={loadPreset}
        onReset={reset}
        onBodyChange={updateBody}
      />
    </main>
  )
}
