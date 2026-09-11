export type CameraMode = 'collision' | 'tracking' | 'preserve'

export function isCollisionCameraJustReleased(
  wasCollisionCameraFocused: boolean,
  collisionCameraFocused: boolean,
  hasTrackedBody: boolean,
): boolean {
  return wasCollisionCameraFocused && !collisionCameraFocused && hasTrackedBody
}

export function shouldResetTrackingFocus(
  selectionChanged: boolean,
  collisionCameraJustReleased: boolean,
): boolean {
  return selectionChanged || collisionCameraJustReleased
}

export function getTrackingHandoffProgress(frameIndex: number, totalFrames: number): number {
  if (totalFrames <= 1) return 1
  const progress = Math.min(1, Math.max(0, frameIndex / (totalFrames - 1)))
  // Cubic ease-out begins at the collision camera's exact rendered transform
  // and reaches the tracking composition inside the existing settle-frame
  // budget. With 18 frames the first moving step is ~0.166, matching the
  // existing 0.16 tracking lerp without lengthening the transition.
  return 1 - (1 - progress) ** 3
}

export function resolveCameraMode(
  collisionCameraFocused: boolean,
  hasTrackedBody: boolean,
): CameraMode {
  if (collisionCameraFocused) return 'collision'
  if (hasTrackedBody) return 'tracking'
  return 'preserve'
}
