export const TARGET_BODY_RADIUS_SCREEN_FRACTION = 1 / 20
export const COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION = 1 / 18
export const COLLISION_CAMERA_DISTANCE_TOLERANCE = 0.01
export const COLLISION_CAMERA_HANDOFF_DURATION_MS = 1500
export const COLLISION_CAMERA_MAX_DISTANCE_CHANGE_RATIO = 0.03
const COLLISION_CAMERA_HANDOFF_TRIGGER_RATIO = 0.18
const COLLISION_CAMERA_SESSION_GAP_MS = 260

export type PerspectiveBodyFramingInput = {
  bodyRadius: number
  minRenderRadius: number
  verticalFovDegrees: number
  viewportWidth: number
  viewportHeight: number
  targetRadiusFraction?: number
}

export type CollisionCameraDistanceHandoffState = {
  value: number
  lastRawTarget: number
  handoffFrom: number
  handoffTarget: number
  handoffStartedAt: number | null
  lastUpdatedAt: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function smoothstep01(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function getHorizontalHalfFov(
  verticalFovDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const width = Math.max(viewportWidth, 1)
  const height = Math.max(viewportHeight, 1)
  const aspect = width / height
  const verticalHalfFov = Math.max(verticalFovDegrees, 0.001) * Math.PI / 360
  return Math.atan(Math.tan(verticalHalfFov) * aspect)
}

export function getRenderedBodyRadius(bodyRadius: number, minRenderRadius: number) {
  return Math.max(bodyRadius, minRenderRadius)
}

/**
 * Stabilizes a collision-camera target-distance handoff when the source body is
 * replaced by a remnant with a materially different radius. The old distance is
 * retained as the handoff baseline, the new radius is approached over the same
 * 1.5 s window as the solid-body destruction handoff, and each update is capped
 * to a small relative distance change.
 */
export function advanceCollisionCameraDistanceHandoff(
  previous: CollisionCameraDistanceHandoffState | null,
  rawTarget: number,
  nowMs: number,
): { value: number; state: CollisionCameraDistanceHandoffState } {
  const safeRawTarget = Math.max(rawTarget, 1e-9)
  if (
    !previous ||
    nowMs - previous.lastUpdatedAt > COLLISION_CAMERA_SESSION_GAP_MS
  ) {
    const state: CollisionCameraDistanceHandoffState = {
      value: safeRawTarget,
      lastRawTarget: safeRawTarget,
      handoffFrom: safeRawTarget,
      handoffTarget: safeRawTarget,
      handoffStartedAt: null,
      lastUpdatedAt: nowMs,
    }
    return { value: safeRawTarget, state }
  }

  const rawChangeRatio = Math.abs(safeRawTarget - previous.lastRawTarget) /
    Math.max(previous.lastRawTarget, 1e-9)
  const shouldStartHandoff = previous.handoffStartedAt === null &&
    rawChangeRatio >= COLLISION_CAMERA_HANDOFF_TRIGGER_RATIO

  let handoffFrom = previous.handoffFrom
  let handoffTarget = previous.handoffTarget
  let handoffStartedAt = previous.handoffStartedAt

  if (shouldStartHandoff) {
    handoffFrom = previous.value
    handoffTarget = safeRawTarget
    handoffStartedAt = nowMs
  } else if (handoffStartedAt !== null) {
    // Radius relaxation may continue after topology/result replacement. Keep the
    // newest target but never restart the handoff clock, which would otherwise
    // allow an endless sequence of snap-fits.
    handoffTarget = safeRawTarget
  }

  let desired = safeRawTarget
  if (handoffStartedAt !== null) {
    const progress = smoothstep01(
      (nowMs - handoffStartedAt) / COLLISION_CAMERA_HANDOFF_DURATION_MS,
    )
    desired = handoffFrom + (handoffTarget - handoffFrom) * progress
    if (progress >= 1) handoffStartedAt = null
  }

  const maxDelta = Math.max(previous.value * COLLISION_CAMERA_MAX_DISTANCE_CHANGE_RATIO, 1e-9)
  const nextValue = clamp(desired, previous.value - maxDelta, previous.value + maxDelta)
  const state: CollisionCameraDistanceHandoffState = {
    value: nextValue,
    lastRawTarget: safeRawTarget,
    handoffFrom,
    handoffTarget,
    handoffStartedAt,
    lastUpdatedAt: nowMs,
  }
  return { value: nextValue, state }
}

let liveCollisionCameraDistanceState: CollisionCameraDistanceHandoffState | null = null

export function calculatePerspectiveBodyDistance({
  bodyRadius,
  minRenderRadius,
  verticalFovDegrees,
  viewportWidth,
  viewportHeight,
  targetRadiusFraction = TARGET_BODY_RADIUS_SCREEN_FRACTION,
}: PerspectiveBodyFramingInput) {
  const radius = getRenderedBodyRadius(bodyRadius, minRenderRadius)
  const horizontalHalfFov = getHorizontalHalfFov(
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const targetNdcRadius = Math.max(targetRadiusFraction * 2, 1e-6)
  const projectedTan = targetNdcRadius * Math.max(Math.tan(horizontalHalfFov), 1e-9)

  // Exact perspective projection for a sphere silhouette. Its angular radius is
  // asin(radius / distance), so tan(angle) = radius / sqrt(distance² - radius²).
  const rawDistance = radius * Math.sqrt(1 + 1 / (projectedTan * projectedTan))

  // Only the live browser collision-watch path is stateful. Node regressions and
  // ordinary user tracking keep the exact pure perspective-distance calculation.
  if (
    targetRadiusFraction === COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION &&
    typeof window !== 'undefined' &&
    typeof performance !== 'undefined'
  ) {
    const stabilized = advanceCollisionCameraDistanceHandoff(
      liveCollisionCameraDistanceState,
      rawDistance,
      performance.now(),
    )
    liveCollisionCameraDistanceState = stabilized.state
    return stabilized.value
  }

  return rawDistance
}

export function calculateProjectedBodyRadiusPixels(
  bodyRadius: number,
  distance: number,
  verticalFovDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const radius = Math.max(bodyRadius, 0)
  if (distance <= radius) return Number.POSITIVE_INFINITY

  const horizontalHalfFov = getHorizontalHalfFov(
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const silhouetteTan = radius / Math.sqrt(distance * distance - radius * radius)
  const ndcRadius = silhouetteTan / Math.max(Math.tan(horizontalHalfFov), 1e-9)
  return Math.max(viewportWidth, 1) * ndcRadius * 0.5
}

export function getRelativeCameraDistanceError(currentDistance: number, desiredDistance: number) {
  return Math.abs(currentDistance - desiredDistance) / Math.max(Math.abs(desiredDistance), 1e-9)
}

export function isCollisionCameraDistanceConverged(
  currentDistance: number,
  desiredDistance: number,
  tolerance = COLLISION_CAMERA_DISTANCE_TOLERANCE,
) {
  return getRelativeCameraDistanceError(currentDistance, desiredDistance) <= Math.max(tolerance, 0)
}
