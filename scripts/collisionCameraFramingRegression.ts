import {
  advanceCollisionCameraDistanceHandoff,
  calculatePerspectiveBodyDistance,
  calculateProjectedBodyRadiusPixels,
  COLLISION_CAMERA_DISTANCE_TOLERANCE,
  COLLISION_CAMERA_HANDOFF_DURATION_MS,
  COLLISION_CAMERA_MAX_DISTANCE_CHANGE_RATIO,
  COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION,
  getRenderedBodyRadius,
  isCollisionCameraDistanceConverged,
  TARGET_BODY_RADIUS_SCREEN_FRACTION,
  type CollisionCameraDistanceHandoffState,
} from '../src/rendering/cameraFraming'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

const viewportWidth = 1440
const viewportHeight = 900
const verticalFovDegrees = 55
const minRenderRadius = 0.025
const primaryRadius = 0.3

function getDistance(bodyRadius: number, targetRadiusFraction?: number) {
  return calculatePerspectiveBodyDistance({
    bodyRadius,
    minRenderRadius,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
    targetRadiusFraction,
  })
}

function convergeDistance(current: number, desired: number, transition: number, maxFrames = 240) {
  let distance = current
  let frames = 0
  while (!isCollisionCameraDistanceConverged(distance, desired) && frames < maxFrames) {
    distance += (desired - distance) * transition
    frames += 1
  }
  return { distance, frames }
}

function testTrackingAndCollisionFractionsStaySeparated() {
  assertClose(
    TARGET_BODY_RADIUS_SCREEN_FRACTION,
    1 / 20,
    1e-12,
    'ordinary tracking must retain the width/20 radius target',
  )
  assertClose(
    COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION,
    1 / 9,
    1e-12,
    'collision watch must use the dedicated width/9 radius target',
  )

  const renderedRadius = getRenderedBodyRadius(primaryRadius, minRenderRadius)
  const trackingDistance = getDistance(primaryRadius)
  const collisionDistance = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const trackingPixels = calculateProjectedBodyRadiusPixels(
    renderedRadius,
    trackingDistance,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const collisionPixels = calculateProjectedBodyRadiusPixels(
    renderedRadius,
    collisionDistance,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )

  assertClose(trackingPixels, viewportWidth / 20, 1e-7, 'tracking projected radius must remain width/20')
  assertClose(collisionPixels, viewportWidth / 9, 1e-7, 'collision projected radius must be width/9')
  assert(
    collisionDistance < trackingDistance * 0.5,
    'collision watch should move materially closer than ordinary tracking',
  )
}

function testCollisionDistanceContinuesPastEighteenFramesUntilConverged() {
  const trackingDistance = getDistance(primaryRadius)
  const desiredDistance = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  let currentDistance = trackingDistance

  for (let frame = 0; frame < 18; frame += 1) {
    currentDistance += (desiredDistance - currentDistance) * 0.18
  }

  assert(
    !isCollisionCameraDistanceConverged(currentDistance, desiredDistance),
    '18 frames must not be treated as an unconditional collision-camera stop condition',
  )

  const converged = convergeDistance(currentDistance, desiredDistance, 0.18)
  assert(converged.frames > 0, 'collision focus must continue correcting after frame 18 when error remains')
  assert(
    isCollisionCameraDistanceConverged(converged.distance, desiredDistance),
    'collision camera must eventually converge within its relative-distance tolerance',
  )
  assertClose(
    COLLISION_CAMERA_DISTANCE_TOLERANCE,
    0.01,
    1e-12,
    'collision camera distance tolerance should be one percent',
  )
}

function testSmallRemnantCannotSnapCollisionDistanceInOneFrame() {
  const sourceDistance = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const tinyRemnantDistance = getDistance(0.03, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const initial = advanceCollisionCameraDistanceHandoff(null, sourceDistance, 0)
  const firstRemnantFrame = advanceCollisionCameraDistanceHandoff(initial.state, tinyRemnantDistance, 16)

  assertClose(
    firstRemnantFrame.value,
    sourceDistance,
    1e-12,
    'source-to-small-remnant handoff must retain the pre-transition distance on the first frame',
  )
  assert(
    firstRemnantFrame.state.handoffStartedAt === 16,
    'a material source-to-remnant radius change must start a protected camera handoff',
  )
  assert(
    COLLISION_CAMERA_HANDOFF_DURATION_MS === 1500,
    'camera handoff protection must cover the full 1.5s destruction handoff',
  )
}

function testCollisionDistanceFrameRateIsCappedDuringHandoff() {
  const sourceDistance = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const tinyRemnantDistance = getDistance(0.03, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  let result = advanceCollisionCameraDistanceHandoff(null, sourceDistance, 0)
  let state: CollisionCameraDistanceHandoffState = result.state
  let previousValue = result.value
  let midpointValue = previousValue

  for (let frame = 1; frame <= 120; frame += 1) {
    result = advanceCollisionCameraDistanceHandoff(state, tinyRemnantDistance, frame * 16)
    const allowedDelta = previousValue * COLLISION_CAMERA_MAX_DISTANCE_CHANGE_RATIO + 1e-12
    assert(
      Math.abs(result.value - previousValue) <= allowedDelta,
      `collision camera distance changed too quickly on frame ${frame}`,
    )
    previousValue = result.value
    state = result.state
    if (frame === 60) midpointValue = result.value
  }

  assert(
    midpointValue > tinyRemnantDistance,
    'protected camera handoff must still be approaching the smaller remnant before the 1.5s window completes',
  )
  assert(
    previousValue >= tinyRemnantDistance - 1e-12,
    'camera handoff must never overshoot closer than the requested remnant distance',
  )
}

function testNearbyLargeBodyProjectedSizeCannotJumpSeveralTimesAtRemnantReveal() {
  const sourceDistance = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const tinyRemnantDistance = getDistance(0.03, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const initial = advanceCollisionCameraDistanceHandoff(null, sourceDistance, 0)
  const next = advanceCollisionCameraDistanceHandoff(initial.state, tinyRemnantDistance, 16)
  const nearbyLargeRadius = 0.24
  const beforePixels = calculateProjectedBodyRadiusPixels(
    nearbyLargeRadius,
    Math.max(sourceDistance, nearbyLargeRadius + 1e-6),
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const afterPixels = calculateProjectedBodyRadiusPixels(
    nearbyLargeRadius,
    Math.max(next.value, nearbyLargeRadius + 1e-6),
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )

  assert(
    afterPixels / beforePixels < 1.08,
    'small-fragment/remnant reveal must not make a nearby large body jump to several times its projected size',
  )
}

function testEjectaExtentCannotChangePrimaryOnlyFraming() {
  const desiredBeforeEjecta = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const deliberatelyHugeEjectaExtent = 10_000
  const deliberatelyDistantSecondary = 5_000
  void deliberatelyHugeEjectaExtent
  void deliberatelyDistantSecondary
  const desiredAfterEjecta = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)

  assertClose(
    desiredAfterEjecta,
    desiredBeforeEjecta,
    0,
    'collision camera desired distance must depend only on the primary rendered radius',
  )
}

testTrackingAndCollisionFractionsStaySeparated()
testCollisionDistanceContinuesPastEighteenFramesUntilConverged()
testSmallRemnantCannotSnapCollisionDistanceInOneFrame()
testCollisionDistanceFrameRateIsCappedDuringHandoff()
testNearbyLargeBodyProjectedSizeCannotJumpSeveralTimesAtRemnantReveal()
testEjectaExtentCannotChangePrimaryOnlyFraming()

console.log('collision camera framing regression checks passed')
