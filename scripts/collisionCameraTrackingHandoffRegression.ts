import { calculatePerspectiveBodyDistance, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION } from '../src/rendering/cameraFraming'
import {
  getTrackingHandoffProgress,
  isCollisionCameraJustReleased,
  resolveCameraMode,
  shouldResetTrackingFocus,
} from '../src/rendering/trackingCameraHandoff'
import { isTrackingMassEligible } from '../src/trackingMassPolicy'
import { findTrackingCandidate } from '../src/trackingSelection'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeBody(id: string, mass: number, radius: number): BodyState {
  return {
    id,
    name: id,
    color: '#ffffff',
    mass,
    radius,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }
}

function testSameSelectionUsesCameraModeHandoff() {
  const trackedBodyId = 'A'
  const trackingBaseline = { sourceId: trackedBodyId, initialMass: 1 }
  const continuation = makeBody('A+B', 0.76, 0.3)
  continuation.trackingContinuationIds = [trackedBodyId]
  const trackedBody = findTrackingCandidate([continuation], trackedBodyId)

  assert(trackedBody?.id === continuation.id, 'authorized collision continuation must remain resolvable')
  assert(
    isTrackingMassEligible(trackedBody.mass, trackingBaseline.initialMass),
    'authorized continuation must pass the captured 50% mass baseline',
  )

  const selectionChanged = false
  const justReleased = isCollisionCameraJustReleased(true, false, trackedBody !== null)
  assert(justReleased, 'true -> false collision-camera transition must be observable')
  assert(
    shouldResetTrackingFocus(selectionChanged, justReleased),
    'camera-mode release must reset tracking focus even when the selection id is unchanged',
  )
  assert(
    resolveCameraMode(false, trackedBody !== null) === 'tracking',
    'release frame with a valid tracked body must go directly to tracking mode',
  )
  assert(trackingBaseline.sourceId === trackedBodyId, 'camera handoff must preserve tracking baseline source id')
  assert(trackingBaseline.initialMass === 1, 'camera handoff must preserve tracking baseline mass')
}

function testTrackingSettleStartsAtCollisionTransformAndConvergesWithoutOvershoot() {
  const viewportWidth = 900
  const viewportHeight = 700
  const radius = 0.3
  const verticalFovDegrees = 55
  const collisionDistance = calculatePerspectiveBodyDistance({
    bodyRadius: radius,
    minRenderRadius: 0.025,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
    targetRadiusFraction: COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION,
  })
  const trackingDistance = calculatePerspectiveBodyDistance({
    bodyRadius: radius,
    minRenderRadius: 0.025,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  })

  assert(trackingDistance > collisionDistance, 'fixture must require a collision-to-tracking distance handoff')

  const totalFrames = 18
  let previousDistance = collisionDistance
  let previousError = Math.abs(collisionDistance - trackingDistance)
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const progress = getTrackingHandoffProgress(frame, totalFrames)
    const distance = collisionDistance + (trackingDistance - collisionDistance) * progress
    const error = Math.abs(distance - trackingDistance)
    const relativeStep = Math.abs(distance - previousDistance) / Math.max(previousDistance, 1e-9)

    if (frame === 0) {
      assert(progress === 0, 'release frame must start at exact collision-camera transform')
      assert(distance === collisionDistance, 'release frame must preserve collision-camera distance exactly')
    } else {
      assert(error <= previousError + 1e-12, 'tracking handoff distance error must decrease every moving frame')
      assert(relativeStep <= 0.25, 'tracking handoff must stay inside normal one-frame zoom motion')
      assert(distance <= trackingDistance + 1e-12, 'tracking handoff must not overshoot the auto-distance target')
    }

    previousDistance = distance
    previousError = error
  }

  assert(getTrackingHandoffProgress(totalFrames - 1, totalFrames) === 1, 'existing 18-frame settle budget must end at progress one')
  assert(previousError <= 1e-12, 'tracking handoff must reach the normal tracking distance without a residual snap')
}

function testBelowHalfContinuationStaysReleased() {
  const continuation = makeBody('A+B', 0.49, 0.2)
  continuation.trackingContinuationIds = ['A']
  const candidate = findTrackingCandidate([continuation], 'A')
  assert(candidate?.id === continuation.id, 'fixture must resolve the explicit continuation before the mass gate')
  assert(!isTrackingMassEligible(candidate.mass, 1), 'below-half continuation must remain rejected')
  assert(
    resolveCameraMode(false, false) === 'preserve',
    'when tracking is genuinely released, camera mode must preserve the existing view instead of reviving tracking',
  )
  assert(
    !isCollisionCameraJustReleased(true, false, false),
    'collision-camera release must not synthesize a tracking handoff without a valid tracked body',
  )
}

const tests = [
  testSameSelectionUsesCameraModeHandoff,
  testTrackingSettleStartsAtCollisionTransformAndConvergesWithoutOvershoot,
  testBelowHalfContinuationStaysReleased,
]

for (const test of tests) test()
console.log(`collision camera tracking handoff regression checks passed (${tests.length})`)
