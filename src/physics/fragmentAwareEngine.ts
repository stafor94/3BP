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

function isStellarCollisionArtifact(body: BodyState, inputStars: BodyState[]) {
  if (body.bodyType !== 'fragment' && body.bodyType !== 'effect') return false
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

  // The core engine has already applied stellar ejecta mass, volume and momentum
  // changes before this post-processing step. Every fragment/effect object whose
  // collision ancestry includes an input star is only a visual collision artifact.
  // Do not pass any of those objects to the normal spherical body renderer.
  // This includes Collision flash: leaving it visible creates a large blue/grey
  // sphere that is visually indistinguishable from a solid fragment.
  const visibleBodies = stepped.filter((body) => !isStellarCollisionArtifact(body, inputStars))
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
