import { useEffect, useRef } from 'react'
import { resolveBodyDescendant } from '../collisionWatch'
import { installBodyLighting, syncBodyLightingState } from '../rendering/bodyLighting'
import {
  installLiveCollisionVfxBridge,
  syncLiveCollisionVfxState,
} from '../rendering/liveCollisionVfxBridge'
import {
  installStellarRemnantPresentation,
  syncStellarRemnantPresentationState,
} from '../rendering/stellarRemnantPresentation'
import {
  createSimulationRenderer,
  type CollisionCameraFocus,
  type SimulationCameraTelemetry,
  type SimulationRenderState,
} from '../rendering/simulationRenderer'
import type { CollisionWatchPhase } from '../collisionWatchTiming'
import type { BodyState, TrailSampleBatch } from '../types'

type Props = {
  bodies: BodyState[]
  simulationTime: number
  simulationSpeed?: number
  trailVersion: number
  trailEnabled: boolean
  trailDuration: number
  trailSampleBatch: TrailSampleBatch
  trackedBodyId: string | null
  collisionCameraFocus: CollisionCameraFocus | null
  collisionWatchPhase?: CollisionWatchPhase | null
  collisionWatchPairKey?: string | null
  collisionImpactObserved?: boolean
}

declare global {
  interface Window {
    __productionCameraHandoffHistory?: SimulationCameraTelemetry[]
    __productionCameraHandoffFrames?: Record<string, string>
  }
}

function isRetainableCollisionCameraBody(body: BodyState | undefined): body is BodyState {
  return Boolean(body && body.bodyType !== 'effect' && body.bodyType !== 'fragment')
}

