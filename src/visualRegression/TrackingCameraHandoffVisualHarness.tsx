import { useEffect, useRef } from 'react'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import { stepBodies } from '../physics/fragmentAwareEngine'
import {
  createSimulationRenderer,
  type SimulationCameraTelemetry,
  type SimulationRenderState,
} from '../rendering/simulationRenderer'
import type { BodyState } from '../types'

type HandoffStage = 'tracking' | 'collision' | 'collision-result' | 'release'
type TimedCameraTelemetry = SimulationCameraTelemetry & { elapsedMs: number }

const SOURCE_ID = 'handoff-a'
const SECONDARY_ID = 'handoff-b'

function makeBody(
  id: string,
  mass: number,
  radius: number,
  position: BodyState['position'],
  velocity: BodyState['velocity'],
  color: string,
): BodyState {
  return {
    id,
    name: id,
    mass,
    radius,
    position,
    velocity,
    color,
    bodyType: 'planet',
  }
}

const sourceA = makeBody(
  SOURCE_ID,
  0.4013,
  0.0754,
  { x: -0.073, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  '#f0aa68',
)
const sourceB = makeBody(
  SECONDARY_ID,
  0.4013,
  0.0754,
  { x: 0.073, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  '#83afff',
)

function createPhysicalMergeFixture() {
  let bodies: BodyState[] = [sourceA, sourceB]
  for (let step = 0; step < 24; step += 1) bodies = stepBodies(bodies, 0.0015)

  const remnant = bodies.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, SOURCE_ID) &&
    bodyCarriesCollisionLineage(body, SECONDARY_ID),
  )
  if (!remnant) throw new Error('tracking-camera handoff fixture must produce a physical equal-mass merge remnant')
  if (remnant.id !== SOURCE_ID) {
    throw new Error('equal-mass merge must preserve the camera-primary source id')
  }
  if (
    !remnant.trackingContinuationIds?.includes(SOURCE_ID) ||
    !remnant.trackingContinuationIds?.includes(SECONDARY_ID)
  ) {
    throw new Error('physical merge remnant must explicitly continue both source tracking lineages')
  }
  return { bodies, remnant }
}

const physicalMerge = createPhysicalMergeFixture()
const remnant = physicalMerge.remnant

function makeTrailBatch(stage: HandoffStage): SimulationRenderState['trailSampleBatch'] {
  if (stage === 'tracking') return { sequence: 0, samples: [] }
  if (stage === 'collision') {
    return {
      sequence: 1,
      samples: [
        { bodyId: sourceA.id, color: sourceA.color, position: { x: -0.22, y: -0.01, z: 0 }, simulatedAt: 0.1 },
        { bodyId: sourceA.id, color: sourceA.color, position: { x: -0.15, y: -0.005, z: 0 }, simulatedAt: 0.2 },
        { bodyId: sourceA.id, color: sourceA.color, position: { ...sourceA.position }, simulatedAt: 0.3 },
        { bodyId: sourceB.id, color: sourceB.color, position: { x: 0.22, y: 0.01, z: 0 }, simulatedAt: 0.1 },
        { bodyId: sourceB.id, color: sourceB.color, position: { x: 0.15, y: 0.005, z: 0 }, simulatedAt: 0.2 },
        { bodyId: sourceB.id, color: sourceB.color, position: { ...sourceB.position }, simulatedAt: 0.3 },
      ],
    }
  }
  return {
    sequence: stage === 'collision-result' ? 2 : 3,
    samples: [
      { bodyId: remnant.id, color: remnant.color, position: { ...remnant.position }, simulatedAt: stage === 'collision-result' ? 0.9 : 1 },
    ],
  }
}

function makeState(stage: HandoffStage): SimulationRenderState {
  const common = {
    simulationTime: stage === 'tracking' ? 0 : stage === 'collision' ? 0.4 : stage === 'collision-result' ? 0.9 : 1,
    simulationSpeed: 1,
    renderStateGeneration: stage === 'tracking' ? 0 : stage === 'collision' ? 1 : stage === 'collision-result' ? 2 : 3,
    trailVersion: 0,
    trailEnabled: true,
    trailDuration: 8,
    trailSampleBatch: makeTrailBatch(stage),
    trackedBodyId: SOURCE_ID,
    collisionWatchPhase: stage === 'tracking' || stage === 'release'
      ? null
      : stage === 'collision'
        ? 'approach' as const
        : 'postImpact' as const,
    collisionWatchPairKey: stage === 'tracking' || stage === 'release'
      ? null
      : `${sourceA.id}~${sourceB.id}`,
    collisionImpactObserved: stage === 'collision-result',
  }

  if (stage === 'collision' || stage === 'collision-result') {
    return {
      ...common,
      bodies: stage === 'collision' ? [sourceA, sourceB] : physicalMerge.bodies,
      collisionCameraFocus: {
        pairKey: `${sourceA.id}~${sourceB.id}`,
        bodyAId: sourceA.id,
        bodyBId: sourceB.id,
      },
    }
  }

  return {
    ...common,
    bodies: stage === 'release' ? physicalMerge.bodies : [sourceA],
    collisionCameraFocus: null,
  }
}

