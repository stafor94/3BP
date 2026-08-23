import type { BodyState, Vec3 } from '../types'
import { add, magnitude, magnitudeSquared, scale, sub } from './vector'

const G = 1
const SOFTENING_SQUARED = 1e-6

const cloneBody = (body: BodyState): BodyState => ({
  ...body,
  position: { ...body.position },
  velocity: { ...body.velocity },
})

function accelerations(bodies: BodyState[]): Vec3[] {
  return bodies.map((body, i) => {
    let acceleration: Vec3 = { x: 0, y: 0, z: 0 }

    bodies.forEach((other, j) => {
      if (i === j) return
      const delta = sub(other.position, body.position)
      const distanceSquared = magnitudeSquared(delta) + SOFTENING_SQUARED
      const invDistanceCubed = 1 / Math.pow(distanceSquared, 1.5)
      acceleration = add(acceleration, scale(delta, G * other.mass * invDistanceCubed))
    })

    return acceleration
  })
}

function mergeCollisions(input: BodyState[]): BodyState[] {
  const bodies = input.map(cloneBody)
  let merged = true

  while (merged) {
    merged = false
    outer: for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i]
        const b = bodies[j]
        if (magnitude(sub(a.position, b.position)) > a.radius + b.radius) continue

        const mass = a.mass + b.mass
        const position = scale(add(scale(a.position, a.mass), scale(b.position, b.mass)), 1 / mass)
        const velocity = scale(add(scale(a.velocity, a.mass), scale(b.velocity, b.mass)), 1 / mass)
        const radius = Math.cbrt(a.radius ** 3 + b.radius ** 3)

        bodies.splice(j, 1)
        bodies.splice(i, 1, {
          id: `${a.id}+${b.id}`,
          name: `${a.name} + ${b.name}`,
          color: a.mass >= b.mass ? a.color : b.color,
          mass,
          radius,
          position,
          velocity,
        })
        merged = true
        break outer
      }
    }
  }

  return bodies
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  if (dt <= 0) return input.map(cloneBody)

  if (input.length < 2) {
    return input.map((body) => ({
      ...cloneBody(body),
      position: add(body.position, scale(body.velocity, dt)),
    }))
  }

  const bodies = input.map(cloneBody)
  const a0 = accelerations(bodies)

  const nextPositions = bodies.map((body, i) =>
    add(add(body.position, scale(body.velocity, dt)), scale(a0[i], 0.5 * dt * dt)),
  )

  const provisional = bodies.map((body, i) => ({ ...body, position: nextPositions[i] }))
  const a1 = accelerations(provisional)

  const integrated = provisional.map((body, i) => ({
    ...body,
    velocity: add(body.velocity, scale(add(a0[i], a1[i]), 0.5 * dt)),
  }))

  return mergeCollisions(integrated)
}