export function SimulationView({
  bodies,
  simulationTime,
  simulationSpeed = 1,
  trailVersion,
  trailEnabled,
  trailDuration,
  trailSampleBatch,
  trackedBodyId,
  collisionCameraFocus,
  collisionWatchPhase = null,
  collisionWatchPairKey = null,
  collisionImpactObserved = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const renderStateGenerationRef = useRef(0)
  const collisionCameraPairKeyRef = useRef<string | null>(null)
  const collisionCameraPrimarySourceIdRef = useRef<string | null>(null)
  const retainedCollisionCameraBodyIdRef = useRef<string | null>(null)
  renderStateGenerationRef.current += 1

  // User tracking always wins and permanently releases any earlier automatic
  // collision-camera retention. The retained id exists only as a camera-level
  // continuation, so ordinary tracking lineage and the 50% mass policy remain
  // entirely owned by App/BodyTrackingRail.
  if (trackedBodyId) retainedCollisionCameraBodyIdRef.current = null

  if (collisionCameraFocus) {
    if (collisionCameraPairKeyRef.current !== collisionCameraFocus.pairKey) {
      const bodyA = resolveBodyDescendant(bodies, collisionCameraFocus.bodyAId)
      const bodyB = resolveBodyDescendant(bodies, collisionCameraFocus.bodyBId)
      if (bodyA && bodyB) {
        const primary = bodyA.mass > bodyB.mass ||
          (bodyA.mass === bodyB.mass && bodyA.radius >= bodyB.radius)
          ? bodyA
          : bodyB
        collisionCameraPrimarySourceIdRef.current = primary === bodyA
          ? collisionCameraFocus.bodyAId
          : collisionCameraFocus.bodyBId
      } else {
        collisionCameraPrimarySourceIdRef.current = null
      }
      collisionCameraPairKeyRef.current = collisionCameraFocus.pairKey
    }

    if (!trackedBodyId) {
      const primarySourceId = collisionCameraPrimarySourceIdRef.current
      const focusedBody = primarySourceId
        ? resolveBodyDescendant(bodies, primarySourceId)
        : undefined
      retainedCollisionCameraBodyIdRef.current = isRetainableCollisionCameraBody(focusedBody)
        ? focusedBody.id
        : null
    }
  } else {
    collisionCameraPairKeyRef.current = null
    collisionCameraPrimarySourceIdRef.current = null
  }

  let retainedCollisionCameraBody = retainedCollisionCameraBodyIdRef.current
    ? bodies.find((body) =>
      body.id === retainedCollisionCameraBodyIdRef.current &&
      body.bodyType !== 'effect' &&
      body.bodyType !== 'fragment',
    )
    : undefined
  if (!collisionCameraFocus && retainedCollisionCameraBodyIdRef.current && !retainedCollisionCameraBody) {
    retainedCollisionCameraBodyIdRef.current = null
    retainedCollisionCameraBody = undefined
  }

  const cameraTrackedBodyId = trackedBodyId ?? retainedCollisionCameraBody?.id ?? null
  const renderStateRef = useRef<SimulationRenderState>({
    bodies,
    simulationTime,
    simulationSpeed,
    renderStateGeneration: renderStateGenerationRef.current,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId: cameraTrackedBodyId,
    collisionCameraFocus,
    collisionWatchPhase,
    collisionWatchPairKey,
    collisionImpactObserved,
  })

  renderStateRef.current = {
    bodies,
    simulationTime,
    simulationSpeed,
    renderStateGeneration: renderStateGenerationRef.current,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId: cameraTrackedBodyId,
    collisionCameraFocus,
    collisionWatchPhase,
    collisionWatchPairKey,
    collisionImpactObserved,
  }
  syncBodyLightingState(bodies)
  syncStellarRemnantPresentationState(bodies, simulationTime)
  syncLiveCollisionVfxState(bodies)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    installBodyLighting()
    // Install after body lighting so the remnant hook composes with the real
    // body material callback without changing physical radius or lighting state.
    installStellarRemnantPresentation()
    // Install last so collision VFX keeps owning its existing draw-path bridge.
    installLiveCollisionVfxBridge()
    syncBodyLightingState(renderStateRef.current.bodies)
    syncStellarRemnantPresentationState(
      renderStateRef.current.bodies,
      renderStateRef.current.simulationTime,
    )
    syncLiveCollisionVfxState(renderStateRef.current.bodies)
    const isProductionCameraHandoffRegression = new URLSearchParams(window.location.search)
      .get('visual-regression') === 'production-camera-handoff'
    let previousWriter: SimulationCameraTelemetry['cameraWriteSource'] | null = null
    const options = isProductionCameraHandoffRegression ? {
      onCameraTelemetry: (telemetry: SimulationCameraTelemetry) => {
        const history = window.__productionCameraHandoffHistory ?? []
        history.push(telemetry)
        if (history.length > 2400) history.shift()
        window.__productionCameraHandoffHistory = history

        const labels: string[] = []
        if (telemetry.mode === 'collision') labels.push('last-collision-frame')
        if (telemetry.collisionCameraJustReleased) labels.push('release-frame')
        if (
          telemetry.cameraWriteSource === 'tracking-transition' &&
          telemetry.trackingTransitionProgress !== null &&
          telemetry.trackingTransitionProgress >= 0.45 &&
          telemetry.trackingTransitionProgress <= 0.75
        ) labels.push('handoff-mid')
        if (
          telemetry.cameraWriteSource === 'tracking-transition' &&
          telemetry.trackingTransitionProgress === 1
        ) labels.push('handoff-last-frame')
        if (
          previousWriter === 'tracking-transition' &&
          telemetry.cameraWriteSource === 'normal-tracking'
        ) labels.push('first-normal-tracking-frame')
        previousWriter = telemetry.cameraWriteSource

        if (labels.length > 0) {
          queueMicrotask(() => {
            const canvas = host.querySelector('canvas')
            if (!canvas) return
            const frames = window.__productionCameraHandoffFrames ?? {}
            const dataUrl = canvas.toDataURL('image/png')
            labels.forEach((label) => { frames[label] = dataUrl })
            window.__productionCameraHandoffFrames = frames
          })
        }
      },
    } : undefined
    return createSimulationRenderer(host, () => renderStateRef.current, options)
  }, [])

  return (
    <div
      className={`simulation-view${trackedBodyId ? ' is-body-tracked' : ''}`}
      ref={hostRef}
      aria-label="3D three-body simulation"
    />
  )
}
