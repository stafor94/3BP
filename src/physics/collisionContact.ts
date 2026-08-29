import type { BodyState, Vec3 } from '../types'

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const magnitudeSquared = (value: Vec3) => dot(value, value)

// Physics, collision prediction, and collision staging share one solid-body
// boundary. Atmosphere/corona effects belong to rendering only.
export function getCollisionContactDistance(a: BodyState, b: BodyState) {
  return a.radius + b.radius
}

// Return the first point where a linearly swept relative trajectory touches the
// shared solid-body boundary. Callers handle already-overlapping pairs separately.
export function getLinearCollisionContactFraction(
  relativeStart: Vec3,
  relativeEnd: Vec3,
  contactDistance: number,
): number | null {
  const contactDistanceSquared = contactDistance * contactDistance
  const startDistanceSquared = magnitudeSquared(relativeStart)
  if (startDistanceSquared <= contactDistanceSquared) return null

  const travel = {
    x: relativeEnd.x - relativeStart.x,
    y: relativeEnd.y - relativeStart.y,
    z: relativeEnd.z - relativeStart.z,
  }
  const a = magnitudeSquared(travel)
  if (a <= 1e-18) return null

  const b = 2 * dot(relativeStart, travel)
  const c = startDistanceSquared - contactDistanceSquared
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null

  const root = Math.sqrt(discriminant)
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  if (first >= 0 && first <= 1) return first
  if (second >= 0 && second <= 1) return second
  return null
}
