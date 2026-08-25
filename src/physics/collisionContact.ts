import type { BodyState } from '../types'

// Physics, collision prediction, and collision staging share one solid-body
// boundary. Atmosphere/corona effects belong to rendering only.
export function getCollisionContactDistance(a: BodyState, b: BodyState) {
  return a.radius + b.radius
}
