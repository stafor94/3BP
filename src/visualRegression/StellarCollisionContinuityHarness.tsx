import { useEffect, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import { stepBodies } from '../physics/fragmentAwareEngine'
import type { BodyState } from '../types'

export function stellarCollisionFixture(kind: string): BodyState[] {
  const partial = kind === 'partial'
  const unequal = partial || kind === 'oblique'
  const radii = unequal ? [0.24, 0.32] : [0.3, 0.3]
  const speed = partial ? 1.05 : kind === 'hit-run' ? 0.15 : 0.3
  const tangent = partial ? 1.2 : kind === 'hit-run' ? 1.65 : kind === 'oblique' ? 0.35 : 0
  return radii.map((radius, i) => ({
    id: `continuity-${i}`, name: `Star ${i}`, bodyType: kind === 'solid' ? (i ? 'moon' : 'planet') : 'star',
    mass: unequal ? (i ? 1.3 : 0.6) : 1, radius,
    color: i ? '#fff4e8' : '#ffaf5f',
    position: { x: (i ? 1 : -1) * ((radii[0] + radii[1]) / 2 + 0.0001), y: 0, z: 0 },
    velocity: { x: (i ? -1 : 1) * speed, y: (i ? 1 : -1) * tangent, z: 0 },
  }))
}

declare global {
  interface Window {
    __collisionTest?: { advance: (dt: number) => void; reset: (kind: string) => void; bodies: BodyState[]; time: number }
  }
}

/** Deterministic input driver only: real production engine and SimulationView. */
export function StellarCollisionContinuityHarness() {
  const [frame, setFrame] = useState(() => ({ bodies: stellarCollisionFixture('oblique'), time: 0 }))
  useEffect(() => {
    window.__collisionTest = {
      ...frame,
      advance: (dt) => setFrame((old) => {
        let bodies = old.bodies
        const steps = Math.max(1, Math.ceil(dt / 0.0005))
        for (let i = 0; i < steps; i++) bodies = stepBodies(bodies, dt / steps)
        return { bodies, time: old.time + dt }
      }),
      reset: (kind) => setFrame({ bodies: stellarCollisionFixture(kind), time: 0 }),
    }
    return () => { delete window.__collisionTest }
  }, [frame])
  return <div style={{ position: 'fixed', inset: 0 }}>
    <SimulationView bodies={frame.bodies} simulationTime={frame.time} simulationSpeed={1}
      trailVersion={0} trailEnabled={false} trailDuration={8} trailSampleBatch={{ sequence: 0, samples: [] }}
      trackedBodyId={null} collisionCameraFocus={null} />
  </div>
}
