import { useEffect, useRef, useState } from 'react'
import { translations, type Language } from '../i18n'
import { PRESETS_BY_BODY_COUNT } from '../presets'
import { formatStellarColorOption, getNearestStellarColor, STELLAR_COLOR_OPTIONS } from '../starColors'
import type { BodyCount, BodyState, PresetId, SpaceMode } from '../types'
import { APP_VERSION } from '../version'
import { BodyTypeSelector } from './BodyTypeSelector'
import '../body-scale-controls.css'
import '../mobile-controls.css'
import '../version.css'
import '../collision-watch-controls.css'

type Props = {
  bodies: BodyState[]
  bodyCount: BodyCount
  spaceMode: SpaceMode
  isRunning: boolean
  speed: number
  bodyScale: number
  preset: PresetId
  language: Language
  trailEnabled: boolean
  trailDuration: number
  trackedBodyId: string | null
  collisionWatchEnabled: boolean
  onTrailEnabledChange: (enabled: boolean) => void
  onTrailDurationChange: (duration: number) => void
  onTrackedBodyChange: (bodyId: string | null) => void
  onCollisionWatchEnabledChange: (enabled: boolean) => void
  onRunningChange: (running: boolean) => void
  onSpeedChange: (speed: number) => void
  onBodyScaleChange: (scale: number) => void
  onSpaceModeChange: (mode: SpaceMode) => void
  onBodyCountChange: (count: BodyCount) => void
  onPresetChange: (preset: PresetId) => void
  onReset: () => void
  onBodyChange: (id: string, next: BodyState) => void
}

const SPEEDS = [0.1, 0.5, 1, 2, 3, 5, 10]
const BODY_COUNTS: BodyCount[] = [1, 2, 3, 4, 5, 6]
const SPACE_MODES: SpaceMode[] = ['2d', '3d']
const TRACKING_MIN_MASS_RATIO = 0.5
const vectorKeys = ['x', 'y', 'z'] as const

function formatNumberValue(value: number) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : '0'
}

function clonePanelBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
  }
}

