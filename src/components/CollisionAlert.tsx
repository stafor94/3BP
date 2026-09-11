import { translations, type Language } from '../i18n'
import type { CollisionPrediction } from '../physics/collisionPrediction'
import type { BodyType } from '../types'
import '../collision-alert.css'

type Props = {
  prediction: CollisionPrediction
  language: Language
  replayReady: boolean
  onWatch: () => void
}

export function CollisionAlert({ prediction, language, replayReady, onWatch }: Props) {
  const t = translations[language]
  const seconds = prediction.timeToImpact < 0.05 ? null : prediction.timeToImpact
  const bodyTypeLabel = (bodyType: BodyType) => t[bodyType]

  return (
    <div className="collision-alert" role="alert" aria-live="assertive">
      <span className="collision-alert-pulse" aria-hidden="true" />
      <div className="collision-alert-copy">
        <strong>{t.collisionWarning}</strong>
        <span className="collision-alert-pair">
          <span className="collision-alert-body">
            <span className="collision-alert-type">{bodyTypeLabel(prediction.bodyAType)}</span>
            <span>{prediction.bodyAName}</span>
          </span>
          <span className="collision-alert-separator" aria-hidden="true">↔</span>
          <span className="collision-alert-body">
            <span className="collision-alert-type">{bodyTypeLabel(prediction.bodyBType)}</span>
            <span>{prediction.bodyBName}</span>
          </span>
        </span>
        <small>
          {seconds === null
            ? t.collisionImminent
            : `${t.collisionIn} ${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)} s`}
          {replayReady ? ` · ${t.collisionReplayReady}` : ''}
        </small>
      </div>
      <button type="button" className="collision-watch-button" onClick={onWatch}>
        {t.watchCollision}
      </button>
    </div>
  )
}
