import { useEffect, useRef, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import { stepBodies } from '../physics/fragmentAwareEngine'
import { resetCollisionSolidHandoffState } from '../rendering/collisionSolidHandoff'
import type { BodyState } from '../types'

const PHYSICS_DT = 0.0015
const SOURCE_A_ID = 'artifact-small-a'
const SOURCE_B_ID = 'artifact-small-b'

function makeInitialBodies(): BodyState[] {
  const massA = 0.00199
  const massB = 0.001
  const relativeSpeed = 0.4717
  const totalMass = massA + massB
  return [
    {
      id: SOURCE_A_ID,
      name: 'Small moon A',
      color: '#a77b5c',
      mass: massA,
      radius: 0.0187,
      position: { x: -0.028, y: 0, z: 0 },
      velocity: { x: relativeSpeed * massB / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
    {
      id: SOURCE_B_ID,
      name: 'Small moon B',
      color: '#806c5d',
      mass: massB,
      radius: 0.0175,
      position: { x: 0.028, y: 0, z: 0 },
      velocity: { x: -relativeSpeed * massA / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
  ]
}

declare global {
  interface Window {
    __startSmallHeadOnCollisionArtifactVisual?: () => void
    __resetSmallHeadOnCollisionArtifactVisual?: () => void
    __smallHeadOnCollisionArtifactStage?: string
  }
}

export function SmallHeadOnCollisionArtifactHarness() {
  const [bodies, setBodies] = useState<BodyState[]>(() => makeInitialBodies())
  const bodiesRef = useRef(bodies)
  const [running, setRunning] = useState(false)
  const [simulationTime, setSimulationTime] = useState(0)
  bodiesRef.current = bodies

  useEffect(() => {
    window.__startSmallHeadOnCollisionArtifactVisual = () => setRunning(true)
    window.__resetSmallHeadOnCollisionArtifactVisual = () => {
      resetCollisionSolidHandoffState()
      const initial = makeInitialBodies()
      bodiesRef.current = initial
      setBodies(initial)
      setSimulationTime(0)
      setRunning(false)
    }
    return () => {
      delete window.__startSmallHeadOnCollisionArtifactVisual
      delete window.__resetSmallHeadOnCollisionArtifactVisual
      delete window.__smallHeadOnCollisionArtifactStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    if (!running) return
    let frame = 0
    const tick = () => {
      const next = stepBodies(bodiesRef.current, PHYSICS_DT)
      bodiesRef.current = next
      setBodies(next)
      setSimulationTime((time) => time + PHYSICS_DT)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running])

  const resolved = bodies.some((body) => body.id.includes(SOURCE_A_ID) && body.id.includes(SOURCE_B_ID))
  const stage = resolved ? 'collision' : 'contact'
  useEffect(() => {
    window.__smallHeadOnCollisionArtifactStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="small-head-on-collision-artifacts"
      data-stage={stage}
      data-physics-source="fragmentAwareEngine.stepBodies"
      data-physical-source-count={bodies.filter((body) =>
        body.id === SOURCE_A_ID || body.id === SOURCE_B_ID).length}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={simulationTime}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={resolved ? null : SOURCE_A_ID}
        collisionCameraFocus={null}
      />
    </div>
  )
}