function isHandoffStage(value: string): value is HandoffStage {
  return value === 'tracking' || value === 'collision' || value === 'collision-result' || value === 'release'
}

declare global {
  interface Window {
    __setTrackingCameraHandoffStage?: (stage: string) => void
    __trackingCameraHandoffStage?: string
    __trackingCameraHandoffTelemetry?: SimulationCameraTelemetry
    __trackingCameraHandoffHistory?: SimulationCameraTelemetry[]
    __trackingCameraHandoffSamples?: TimedCameraTelemetry[]
    __trackingCameraHandoffRetainedTrailIds?: string[]
    __trackingCameraPhysicalRemnantId?: string
    __trackingCameraHandoffReleaseFirstFrameDataUrl?: string
  }
}

export function TrackingCameraHandoffVisualHarness() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let currentState = makeState('tracking')
    let releaseStartedAt: number | null = null
    let releaseArmed = false
    const cameraHistory: SimulationCameraTelemetry[] = []
    const releaseSamples: TimedCameraTelemetry[] = []

    const dispose = createSimulationRenderer(
      host,
      () => currentState,
      {
        onCameraTelemetry: (telemetry) => {
          window.__trackingCameraHandoffTelemetry = telemetry
          cameraHistory.push(telemetry)
          if (cameraHistory.length > 300) cameraHistory.shift()
          window.__trackingCameraHandoffHistory = [...cameraHistory]

          if (releaseArmed && telemetry.collisionCameraJustReleased) {
            releaseStartedAt = telemetry.nowMs
            releaseArmed = false
            releaseSamples.length = 0
            queueMicrotask(() => {
              const canvas = host.querySelector('canvas')
              if (canvas) window.__trackingCameraHandoffReleaseFirstFrameDataUrl = canvas.toDataURL('image/png')
            })
          }
          if (releaseStartedAt !== null) {
            releaseSamples.push({
              ...telemetry,
              elapsedMs: telemetry.nowMs - releaseStartedAt,
            })
            if (releaseSamples.length > 180) releaseSamples.shift()
            window.__trackingCameraHandoffSamples = [...releaseSamples]
          }
        },
        onTrailTelemetry: (telemetry) => {
          window.__trackingCameraHandoffRetainedTrailIds = [...telemetry.retainedTrailIds]
        },
      },
    )

    window.__trackingCameraPhysicalRemnantId = remnant.id
    window.__setTrackingCameraHandoffStage = (nextStage: string) => {
      if (!isHandoffStage(nextStage)) throw new Error(`Unknown tracking handoff visual stage: ${nextStage}`)
      if (nextStage === 'release') {
        releaseStartedAt = null
        releaseArmed = true
        releaseSamples.length = 0
        window.__trackingCameraHandoffSamples = []
        delete window.__trackingCameraHandoffReleaseFirstFrameDataUrl
      }
      currentState = makeState(nextStage)
      window.__trackingCameraHandoffStage = nextStage
      document.body.dataset.visualStage = nextStage
    }
    window.__trackingCameraHandoffHistory = []
    window.__setTrackingCameraHandoffStage('tracking')

    return () => {
      dispose()
      delete window.__setTrackingCameraHandoffStage
      delete window.__trackingCameraHandoffStage
      delete window.__trackingCameraHandoffTelemetry
      delete window.__trackingCameraHandoffHistory
      delete window.__trackingCameraHandoffSamples
      delete window.__trackingCameraHandoffRetainedTrailIds
      delete window.__trackingCameraPhysicalRemnantId
      delete window.__trackingCameraHandoffReleaseFirstFrameDataUrl
      delete document.body.dataset.visualStage
    }
  }, [])

  return (
    <div
      data-visual-regression="tracking-camera-handoff"
      ref={hostRef}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    />
  )
}
