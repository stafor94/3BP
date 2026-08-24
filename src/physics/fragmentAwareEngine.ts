import { getEffectiveBodyType } from '../bodyTypes'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState } from '../types'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'

// Large solid fragments behave as long-lived asteroids. Keep the cap deliberately
// small so N-body cost remains predictable even after many collisions.
const ASTEROID_MIN_RADIUS = 0.012
const ASTEROID_MIN_MASS = 0.0003
const MAX_PERSISTENT_ASTEROIDS = 10

function isBodyDescendedFrom(bodyId: string, ancestorId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return ancestorId.split('+').every((part) => bodyParts.has(part))
}

function isStellarSolidFragment(body: BodyState, inputStars: BodyState[]) {
  if (body.bodyType !== 'fragment') return false
  return inputStars.some((star) => isBodyDescendedFrom(body.id, star.id))
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
  const inputStars = input.filter((body) => getEffectiveBodyType(body) === 'star')
  const stepped = stepPhysicsBodies(input, dt)

  // A stellar collision must never leave asteroid-like solid chunks. Keep the
  // short-lived effect bodies, though: bodyLighting renders stellar plasma and
  // collision flashes as glow-only sprites rather than spherical body meshes.
  const visibleBodies = stepped.filter((body) => !isStellarSolidFragment(body, inputStars))
  const persistentAsteroidIds = selectPersistentAsteroidIds(visibleBodies)

  return visibleBodies
    .map((body) => {
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
          lifetime: 0.9,
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
