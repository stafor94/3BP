import { useEffect, useRef } from 'react'
import { installBodyLighting, syncBodyLightingState } from '../rendering/bodyLighting'
import {
  createSimulationRenderer,
  type CollisionCameraFocus,
  type SimulationRenderState,
} from '../rendering/simulationRenderer'
import {
  installStellarTopologyOcclusion,
  syncStellarTopologyOcclusionState,
} from '../rendering/stellarTopologyOccluder'
import type { BodyState, TrailSampleBatch } from '../types'

type Props = {
  bodies: BodyState[]
  simulationTime: number
  trailVersion: number
  trailEnabled: boolean
  trailDuration: number
  trailSampleBatch: TrailSampleBatch
  trackedBodyId: string | null
  collisionCameraFocus: CollisionCameraFocus | null
}

export function SimulationView({
  bodies,
  simulationTime,
  trailVersion,
  trailEnabled,
  trailDuration,
  trailSampleBatch,
  trackedBodyId,
  collisionCameraFocus,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const renderStateRef = useRef<SimulationRenderState>({
    bodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
    collisionCameraFocus,
  })

  renderStateRef.current = {
    bodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
    collisionCameraFocus,
  }
  syncBodyLightingState(bodies)
  syncStellarTopologyOcclusionState(bodies)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    installBodyLighting()
    installStellarTopologyOcclusion()
    syncBodyLightingState(renderStateRef.current.bodies)
    syncStellarTopologyOcclusionState(renderStateRef.current.bodies)
    return createSimulationRenderer(host, () => renderStateRef.current)
  }, [])

  return (
    <div
      className={`simulation-view${trackedBodyId ? ' is-body-tracked' : ''}`}
      ref={hostRef}
      aria-label="3D three-body simulation"
    />
  )
}
