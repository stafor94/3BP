import { useEffect, useState } from 'react'
import { resolveCollisionWatchOutcome, type CollisionWatchOutcome } from '../collisionWatch'
import { translations, type Language } from '../i18n'
import type { BodyState, BodyType } from '../types'
import '../collision-watch-info.css'

export type CollisionWatchBodyInfo = {
  sourceId: string
  sourceName: string
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
  bodies: BodyState[]
  language: Language
}

type CachedOutcome = {
  pairKey: string
  outcome: CollisionWatchOutcome
}

function formatValue(value: number) {
  if (!Number.isFinite(value)) return '0'
  const digits = Math.abs(value) >= 10 ? 2 : Math.abs(value) >= 1 ? 3 : 4
  return value.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

function getOutcomeLabel(outcome: CollisionWatchOutcome, language: Language) {
  const t = translations[language]
  switch (outcome) {
    case 'merge': return t.collisionWatchOutcomeMerge
    case 'hitAndRun': return t.collisionWatchOutcomeHitAndRun
    case 'partialDisruption': return t.collisionWatchOutcomePartialDisruption
    case 'disrupt': return t.collisionWatchOutcomeDisrupt
    case 'hitRun': return t.collisionWatchOutcomeHitRun
    case 'mergeOrAbsorb': return t.collisionWatchOutcomeMergeOrAbsorb
  }
}

export function CollisionWatchInfo({ details, bodies, language }: Props) {
  const t = translations[language]
  const impacted = details.impactObservedAt !== null
  const resolvedOutcome = impacted
    ? resolveCollisionWatchOutcome(
        bodies,
        details.bodyA.sourceId,
        details.bodyB.sourceId,
        details.bodyA.type,
        details.bodyB.type,
      )
    : null
  const [cachedOutcome, setCachedOutcome] = useState<CachedOutcome | null>(null)

  useEffect(() => {
    if (!resolvedOutcome) return
    setCachedOutcome({ pairKey: details.pairKey, outcome: resolvedOutcome })
  }, [details.pairKey, resolvedOutcome])

  const outcome = resolvedOutcome ?? (
    cachedOutcome?.pairKey === details.pairKey ? cachedOutcome.outcome : null
  )

  const renderBody = (body: CollisionWatchBodyInfo) => (
    <article className="collision-watch-body-card">
      <span className="collision-watch-body-color" style={{ backgroundColor: body.color }} aria-hidden="true" />
      <div className="collision-watch-body-main">
        <span className="collision-watch-body-type">{t[body.type]}</span>
        <strong title={body.name}>{body.sourceName}</strong>
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
        {impacted && (
          <span className={`collision-watch-outcome${outcome ? ' resolved' : ''}`}>
            <span>{t.collisionWatchOutcome}</span>
            <strong>{outcome ? getOutcomeLabel(outcome, language) : t.collisionWatchOutcomePending}</strong>
          </span>
        )}
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
