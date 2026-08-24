import { translations, type Language } from '../i18n'
import type { CollisionPrediction } from '../physics/collisionPrediction'
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

  return (
    <div className="collision-alert" role="alert" aria-live="assertive">
      <span className="collision-alert-pulse" aria-hidden="true" />
      <div className="collision-alert-copy">
        <strong>{t.collisionWarning}</strong>
        <span className="collision-alert-pair">{prediction.bodyAName} ↔ {prediction.bodyBName}</span>
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
