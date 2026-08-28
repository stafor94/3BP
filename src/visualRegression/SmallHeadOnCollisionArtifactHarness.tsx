import { useEffect, useMemo, useState } from 'react'
import { SimulationView } from '../components/SimulationView'
import type { BodyState } from '../types'

type VisualStage = 'contact' | 'collision'

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

const source = body('artifact-small-a', 'moon', 0.022, 0.024, -0.0235, 0, '#a77b5c')
const impactor = body('artifact-small-b', 'moon', 0.018, 0.023, 0.0235, 0, '#806c5d')
source.velocity = { x: 0.82, y: 0, z: 0 }
impactor.velocity = { x: -1.0, y: 0, z: 0 }

const resultId = `${source.id}+${impactor.id}`
const result = body(resultId, 'moon', 0.025, 0.025, 0, 0, '#916f58')
result.velocity = { x: 0.001, y: 0, z: 0 }

const impactFlash = body(`${resultId}+flash`, 'effect', 0, 0.055, 0, 0, '#c38b64')
impactFlash.velocity = { ...result.velocity }
impactFlash.age = 0
impactFlash.lifetime = 0.72
impactFlash.effectVisual = {
  kind: 'contactFlash',
  direction: { x: 0, y: 1, z: 0 },
  normal: { x: 1, y: 0, z: 0 },
  stretch: 3.6,
  widthScale: 0.29,
  brightness: 1.92,
  turbulence: 0.12,
  pulseStrength: 0.08,
  stellarCollision: false,
  sourceMaxRadius: 0.024,
}

const fragments: BodyState[] = [
  body(`${resultId}+fragment-0`, 'fragment', 0.0065, 0.0082, -0.012, 0.001, '#7e6250'),
  body(`${resultId}+fragment-1`, 'fragment', 0.0045, 0.0072, 0.012, -0.001, '#a47d61'),
  body(`${resultId}+fragment-2`, 'fragment', 0.0030, 0.0064, -0.005, -0.002, '#725849'),
]
fragments[0].velocity = { x: -0.18, y: 0.004, z: 0 }
fragments[1].velocity = { x: 0.22, y: -0.003, z: 0 }
fragments[2].velocity = { x: 0.11, y: 0.002, z: 0 }
fragments.forEach((fragment) => { fragment.age = 0 })

const CONTACT_BODIES = [source, impactor]

declare global {
  interface Window {
    __startSmallHeadOnCollisionArtifactVisual?: () => void
    __resetSmallHeadOnCollisionArtifactVisual?: () => void
    __smallHeadOnCollisionArtifactStage?: string
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
    age: bodyState.bodyType === 'fragment' || bodyState.bodyType === 'effect'
      ? elapsedSeconds
      : bodyState.age,
  }
}

export function SmallHeadOnCollisionArtifactHarness() {
  const [stage, setStage] = useState<VisualStage>('contact')
  const [elapsedMs, setElapsedMs] = useState(0)

  const bodies = useMemo(() => {
    if (stage === 'contact') return CONTACT_BODIES
    const elapsedSeconds = elapsedMs / 1000
    return [
      advance(result, elapsedSeconds),
      ...fragments.map((fragment) => advance(fragment, elapsedSeconds)),
      ...(elapsedSeconds <= 0.72 ? [advance(impactFlash, elapsedSeconds)] : []),
    ]
  }, [stage, elapsedMs])

  useEffect(() => {
    window.__startSmallHeadOnCollisionArtifactVisual = () => {
      setElapsedMs(0)
      setStage('collision')
    }
    window.__resetSmallHeadOnCollisionArtifactVisual = () => {
      setStage('contact')
      setElapsedMs(0)
    }
    return () => {
      delete window.__startSmallHeadOnCollisionArtifactVisual
      delete window.__resetSmallHeadOnCollisionArtifactVisual
      delete window.__smallHeadOnCollisionArtifactStage
      delete document.body.dataset.visualStage
    }
  }, [])

  useEffect(() => {
    if (stage !== 'collision') return
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
    window.__smallHeadOnCollisionArtifactStage = stage
    document.body.dataset.visualStage = stage
  }, [stage])

  return (
    <div
      data-visual-regression="small-head-on-collision-artifacts"
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
        trackedBodyId={stage === 'contact' ? source.id : result.id}
        collisionCameraFocus={null}
      />
    </div>
  )
}
