import { useState } from 'react'
import { translations, type Language } from '../i18n'
import type { BodyState, PresetId } from '../types'

type Props = {
  bodies: BodyState[]
  isRunning: boolean
  speed: number
  time: number
  preset: PresetId
  language: Language
  trailEnabled: boolean
  trailDuration: number
  onTrailEnabledChange: (enabled: boolean) => void
  onTrailDurationChange: (duration: number) => void
  onRunningChange: (running: boolean) => void
  onSpeedChange: (speed: number) => void
  onPresetChange: (preset: PresetId) => void
  onReset: () => void
  onBodyChange: (id: string, next: BodyState) => void
}

const SPEEDS = [0.1, 1, 5, 10]
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
  isRunning,
  speed,
  time,
  preset,
  language,
  trailEnabled,
  trailDuration,
  onTrailEnabledChange,
  onTrailDurationChange,
  onRunningChange,
  onSpeedChange,
  onPresetChange,
  onReset,
  onBodyChange,
}: Props) {
  const t = translations[language]
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <aside className={`control-panel${isCollapsed ? ' collapsed' : ''}`}>
      <div className="panel-header">
        <div>
          <span className="eyebrow">{t.simulator}</span>
          <h1>3 Body Problem</h1>
        </div>
        <div className="panel-header-actions">
          <span className="time-readout">t = {time.toFixed(2)}</span>
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setIsCollapsed((value) => !value)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? t.expand : t.collapse}
          >
            <span aria-hidden="true">{isCollapsed ? '⌃' : '⌄'}</span>
            {isCollapsed ? t.expand : t.collapse}
          </button>
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
          <label className="section-label" htmlFor="preset">{t.preset}</label>
          <select id="preset" value={preset} onChange={(event) => onPresetChange(event.target.value as PresetId)}>
            <option value="figure8">{t.figure8}</option>
            <option value="triangle">{t.triangle}</option>
            <option value="random">{t.random}</option>
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
          {bodies.map((body) => (
            <details className="body-card" key={body.id} open={bodies.length <= 3}>
              <summary>
                <span className="body-dot" style={{ background: body.color }} />
                <strong>{body.name}</strong>
                <span>{body.mass.toFixed(2)} M</span>
              </summary>

              <div className="body-fields">
                <label>
                  {t.name}
                  <input value={body.name} onChange={(e) => onBodyChange(body.id, { ...body, name: e.target.value })} />
                </label>
                <label>
                  {t.color}
                  <input type="color" value={body.color} onChange={(e) => onBodyChange(body.id, { ...body, color: e.target.value })} />
                </label>
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
          ))}
        </div>

        <p className="panel-note">{t.controlsHint}</p>
      </div>
    </aside>
  )
}
