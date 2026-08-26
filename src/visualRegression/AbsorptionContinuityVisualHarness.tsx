import { useEffect, useMemo, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import { stepBodies } from '../physics/fragmentAwareEngine'
import type { BodyState } from '../types'

const PHYSICS_DT = 0.0015

function makeInitialBodies(): BodyState[] {
  const primary: BodyState = {
    id: 'visual-absorption-primary',
    name: 'Janus',
    color: '#c87545',
    mass: 0.35,
    radius: 0.0688,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }
  const impactor: BodyState = {
    id: 'visual-absorption-impactor',
    name: 'Luna',
    color: '#65cce2',
    mass: 0.0019,
    radius: 0.0187,
    position: { x: primary.radius + 0.0187 - 1e-6, y: 0, z: 0 },
    velocity: { x: -0.21708, y: 2.4022115380623745, z: 0 },
    bodyType: 'moon',
  }
  return [primary, impactor]
}

function simulateToStep(targetStep: number) {
  let bodies = makeInitialBodies()
  for (let step = 0; step < targetStep; step += 1) {
    bodies = stepBodies(bodies, PHYSICS_DT)
  }
  return bodies
}

declare global {
  interface Window {
    __setAbsorptionContinuityVisualStep?: (step: number) => void
    __absorptionContinuityVisualStep?: number
  }
}

export function AbsorptionContinuityVisualHarness() {
  const [visualStep, setVisualStep] = useState(0)
  const [bodies, setBodies] = useState<BodyState[]>(() => makeInitialBodies())

  const diagnostics = useMemo(() => {
    const impactor = bodies.find((body) => body.id === 'visual-absorption-impactor')
    const primary = bodies.find((body) => body.id === 'visual-absorption-primary')
    const remnant = bodies.find((body) =>
      body.bodyType !== 'effect' &&
      body.bodyType !== 'fragment' &&
      body.id.includes('visual-absorption-primary') &&
      body.id.includes('visual-absorption-impactor'),
    )
    const massCarryingEffects = bodies.filter((body) => body.bodyType === 'effect' && body.mass > 0)
    const solidFragments = bodies.filter((body) => body.bodyType === 'fragment')
    return {
      impactorRadius: impactor?.radius ?? 0,
      primaryRadius: primary?.radius ?? remnant?.radius ?? 0,
      remnantId: remnant?.id ?? '',
      massCarryingEffectCount: massCarryingEffects.length,
      solidFragmentCount: solidFragments.length,
      maxEffectStretch: massCarryingEffects.reduce(
        (max, body) => Math.max(max, body.effectVisual?.stretch ?? 1),
        0,
      ),
      maxEffectTail: massCarryingEffects.reduce(
        (max, body) => Math.max(max, body.effectVisual?.tailLength ?? 0),
        0,
      ),
    }
  }, [bodies])

  useEffect(() => {
    window.__setAbsorptionContinuityVisualStep = (requestedStep: number) => {
      const nextStep = Math.max(0, Math.min(24, Math.floor(requestedStep)))
      setBodies(simulateToStep(nextStep))
      setVisualStep(nextStep)
    }
    return () => {
      delete window.__setAbsorptionContinuityVisualStep
      delete window.__absorptionContinuityVisualStep
      delete document.body.dataset.visualStep
    }
  }, [])

  useEffect(() => {
    window.__absorptionContinuityVisualStep = visualStep
    document.body.dataset.visualStep = String(visualStep)
  }, [visualStep])

  const trackedBodyId = bodies.find((body) => body.bodyType === 'planet')?.id ?? null

  return (
    <div
      data-visual-regression="absorption-continuity"
      data-visual-step={visualStep}
      data-impactor-radius={diagnostics.impactorRadius}
      data-primary-radius={diagnostics.primaryRadius}
      data-remnant-id={diagnostics.remnantId}
      data-mass-effect-count={diagnostics.massCarryingEffectCount}
      data-solid-fragment-count={diagnostics.solidFragmentCount}
      data-max-effect-stretch={diagnostics.maxEffectStretch}
      data-max-effect-tail={diagnostics.maxEffectTail}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={visualStep * PHYSICS_DT}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={trackedBodyId}
        collisionCameraFocus={null}
      />
    </div>
  )
}
