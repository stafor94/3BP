import { useEffect, useRef } from 'react'
import { installBodyLighting, syncBodyLightingState } from '../rendering/bodyLighting'
import {
  installLiveCollisionVfxBridge,
  syncLiveCollisionVfxState,
} from '../rendering/liveCollisionVfxBridge'
import {
  createSimulationRenderer,
  type CollisionCameraFocus,
  type SimulationRenderState,
} from '../rendering/simulationRenderer'
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
  syncLiveCollisionVfxState(bodies)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    installBodyLighting()
    // Install after body lighting so the bridge wraps the body material's real
    // onBeforeRender callback instead of relying on WebGLRenderer.prototype.render.
    installLiveCollisionVfxBridge()
    syncBodyLightingState(renderStateRef.current.bodies)
    syncLiveCollisionVfxState(renderStateRef.current.bodies)
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
