import { useEffect, useRef, useState } from 'react'
import { translations, type Language } from '../i18n'

type Props = {
  isRunning: boolean
  speed: number
  time: number
  language: Language
  onSpeedChange: (speed: number) => void
}

const SPEEDS = [0.1, 0.5, 1, 2, 3, 5, 10]

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
