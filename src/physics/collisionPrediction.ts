import type { BodyState, Vec3 } from '../types'

const G = 1
const SOFTENING_SQUARED = 1e-6
const PREDICTION_STEPS = 48
const REFINEMENT_STEPS = 12

export type CollisionPrediction = {
  pairKey: string
  bodyAId: string
  bodyBId: string
  bodyAName: string
  bodyBName: string
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

function isPredictionBody(body: BodyState) {
  return body.bodyType !== 'effect' && body.bodyType !== 'fragment' && body.mass > 0 && body.radius > 0
}

function accelerations(bodies: BodyState[]) {
  return bodies.map((body, index) => {
    if (!isPredictionBody(body)) return { x: 0, y: 0, z: 0 }

    let acceleration: Vec3 = { x: 0, y: 0, z: 0 }
    bodies.forEach((other, otherIndex) => {
      if (index === otherIndex || other.bodyType === 'effect' || other.mass <= 0) return
      const delta = sub(other.position, body.position)
      const distanceSquared = magnitudeSquared(delta) + SOFTENING_SQUARED
      const invDistanceCubed = 1 / Math.pow(distanceSquared, 1.5)
      acceleration = add(acceleration, scale(delta, G * other.mass * invDistanceCubed))
    })
    return acceleration
  })
}

function relativePositionAt(relativePosition: Vec3, relativeVelocity: Vec3, relativeAcceleration: Vec3, time: number) {
  return add(
    add(relativePosition, scale(relativeVelocity, time)),
    scale(relativeAcceleration, 0.5 * time * time),
  )
}

function bodyPositionAt(body: BodyState, acceleration: Vec3, time: number) {
  return add(
    add(body.position, scale(body.velocity, time)),
    scale(acceleration, 0.5 * time * time),
  )
}

function predictPair(
  a: BodyState,
  b: BodyState,
  accelerationA: Vec3,
  accelerationB: Vec3,
  horizon: number,
): CollisionPrediction | null {
  const relativePosition = sub(b.position, a.position)
  const relativeVelocity = sub(b.velocity, a.velocity)
  const relativeAcceleration = sub(accelerationB, accelerationA)
  const contactDistance = a.radius + b.radius
  const contactDistanceSquared = contactDistance * contactDistance
  const currentDistanceSquared = magnitudeSquared(relativePosition)

  if (currentDistanceSquared <= contactDistanceSquared) return null

  const radialClosing = dot(relativePosition, relativeVelocity)
  const radialAcceleration = dot(relativePosition, relativeAcceleration)
  if (radialClosing >= 0 && radialAcceleration >= 0) return null

  let previousTime = 0
  let previousGap = currentDistanceSquared - contactDistanceSquared
  let impactStart = -1
  let impactEnd = -1

  for (let step = 1; step <= PREDICTION_STEPS; step += 1) {
    const time = (horizon * step) / PREDICTION_STEPS
    const relative = relativePositionAt(relativePosition, relativeVelocity, relativeAcceleration, time)
    const gap = magnitudeSquared(relative) - contactDistanceSquared

    if (gap <= 0 && previousGap > 0) {
      impactStart = previousTime
      impactEnd = time
      break
    }

    previousTime = time
    previousGap = gap
  }

  if (impactStart < 0 || impactEnd < 0) return null

  for (let iteration = 0; iteration < REFINEMENT_STEPS; iteration += 1) {
    const middle = (impactStart + impactEnd) * 0.5
    const relative = relativePositionAt(relativePosition, relativeVelocity, relativeAcceleration, middle)
    if (magnitudeSquared(relative) <= contactDistanceSquared) impactEnd = middle
    else impactStart = middle
  }

  const timeToImpact = impactEnd
  const positionA = bodyPositionAt(a, accelerationA, timeToImpact)
  const positionB = bodyPositionAt(b, accelerationB, timeToImpact)
  const totalMass = Math.max(a.mass + b.mass, 1e-9)
  const point = scale(add(scale(positionA, a.mass), scale(positionB, b.mass)), 1 / totalMass)
  const relativeAtImpact = add(relativeVelocity, scale(relativeAcceleration, timeToImpact))

  return {
    pairKey: [a.id, b.id].sort().join('::'),
    bodyAId: a.id,
    bodyBId: b.id,
    bodyAName: a.name,
    bodyBName: b.name,
    timeToImpact,
    point,
    closingSpeed: magnitude(relativeAtImpact),
  }
}

export function predictUpcomingCollision(bodies: BodyState[], horizon: number): CollisionPrediction | null {
  if (horizon <= 0) return null

  const acceleration = accelerations(bodies)
  let earliest: CollisionPrediction | null = null

  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i]
    if (!isPredictionBody(a) || (a.collisionCooldown ?? 0) > 0) continue

    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j]
      if (!isPredictionBody(b) || (b.collisionCooldown ?? 0) > 0) continue

      const prediction = predictPair(a, b, acceleration[i], acceleration[j], horizon)
      if (!prediction) continue
      if (!earliest || prediction.timeToImpact < earliest.timeToImpact) earliest = prediction
    }
  }

  return earliest
}
