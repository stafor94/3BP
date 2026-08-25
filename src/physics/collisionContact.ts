import type { BodyState } from '../types'

// Physics and rendering use the same solid-body surface. Stellar atmosphere/glow
// belongs to rendering and must not move the physical collision boundary inward.
export function getCollisionContactScale(_a: BodyState, _b: BodyState) {
  return 1
}

export function getCollisionContactDistance(a: BodyState, b: BodyState) {
  return (a.radius + b.radius) * getCollisionContactScale(a, b)
}
