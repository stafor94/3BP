import { useEffect, useRef, useState } from 'react'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import { SimulationView } from '../components/SimulationView'
import { stepBodies } from '../physics/fragmentAwareEngine'
import { stepBodies as stepStageTwoBodies } from '../physics/fragmentAwareEngineStageTwo'
import { resetCollisionSolidHandoffState } from '../rendering/collisionSolidHandoff'
import type { BodyState, Vec3 } from '../types'

const PHYSICS_DT = 0.0015
const SOURCE_ID = 'visual-solid-source'
const IMPACTOR_ID = 'visual-solid-impactor'
const SEEK_EPSILON = PHYSICS_DT * 0.25

type VisualScenario = 'default' | 'representative' | 'head-on' | 'oblique'
type EjectaBaseline = 'stage2' | 'stage3'
type PhysicsStepper = (input: BodyState[], dt: number) => BodyState[]

function getVisualOptions() {
  const params = new URLSearchParams(window.location.search)
  const requestedScenario = params.get('ejecta-scenario')
  const scenario: VisualScenario =
    requestedScenario === 'representative' ||
    requestedScenario === 'head-on' ||
    requestedScenario === 'oblique'
      ? requestedScenario
      : 'default'
  const baseline: EjectaBaseline = params.get('ejecta-baseline') === 'stage2'
    ? 'stage2'
    : 'stage3'
  return { scenario, baseline }
}

function makeDirectionalFixture(impactorVelocity: Vec3): BodyState[] {
  const sourceRadius = 0.0688
  const impactorRadius = 0.0187
  return [
    {
      id: SOURCE_ID,
      name: 'visual-solid-source',
      color: '#d49a63',
      mass: 0.35,
      radius: sourceRadius,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      bodyType: 'planet',
    },
    {
      id: IMPACTOR_ID,
      name: 'visual-solid-impactor',
      color: '#9fb8d7',
      mass: 0.0019,
      radius: impactorRadius,
      position: { x: sourceRadius + impactorRadius - 1e-6, y: 0, z: 0 },
      velocity: { ...impactorVelocity },
      bodyType: 'moon',
    },
  ]
}

function makeInitialBodies(scenario: VisualScenario): BodyState[] {
  if (scenario === 'representative') {
    return makeDirectionalFixture({ x: -0.21708, y: 2.4022115380623745, z: 0 })
  }
  if (scenario === 'head-on') {
    return makeDirectionalFixture({ x: -2.35, y: 0.12, z: 0 })
  }
  if (scenario === 'oblique') {
    return makeDirectionalFixture({ x: -1.35, y: 1.75, z: 0 })
  }

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

function cloneFrame(bodies: BodyState[]) {
  return bodies.map((body) => ({
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    collisionLineageIds: body.collisionLineageIds ? [...body.collisionLineageIds] : undefined,
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
    effectVisual: body.effectVisual
      ? {
          ...body.effectVisual,
          direction: { ...body.effectVisual.direction },
          normal: body.effectVisual.normal ? { ...body.effectVisual.normal } : undefined,
        }
      : undefined,
  }))
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

function runToRelativeImpactTime(
  scenario: VisualScenario,
  stepper: PhysicsStepper,
  secondsAfterImpact: number,
) {
  let frame = makeInitialBodies(scenario)
  let absoluteTime = 0
  let resolved = false
  const history: Array<{ frame: BodyState[]; absoluteTime: number }> = [
    { frame: cloneFrame(frame), absoluteTime },
  ]

  for (let step = 0; step < 5000; step += 1) {
    frame = stepper(frame, PHYSICS_DT)
    absoluteTime += PHYSICS_DT
    history.push({ frame: cloneFrame(frame), absoluteTime })
    if (hasPhysicalCollisionResult(frame)) {
      resolved = true
      break
    }
  }
  if (!resolved) throw new Error(`visual scenario ${scenario} did not resolve`)

  if (secondsAfterImpact < 0) {
    const stepsBack = Math.max(1, Math.round(Math.abs(secondsAfterImpact) / PHYSICS_DT))
    const index = Math.max(0, history.length - 1 - stepsBack)
    const snapshot = history[index]
    return {
      frame: snapshot.frame,
      absoluteTime: snapshot.absoluteTime,
      postImpactTime: -((history.length - 1 - index) * PHYSICS_DT),
    }
  }

  let postImpactTime = 0
  while (postImpactTime + PHYSICS_DT <= secondsAfterImpact + SEEK_EPSILON) {
    frame = stepper(frame, PHYSICS_DT)
    absoluteTime += PHYSICS_DT
    postImpactTime += PHYSICS_DT
  }

  return { frame, absoluteTime, postImpactTime }
}

declare global {
  interface Window {
    __startNonStellarDestructionVisual?: () => void
    __resetNonStellarDestructionVisual?: () => void
    __seekNonStellarDestructionVisual?: (secondsAfterImpact: number) => void
    __nonStellarDestructionVisualStage?: string
    __nonStellarDestructionVisualTime?: number
  }
}

export function NonStellarDestructionVisualHarness() {
  const [{ scenario, baseline }] = useState(getVisualOptions)
  const stepper = baseline === 'stage2' ? stepStageTwoBodies : stepBodies
  const [bodies, setBodies] = useState<BodyState[]>(() => makeInitialBodies(scenario))
  const bodiesRef = useRef(bodies)
  const [running, setRunning] = useState(false)
  const [simulationTime, setSimulationTime] = useState(0)
  bodiesRef.current = bodies

  useEffect(() => {
    resetCollisionSolidHandoffState()
    window.__startNonStellarDestructionVisual = () => setRunning(true)
    window.__resetNonStellarDestructionVisual = () => {
      resetCollisionSolidHandoffState()
      const initial = makeInitialBodies(scenario)
      bodiesRef.current = initial
      setBodies(initial)
      setSimulationTime(0)
      setRunning(false)
    }
    window.__seekNonStellarDestructionVisual = (secondsAfterImpact: number) => {
      resetCollisionSolidHandoffState()
      const seek = runToRelativeImpactTime(
        scenario,
        stepper,
        secondsAfterImpact,
      )
      bodiesRef.current = seek.frame
      setBodies(seek.frame)
      setSimulationTime(seek.absoluteTime)
      window.__nonStellarDestructionVisualTime = seek.postImpactTime
      setRunning(false)
    }
    return () => {
      delete window.__startNonStellarDestructionVisual
      delete window.__resetNonStellarDestructionVisual
      delete window.__seekNonStellarDestructionVisual
      delete window.__nonStellarDestructionVisualStage
      delete window.__nonStellarDestructionVisualTime
      delete document.body.dataset.visualStage
    }
  }, [scenario, stepper])

  useEffect(() => {
    if (!running) return
    let frame = 0
    const tick = () => {
      const next = stepper(bodiesRef.current, PHYSICS_DT)
      bodiesRef.current = next
      setBodies(next)
      setSimulationTime((time) => time + PHYSICS_DT)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, stepper])

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
      data-ejecta-baseline={baseline}
      data-ejecta-scenario={scenario}
      data-physics-source={baseline === 'stage2'
        ? 'fragmentAwareEngineStageTwo.stepBodies'
        : 'fragmentAwareEngine.stepBodies'}
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
