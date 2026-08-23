import { useCallback, useEffect, useRef, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { SimulationView } from './components/SimulationView'
import { translations, type Language } from './i18n'
import { stepBodies } from './physics/engine'
import { getPreset } from './presets'
import type { BodyState, PresetId } from './types'

const PHYSICS_DT = 0.0015
const MAX_STEPS_PER_FRAME = 4000
const LANGUAGE_STORAGE_KEY = '3bp-language'

function getInitialLanguage(): Language {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return saved === 'en' ? 'en' : 'ko'
}

export default function App() {
  const [preset, setPreset] = useState<PresetId>('figure8')
  const [bodies, setBodies] = useState<BodyState[]>(() => getPreset('figure8'))
  const [isRunning, setIsRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const [trailVersion, setTrailVersion] = useState(0)
  const [language, setLanguage] = useState<Language>(getInitialLanguage)

  const bodiesRef = useRef(bodies)
  const runningRef = useRef(isRunning)
  const speedRef = useRef(speed)
  const t = translations[language]

  useEffect(() => { bodiesRef.current = bodies }, [bodies])
  useEffect(() => { runningRef.current = isRunning }, [isRunning])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language === 'ko' ? 'ko' : 'en'
  }, [language])

  const loadPreset = useCallback((nextPreset: PresetId) => {
    setPreset(nextPreset)
    const next = getPreset(nextPreset)
    bodiesRef.current = next
    setBodies(next)
    setTime(0)
    setIsRunning(false)
    setTrailVersion((v) => v + 1)
  }, [])

  const reset = useCallback(() => loadPreset(preset), [loadPreset, preset])

  const updateBody = useCallback((id: string, next: BodyState) => {
    setIsRunning(false)
    setBodies((current) => {
      const updated = current.map((body) => (body.id === id ? next : body))
      bodiesRef.current = updated
      return updated
    })
    setTrailVersion((v) => v + 1)
  }, [])

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

      while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        nextBodies = stepBodies(nextBodies, PHYSICS_DT)
        accumulator -= PHYSICS_DT
        advanced += PHYSICS_DT
        steps += 1
      }

      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
      if (advanced > 0) {
        bodiesRef.current = nextBodies
        setTime((value) => value + advanced)
      }

      if (publishAccumulator >= 1 / 30 && advanced > 0) {
        setBodies(nextBodies)
        publishAccumulator = 0
      }
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  return (
    <main className="app-shell">
      <section className="viewport-shell">
        <SimulationView bodies={bodies} trailVersion={trailVersion} />
        <div className="viewport-badge">
          <span className={isRunning ? 'status-dot running' : 'status-dot'} />
          {isRunning ? `${speed}× ${t.running}` : t.paused}
        </div>
      </section>
      <ControlPanel
        bodies={bodies}
        isRunning={isRunning}
        speed={speed}
        time={time}
        preset={preset}
        language={language}
        onLanguageChange={setLanguage}
        onRunningChange={setIsRunning}
        onSpeedChange={setSpeed}
        onPresetChange={loadPreset}
        onReset={reset}
        onBodyChange={updateBody}
      />
    </main>
  )
}
