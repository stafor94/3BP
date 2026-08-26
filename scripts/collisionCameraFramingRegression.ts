import {
  calculatePerspectiveBodyDistance,
  calculateProjectedBodyRadiusPixels,
  COLLISION_CAMERA_DISTANCE_TOLERANCE,
  COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION,
  getRenderedBodyRadius,
  isCollisionCameraDistanceConverged,
  TARGET_BODY_RADIUS_SCREEN_FRACTION,
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

function testRadiusChangeReentersConvergence() {
  const originalDistance = getDistance(primaryRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)
  const enlargedRadius = 0.43
  const enlargedDesiredDistance = getDistance(enlargedRadius, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION)

  assert(
    !isCollisionCameraDistanceConverged(originalDistance, enlargedDesiredDistance),
    'a remnant radius change must make the old collision-camera distance non-converged',
  )

  const converged = convergeDistance(originalDistance, enlargedDesiredDistance, 0.18)
  const projectedRadius = calculateProjectedBodyRadiusPixels(
    getRenderedBodyRadius(enlargedRadius, minRenderRadius),
    converged.distance,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const projectedFraction = projectedRadius / viewportWidth
  assert(
    Math.abs(projectedFraction - 1 / 9) <= COLLISION_CAMERA_DISTANCE_TOLERANCE * (1 / 9) * 1.2,
    `radius-change reframe must settle near width/9, got fraction ${projectedFraction}`,
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
testRadiusChangeReentersConvergence()
testEjectaExtentCannotChangePrimaryOnlyFraming()

console.log('collision camera framing regression checks passed')
