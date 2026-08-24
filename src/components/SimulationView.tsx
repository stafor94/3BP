import { useEffect, useRef } from 'react'
import { installBodyLighting, syncBodyLightingState } from '../rendering/bodyLighting'
import { createSimulationRenderer, type SimulationRenderState } from '../rendering/simulationRenderer'
import type { BodyState, TrailSampleBatch } from '../types'

type Props = {
  bodies: BodyState[]
  simulationTime: number
  trailVersion: number
  trailEnabled: boolean
  trailDuration: number
  trailSampleBatch: TrailSampleBatch
  trackedBodyId: string | null
}

export function SimulationView({
  bodies,
  simulationTime,
  trailVersion,
  trailEnabled,
  trailDuration,
  trailSampleBatch,
  trackedBodyId,
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
  })

  renderStateRef.current = {
    bodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
  }
  syncBodyLightingState(bodies)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    installBodyLighting()
    syncBodyLightingState(renderStateRef.current.bodies)
    return createSimulationRenderer(host, () => renderStateRef.current)
  }, [])

  return <div className="simulation-view" ref={hostRef} aria-label="3D three-body simulation" />
}
