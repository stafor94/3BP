import { getRenderedBodyRadius } from './cameraFraming'

export const MIN_BODY_RENDER_RADIUS = 0.025

export function getBodyPresentationRadius(bodyRadius: number) {
  return getRenderedBodyRadius(bodyRadius, MIN_BODY_RENDER_RADIUS)
}
