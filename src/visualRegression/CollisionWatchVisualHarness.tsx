import { useEffect, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import { stepBodies as stepCoreBodies } from '../physics/engine'
import type { BodyState, Vec3 } from '../types'

type VisualStage = 'camera' | 'head-on' | 'grazing'

type StageFixture = {
  bodies: BodyState[]
  pairKey: string
  bodyAId: string
  bodyBId: string
  simulationTime: number
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  position: Vec3,
  velocity: Vec3,
  color: string,
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position,
    velocity,
    bodyType: 'star',
  }
}

const cameraA = makeStar(
  'watch-camera-a',
  1.2,
  0.3,
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  '#ffb267',
)
const cameraB = makeStar(
  'watch-camera-b',
  0.8,
  0.22,
  { x: 0.82, y: 0.12, z: 0 },
  { x: 0, y: 0.35, z: 0 },
  '#83afff',
)

const headOnA = makeStar(
  'watch-head-a',
  1,
  0.3,
  { x: -0.2999995, y: 0, z: 0 },
  { x: 0.3, y: 0, z: 0 },
  '#ff805f',
)
const headOnB = makeStar(
  'watch-head-b',
  1,
  0.3,
  { x: 0.2999995, y: 0, z: 0 },
  { x: -0.3, y: 0, z: 0 },
  '#8ab7ff',
)

const grazingA = makeStar(
  'watch-graze-a',
  1,
  0.3,
  { x: 0, y: -0.2999995, z: 0 },
  { x: -1.65, y: 0.15, z: 0 },
  '#ff8b68',
)
const grazingB = makeStar(
  'watch-graze-b',
  1,
  0.3,
  { x: 0, y: 0.2999995, z: 0 },
  { x: 1.65, y: -0.15, z: 0 },
  '#b8d8ff',
)

const STAGES: Record<VisualStage, StageFixture> = {
  camera: {
    bodies: [cameraA, cameraB],
    pairKey: 'watch-camera-a~watch-camera-b',
    bodyAId: cameraA.id,
    bodyBId: cameraB.id,
    simulationTime: 0,
  },
  'head-on': {
    bodies: stepCoreBodies([headOnA, headOnB], 1e-8),
    pairKey: 'watch-head-a~watch-head-b',
    bodyAId: headOnA.id,
    bodyBId: headOnB.id,
    simulationTime: 0.03,
  },
  grazing: {
    bodies: stepCoreBodies([grazingA, grazingB], 1e-8),
    pairKey: 'watch-graze-a~watch-graze-b',
    bodyAId: grazingA.id,
    bodyBId: grazingB.id,
    simulationTime: 0.03,
  },
}

function isVisualStage(value: string): value is VisualStage {
  return value === 'camera' || value === 'head-on' || value === 'grazing'
}

declare global {
  interface Window {
    __setCollisionWatchVisualStage?: (stage: string) => void
    __collisionWatchVisualStage?: string
  }
}

export function CollisionWatchVisualHarness() {
  const [stage, setStage] = useState<VisualStage>('camera')
  const fixture = STAGES[stage]

  useEffect(() => {
    window.__setCollisionWatchVisualStage = (nextStage: string) => {
      if (!isVisualStage(nextStage)) throw new Error(`Unknown collision-watch visual stage: ${nextStage}`)
      setStage(nextStage)
    }

    return () => {
      delete window.__setCollisionWatchVisualStage
      delete window.__collisionWatchVisualStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    window.__collisionWatchVisualStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="collision-watch"
      data-stage={stage}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={fixture.bodies}
        simulationTime={fixture.simulationTime}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={null}
        collisionCameraFocus={{
          pairKey: fixture.pairKey,
          bodyAId: fixture.bodyAId,
          bodyBId: fixture.bodyBId,
        }}
      />
    </div>
  )
}
