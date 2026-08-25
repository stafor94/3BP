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

type TrackingCameraAnchorState = {
  trackedSourceId: string
  pairKey: string
  anchorId: string
  direction: Vec3
  envelopeRadius: number
  anchorVelocity: Vec3
}

const COLLISION_CAMERA_BODY_MARGIN = 1.65
const COLLISION_CAMERA_TRACKING_ZOOM_RATIO = 0.8
const COLLISION_CAMERA_PAIR_DISTANCE_FACTOR = 1
const COLLISION_CAMERA_DIRECTION_EPSILON = 0.0005
const TRACKING_CAMERA_MIN_ENVELOPE_RADIUS = 0.18
const TRACKING_CAMERA_BODY_RADIUS_FACTOR = 5.2

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

function findOrbitReference(bodies: BodyState[], trackedBody: BodyState): BodyState | null {
  let bestBody: BodyState | null = null
  let bestInfluence = Number.NEGATIVE_INFINITY

  for (const body of bodies) {
    if (
      body.id === trackedBody.id ||
      body.bodyType === 'effect' ||
      body.bodyType === 'fragment'
    ) continue

    const dx = body.position.x - trackedBody.position.x
    const dy = body.position.y - trackedBody.position.y
    const dz = body.position.z - trackedBody.position.z
    const distanceSquared = dx * dx + dy * dy + dz * dz
    if (distanceSquared <= 1e-12) continue

    // The strongest instantaneous pull is still useful for choosing a readable
    // viewing direction, but it must not control zoom. Otherwise selecting the
    // same body at a different orbital phase can produce a completely different
    // camera scale.
    const influence = Math.max(body.mass, 0) / distanceSquared
    if (influence > bestInfluence) {
      bestInfluence = influence
      bestBody = body
    }
  }

  return bestBody
}

function getStableTrackingEnvelopeRadius(trackedBody: BodyState) {
  return Math.max(
    trackedBody.radius * TRACKING_CAMERA_BODY_RADIUS_FACTOR / COLLISION_CAMERA_BODY_MARGIN,
    TRACKING_CAMERA_MIN_ENVELOPE_RADIUS,
  )
}

function createTrackingCameraAnchorState(
  bodies: BodyState[],
  trackedSourceId: string,
): TrackingCameraAnchorState | null {
  const trackedBody = resolveBody(bodies, trackedSourceId)
  if (!trackedBody) return null

  const orbitReference = findOrbitReference(bodies, trackedBody)
  if (orbitReference) {
    const { direction } = normalizedDirection(trackedBody, orbitReference)
    return {
      trackedSourceId,
      pairKey: `tracking-camera:${trackedSourceId}`,
      anchorId: `__tracking-camera-anchor__${trackedSourceId}`,
      direction,
      envelopeRadius: getStableTrackingEnvelopeRadius(trackedBody),
      anchorVelocity: { ...orbitReference.velocity },
    }
  }

  // A single/free body has no meaningful orbital partner. Give it a stable
  // top-like view. Zoom uses the same body-size rule as every other target so
  // reselecting a body never depends on an instantaneous neighbor distance.
  return {
    trackedSourceId,
    pairKey: `tracking-camera:${trackedSourceId}`,
    anchorId: `__tracking-camera-anchor__${trackedSourceId}`,
    direction: { x: 1, y: 0, z: 0 },
    envelopeRadius: getStableTrackingEnvelopeRadius(trackedBody),
    anchorVelocity: {
      x: trackedBody.velocity.x,
      y: trackedBody.velocity.y + 1,
      z: trackedBody.velocity.z,
    },
  }
}

function createRenderOnlyCameraAnchor(
  mainBody: BodyState,
  anchorId: string,
  direction: Vec3,
  envelopeRadius: number,
  anchorVelocity: Vec3,
  name: string,
): BodyState {
  return {
    ...mainBody,
    id: anchorId,
    name,
    mass: 0,
    radius: envelopeRadius,
    bodyType: 'fragment',
    age: FRAGMENT_LIFETIME,
    lifetime: FRAGMENT_LIFETIME,
    position: {
      x: mainBody.position.x + direction.x * COLLISION_CAMERA_DIRECTION_EPSILON,
      y: mainBody.position.y + direction.y * COLLISION_CAMERA_DIRECTION_EPSILON,
      z: mainBody.position.z + direction.z * COLLISION_CAMERA_DIRECTION_EPSILON,
    },
    velocity: { ...anchorVelocity },
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
  const trackingCameraAnchorRef = useRef<TrackingCameraAnchorState | null>(null)

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
        const stableTrackingEnvelope = getStableTrackingEnvelopeRadius(mainBody)
        const pairEnvelope = secondaryBody.radius +
          distance * COLLISION_CAMERA_PAIR_DISTANCE_FACTOR / COLLISION_CAMERA_BODY_MARGIN

        collisionCameraAnchorRef.current = {
          pairKey: collisionCameraFocus.pairKey,
          mainSourceId,
          anchorId: `__collision-camera-anchor__${collisionCameraFocus.pairKey}`,
          direction,
          // Never let collision watch zoom closer than roughly 20% beyond the
          // normal tracking framing. If the secondary body needs more room, zoom
          // out instead so both colliders remain visible.
          envelopeRadius: Math.max(
            stableTrackingEnvelope * COLLISION_CAMERA_TRACKING_ZOOM_RATIO,
            pairEnvelope,
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
          const cameraAnchor = createRenderOnlyCameraAnchor(
            mainBody,
            anchorState.anchorId,
            anchorState.direction,
            anchorState.envelopeRadius,
            anchorState.anchorVelocity,
            'Collision camera anchor',
          )

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

  // Collision watch owns the camera only while its one-shot framing is active.
  // Otherwise every newly selected tracking target receives its own orbit-aware
  // viewing direction but a body-size-based stable zoom. The synthetic anchor
  // moves with the selected body, so manual camera changes remain intact later.
  if (effectiveCollisionCameraFocus) {
    trackingCameraAnchorRef.current = null
  } else if (trackedBodyId) {
    const previousTrackingAnchor = trackingCameraAnchorRef.current
    if (!previousTrackingAnchor || previousTrackingAnchor.trackedSourceId !== trackedBodyId) {
      trackingCameraAnchorRef.current = createTrackingCameraAnchorState(bodies, trackedBodyId)
    }

    const trackingAnchor = trackingCameraAnchorRef.current
    const trackedBody = trackingAnchor
      ? resolveBody(bodies, trackingAnchor.trackedSourceId)
      : null

    if (trackingAnchor && trackedBody) {
      const cameraAnchor = createRenderOnlyCameraAnchor(
        trackedBody,
        trackingAnchor.anchorId,
        trackingAnchor.direction,
        trackingAnchor.envelopeRadius,
        trackingAnchor.anchorVelocity,
        'Tracking camera anchor',
      )
      renderBodies = [...bodies, cameraAnchor]
      effectiveCollisionCameraFocus = {
        pairKey: trackingAnchor.pairKey,
        bodyAId: trackingAnchor.trackedSourceId,
        bodyBId: trackingAnchor.anchorId,
      }
    } else {
      trackingCameraAnchorRef.current = null
    }
  } else {
    trackingCameraAnchorRef.current = null
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
