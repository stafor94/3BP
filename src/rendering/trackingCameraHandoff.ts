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

export function resolveCameraMode(
  collisionCameraFocused: boolean,
  hasTrackedBody: boolean,
): CameraMode {
  if (collisionCameraFocused) return 'collision'
  if (hasTrackedBody) return 'tracking'
  return 'preserve'
}
