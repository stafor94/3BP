import { useEffect, useRef } from 'react'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import { installBodyLighting, syncBodyLightingState } from '../rendering/bodyLighting'
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

function isBodyDescendedFrom(bodyId: string, sourceId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return sourceId.split('+').every((part) => bodyParts.has(part))
}

function getCollisionRenderBodies(
  bodies: BodyState[],
  collisionCameraFocus: CollisionCameraFocus | null,
) {
  if (!collisionCameraFocus) return bodies

  const mergedStar = bodies.find((body) =>
    body.bodyType === 'star' &&
    isBodyDescendedFrom(body.id, collisionCameraFocus.bodyAId) &&
    isBodyDescendedFrom(body.id, collisionCameraFocus.bodyBId),
  )
  if (!mergedStar) return bodies

  // The collision renderer normally resolves each source id to a descendant.
  // After a stellar merge both ids resolve to the same remnant, which makes the
  // collision camera fall back to normal mobile tracking and can push the very
  // close remnant outside the viewport. Add an invisible render-only anchor for
  // one source id so the collision camera keeps framing the merged star through
  // the post-impact observation period without changing the physics state.
  const anchorId = !bodies.some((body) => body.id === collisionCameraFocus.bodyBId)
    ? collisionCameraFocus.bodyBId
    : !bodies.some((body) => body.id === collisionCameraFocus.bodyAId)
      ? collisionCameraFocus.bodyAId
      : null
  if (!anchorId) return bodies

  const cameraAnchor: BodyState = {
    ...mergedStar,
    id: anchorId,
    name: 'Collision camera anchor',
    mass: 0,
    radius: 0,
    bodyType: 'fragment',
    age: FRAGMENT_LIFETIME,
    lifetime: FRAGMENT_LIFETIME,
    position: { ...mergedStar.position },
    velocity: { ...mergedStar.velocity },
  }

  return [...bodies, cameraAnchor]
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
  const renderBodies = getCollisionRenderBodies(bodies, collisionCameraFocus)
  const renderStateRef = useRef<SimulationRenderState>({
    bodies: renderBodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
    collisionCameraFocus,
  })

  renderStateRef.current = {
    bodies: renderBodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
    collisionCameraFocus,
  }
  syncBodyLightingState(bodies)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    installBodyLighting()
    syncBodyLightingState(bodies)
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
