import { translations, type Language } from '../i18n'
import type { BodyType } from '../types'
import '../collision-watch-info.css'

export type CollisionWatchBodyInfo = {
  id: string
  name: string
  type: BodyType
  color: string
  mass: number
  radius: number
}

export type CollisionWatchDetails = {
  pairKey: string
  bodyA: CollisionWatchBodyInfo
  bodyB: CollisionWatchBodyInfo
  closingSpeed: number
  impactObservedAt: number | null
}

type Props = {
  details: CollisionWatchDetails
  language: Language
}

function formatValue(value: number) {
  if (!Number.isFinite(value)) return '0'
  const digits = Math.abs(value) >= 10 ? 2 : Math.abs(value) >= 1 ? 3 : 4
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '')
}

export function CollisionWatchInfo({ details, language }: Props) {
  const t = translations[language]
  const impacted = details.impactObservedAt !== null

  const renderBody = (body: CollisionWatchBodyInfo) => (
    <article className="collision-watch-body-card">
      <span className="collision-watch-body-color" style={{ backgroundColor: body.color }} aria-hidden="true" />
      <div className="collision-watch-body-main">
        <span className="collision-watch-body-type">{t[body.type]}</span>
        <strong>{body.name}</strong>
      </div>
      <dl className="collision-watch-body-stats">
        <div>
          <dt>{t.mass}</dt>
          <dd>{formatValue(body.mass)}</dd>
        </div>
        <div>
          <dt>{t.radius}</dt>
          <dd>{formatValue(body.radius)}</dd>
        </div>
      </dl>
    </article>
  )

  return (
    <div className={`collision-watch-info${impacted ? ' impacted' : ''}`} role="status" aria-live="polite">
      <div className="collision-watch-info-header">
        <strong>{t.collisionWatch}</strong>
        <span className="collision-watch-phase">
          <span className="collision-watch-phase-dot" aria-hidden="true" />
          {impacted ? t.collisionWatchImpact : t.collisionWatchApproaching}
        </span>
        <small>{t.relativeSpeed} {formatValue(details.closingSpeed)}</small>
      </div>
      <div className="collision-watch-pair">
        {renderBody(details.bodyA)}
        <span className="collision-watch-pair-mark" aria-hidden="true">×</span>
        {renderBody(details.bodyB)}
      </div>
    </div>
  )
}
