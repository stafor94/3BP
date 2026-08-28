import type { BodyState } from '../types'
import { getRenderedBodyRadius } from './cameraFraming'

export const MIN_BODY_RENDER_RADIUS = 0.025
export const MIN_FRAGMENT_RENDER_RADIUS = 0.006

export function getBodyPresentationRadius(bodyRadius: number) {
  return getRenderedBodyRadius(bodyRadius, MIN_BODY_RENDER_RADIUS)
}

export function getFragmentPresentationRadius(bodyRadius: number) {
  return getRenderedBodyRadius(bodyRadius, MIN_FRAGMENT_RENDER_RADIUS)
}

export function getSimulationBodyPresentationRadius(
  body: Pick<BodyState, 'bodyType' | 'radius'>,
) {
  return body.bodyType === 'fragment'
    ? getFragmentPresentationRadius(body.radius)
    : getBodyPresentationRadius(body.radius)
}
