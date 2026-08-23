import type { BodyState, PresetId } from '../types'

type Props = {
  bodies: BodyState[]
  isRunning: boolean
  speed: number
  time: number
  preset: PresetId
  onRunningChange: (running: boolean) => void
  onSpeedChange: (speed: number) => void
  onPresetChange: (preset: PresetId) => void
  onReset: () => void
  onBodyChange: (id: string, next: BodyState) => void
}

const SPEEDS = [0.1, 1, 10, 100]
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
  onRunningChange,
  onSpeedChange,
  onPresetChange,
  onReset,
  onBodyChange,
}: Props) {
  return (
    <aside className="control-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">NEWTONIAN SIMULATOR</span>
          <h1>3 Body Problem</h1>
        </div>
        <span className="time-readout">t = {time.toFixed(2)}</span>
      </div>

      <div className="primary-controls">
        <button className="start-button" onClick={() => onRunningChange(!isRunning)}>
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button className="secondary-button" onClick={onReset}>Reset</button>
      </div>

      <section>
        <label className="section-label" htmlFor="preset">Preset</label>
        <select id="preset" value={preset} onChange={(event) => onPresetChange(event.target.value as PresetId)}>
          <option value="figure8">Figure-8</option>
          <option value="triangle">Rotating Triangle</option>
          <option value="random">Random</option>
        </select>
      </section>

      <section>
        <span className="section-label">Time scale</span>
        <div className="speed-grid">
          {SPEEDS.map((item) => (
            <button key={item} className={speed === item ? 'active' : ''} onClick={() => onSpeedChange(item)}>
              {item}×
            </button>
          ))}
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
                Name
                <input value={body.name} onChange={(e) => onBodyChange(body.id, { ...body, name: e.target.value })} />
              </label>
              <label>
                Color
                <input type="color" value={body.color} onChange={(e) => onBodyChange(body.id, { ...body, color: e.target.value })} />
              </label>
              <label>
                Mass
                <NumberField value={body.mass} step={0.05} onChange={(mass) => onBodyChange(body.id, { ...body, mass: Math.max(0.001, mass) })} />
              </label>
              <label>
                Radius
                <NumberField value={body.radius} step={0.005} onChange={(radius) => onBodyChange(body.id, { ...body, radius: Math.max(0.005, radius) })} />
              </label>
            </div>

            <span className="field-group-title">Position</span>
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

            <span className="field-group-title">Velocity</span>
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

      <p className="panel-note">Drag to orbit · Scroll/pinch to zoom · G = 1 normalized units</p>
    </aside>
  )
}
