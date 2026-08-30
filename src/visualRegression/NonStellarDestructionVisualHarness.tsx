import { useEffect, useRef, useState } from 'react'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import { SimulationView } from '../components/SimulationView'
import { stepBodies } from '../physics/fragmentAwareEngine'
import { resetCollisionSolidHandoffState } from '../rendering/collisionSolidHandoff'
import type { BodyState } from '../types'

const PHYSICS_DT = 0.0015
const SOURCE_ID = 'visual-solid-source'
const IMPACTOR_ID = 'visual-solid-impactor'

function makeInitialBodies(): BodyState[] {
  const sourceMass = 1
  const impactorMass = 0.18
  const relativeSpeed = 5.2
  const totalMass = sourceMass + impactorMass

  return [
    {
      id: SOURCE_ID,
      name: 'visual-solid-source',
      color: '#d49a63',
      mass: sourceMass,
      radius: 0.28,
      position: { x: -0.25, y: 0, z: 0 },
      velocity: { x: relativeSpeed * impactorMass / totalMass, y: 0, z: 0 },
      bodyType: 'planet',
    },
    {
      id: IMPACTOR_ID,
      name: 'visual-solid-impactor',
      color: '#9fb8d7',
      mass: impactorMass,
      radius: 0.105,
      position: { x: 0.25, y: 0.015, z: 0 },
      velocity: { x: -relativeSpeed * sourceMass / totalMass, y: 0, z: 0 },
      bodyType: 'moon',
    },
  ]
}

function hasPhysicalCollisionResult(bodies: BodyState[]) {
  const lineageRemnant = bodies.some((body) =>
    body.bodyType !== 'effect' && body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, SOURCE_ID) &&
    bodyCarriesCollisionLineage(body, IMPACTOR_ID)
  )
  const physicalDebris = bodies.some((body) =>
    body.bodyType === 'fragment' || (body.name === 'Collision spark' && body.mass > 0)
  )
  return lineageRemnant || physicalDebris
}

declare global {
  interface Window {
    __startNonStellarDestructionVisual?: () => void
    __resetNonStellarDestructionVisual?: () => void
    __nonStellarDestructionVisualStage?: string
  }
}

export function NonStellarDestructionVisualHarness() {
  const [bodies, setBodies] = useState<BodyState[]>(() => makeInitialBodies())
  const bodiesRef = useRef(bodies)
  const [running, setRunning] = useState(false)
  const [simulationTime, setSimulationTime] = useState(0)
  bodiesRef.current = bodies

  useEffect(() => {
    resetCollisionSolidHandoffState()
    window.__startNonStellarDestructionVisual = () => setRunning(true)
    window.__resetNonStellarDestructionVisual = () => {
      resetCollisionSolidHandoffState()
      const initial = makeInitialBodies()
      bodiesRef.current = initial
      setBodies(initial)
      setSimulationTime(0)
      setRunning(false)
    }
    return () => {
      delete window.__startNonStellarDestructionVisual
      delete window.__resetNonStellarDestructionVisual
      delete window.__nonStellarDestructionVisualStage
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

  const resolved = hasPhysicalCollisionResult(bodies)
  const stage = resolved ? 'destruction' : 'contact'
  const physicalDebrisCount = bodies.filter((body) =>
    body.bodyType === 'fragment' || (body.name === 'Collision spark' && body.mass > 0)
  ).length

  useEffect(() => {
    window.__nonStellarDestructionVisualStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="non-stellar-destruction"
      data-stage={stage}
      data-physics-source="fragmentAwareEngine.stepBodies"
      data-physical-debris-count={physicalDebrisCount}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={simulationTime}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={resolved ? null : SOURCE_ID}
        collisionCameraFocus={null}
      />
    </div>
  )
}
