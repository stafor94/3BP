import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState, Vec3 } from '../types'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'
const PLASMA_ID_TOKEN = '+plasma'
const STELLAR_PLASMA_LIFETIME = 1.35
const COLLISION_SPARK_LIFETIME = 0.9
const PLASMA_EXPANSION_RATE = 0.003
const PLASMA_MAX_RADIUS = 0.018
const PLASMA_DRAG_PER_SECOND = 0.18

// Large solid fragments behave as long-lived asteroids. Keep the cap deliberately
// small so N-body cost remains predictable even after many collisions.
const ASTEROID_MIN_RADIUS = 0.012
const ASTEROID_MIN_MASS = 0.0003
const MAX_PERSISTENT_ASTEROIDS = 10

const scaleVec = (value: Vec3, scale: number): Vec3 => ({
  x: value.x * scale,
  y: value.y * scale,
  z: value.z * scale,
})

function isPlasmaEffect(body: BodyState) {
  return body.bodyType === 'effect' && body.id.includes(PLASMA_ID_TOKEN)
}

function isAsteroidCandidate(body: BodyState) {
  return body.bodyType === 'fragment' &&
    body.radius >= ASTEROID_MIN_RADIUS &&
    body.mass >= ASTEROID_MIN_MASS
}

function selectPersistentAsteroidIds(bodies: BodyState[]) {
  return new Set(
    bodies
      .filter(isAsteroidCandidate)
      .sort((a, b) => {
        const massDelta = b.mass - a.mass
        if (Math.abs(massDelta) > 1e-12) return massDelta
        const radiusDelta = b.radius - a.radius
        if (Math.abs(radiusDelta) > 1e-12) return radiusDelta
        return a.id.localeCompare(b.id)
      })
      .slice(0, MAX_PERSISTENT_ASTEROIDS)
      .map((body) => body.id),
  )
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const stepped = stepPhysicsBodies(input, dt)
  const persistentAsteroidIds = selectPersistentAsteroidIds(stepped)

  return stepped
    .map((body) => {
      if (isPlasmaEffect(body)) {
        const age = body.age ?? 0
        const expansionBoost = 1 + Math.min(age, STELLAR_PLASMA_LIFETIME) * 0.12
        const drag = Math.exp(-PLASMA_DRAG_PER_SECOND * dt)
        return {
          ...body,
          radius: Math.min(
            PLASMA_MAX_RADIUS,
            body.radius + PLASMA_EXPANSION_RATE * expansionBoost * dt,
          ),
          velocity: scaleVec(body.velocity, drag),
          lifetime: STELLAR_PLASMA_LIFETIME,
        }
      }

      if (body.bodyType === 'fragment') {
        if (persistentAsteroidIds.has(body.id)) {
          return {
            ...body,
            age: undefined,
            lifetime: undefined,
          }
        }

        return {
          ...body,
          age: (body.age ?? 0) + dt,
          lifetime: FRAGMENT_LIFETIME,
        }
      }

      if (body.bodyType === 'effect' && body.name === COLLISION_SPARK_NAME) {
        return {
          ...body,
          lifetime: COLLISION_SPARK_LIFETIME,
        }
      }

      return body
    })
    .filter((body) => (
      body.bodyType !== 'fragment' ||
      persistentAsteroidIds.has(body.id) ||
      (body.age ?? 0) < FRAGMENT_LIFETIME
    ))
}