function isInitialPanelBody(body: BodyState) {
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

function NumberField({ value, onChange, step = 0.01 }: { value: number; onChange: (n: number) => void; step?: number }) {
  const [draft, setDraft] = useState(() => formatNumberValue(value))
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) setDraft(formatNumberValue(value))
  }, [value, isEditing])

  const commit = () => {
    setIsEditing(false)
    const trimmed = draft.trim()
    if (trimmed === '') {
      setDraft(formatNumberValue(value))
      return
    }

    const next = Number(trimmed)
    if (!Number.isFinite(next)) {
      setDraft(formatNumberValue(value))
      return
    }

    onChange(next)
  }

  return (
    <input
      type="number"
      value={draft}
      step={step}
      onFocus={() => setIsEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(formatNumberValue(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function ControlPanel({
  bodies,
  bodyCount,
  spaceMode,
  isRunning,
  speed,
  bodyScale,
  preset,
  language,
  trailEnabled,
  trailDuration,
  trackedBodyId,
  collisionWatchEnabled,
  onTrailEnabledChange,
  onTrailDurationChange,
  onTrackedBodyChange,
  onCollisionWatchEnabledChange,
  onRunningChange,
  onSpeedChange,
  onBodyScaleChange,
  onSpaceModeChange,
  onBodyCountChange,
  onPresetChange,
  onReset,
  onBodyChange,
}: Props) {
  const t = translations[language]
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [panelBodies, setPanelBodies] = useState<BodyState[]>(() =>
    bodies.filter(isInitialPanelBody).map(clonePanelBody),
  )
  const [trackingSourceId, setTrackingSourceId] = useState<string | null>(null)
  const previousRunningRef = useRef(isRunning)
  const setupKeyRef = useRef(`${preset}:${bodyCount}:${spaceMode}`)
  const hasStartedRef = useRef(false)
  const resetRequestedRef = useRef(false)
  const panelBodyScaleRef = useRef(bodyScale)
  const availablePresets = PRESETS_BY_BODY_COUNT[bodyCount]

  useEffect(() => {
    const setupKey = `${preset}:${bodyCount}:${spaceMode}`
    const setupChanged = setupKeyRef.current !== setupKey
    const startedNow = !previousRunningRef.current && isRunning
    const initialBodies = bodies.filter(isInitialPanelBody)
    const isCleanInitialSet = initialBodies.length === bodyCount && initialBodies.length === bodies.length

    if (setupChanged) {
      setupKeyRef.current = setupKey
      hasStartedRef.current = false
    }

    if (resetRequestedRef.current && !isRunning && isCleanInitialSet) {
      resetRequestedRef.current = false
      hasStartedRef.current = false
    }

    if (isCleanInitialSet && (setupChanged || startedNow || !hasStartedRef.current)) {
      panelBodyScaleRef.current = bodyScale
      setPanelBodies(initialBodies.map(clonePanelBody))
    }

    if (startedNow) hasStartedRef.current = true
    previousRunningRef.current = isRunning
  }, [bodies, bodyCount, bodyScale, isRunning, preset, spaceMode])

  useEffect(() => {
    setTrackingSourceId((current) => {
      if (!trackedBodyId) return null

      if (current) {
        const currentSource = panelBodies.find((body) => body.id === current)
        const currentCandidate = currentSource
          ? findTrackingCandidate(bodies, currentSource.id)
          : null
        if (currentCandidate?.id === trackedBodyId) return current
      }

      const exactSource = panelBodies.find((body) => body.id === trackedBodyId)
      if (exactSource) return exactSource.id

      return panelBodies.find((body) => isBodyDescendedFrom(trackedBodyId, body.id))?.id ?? null
    })
  }, [bodies, panelBodies, trackedBodyId])

  useEffect(() => {
    if (!trackingSourceId || !trackedBodyId) return

    const source = panelBodies.find((body) => body.id === trackingSourceId)
    if (!source) {
      setTrackingSourceId(null)
      onTrackedBodyChange(null)
      return
    }

    const candidate = findTrackingCandidate(bodies, source.id)
    const scaleRatio = bodyScale / Math.max(panelBodyScaleRef.current, 1e-9)
    const initialMassAtCurrentScale = source.mass * scaleRatio
    const canTrack = Boolean(
      candidate && candidate.mass > initialMassAtCurrentScale * TRACKING_MIN_MASS_RATIO + 1e-12,
    )

    if (!canTrack) {
      setTrackingSourceId(null)
      onTrackedBodyChange(null)
    }
  }, [bodies, bodyScale, onTrackedBodyChange, panelBodies, trackedBodyId, trackingSourceId])

  const handleReset = () => {
    resetRequestedRef.current = true
    setTrackingSourceId(null)
    onReset()
  }

  const handleBodyChange = (id: string, next: BodyState) => {
    panelBodyScaleRef.current = bodyScale
    setPanelBodies((current) => current.map((body) => (body.id === id ? clonePanelBody(next) : body)))
    onBodyChange(id, next)
  }

  const getTrackingState = (source: BodyState) => {
    const candidate = findTrackingCandidate(bodies, source.id)
    const scaleRatio = bodyScale / Math.max(panelBodyScaleRef.current, 1e-9)
    const initialMassAtCurrentScale = source.mass * scaleRatio
    const canTrack = Boolean(
      candidate && candidate.mass > initialMassAtCurrentScale * TRACKING_MIN_MASS_RATIO + 1e-12,
    )
    return { candidate, canTrack }
  }

  const selectTrackingSource = (source: BodyState) => {
    const { candidate, canTrack } = getTrackingState(source)
    if (!candidate || !canTrack) return

    setTrackingSourceId(source.id)
    onTrackedBodyChange(candidate.id)
  }

  return (
    <aside className={`control-panel${isCollapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="panel-toggle"
        onClick={() => setIsCollapsed((value) => !value)}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? t.expand : t.collapse}
        title={isCollapsed ? t.expand : t.collapse}
      >
        <svg viewBox="0 0 24 14" aria-hidden="true">
          <path d={isCollapsed ? 'M5 10.5 12 3.5l7 7' : 'M5 3.5 12 10.5l7-7'} />
        </svg>
      </button>

      <div className="panel-header">
        <div className="panel-title-block">
          <span className="eyebrow">{t.simulator}</span>
          <div className="title-line">
            <h1>3 Body Problem</h1>
            <span className="app-version" aria-label={`version ${APP_VERSION}`}>v{APP_VERSION}</span>
          </div>
        </div>
        <div className="panel-header-actions">
          <div className="collapsed-primary-controls" aria-hidden={!isCollapsed}>
            <button className="start-button" onClick={() => onRunningChange(!isRunning)}>
              {isRunning ? t.pause : t.start}
            </button>
            <button className="secondary-button" onClick={handleReset}>{t.reset}</button>
          </div>
        </div>
      </div>

      <div className="panel-content">
        <div className="primary-controls">
          <button className="start-button" onClick={() => onRunningChange(!isRunning)}>
            {isRunning ? t.pause : t.start}
          </button>
          <button className="secondary-button" onClick={handleReset}>{t.reset}</button>
          <label className={`collision-watch-toggle${collisionWatchEnabled ? ' active' : ''}`}>
            <input
              type="checkbox"
              checked={collisionWatchEnabled}
              onChange={(event) => onCollisionWatchEnabledChange(event.target.checked)}
            />
            <span>{t.collisionWatch}</span>
          </label>
        </div>

        <section>
          <div className="preset-heading-row">
            <label className="section-label" htmlFor="preset">{t.preset}</label>
            <div className="preset-control-groups">
              <div className="space-mode-control" role="group" aria-label={t.spaceMode}>
                {SPACE_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={spaceMode === mode ? 'active' : ''}
                    aria-pressed={spaceMode === mode}
                    title={mode === '2d' ? t.spaceMode2d : t.spaceMode3d}
                    onClick={() => onSpaceModeChange(mode)}
                  >
                    {mode === '2d' ? t.spaceMode2d : t.spaceMode3d}
                  </button>
                ))}
              </div>
              <div className="body-count-control" role="group" aria-label={t.bodyCount}>
                {BODY_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={bodyCount === count ? 'active' : ''}
                    aria-pressed={bodyCount === count}
                    title={`${t.bodyCount}: ${count}`}
                    onClick={() => onBodyCountChange(count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <select id="preset" value={preset} onChange={(event) => onPresetChange(event.target.value as PresetId)}>
            {availablePresets.map((item) => (
              <option key={item} value={item}>{t[item]}</option>
            ))}
          </select>
        </section>

        <section>
          <span className="section-label">{t.timeScale}</span>
          <div className="speed-grid">
            {SPEEDS.map((item) => (
              <button key={item} className={speed === item ? 'active' : ''} onClick={() => onSpeedChange(item)}>
                {item}×
              </button>
            ))}
          </div>
        </section>

        <section className="body-scale-section">
          <div className="body-scale-heading-row">
            <label className="section-label" htmlFor="body-scale">{t.bodyScale}</label>
            <output htmlFor="body-scale">{bodyScale.toFixed(2)}×</output>
          </div>
          <input
            id="body-scale"
            className="body-scale-slider"
            type="range"
            min="-2"
            max="2"
            step="0.05"
            value={Math.log2(bodyScale)}
            aria-label={t.bodyScale}
            onChange={(event) => onBodyScaleChange(2 ** Number(event.target.value))}
          />
          <div className="body-scale-range" aria-hidden="true">
            <span>0.25×</span>
            <small>{t.bodyScaleHint}</small>
            <span>4.00×</span>
          </div>
        </section>

        <section className="trail-section">
          <div className="trail-heading-row">
            <span className="section-label">{t.trail}</span>
            <label className="trail-toggle">
              <input
                type="checkbox"
                checked={trailEnabled}
                onChange={(event) => onTrailEnabledChange(event.target.checked)}
              />
              <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
              <span className="toggle-state">{trailEnabled ? t.on : t.off}</span>
            </label>
          </div>
          <div className={`trail-duration-row${trailEnabled ? '' : ' disabled'}`}>
            <label htmlFor="trail-duration">{t.trailDuration}</label>
            <input
              id="trail-duration"
              type="range"
              min="1"
              max="60"
              step="1"
              value={trailDuration}
              disabled={!trailEnabled}
              onChange={(event) => onTrailDurationChange(Math.min(60, Math.max(1, Number(event.target.value))))}
            />
            <output htmlFor="trail-duration">{trailDuration} s</output>
          </div>
        </section>

        <div className="body-list">
          {panelBodies.map((body) => {
            const { candidate, canTrack } = getTrackingState(body)
            const isTracked = trackingSourceId === body.id && trackedBodyId !== null
            const stellarColor = getNearestStellarColor(body.color)
            const bodyType = body.bodyType ?? 'planet'
            return (
              <details className="body-card" key={body.id} open={panelBodies.length <= 3}>
                <summary>
                  <span className="body-dot" style={{ background: stellarColor.hex, color: stellarColor.hex }} />
                  <span className="body-summary-type">{t[bodyType]}</span>
                  <strong>{body.name}</strong>
                  <span>{body.mass.toFixed(2)} M</span>
                </summary>

                <div className="body-track-row">
                  <span>
                    <strong>{t.trackBody}</strong>
                    <small>{t.trackBodyHint}</small>
                  </span>
                  <label className="body-track-check">
                    <input
                      type="checkbox"
                      checked={isTracked}
                      disabled={!canTrack}
                      aria-label={`${body.name} ${t.trackBody}`}
                      onChange={(event) => {
                        if (!event.target.checked) {
                          setTrackingSourceId(null)
                          onTrackedBodyChange(null)
                          return
                        }
                        if (candidate) selectTrackingSource(body)
                      }}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <BodyTypeSelector
                  body={body}
                  language={language}
                  onChange={(next) => handleBodyChange(body.id, next)}
                />

                <div className="body-fields">
                  <label>
                    {t.name}
                    <input value={body.name} readOnly aria-readonly="true" title={body.name} />
                  </label>
                  <div className="stellar-color-field">
                    <span>{t.color}</span>
                    <div className="stellar-color-picker" role="group" aria-label={t.color}>
                      {STELLAR_COLOR_OPTIONS.map((option) => {
                        const optionLabel = formatStellarColorOption(option, language)
                        const active = stellarColor.spectralClass === option.spectralClass
                        return (
                          <button
                            key={option.spectralClass}
                            type="button"
                            className={active ? 'active' : ''}
                            style={{ backgroundColor: option.hex }}
                            title={optionLabel}
                            aria-label={optionLabel}
                            aria-pressed={active}
                            onClick={() => handleBodyChange(body.id, { ...body, color: option.hex })}
                          />
                        )
                      })}
                    </div>
                  </div>
                  <label>
                    {t.mass}
                    <NumberField value={body.mass} step={0.05} onChange={(mass) => handleBodyChange(body.id, { ...body, mass: Math.max(0.001, mass) })} />
                  </label>
                  <label>
                    {t.radius}
                    <NumberField value={body.radius} step={0.005} onChange={(radius) => handleBodyChange(body.id, { ...body, radius: Math.max(0.005, radius) })} />
                  </label>
                </div>

                <span className="field-group-title">{t.position}</span>
                <div className="vector-grid">
                  {vectorKeys.map((key) => (
                    <label key={key}>
                      {key.toUpperCase()}
                      <NumberField
                        value={body.position[key]}
                        onChange={(value) => handleBodyChange(body.id, { ...body, position: { ...body.position, [key]: value } })}
                      />
                    </label>
                  ))}
                </div>

                <span className="field-group-title">{t.velocity}</span>
                <div className="vector-grid">
                  {vectorKeys.map((key) => (
                    <label key={key}>
                      V{key.toUpperCase()}
                      <NumberField
                        value={body.velocity[key]}
                        onChange={(value) => handleBodyChange(body.id, { ...body, velocity: { ...body.velocity, [key]: value } })}
                      />
                    </label>
                  ))}
                </div>

                <div className="coordinates">
                  x {body.position.x.toFixed(3)} · y {body.position.y.toFixed(3)} · z {body.position.z.toFixed(3)}
                </div>
              </details>
            )
          })}
        </div>

        <p className="panel-note">{t.controlsHint}</p>
      </div>
    </aside>
  )
}
