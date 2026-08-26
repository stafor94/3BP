import { useEffect, useRef, useState } from 'react'
import { getEffectiveBodyType, normalizeBodyForType } from '../bodyTypes'
import { translations, type Language } from '../i18n'
import { PRESETS_BY_BODY_COUNT } from '../presets'
import {
  BODY_SCALE_OPTIONS,
  TRAIL_DURATION_MAX,
  TRAIL_DURATION_MIN,
  normalizeTrailDuration,
} from '../simulationSettings'
import {
  getStellarComputedProperties,
  STELLAR_EVOLUTION_STAGES,
} from '../starColors'
import {
  ATMOSPHERE_PRESETS,
  getResolvedSurfaceProfile,
  getSurfacePreset,
  getSurfacePresetsForBodyType,
} from '../surfacePresets'
import { findTrackingCandidate } from '../trackingSelection'
import type { BodyCount, BodyState, PresetId, SpaceMode, StellarEvolutionStage } from '../types'
import { APP_VERSION } from '../version'
import { BodyTypeSelector } from './BodyTypeSelector'
import '../body-scale-controls.css'
import '../mobile-controls.css'
import '../version.css'
import '../collision-watch-controls.css'
import '../stellar-surface-controls.css'

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

const STAGE_LABELS: Record<Language, Record<StellarEvolutionStage, string>> = {
  ko: {
    protostar: '원시성',
    mainSequence: '주계열성',
    subgiant: '준거성',
    giant: '거성',
    supergiant: '초거성',
    whiteDwarf: '백색왜성',
  },
  en: {
    protostar: 'Protostar',
    mainSequence: 'Main sequence',
    subgiant: 'Subgiant',
    giant: 'Giant',
    supergiant: 'Supergiant',
    whiteDwarf: 'White dwarf',
  },
}

function formatNumberValue(value: number) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : '0'
}

function formatScientific(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 100000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(2)
  }
  return Number(value.toFixed(2)).toLocaleString()
}

function formatScale(value: number) {
  return `${Number(value.toFixed(2))}×`
}

function getBodyScaleIndex(value: number) {
  return BODY_SCALE_OPTIONS.reduce((closestIndex, option, index) =>
    Math.abs(option - value) < Math.abs(BODY_SCALE_OPTIONS[closestIndex] - value)
      ? index
      : closestIndex,
  0)
}

function clonePanelBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
  }
}

function isInitialPanelBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect' && !body.id.includes('+')
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
  const bodyScaleIndex = getBodyScaleIndex(bodyScale)

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
        if (
          currentCandidate &&
          (currentCandidate.id === trackedBodyId || currentSource?.id === trackedBodyId)
        ) {
          return current
        }
      }

      const exactSource = panelBodies.find((body) => body.id === trackedBodyId)
      if (exactSource && findTrackingCandidate(bodies, exactSource.id)) return exactSource.id

      return panelBodies.find((body) =>
        findTrackingCandidate(bodies, body.id)?.id === trackedBodyId,
      )?.id ?? null
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
    const normalized = normalizeBodyForType(next, getEffectiveBodyType(next))
    panelBodyScaleRef.current = bodyScale
    setPanelBodies((current) => current.map((body) => (body.id === id ? clonePanelBody(normalized) : body)))
    onBodyChange(id, normalized)
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
            <output htmlFor="body-scale">{formatScale(bodyScale)}</output>
          </div>
          <input
            id="body-scale"
            className="body-scale-slider"
            type="range"
            min="0"
            max={BODY_SCALE_OPTIONS.length - 1}
            step="1"
            value={bodyScaleIndex}
            aria-label={t.bodyScale}
            onChange={(event) => onBodyScaleChange(BODY_SCALE_OPTIONS[Number(event.target.value)])}
          />
          <div className="body-scale-range" aria-hidden="true">
            <span>{formatScale(BODY_SCALE_OPTIONS[0])}</span>
            <small>{t.bodyScaleHint}</small>
            <span>{formatScale(BODY_SCALE_OPTIONS[BODY_SCALE_OPTIONS.length - 1])}</span>
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
              min={TRAIL_DURATION_MIN}
              max={TRAIL_DURATION_MAX}
              step="1"
              value={trailDuration}
              disabled={!trailEnabled}
              onChange={(event) => onTrailDurationChange(normalizeTrailDuration(Number(event.target.value)))}
            />
            <output htmlFor="trail-duration">{trailDuration} s</output>
          </div>
        </section>

        <div className="body-list">
          {panelBodies.map((body) => {
            const { candidate, canTrack } = getTrackingState(body)
            const isTracked = trackingSourceId === body.id && trackedBodyId !== null
            const bodyType = getEffectiveBodyType(body)
            const stellarProperties = bodyType === 'star' ? getStellarComputedProperties(body) : null
            const surfaceProfile = bodyType === 'planet' || bodyType === 'moon'
              ? getResolvedSurfaceProfile(body, bodyType)
              : null
            const displayColor = stellarProperties?.displayColor ?? surfaceProfile?.baseColor ?? body.color
            const surfaceOptions = bodyType === 'planet' || bodyType === 'moon'
              ? getSurfacePresetsForBodyType(bodyType)
              : []

            return (
              <details className="body-card" key={body.id} open={panelBodies.length <= 3}>
                <summary>
                  <span className="body-dot" style={{ background: displayColor, color: displayColor }} />
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
                  <label>
                    {t.mass}
                    <NumberField
                      value={body.mass}
                      step={0.05}
                      onChange={(mass) => handleBodyChange(body.id, { ...body, mass: Math.max(0.001, mass) })}
                    />
                  </label>
                </div>

                {stellarProperties ? (
                  <div className="stellar-editor">
                    <label className="stellar-select-row">
                      <span>{t.stellarEvolutionStage}</span>
                      <select
                        value={stellarProperties.stage}
                        onChange={(event) => handleBodyChange(body.id, {
                          ...body,
                          stellarEvolutionStage: event.target.value as StellarEvolutionStage,
                        })}
                      >
                        {STELLAR_EVOLUTION_STAGES.map((stage) => (
                          <option key={stage} value={stage}>{STAGE_LABELS[language][stage]}</option>
                        ))}
                      </select>
                    </label>

                    <label className="stellar-range-row">
                      <span>{t.stellarEvolutionPhase}</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={stellarProperties.phase01}
                        onChange={(event) => handleBodyChange(body.id, {
                          ...body,
                          stellarEvolutionPhase01: Number(event.target.value),
                        })}
                      />
                      <output>{stellarProperties.phase01.toFixed(2)}</output>
                    </label>

                    <label className="stellar-range-row">
                      <span>{t.stellarRadiusScale}</span>
                      <input
                        type="range"
                        min="0.2"
                        max="3"
                        step="0.02"
                        value={body.stellarRadiusScale ?? 1}
                        onChange={(event) => handleBodyChange(body.id, {
                          ...body,
                          stellarRadiusScale: Number(event.target.value),
                        })}
                      />
                      <output>{(body.stellarRadiusScale ?? 1).toFixed(2)}×</output>
                    </label>

                    <div className="stellar-readout-heading">{t.stellarProperties}</div>
                    <dl className="stellar-readout-grid">
                      <div>
                        <dt>{t.estimatedLuminosity}</dt>
                        <dd>{formatScientific(stellarProperties.luminositySolar)} L☉</dd>
                      </div>
                      <div>
                        <dt>{t.estimatedRadius}</dt>
                        <dd>{formatScientific(stellarProperties.radiusSolar)} R☉</dd>
                      </div>
                      <div>
                        <dt>{t.coreTemperature}</dt>
                        <dd>{formatScientific(stellarProperties.coreTemperatureK)} K</dd>
                      </div>
                      <div>
                        <dt>{t.surfaceTemperature}</dt>
                        <dd>{Math.round(stellarProperties.surfaceTemperatureK).toLocaleString()} K</dd>
                      </div>
                      <div>
                        <dt>{t.spectralClass}</dt>
                        <dd>{stellarProperties.spectralClass}</dd>
                      </div>
                      <div>
                        <dt>{t.displayColor}</dt>
                        <dd className="stellar-color-readout">
                          <span style={{ backgroundColor: stellarProperties.displayColor }} />
                          <code>{stellarProperties.displayColor.toUpperCase()}</code>
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <div className="surface-editor">
                    <label>
                      {t.surfacePreset}
                      <select
                        value={surfaceProfile?.id ?? ''}
                        onChange={(event) => {
                          const selected = getSurfacePreset(event.target.value as BodyState['surfacePresetId'])
                          handleBodyChange(body.id, {
                            ...body,
                            surfacePresetId: selected?.id,
                            atmospherePresetId: bodyType === 'planet'
                              ? selected?.defaultAtmosphere
                              : body.atmospherePresetId,
                          })
                        }}
                      >
                        {surfaceOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {language === 'ko' ? option.nameKo : option.nameEn}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="surface-variation-row">
                      <span>{t.surfaceVariation}</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={body.surfaceVariant01 ?? 0.5}
                        onChange={(event) => handleBodyChange(body.id, {
                          ...body,
                          surfaceVariant01: Number(event.target.value),
                        })}
                      />
                      <output>{(body.surfaceVariant01 ?? 0.5).toFixed(2)}</output>
                    </label>
                    {bodyType === 'planet' && (
                      <label>
                        {t.atmosphere}
                        <select
                          value={body.atmospherePresetId ?? surfaceProfile?.defaultAtmosphere ?? 'none'}
                          onChange={(event) => handleBodyChange(body.id, {
                            ...body,
                            atmospherePresetId: event.target.value as BodyState['atmospherePresetId'],
                          })}
                        >
                          {ATMOSPHERE_PRESETS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {language === 'ko' ? option.nameKo : option.nameEn}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {t.radius}
                      <NumberField
                        value={body.radius}
                        step={0.005}
                        onChange={(radius) => handleBodyChange(body.id, { ...body, radius: Math.max(0.005, radius) })}
                      />
                    </label>
                  </div>
                )}

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
