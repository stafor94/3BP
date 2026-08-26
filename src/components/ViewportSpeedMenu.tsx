import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { translations, type Language } from '../i18n'
import {
  getTrackedBodyTelemetry,
  subscribeTrackedBodyTelemetry,
} from '../trackingTelemetry'
import type { BodyState } from '../types'
import '../tracked-body-info.css'

type Props = {
  isRunning: boolean
  speed: number
  time: number
  language: Language
  onSpeedChange: (speed: number) => void
}

const SPEEDS = [0.1, 0.5, 1, 2, 3, 5, 10]

function formatScalar(value: number, language: Language) {
  const absolute = Math.abs(value)
  if (absolute !== 0 && (absolute < 0.001 || absolute >= 10_000)) {
    return value.toExponential(2)
  }
  return new Intl.NumberFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    maximumFractionDigits: 4,
    maximumSignificantDigits: 5,
  }).format(value)
}

function getBodyTypeLabel(body: BodyState, language: Language) {
  const t = translations[language]
  const bodyType = body.bodyType ?? 'planet'
  if (bodyType === 'star') return t.star
  if (bodyType === 'moon') return t.moon
  if (bodyType === 'fragment') return t.fragment
  if (bodyType === 'effect') return t.effect
  return t.planet
}

export function ViewportSpeedMenu({
  isRunning,
  speed,
  time,
  language,
  onSpeedChange,
}: Props) {
  const t = translations[language]
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const trackedBody = useSyncExternalStore(
    subscribeTrackedBodyTelemetry,
    getTrackedBodyTelemetry,
    getTrackedBodyTelemetry,
  )

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const trackedVolume = trackedBody
    ? (4 / 3) * Math.PI * trackedBody.radius ** 3
    : null
  const trackedType = trackedBody ? getBodyTypeLabel(trackedBody, language) : null

  return (
    <div className="viewport-speed-menu" ref={rootRef}>
      <button
        type="button"
        className="viewport-badge"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t.timeScale}
        title={t.timeScale}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={isRunning ? 'status-dot running' : 'status-dot'} />
        <span>{isRunning ? `${speed}× ${t.running}` : t.paused}</span>
        <span aria-hidden="true">·</span>
        <span>{t.elapsedTime} {time.toFixed(2)}</span>
      </button>

      {trackedBody && trackedVolume !== null && trackedType && (
        <div
          className="viewport-tracked-body"
          aria-label={`${t.trackBody}: ${trackedBody.name}, ${trackedType}, ${t.mass} ${formatScalar(trackedBody.mass, language)}, ${language === 'ko' ? '부피' : 'Volume'} ${formatScalar(trackedVolume, language)}, ${t.radius} ${formatScalar(trackedBody.radius, language)}`}
        >
          <span className="tracked-body-identity">
            <strong title={trackedBody.name}>{trackedBody.name}</strong>
            <span className="tracked-body-type">{trackedType}</span>
          </span>
          <span className="tracked-body-metric mass">
            <span className="metric-label">{t.mass}</span>
            <span className="metric-short" aria-hidden="true">M</span>
            <b>{formatScalar(trackedBody.mass, language)}</b>
          </span>
          <span className="tracked-body-metric volume">
            <span className="metric-label">{language === 'ko' ? '부피' : 'Volume'}</span>
            <span className="metric-short" aria-hidden="true">V</span>
            <b>{formatScalar(trackedVolume, language)}</b>
          </span>
          <span className="tracked-body-metric radius">
            <span className="metric-label">{t.radius}</span>
            <span className="metric-short" aria-hidden="true">R</span>
            <b>{formatScalar(trackedBody.radius, language)}</b>
          </span>
        </div>
      )}

      {isOpen && (
        <div className="viewport-speed-dropdown" role="menu" aria-label={t.timeScale}>
          {SPEEDS.map((item) => {
            const isActive = speed === item
            return (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                className={isActive ? 'active' : ''}
                onClick={() => {
                  onSpeedChange(item)
                  setIsOpen(false)
                }}
              >
                {item}×
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
