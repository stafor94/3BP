import { getEffectiveBodyType } from '../bodyTypes'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'
const COLLISION_FLASH_NAME = 'Collision flash'

// At the collision-watch impact speed (0.03x), 0.045 simulated seconds takes
// 1.5 real seconds. Keep the physical result advancing in the background while
// the renderer receives the two colliders for a short, readable contact phase.
const COLLISION_TRANSITION_SIM_DURATION = 0.045
const COLLISION_CONTACT_PROGRESS = 0.58

// Large solid fragments behave as long-lived asteroids. Keep the cap deliberately
// small so N-body cost remains predictable even after many collisions.
const ASTEROID_MIN_RADIUS = 0.012
const ASTEROID_MIN_MASS = 0.0003
const MAX_PERSISTENT_ASTEROIDS = 10

type CollisionTransition = {
  bodyA: BodyState
  bodyB: BodyState
  physicalBodies: BodyState[]
  elapsed: number
}

type CollisionContactPositions = {
  bodyA: Vec3
  bodyB: Vec3
}

// The simulator feeds each returned body array directly into the next physics
// step. A WeakMap lets a staged collision follow that exact array chain without
// leaking state across preset changes or resets, which create a different array.
const collisionTransitionByFrame = new WeakMap<BodyState[], CollisionTransition>()

function cloneBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
  }
}

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

function finalizePhysicalBodies(input: BodyState[], stepped: BodyState[], dt: number) {
  const inputStars = input.filter((body) => getEffectiveBodyType(body) === 'star')

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

function advancePhysicalBodies(input: BodyState[], dt: number) {
  return finalizePhysicalBodies(input, stepPhysicsBodies(input, dt), dt)
}

function findNewCollisionPair(input: BodyState[], stepped: BodyState[], dt: number) {
  const freshFlashes = stepped.filter((body) =>
    body.bodyType === 'effect' &&
    body.name === COLLISION_FLASH_NAME &&
    (body.age ?? Number.POSITIVE_INFINITY) <= dt + 1e-9,
  )

  for (const flash of freshFlashes) {
    for (let i = 0; i < input.length; i += 1) {
      const bodyA = input[i]
      if (bodyA.bodyType === 'effect') continue

      for (let j = i + 1; j < input.length; j += 1) {
        const bodyB = input[j]
        if (bodyB.bodyType === 'effect') continue

        if (
          flash.id.startsWith(`${bodyA.id}+${bodyB.id}+flash`) ||
          flash.id.startsWith(`${bodyB.id}+${bodyA.id}+flash`)
        ) {
          return { bodyA: cloneBody(bodyA), bodyB: cloneBody(bodyB) }
        }
      }
    }
  }

  return null
}

function largestDescendant(bodies: BodyState[], ancestorId: string) {
  return bodies
    .filter((body) => body.bodyType !== 'effect' && isBodyDescendedFrom(body.id, ancestorId))
    .reduce<BodyState | null>(
      (largest, body) => (!largest || body.mass > largest.mass ? body : largest),
      null,
    )
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  }
}

function smoothstep01(value: number) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function getCollisionContactPositions(a: BodyState, b: BodyState): CollisionContactPositions {
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const distance = Math.hypot(delta.x, delta.y, delta.z)
  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    y: b.velocity.y - a.velocity.y,
    z: b.velocity.z - a.velocity.z,
  }
  const relativeSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z)
  const normal = distance > 1e-10
    ? {
        x: delta.x / distance,
        y: delta.y / distance,
        z: delta.z / distance,
      }
    : relativeSpeed > 1e-10
      ? {
          x: relativeVelocity.x / relativeSpeed,
          y: relativeVelocity.y / relativeSpeed,
          z: relativeVelocity.z / relativeSpeed,
        }
      : { x: 1, y: 0, z: 0 }
  const totalMass = Math.max(a.mass + b.mass, 1e-9)
  const center = {
    x: (a.position.x * a.mass + b.position.x * b.mass) / totalMass,
    y: (a.position.y * a.mass + b.position.y * b.mass) / totalMass,
    z: (a.position.z * a.mass + b.position.z * b.mass) / totalMass,
  }
  const contactDistance = getCollisionContactDistance(a, b)

  return {
    bodyA: {
      x: center.x - normal.x * contactDistance * (b.mass / totalMass),
      y: center.y - normal.y * contactDistance * (b.mass / totalMass),
      z: center.z - normal.z * contactDistance * (b.mass / totalMass),
    },
    bodyB: {
      x: center.x + normal.x * contactDistance * (a.mass / totalMass),
      y: center.y + normal.y * contactDistance * (a.mass / totalMass),
      z: center.z + normal.z * contactDistance * (a.mass / totalMass),
    },
  }
}

