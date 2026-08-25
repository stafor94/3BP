import { useEffect, useRef } from 'react'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import { installBodyLighting, syncBodyLightingState } from '../rendering/bodyLighting'
import {
  createSimulationRenderer,
  type CollisionCameraFocus,
  type SimulationRenderState,
} from '../rendering/simulationRenderer'
import type { BodyState, TrailSampleBatch, Vec3 } from '../types'

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

type CollisionCameraAnchorState = {
  pairKey: string
  mainSourceId: string
  anchorId: string
  direction: Vec3
  envelopeRadius: number
  anchorVelocity: Vec3
  trackingEstablished: boolean
}

const COLLISION_CAMERA_BODY_MARGIN = 1.65
const COLLISION_CAMERA_ENVELOPE_DISTANCE_FACTOR = 0.72
const COLLISION_CAMERA_DIRECTION_EPSILON = 0.0005

function isBodyDescendedFrom(bodyId: string, sourceId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return sourceId.split('+').every((part) => bodyParts.has(part))
}

function resolveBody(bodies: BodyState[], sourceId: string) {
  return bodies.find((body) => body.id === sourceId && body.bodyType !== 'effect') ??
    bodies.find((body) => body.bodyType !== 'effect' && isBodyDescendedFrom(body.id, sourceId))
}

function vectorLength(vector: Vec3) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalizedDirection(from: BodyState, to: BodyState): { direction: Vec3; distance: number } {
  const delta = {
    x: to.position.x - from.position.x,
    y: to.position.y - from.position.y,
    z: to.position.z - from.position.z,
  }
  const distance = vectorLength(delta)
  if (distance <= 1e-10) return { direction: { x: 0, y: 0, z: 1 }, distance: 0 }
  return {
    direction: {
      x: delta.x / distance,
      y: delta.y / distance,
      z: delta.z / distance,
    },
    distance,
  }
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
  const collisionCameraAnchorRef = useRef<CollisionCameraAnchorState | null>(null)
  const collisionCameraSuppressedPairRef = useRef<string | null>(null)

  let renderBodies = bodies
  let effectiveCollisionCameraFocus = collisionCameraFocus

  if (!collisionCameraFocus) {
    collisionCameraAnchorRef.current = null
    collisionCameraSuppressedPairRef.current = null
  } else {
    const previousAnchor = collisionCameraAnchorRef.current
    if (!previousAnchor || previousAnchor.pairKey !== collisionCameraFocus.pairKey) {
      collisionCameraSuppressedPairRef.current = null
      const bodyA = resolveBody(bodies, collisionCameraFocus.bodyAId)
      const bodyB = resolveBody(bodies, collisionCameraFocus.bodyBId)

      if (bodyA && bodyB) {
        const mainBody = bodyA.mass > bodyB.mass || (bodyA.mass === bodyB.mass && bodyA.radius >= bodyB.radius)
          ? bodyA
          : bodyB
        const secondaryBody = mainBody === bodyA ? bodyB : bodyA
        const mainSourceId = mainBody === bodyA
          ? collisionCameraFocus.bodyAId
          : collisionCameraFocus.bodyBId
        const { direction, distance } = normalizedDirection(mainBody, secondaryBody)

        collisionCameraAnchorRef.current = {
          pairKey: collisionCameraFocus.pairKey,
          mainSourceId,
          anchorId: `__collision-camera-anchor__${collisionCameraFocus.pairKey}`,
          direction,
          envelopeRadius: Math.max(
            secondaryBody.radius +
              distance * COLLISION_CAMERA_ENVELOPE_DISTANCE_FACTOR / COLLISION_CAMERA_BODY_MARGIN,
            0.001,
          ),
          anchorVelocity: { ...secondaryBody.velocity },
          trackingEstablished: trackedBodyId !== null && isBodyDescendedFrom(trackedBodyId, mainSourceId),
        }
      } else {
        collisionCameraAnchorRef.current = null
      }
    }

    const anchorState = collisionCameraAnchorRef.current
    if (anchorState) {
      const trackedMainBody = trackedBodyId !== null &&
        isBodyDescendedFrom(trackedBodyId, anchorState.mainSourceId)

      if (!anchorState.trackingEstablished && trackedMainBody) {
        anchorState.trackingEstablished = true
      } else if (anchorState.trackingEstablished && !trackedMainBody) {
        collisionCameraSuppressedPairRef.current = anchorState.pairKey
      }

      if (collisionCameraSuppressedPairRef.current === anchorState.pairKey) {
        effectiveCollisionCameraFocus = null
      } else {
        const mainBody = resolveBody(bodies, anchorState.mainSourceId)
        if (mainBody) {
          const cameraAnchor: BodyState = {
            ...mainBody,
            id: anchorState.anchorId,
            name: 'Collision camera anchor',
            mass: 0,
            radius: anchorState.envelopeRadius,
            bodyType: 'fragment',
            age: FRAGMENT_LIFETIME,
            lifetime: FRAGMENT_LIFETIME,
            position: {
              x: mainBody.position.x + anchorState.direction.x * COLLISION_CAMERA_DIRECTION_EPSILON,
              y: mainBody.position.y + anchorState.direction.y * COLLISION_CAMERA_DIRECTION_EPSILON,
              z: mainBody.position.z + anchorState.direction.z * COLLISION_CAMERA_DIRECTION_EPSILON,
            },
            velocity: { ...anchorState.anchorVelocity },
          }

          renderBodies = [...bodies, cameraAnchor]
          effectiveCollisionCameraFocus = {
            pairKey: collisionCameraFocus.pairKey,
            bodyAId: anchorState.mainSourceId,
            bodyBId: anchorState.anchorId,
          }
        } else {
          effectiveCollisionCameraFocus = null
        }
      }
    } else {
      effectiveCollisionCameraFocus = null
    }
  }

  const renderStateRef = useRef<SimulationRenderState>({
    bodies: renderBodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
    collisionCameraFocus: effectiveCollisionCameraFocus,
  })

  renderStateRef.current = {
    bodies: renderBodies,
    simulationTime,
    trailVersion,
    trailEnabled,
    trailDuration,
    trailSampleBatch,
    trackedBodyId,
    collisionCameraFocus: effectiveCollisionCameraFocus,
  }
  syncBodyLightingState(bodies)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    installBodyLighting()
    syncBodyLightingState(renderStateRef.current.bodies)
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
