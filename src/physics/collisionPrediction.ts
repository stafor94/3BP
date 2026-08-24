import type { BodyState, BodyType, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'

const G = 1
const SOFTENING_SQUARED = 1e-6
const PREDICTION_DT = 0.003

export type CollisionPrediction = {
  pairKey: string
  bodyAId: string
  bodyBId: string
  bodyAName: string
  bodyBName: string
  bodyAType: BodyType
  bodyBType: BodyType
  timeToImpact: number
  point: Vec3
  closingSpeed: number
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (v: Vec3, value: number): Vec3 => ({ x: v.x * value, y: v.y * value, z: v.z * value })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const magnitudeSquared = (v: Vec3) => dot(v, v)
const magnitude = (v: Vec3) => Math.sqrt(magnitudeSquared(v))

function cloneBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
  }
}

function isPredictionBody(body: BodyState) {
  return body.bodyType !== 'effect' && body.bodyType !== 'fragment' && body.mass > 0 && body.radius > 0
}

function getPredictionBodyType(body: BodyState): BodyType {
  return body.bodyType ?? 'planet'
}

function accelerations(bodies: BodyState[]): Vec3[] {
  return bodies.map((body, index) => {
    let acceleration: Vec3 = { x: 0, y: 0, z: 0 }

    bodies.forEach((other, otherIndex) => {
      if (index === otherIndex || other.mass <= 0) return
      const delta = sub(other.position, body.position)
      const distanceSquared = magnitudeSquared(delta) + SOFTENING_SQUARED
      const invDistanceCubed = 1 / Math.pow(distanceSquared, 1.5)
      acceleration = add(acceleration, scale(delta, G * other.mass * invDistanceCubed))
    })

    return acceleration
  })
}

function contactFraction(relativeStart: Vec3, relativeEnd: Vec3, contactDistance: number): number | null {
  const contactDistanceSquared = contactDistance * contactDistance
  const startDistanceSquared = magnitudeSquared(relativeStart)

  if (startDistanceSquared <= contactDistanceSquared) return null

  const travel = sub(relativeEnd, relativeStart)
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

function interpolate(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(sub(b, a), t))
}

function findCollisionDuringStep(
  current: BodyState[],
  next: BodyState[],
  elapsed: number,
  dt: number,
): CollisionPrediction | null {
  let earliest: CollisionPrediction | null = null
  let earliestFraction = Infinity

  for (let i = 0; i < current.length; i += 1) {
    const a = current[i]
    if (!isPredictionBody(a) || (a.collisionCooldown ?? 0) > 0) continue

    for (let j = i + 1; j < current.length; j += 1) {
      const b = current[j]
      if (!isPredictionBody(b) || (b.collisionCooldown ?? 0) > 0) continue

      const relativeStart = sub(b.position, a.position)
      const relativeEnd = sub(next[j].position, next[i].position)
      const fraction = contactFraction(relativeStart, relativeEnd, getCollisionContactDistance(a, b))
      if (fraction === null || fraction >= earliestFraction) continue

      const positionA = interpolate(a.position, next[i].position, fraction)
      const positionB = interpolate(b.position, next[j].position, fraction)
      const velocityA = interpolate(a.velocity, next[i].velocity, fraction)
      const velocityB = interpolate(b.velocity, next[j].velocity, fraction)
      const totalMass = Math.max(a.mass + b.mass, 1e-9)
      const point = scale(add(scale(positionA, a.mass), scale(positionB, b.mass)), 1 / totalMass)
      const relativeVelocity = sub(velocityB, velocityA)
      const separation = sub(positionB, positionA)
      const separationLength = Math.max(magnitude(separation), 1e-9)
      const normal = scale(separation, 1 / separationLength)
      const radialClosingSpeed = -dot(relativeVelocity, normal)

      if (radialClosingSpeed <= 1e-5) continue

      earliestFraction = fraction
      earliest = {
        pairKey: [a.id, b.id].sort().join('::'),
        bodyAId: a.id,
        bodyBId: b.id,
        bodyAName: a.name,
        bodyBName: b.name,
        bodyAType: getPredictionBodyType(a),
        bodyBType: getPredictionBodyType(b),
        timeToImpact: elapsed + dt * fraction,
        point,
        closingSpeed: magnitude(relativeVelocity),
      }
    }
  }

  return earliest
}

function integrateStep(bodies: BodyState[], dt: number): BodyState[] {
  const a0 = accelerations(bodies)
  const nextPositions = bodies.map((body, index) =>
    add(
      add(body.position, scale(body.velocity, dt)),
      scale(a0[index], 0.5 * dt * dt),
    ),
  )

  const provisional = bodies.map((body, index) => ({
    ...cloneBody(body),
    position: nextPositions[index],
  }))
  const a1 = accelerations(provisional)

  return provisional.map((body, index) => ({
    ...body,
    velocity: add(bodies[index].velocity, scale(add(a0[index], a1[index]), 0.5 * dt)),
    collisionCooldown: body.collisionCooldown === undefined
      ? undefined
      : Math.max(0, body.collisionCooldown - dt),
  }))
}

export function predictUpcomingCollision(bodies: BodyState[], horizon: number): CollisionPrediction | null {
  if (horizon <= 0) return null

  let simulated = bodies.filter(isPredictionBody).map(cloneBody)
  if (simulated.length < 2) return null

  let elapsed = 0
  while (elapsed < horizon - 1e-12) {
    const dt = Math.min(PREDICTION_DT, horizon - elapsed)
    const next = integrateStep(simulated, dt)
    const collision = findCollisionDuringStep(simulated, next, elapsed, dt)
    if (collision) return collision

    simulated = next
    elapsed += dt
  }

  return null
}
