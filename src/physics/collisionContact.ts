import type { BodyState } from '../types'

function isStar(body: BodyState) {
  if (body.bodyType) return body.bodyType === 'star'

  const name = body.name.toLowerCase()
  if (/star|helios|primary/.test(name) && body.mass >= 0.75) return true
  return body.mass >= 0.75
}

export function getCollisionContactScale(a: BodyState, b: BodyState) {
  const starA = isStar(a)
  const starB = isStar(b)

  if (starA && starB) return 0.72
  if (starA || starB) return 0.82
  return 1
}

export function getCollisionContactDistance(a: BodyState, b: BodyState) {
  return (a.radius + b.radius) * getCollisionContactScale(a, b)
}
