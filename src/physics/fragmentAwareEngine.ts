import { getEffectiveBodyType } from '../bodyTypes'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'
const COLLISION_FLASH_NAME = 'Collision flash'

// At collision-watch impact speed (0.03x), 0.045 simulated seconds is roughly
// 1.5 real seconds. The normal pre-contact approach is handled by the real
// physics timeline; this window is reserved for the visible contact/impact itself.
const COLLISION_IMPACT_SIM_DURATION = 0.045
const IMPACT_MAX_OVERLAP_RATIO = 0.18
const CONTACT_RESOLUTION_OVERLAP = 1e-6
const CONTACT_RESOLUTION_DT = 1e-8

// Large solid fragments behave as long-lived asteroids. Keep the cap deliberately
// small so N-body cost remains predictable even after many collisions.
const ASTEROID_MIN_RADIUS = 0.012
const ASTEROID_MIN_MASS = 0.0003
const MAX_PERSISTENT_ASTEROIDS = 10

type CollisionPresentationMode = 'merge' | 'hitRun'

type CollisionTransition = {
  bodyAId: string
  bodyBId: string
  sourceBodies: BodyState[]
  elapsed: number
  mode: CollisionPresentationMode
}

type CollisionContactPositions = {
  bodyA: Vec3
  bodyB: Vec3
}

// The simulator feeds each returned body array directly into the next physics
// step. Keep transition state attached to that exact frame chain without leaking
// across preset changes or resets, which create a different array.
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
          return { bodyA, bodyB }
        }
      }
    }
  }

  return null
}

