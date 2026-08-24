import { useState } from 'react'
import { translations, type Language } from '../i18n'
import { PRESETS_BY_BODY_COUNT } from '../presets'
import { formatStellarColorOption, getNearestStellarColor, STELLAR_COLOR_OPTIONS } from '../starColors'
import type { BodyCount, BodyState, PresetId, SpaceMode } from '../types'
import { APP_VERSION } from '../version'
import { BodyTypeSelector } from './BodyTypeSelector'
import '../mobile-controls.css'
import '../version.css'

type Props = {
  bodies: BodyState[]
  bodyCount: BodyCount
  spaceMode: SpaceMode
  isRunning: boolean
  speed: number
  preset: PresetId
  language: Language
  trailEnabled: boolean
  trailDuration: number
  trackedBodyId: string | null
  onTrailEnabledChange: (enabled: boolean) => void
  onTrailDurationChange: (duration: number) => void
  onTrackedBodyChange: (bodyId: string | null) => void
  onRunningChange: (running: boolean) => void
  onSpeedChange: (speed: number) => void
  onSpaceModeChange: (mode: SpaceMode) => void
  onBodyCountChange: (count: BodyCount) => void
  onPresetChange: (preset: PresetId) => void
  onReset: () => void
  onBodyChange: (id: string, next: BodyState) => void
}

const SPEEDS = [0.1, 1, 5, 10]
const BODY_COUNTS: BodyCount[] = [1, 2, 3, 4, 5, 6]
const SPACE_MODES: SpaceMode[] = ['2d', '3d']
const vectorKeys = ['x', 'y', 'z'] as const

function NumberField({ value, onChange, step = 0.01 }: { value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Number(value.toFixed(6)) : 0}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

export function ControlPanel({
  bodies,
  bodyCount,
  spaceMode,
  isRunning,
  speed,
  preset,
  language,
  trailEnabled,
  trailDuration,
  trackedBodyId,
  onTrailEnabledChange,
  onTrailDurationChange,
  onTrackedBodyChange,
  onRunningChange,
  onSpeedChange,
  onSpaceModeChange,
  onBodyCountChange,
  onPresetChange,
  onReset,
  onBodyChange,
}: Props) {
  const t = translations[language]
  const [isCollapsed, setIsCollapsed] = useState(false)
  const availablePresets = PRESETS_BY_BODY_COUNT[bodyCount]

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
            <button className="secondary-button" onClick={onReset}>{t.reset}</button>
          </div>
        </div>
      </div>

      <div className="panel-content">
        <div className="primary-controls">
          <button className="start-button" onClick={() => onRunningChange(!isRunning)}>
            {isRunning ? t.pause : t.start}
          </button>
          <button className="secondary-button" onClick={onReset}>{t.reset}</button>
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
          {bodies.map((body) => {
            const isTracked = trackedBodyId === body.id
            const stellarColor = getNearestStellarColor(body.color)
            return (
              <details className="body-card" key={body.id} open={bodies.length <= 3}>
                <summary>
                  <span className="body-dot" style={{ background: stellarColor.hex, color: stellarColor.hex }} />
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
                      aria-label={`${body.name} ${t.trackBody}`}
                      onChange={(event) => onTrackedBodyChange(event.target.checked ? body.id : null)}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <BodyTypeSelector
                  body={body}
                  language={language}
                  onChange={(next) => onBodyChange(body.id, next)}
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
                            onClick={() => onBodyChange(body.id, { ...body, color: option.hex })}
                          />
                        )
                      })}
                    </div>
                  </div>
                  <label>
                    {t.mass}
                    <NumberField value={body.mass} step={0.05} onChange={(mass) => onBodyChange(body.id, { ...body, mass: Math.max(0.001, mass) })} />
                  </label>
                  <label>
                    {t.radius}
                    <NumberField value={body.radius} step={0.005} onChange={(radius) => onBodyChange(body.id, { ...body, radius: Math.max(0.005, radius) })} />
                  </label>
                </div>

                <span className="field-group-title">{t.position}</span>
                <div className="vector-grid">
                  {vectorKeys.map((key) => (
                    <label key={key}>
                      {key.toUpperCase()}
                      <NumberField
                        value={body.position[key]}
                        onChange={(value) => onBodyChange(body.id, { ...body, position: { ...body.position, [key]: value } })}
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
                        onChange={(value) => onBodyChange(body.id, { ...body, velocity: { ...body.velocity, [key]: value } })}
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
