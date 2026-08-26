import { useEffect, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import type { BodyState } from '../types'

type VisualStage = 'separate' | 'peak' | 'remnant'

function makeStar(id: string, x: number, color: string): BodyState {
  return {
    id,
    name: id,
    color,
    mass: 1,
    radius: 0.3,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
}

const STAGE_BODIES: Record<VisualStage, BodyState[]> = {
  separate: [
    makeStar('visual-a', -0.44, '#ff6b4a'),
    makeStar('visual-b', 0.44, '#6f9cff'),
  ],
  peak: [
    makeStar('visual-a', -0.246, '#ff6b4a'),
    makeStar('visual-b', 0.246, '#6f9cff'),
  ],
  remnant: [
    {
      id: 'visual-a+visual-b',
      name: 'visual-remnant',
      color: '#ff815f',
      mass: 1.94,
      radius: 0.38,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      bodyType: 'star',
      stellarCollisionOutcome: 'merge',
    },
  ],
}

function isVisualStage(value: string): value is VisualStage {
  return value === 'separate' || value === 'peak' || value === 'remnant'
}

declare global {
  interface Window {
    __setStellarVisualStage?: (stage: string) => void
    __stellarVisualStage?: string
  }
}

export function StellarTopologyVisualHarness() {
  const [stage, setStage] = useState<VisualStage>('separate')

  useEffect(() => {
    window.__setStellarVisualStage = (nextStage: string) => {
      if (!isVisualStage(nextStage)) throw new Error(`Unknown visual-regression stage: ${nextStage}`)
      setStage(nextStage)
    }

    return () => {
      delete window.__setStellarVisualStage
      delete window.__stellarVisualStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    window.__stellarVisualStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="stellar-topology"
      data-stage={stage}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={STAGE_BODIES[stage]}
        simulationTime={stage === 'separate' ? 0 : stage === 'peak' ? 0.02 : 0.04}
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
