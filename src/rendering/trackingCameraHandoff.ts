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

export function getTrackingHandoffProgress(completedFrames: number, totalFrames: number): number {
  if (totalFrames <= 0) return 1
  const progress = Math.min(1, Math.max(0, completedFrames / totalFrames))
  // Cubic ease-out starts almost exactly at the existing 0.16 tracking lerp
  // rate for an 18-frame settle, while reaching the destination without a
  // residual snap on the final frame.
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
