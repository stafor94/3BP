import { useCallback, useEffect, useRef, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { SimulationView } from './components/SimulationView'
import { getOrbital2dPresetOverride } from './orbital2dPresets'
import { getOrbital3dPresetOverride } from './orbital3dPresets'
import { translations, type Language } from './i18n'
import { stepBodies } from './physics/engine'
import { DEFAULT_PRESET_BY_BODY_COUNT, getPreset, getPresetBodyCount } from './presets'
import type { BodyCount, BodyState, PresetId, SpaceMode, TrailSample, TrailSampleBatch } from './types'

const PHYSICS_DT = 0.0015
const MAX_STEPS_PER_FRAME = 4000
const TRAIL_SAMPLE_INTERVAL = 0.01
const LANGUAGE_STORAGE_KEY = '3bp-language'
const TRAIL_ENABLED_STORAGE_KEY = '3bp-trail-enabled'
const TRAIL_DURATION_STORAGE_KEY = '3bp-trail-duration'
const SPACE_MODE_STORAGE_KEY = '3bp-space-mode'
const SHOWCASE_DEFAULT_BY_BODY_COUNT: Partial<Record<BodyCount, PresetId>> = {
  4: 'quadNested',
  5: 'pentaNested',
  6: 'hexaNested',
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
  const [bodies, setBodies] = useState<BodyState[]>(() => getPreset('figure8'))
  const [isRunning, setIsRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const [trailVersion, setTrailVersion] = useState(0)
  const [trailEnabled, setTrailEnabled] = useState(getInitialTrailEnabled)
  const [trailDuration, setTrailDuration] = useState(getInitialTrailDuration)
  const [trailSampleBatch, setTrailSampleBatch] = useState<TrailSampleBatch>({ sequence: 0, samples: [] })
  const [trackedBodyId, setTrackedBodyId] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>(getInitialLanguage)

  const bodiesRef = useRef(bodies)
  const runningRef = useRef(isRunning)
  const speedRef = useRef(speed)
  const trailEnabledRef = useRef(trailEnabled)
  const simulationTimeRef = useRef(0)
  const nextTrailSampleAtRef = useRef(0)
  const trailSampleQueueRef = useRef<TrailSample[]>([])
  const trailBatchSequenceRef = useRef(0)
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
      return bodies.find((body) => isBodyDescendedFrom(body.id, current))?.id ?? null
    })
  }, [bodies])

  const resetTrailSampling = useCallback((startTime: number) => {
    simulationTimeRef.current = startTime
    nextTrailSampleAtRef.current = startTime
    trailSampleQueueRef.current = []
    trailBatchSequenceRef.current += 1
    setTrailSampleBatch({ sequence: trailBatchSequenceRef.current, samples: [] })
  }, [])

  const loadPreset = useCallback((nextPreset: PresetId, mode: SpaceMode = spaceMode) => {
    setPreset(nextPreset)
    setBodyCount(getPresetBodyCount(nextPreset))
    const next = mode === '3d'
      ? getOrbital3dPresetOverride(nextPreset) ?? getPreset(nextPreset)
      : getOrbital2dPresetOverride(nextPreset) ?? getPreset(nextPreset)
    bodiesRef.current = next
    setBodies(next)
    setTrackedBodyId(next.length === 1 ? next[0].id : null)
    setTime(0)
    setIsRunning(false)
    resetTrailSampling(0)
    setTrailVersion((v) => v + 1)
  }, [resetTrailSampling, spaceMode])

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
    setBodies((current) => {
      const updated = current.map((body) => (body.id === id ? next : body))
      bodiesRef.current = updated
      return updated
    })
    resetTrailSampling(simulationTimeRef.current)
    setTrailVersion((v) => v + 1)
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
      </section>
      <ControlPanel
        bodies={bodies}
        bodyCount={bodyCount}
        spaceMode={spaceMode}
        isRunning={isRunning}
        speed={speed}
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
        onSpaceModeChange={changeSpaceMode}
        onBodyCountChange={changeBodyCount}
        onPresetChange={loadPreset}
        onReset={reset}
        onBodyChange={updateBody}
      />
    </main>
  )
}
