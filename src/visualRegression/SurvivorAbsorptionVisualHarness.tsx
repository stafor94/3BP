import { useEffect, useMemo, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import type { BodyState } from '../types'

type VisualStage = 'contact' | 'absorption'

function body(
  id: string,
  bodyType: BodyState['bodyType'],
  mass: number,
  radius: number,
  x: number,
  y: number,
  color: string,
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position: { x, y, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

const survivor = body('visual-survivor-primary', 'planet', 1, 0.28, 0, 0, '#d49a63')
const impactor = body('visual-survivor-impactor', 'moon', 0.08, 0.09, 0.37, 0, '#9fb8d7')
const remnant = body(
  'visual-survivor-primary+visual-survivor-impactor',
  'planet',
  1.04,
  0.28,
  0,
  0,
  '#d49a63',
)
remnant.trackingContinuationIds = [survivor.id]

const debris: BodyState[] = [
  body('visual-survivor-primary+visual-survivor-impactor+frag1-0', 'fragment', 0.024, 0.028, 0.31, 0.045, '#c99267'),
  body('visual-survivor-primary+visual-survivor-impactor+frag1-1', 'fragment', 0.016, 0.021, 0.33, -0.04, '#9c8272'),
]
debris[0].velocity = { x: 0.12, y: 0.17, z: 0 }
debris[1].velocity = { x: 0.16, y: -0.13, z: 0 }

const flash: BodyState = {
  id: 'visual-survivor-primary+visual-survivor-impactor+flash1',
  name: 'Collision flash',
  color: '#d49a63',
  mass: 0,
  radius: 0.07,
  position: { x: 0.28, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  bodyType: 'effect',
  age: 0,
  lifetime: 0.72,
  effectVisual: {
    kind: 'contactFlash',
    direction: { x: 0, y: 1, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    stretch: 2.8,
    widthScale: 0.34,
    brightness: 1.5,
    turbulence: 0.2,
    pulseStrength: 0.18,
    secondaryColor: impactor.color,
  },
}

const CONTACT_BODIES = [survivor, impactor]

declare global {
  interface Window {
    __startSurvivorAbsorptionVisual?: () => void
    __resetSurvivorAbsorptionVisual?: () => void
    __survivorAbsorptionVisualStage?: string
  }
}

export function SurvivorAbsorptionVisualHarness() {
  const [stage, setStage] = useState<VisualStage>('contact')
  const [elapsedMs, setElapsedMs] = useState(0)

  const bodies = useMemo(() => {
    if (stage === 'contact') return CONTACT_BODIES
    const elapsedSeconds = elapsedMs / 1000
    const movingDebris = debris.map((fragment) => ({
      ...fragment,
      position: {
        x: fragment.position.x + fragment.velocity.x * elapsedSeconds,
        y: fragment.position.y + fragment.velocity.y * elapsedSeconds,
        z: fragment.position.z + fragment.velocity.z * elapsedSeconds,
      },
      velocity: { ...fragment.velocity },
      age: elapsedSeconds,
    }))
    const activeFlash = elapsedSeconds < (flash.lifetime ?? 0.72)
      ? [{ ...flash, age: elapsedSeconds }]
      : []
    return [remnant, ...movingDebris, ...activeFlash]
  }, [stage, elapsedMs])

  useEffect(() => {
    window.__startSurvivorAbsorptionVisual = () => {
      setElapsedMs(0)
      setStage('absorption')
    }
    window.__resetSurvivorAbsorptionVisual = () => {
      setStage('contact')
      setElapsedMs(0)
    }
    return () => {
      delete window.__startSurvivorAbsorptionVisual
      delete window.__resetSurvivorAbsorptionVisual
      delete window.__survivorAbsorptionVisualStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    if (stage !== 'absorption') return
    const startedAt = performance.now()
    let animationFrame = 0
    const tick = () => {
      setElapsedMs(performance.now() - startedAt)
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [stage])

  useEffect(() => {
    window.__survivorAbsorptionVisualStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="survivor-absorption"
      data-stage={stage}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={stage === 'contact' ? 0 : elapsedMs / 1000}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={survivor.id}
        collisionCameraFocus={null}
      />
    </div>
  )
}