function inferCollisionPresentationMode(
  stepped: BodyState[],
  bodyA: BodyState,
  bodyB: BodyState,
): CollisionPresentationMode {
  const survivorA = stepped.some((body) => body.bodyType !== 'effect' && body.id === bodyA.id)
  const survivorB = stepped.some((body) => body.bodyType !== 'effect' && body.id === bodyB.id)
  return survivorA && survivorB ? 'hitRun' : 'merge'
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep01(value: number) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function getCollisionContactPositions(
  a: BodyState,
  b: BodyState,
  overlap = 0,
): CollisionContactPositions {
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
  const contactDistance = Math.max(0, getCollisionContactDistance(a, b) - overlap)

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

function getCenterVelocity(a: BodyState, b: BodyState): Vec3 {
  const totalMass = Math.max(a.mass + b.mass, 1e-9)
  return {
    x: (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass,
    y: (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass,
    z: (a.velocity.z * a.mass + b.velocity.z * b.mass) / totalMass,
  }
}

function getDriftedCollisionContactPositions(
  a: BodyState,
  b: BodyState,
  elapsed: number,
  overlap = 0,
): CollisionContactPositions {
  const contact = getCollisionContactPositions(a, b, overlap)
  const centerVelocity = getCenterVelocity(a, b)
  const drift = {
    x: centerVelocity.x * elapsed,
    y: centerVelocity.y * elapsed,
    z: centerVelocity.z * elapsed,
  }

  return {
    bodyA: {
      x: contact.bodyA.x + drift.x,
      y: contact.bodyA.y + drift.y,
      z: contact.bodyA.z + drift.z,
    },
    bodyB: {
      x: contact.bodyB.x + drift.x,
      y: contact.bodyB.y + drift.y,
      z: contact.bodyB.z + drift.z,
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

function advanceDisplayBody(body: BodyState, elapsed: number): BodyState {
  const next = cloneBody(body)
  next.position = {
    x: body.position.x + body.velocity.x * elapsed,
    y: body.position.y + body.velocity.y * elapsed,
    z: body.position.z + body.velocity.z * elapsed,
  }
  if (body.collisionCooldown !== undefined) {
    next.collisionCooldown = Math.max(0, body.collisionCooldown - elapsed)
  }
  if (body.bodyType === 'effect') next.age = (body.age ?? 0) + elapsed
  return next
}

function isExpiredEffect(body: BodyState) {
  return body.bodyType === 'effect' && (body.age ?? 0) >= (body.lifetime ?? 2)
}

function getImpactOverlap(
  a: BodyState,
  b: BodyState,
  progress: number,
  mode: CollisionPresentationMode,
) {
  const maxOverlap = Math.min(a.radius, b.radius) * IMPACT_MAX_OVERLAP_RATIO
  if (mode === 'hitRun') return maxOverlap * Math.sin(Math.PI * progress)
  return maxOverlap * smoothstep01(progress)
}

function animateCollider(
  body: BodyState,
  impactPosition: Vec3,
  progress: number,
  mode: CollisionPresentationMode,
) {
  const energy = mode === 'hitRun'
    ? Math.sin(Math.PI * progress)
    : smoothstep01(progress)
  const whiteMix = 0.04 + energy * 0.46

  return {
    ...cloneBody(body),
    color: brightenHex(body.color, whiteMix),
    position: { ...impactPosition },
  }
}

function getTransitionBodies(transition: CollisionTransition) {
  const bodyA = transition.sourceBodies.find((body) => body.id === transition.bodyAId)
  const bodyB = transition.sourceBodies.find((body) => body.id === transition.bodyBId)
  if (!bodyA || !bodyB) return null
  return { bodyA, bodyB }
}

function buildCollisionImpactFrame(transition: CollisionTransition) {
  const pair = getTransitionBodies(transition)
  if (!pair) return transition.sourceBodies.map(cloneBody)

  const progress = Math.min(1, Math.max(0, transition.elapsed / COLLISION_IMPACT_SIM_DURATION))
  const overlap = getImpactOverlap(pair.bodyA, pair.bodyB, progress, transition.mode)
  const impactPositions = getDriftedCollisionContactPositions(
    pair.bodyA,
    pair.bodyB,
    transition.elapsed,
    overlap,
  )

  return transition.sourceBodies
    .map((body) => {
      if (body.id === pair.bodyA.id) {
        return animateCollider(body, impactPositions.bodyA, progress, transition.mode)
      }
      if (body.id === pair.bodyB.id) {
        return animateCollider(body, impactPositions.bodyB, progress, transition.mode)
      }
      return advanceDisplayBody(body, transition.elapsed)
    })
    .filter((body) => !isExpiredEffect(body))
}

function buildContactPhysicalFrame(transition: CollisionTransition) {
  const pair = getTransitionBodies(transition)
  if (!pair) return transition.sourceBodies.map(cloneBody)

  // Resolve a microscopic amount inside the mathematical surface so the engine
  // cannot miss contact because of floating-point drift or an outward substep.
  // The display-only impact overlap above is never fed into the physical solver.
  const contactPositions = getDriftedCollisionContactPositions(
    pair.bodyA,
    pair.bodyB,
    COLLISION_IMPACT_SIM_DURATION,
    CONTACT_RESOLUTION_OVERLAP,
  )

  return transition.sourceBodies
    .map((body) => {
      const advanced = advanceDisplayBody(body, COLLISION_IMPACT_SIM_DURATION)
      if (body.id === pair.bodyA.id) return { ...advanced, position: contactPositions.bodyA }
      if (body.id === pair.bodyB.id) return { ...advanced, position: contactPositions.bodyB }
      return advanced
    })
    .filter((body) => !isExpiredEffect(body))
}

function isAtOrInsideContact(a: BodyState, b: BodyState) {
  const distance = Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
  return distance <= getCollisionContactDistance(a, b) + 1e-9
}

function resolveTransition(transition: CollisionTransition, overshoot: number) {
  const contactFrame = buildContactPhysicalFrame(transition)
  let resolved = advancePhysicalBodies(contactFrame, CONTACT_RESOLUTION_DT)
  if (overshoot > 0) resolved = advancePhysicalBodies(resolved, overshoot)
  return resolved
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const activeTransition = collisionTransitionByFrame.get(input)
  if (activeTransition) {
    const elapsed = activeTransition.elapsed + dt
    if (elapsed + 1e-12 >= COLLISION_IMPACT_SIM_DURATION) {
      return resolveTransition(
        activeTransition,
        Math.max(0, elapsed - COLLISION_IMPACT_SIM_DURATION),
      )
    }

    const nextTransition: CollisionTransition = {
      ...activeTransition,
      elapsed,
    }
    const frame = buildCollisionImpactFrame(nextTransition)
    collisionTransitionByFrame.set(frame, nextTransition)
    return frame
  }

  // Probe one normal physics step only to discover whether this frame would cross
  // a collision surface. If so, discard that already-resolved future state and
  // enter a contact/impact phase from the current frame. The natural approach is
  // no longer stretched or replayed; only the actual collision is slowed down.
  const probedPhysicalBodies = advancePhysicalBodies(input, dt)
  const collisionPair = findNewCollisionPair(input, probedPhysicalBodies, dt)
  if (!collisionPair) return probedPhysicalBodies

  // If the frame already starts at/inside contact, do not invent an extra visual
  // transition. Accept the physical result immediately; this handles resumed old
  // states and avoids repeatedly staging an already-colliding pair.
  if (isAtOrInsideContact(collisionPair.bodyA, collisionPair.bodyB)) {
    return probedPhysicalBodies
  }

  const transition: CollisionTransition = {
    bodyAId: collisionPair.bodyA.id,
    bodyBId: collisionPair.bodyB.id,
    sourceBodies: input.map(cloneBody),
    elapsed: Math.min(dt, COLLISION_IMPACT_SIM_DURATION),
    mode: inferCollisionPresentationMode(
      probedPhysicalBodies,
      collisionPair.bodyA,
      collisionPair.bodyB,
    ),
  }

  if (transition.elapsed + 1e-12 >= COLLISION_IMPACT_SIM_DURATION) {
    return resolveTransition(transition, 0)
  }

  const frame = buildCollisionImpactFrame(transition)
  collisionTransitionByFrame.set(frame, transition)
  return frame
}
