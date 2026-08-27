import { useEffect, useMemo, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import type { BodyState } from '../types'

type VisualStage = 'contact' | 'destruction'

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

const source = body('moving-disruption-source', 'planet', 1, 0.28, -0.18, 0, '#d49a63')
const impactor = body('moving-disruption-impactor', 'planet', 0.7, 0.22, 0.31, 0.015, '#91acd0')
const result = body(
  'moving-disruption-source+moving-disruption-impactor',
  'planet',
  1.1,
  0.3,
  0.04,
  0.01,
  '#70c7a6',
)
result.velocity = { x: 0.52, y: -0.12, z: 0 }

const fragments: BodyState[] = [
  body(`${result.id}+fragment-0`, 'fragment', 0.35, 0.12, 0.01, 0.1, '#7892a8'),
  body(`${result.id}+fragment-1`, 'fragment', 0.25, 0.1, 0.1, -0.08, '#66788e'),
]
fragments[0].velocity = { x: 0.66, y: 0.02, z: 0 }
fragments[1].velocity = { x: 0.38, y: -0.26, z: 0 }
fragments.forEach((fragment) => { fragment.age = 0 })

const CONTACT_BODIES = [source, impactor]

declare global {
  interface Window {
    __startMovingDisruptionVisual?: () => void
    __resetMovingDisruptionVisual?: () => void
    __movingDisruptionVisualStage?: string
  }
}

function advance(bodyState: BodyState, elapsedSeconds: number): BodyState {
  return {
    ...bodyState,
    position: {
      x: bodyState.position.x + bodyState.velocity.x * elapsedSeconds,
      y: bodyState.position.y + bodyState.velocity.y * elapsedSeconds,
      z: bodyState.position.z + bodyState.velocity.z * elapsedSeconds,
    },
    velocity: { ...bodyState.velocity },
    age: bodyState.bodyType === 'fragment' ? elapsedSeconds : bodyState.age,
  }
}

export function MovingDisruptionVisualHarness() {
  const [stage, setStage] = useState<VisualStage>('contact')
  const [destructionElapsedMs, setDestructionElapsedMs] = useState(0)

  const bodies = useMemo(() => {
    if (stage === 'contact') return CONTACT_BODIES
    const elapsedSeconds = destructionElapsedMs / 1000
    return [
      advance(result, elapsedSeconds),
      ...fragments.map((fragment) => advance(fragment, elapsedSeconds)),
    ]
  }, [stage, destructionElapsedMs])

  useEffect(() => {
    window.__startMovingDisruptionVisual = () => {
      setDestructionElapsedMs(0)
      setStage('destruction')
    }
    window.__resetMovingDisruptionVisual = () => {
      setStage('contact')
      setDestructionElapsedMs(0)
    }
    return () => {
      delete window.__startMovingDisruptionVisual
      delete window.__resetMovingDisruptionVisual
      delete window.__movingDisruptionVisualStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    if (stage !== 'destruction') return
    const startedAt = performance.now()
    let animationFrame = 0
    const tick = () => {
      setDestructionElapsedMs(performance.now() - startedAt)
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [stage])

  useEffect(() => {
    window.__movingDisruptionVisualStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="actual-disruption"
      data-stage={stage}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={stage === 'contact' ? 0 : destructionElapsedMs / 1000}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={null}
        collisionCameraFocus={null}
      />
    </div>
  )
}
