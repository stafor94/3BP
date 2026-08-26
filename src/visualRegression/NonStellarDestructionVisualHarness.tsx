import { useEffect, useState } from 'react'
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

const source = body('visual-solid-source', 'planet', 1, 0.28, 0, 0, '#d49a63')
// Deliberately high source velocity is a regression stressor. The destruction
// handoff must preserve the exact collision transform rather than extrapolating
// a replacement sphere from velocity, which previously swept across the camera.
source.velocity = { x: 4.5, y: -2.6, z: 0 }
const impactor = body('visual-solid-impactor', 'moon', 0.18, 0.105, 0.365, 0.015, '#9fb8d7')
const anchor = body('visual-solid-anchor', 'planet', 0.75, 0.22, -0.78, 0.2, '#d9c68a')

const fragments: BodyState[] = [
  body('visual-solid-source+visual-solid-impactor+fragment-0', 'fragment', 0.21, 0.12, 0.04, 0.015, '#c99267'),
  body('visual-solid-source+visual-solid-impactor+fragment-1', 'fragment', 0.13, 0.09, -0.06, 0.05, '#bb815d'),
  body('visual-solid-source+visual-solid-impactor+fragment-2', 'fragment', 0.08, 0.067, 0.03, -0.075, '#a76f54'),
  body('visual-solid-source+visual-solid-impactor+fragment-3', 'fragment', 0.045, 0.052, -0.1, -0.025, '#d2a47e'),
]
fragments.forEach((fragment, index) => {
  const direction = index % 2 === 0 ? 1 : -1
  fragment.velocity = {
    x: direction * (0.22 + index * 0.04),
    y: (index - 1.5) * 0.07,
    z: 0,
  }
  fragment.age = 0
})

const CONTACT_BODIES = [source, impactor, anchor]
const RESULT_BODIES = [impactor, anchor, ...fragments]

declare global {
  interface Window {
    __startNonStellarDestructionVisual?: () => void
    __resetNonStellarDestructionVisual?: () => void
    __nonStellarDestructionVisualStage?: string
  }
}

export function NonStellarDestructionVisualHarness() {
  const [stage, setStage] = useState<VisualStage>('contact')
  const bodies = stage === 'contact' ? CONTACT_BODIES : RESULT_BODIES

  useEffect(() => {
    window.__startNonStellarDestructionVisual = () => setStage('destruction')
    window.__resetNonStellarDestructionVisual = () => setStage('contact')
    return () => {
      delete window.__startNonStellarDestructionVisual
      delete window.__resetNonStellarDestructionVisual
      delete window.__nonStellarDestructionVisualStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    window.__nonStellarDestructionVisualStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="non-stellar-destruction"
      data-stage={stage}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    >
      <SimulationView
        bodies={bodies}
        simulationTime={stage === 'contact' ? 0 : 0.03}
        trailVersion={0}
        trailEnabled={false}
        trailDuration={8}
        trailSampleBatch={{ sequence: 0, samples: [] }}
        trackedBodyId={source.id}
        collisionCameraFocus={null}
      />
    </div>
  )
}
