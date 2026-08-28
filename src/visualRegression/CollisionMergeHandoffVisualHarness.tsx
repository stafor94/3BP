import { useEffect, useMemo, useRef, useState } from 'react'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import { SimulationView } from '../components/SimulationView'
import { stepBodies } from '../physics/fragmentAwareEngine'
import { resetCollisionSolidHandoffState } from '../rendering/collisionSolidHandoff'
import type { BodyState } from '../types'

const PHYSICS_DT = 0.0015
const SOURCE_A_ID = 'merge-handoff-a'
const SOURCE_B_ID = 'merge-handoff-b'

function makeInitialBodies(): BodyState[] {
  const radiusA = 0.018
  const radiusB = 0.017
  const separation = radiusA + radiusB - 1e-6
  return [
    {
      id: SOURCE_A_ID,
      name: 'Aster',
      color: '#9a765d',
      mass: 0.02,
      radius: radiusA,
      position: { x: -separation * 0.5, y: 0, z: 0 },
      velocity: { x: 0.1, y: 0, z: 0 },
      bodyType: 'moon',
    },
    {
      id: SOURCE_B_ID,
      name: 'Beryl',
      color: '#6f91a5',
      mass: 0.02,
      radius: radiusB,
      position: { x: separation * 0.5, y: 0, z: 0 },
      velocity: { x: -0.1, y: 0, z: 0 },
      bodyType: 'moon',
    },
  ]
}

function findRemnant(bodies: BodyState[]) {
  return bodies.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, SOURCE_A_ID) &&
    bodyCarriesCollisionLineage(body, SOURCE_B_ID),
  )
}

declare global {
  interface Window {
    __advanceCollisionMergeHandoffStep?: () => void
    __resetCollisionMergeHandoffVisual?: () => void
    __collisionMergeHandoffPhysicsStep?: number
  }
}

export function CollisionMergeHandoffVisualHarness() {
  const [bodies, setBodies] = useState<BodyState[]>(() => makeInitialBodies())
  const bodiesRef = useRef(bodies)
  const [physicsStep, setPhysicsStep] = useState(0)
  const [resolvedAt, setResolvedAt] = useState<number | null>(null)
  const [, setRenderClock] = useState(0)
  bodiesRef.current = bodies

  const diagnostics = useMemo(() => {
    const remnant = findRemnant(bodies)
    const physical = bodies.filter((body) => body.bodyType !== 'effect')
    return {
      remnantId: remnant?.id ?? '',
      sourceAPresent: bodies.some((body) => body.id === SOURCE_A_ID),
      sourceBPresent: bodies.some((body) => body.id === SOURCE_B_ID),
      physicalBodyCount: physical.length,
      remnantMass: remnant?.mass ?? 0,
      remnantRadius: remnant?.radius ?? 0,
      remnantVx: remnant?.velocity.x ?? 0,
      remnantVy: remnant?.velocity.y ?? 0,
      remnantVz: remnant?.velocity.z ?? 0,
    }
  }, [bodies])

  useEffect(() => {
    window.__advanceCollisionMergeHandoffStep = () => {
      if (findRemnant(bodiesRef.current)) return
      const next = stepBodies(bodiesRef.current, PHYSICS_DT)
      bodiesRef.current = next
      setBodies(next)
      setPhysicsStep((current) => current + 1)
      if (findRemnant(next)) setResolvedAt(performance.now())
    }
    window.__resetCollisionMergeHandoffVisual = () => {
      resetCollisionSolidHandoffState()
      const initial = makeInitialBodies()
      bodiesRef.current = initial
      setBodies(initial)
      setPhysicsStep(0)
      setResolvedAt(null)
    }
    return () => {
      delete window.__advanceCollisionMergeHandoffStep
      delete window.__resetCollisionMergeHandoffVisual
      delete window.__collisionMergeHandoffPhysicsStep
      delete document.body.dataset.visualStep
    }
  }, [])

  useEffect(() => {
    window.__collisionMergeHandoffPhysicsStep = physicsStep
    document.body.dataset.visualStep = String(physicsStep)
  }, [physicsStep])

  useEffect(() => {
    if (resolvedAt === null) return
    let frame = 0
    const tick = () => {
      setRenderClock(performance.now())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [resolvedAt])

  return (
    <div
      data-visual-regression="collision-merge-handoff"
      data-physics-step={physicsStep}
      data-remnant-id={diagnostics.remnantId}
      data-source-a-present={diagnostics.sourceAPresent ? '1' : '0'}
      data-source-b-present={diagnostics.sourceBPresent ? '1' : '0'}
      data-physical-body-count={diagnostics.physicalBodyCount}
      data-remnant-mass={diagnostics.remnantMass}
      data-remnant-radius={diagnostics.remnantRadius}
      data-remnant-vx={diagnostics.remnantVx}
      data-remnant-vy={diagnostics.remnantVy}
      data-remnant-vz={diagnostics.remnantVz}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={physicsStep * PHYSICS_DT}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={SOURCE_A_ID}
        collisionCameraFocus={null}
      />
    </div>
  )
}