function brightenHex(color: string, amount: number) {
  const normalized = color.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color

  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const mix = Math.min(1, Math.max(0, amount))
  const channel = (value: number) => Math.round(lerp(value, 255, mix))
    .toString(16)
    .padStart(2, '0')

  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

function animateCollider(
  body: BodyState,
  contactPosition: Vec3,
  target: BodyState | null,
  progress: number,
) {
  const approachProgress = smoothstep01(progress / COLLISION_CONTACT_PROGRESS)
  const departureProgress = smoothstep01(
    (progress - COLLISION_CONTACT_PROGRESS) / (1 - COLLISION_CONTACT_PROGRESS),
  )
  const fallbackTarget = {
    position: {
      x: contactPosition.x + body.velocity.x * COLLISION_TRANSITION_SIM_DURATION,
      y: contactPosition.y + body.velocity.y * COLLISION_TRANSITION_SIM_DURATION,
      z: contactPosition.z + body.velocity.z * COLLISION_TRANSITION_SIM_DURATION,
    },
    velocity: body.velocity,
  }
  const destination = target ?? fallbackTarget
  const position = progress <= COLLISION_CONTACT_PROGRESS
    ? lerpVec3(body.position, contactPosition, approachProgress)
    : lerpVec3(contactPosition, destination.position, departureProgress)
  const velocityProgress = progress <= COLLISION_CONTACT_PROGRESS
    ? approachProgress * COLLISION_CONTACT_PROGRESS
    : COLLISION_CONTACT_PROGRESS + departureProgress * (1 - COLLISION_CONTACT_PROGRESS)
  const pulse = 1 + Math.sin(Math.PI * progress) * 0.12
  const whiteMix = Math.sin(Math.PI * progress) * 0.42 + progress * 0.12

  return {
    ...cloneBody(body),
    color: brightenHex(body.color, whiteMix),
    radius: body.radius * pulse,
    position,
    velocity: lerpVec3(body.velocity, destination.velocity, velocityProgress),
    collisionCooldown: 0,
  }
}

function buildCollisionTransitionFrame(transition: CollisionTransition) {
  const progress = Math.min(
    1,
    Math.max(0, transition.elapsed / COLLISION_TRANSITION_SIM_DURATION),
  )
  const targetA = largestDescendant(transition.physicalBodies, transition.bodyA.id)
  const targetB = largestDescendant(transition.physicalBodies, transition.bodyB.id)
  const contactPositions = getCollisionContactPositions(transition.bodyA, transition.bodyB)

  // Hide the already-resolved remnant/survivors/debris for the colliding pair
  // while keeping real collision effects (flash/plasma/sparks) and all unrelated
  // bodies moving according to the physical solution in the background.
  const backgroundBodies = transition.physicalBodies.filter((body) => {
    if (body.bodyType === 'effect') return true
    return !(
      isBodyDescendedFrom(body.id, transition.bodyA.id) ||
      isBodyDescendedFrom(body.id, transition.bodyB.id)
    )
  })

  return [
    ...backgroundBodies,
    animateCollider(transition.bodyA, contactPositions.bodyA, targetA, progress),
    animateCollider(transition.bodyB, contactPositions.bodyB, targetB, progress),
  ]
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const activeTransition = collisionTransitionByFrame.get(input)
  if (activeTransition) {
    const nextPhysicalBodies = advancePhysicalBodies(activeTransition.physicalBodies, dt)
    const elapsed = activeTransition.elapsed + dt

    if (elapsed + 1e-12 >= COLLISION_TRANSITION_SIM_DURATION) {
      return nextPhysicalBodies
    }

    const nextTransition: CollisionTransition = {
      ...activeTransition,
      physicalBodies: nextPhysicalBodies,
      elapsed,
    }
    const frame = buildCollisionTransitionFrame(nextTransition)
    collisionTransitionByFrame.set(frame, nextTransition)
    return frame
  }

  const physicalBodies = advancePhysicalBodies(input, dt)
  const collisionPair = findNewCollisionPair(input, physicalBodies, dt)
  if (!collisionPair) return physicalBodies

  const transition: CollisionTransition = {
    ...collisionPair,
    physicalBodies,
    elapsed: 0,
  }
  const frame = buildCollisionTransitionFrame(transition)
  collisionTransitionByFrame.set(frame, transition)
  return frame
}