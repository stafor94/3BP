import { getEffectiveBodyType } from '../bodyTypes'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'
const COLLISION_FLASH_NAME = 'Collision flash'

// Keep only a very short display-only contact bridge before topology resolution.
// Collision-watch slow motion is real-time phase controlled in App.tsx; stretching
// this simulated overlap would otherwise recreate a multi-second 0.03x stall.
const COLLISION_IMPACT_SIM_DURATION = 0.006
const STELLAR_MERGE_IMPACT_SIM_DURATION = 0.009
const IMPACT_MAX_OVERLAP_RATIO = 0.14
const STELLAR_MERGE_MAX_OVERLAP_RATIO = 0.34
const CONTACT_RESOLUTION_OVERLAP = 1e-6
const CONTACT_RESOLUTION_DT = 1e-8
const TRACKING_G = 1

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

type TrackingCollisionGeometry = {
  speedRatio: number
  headOn: number
  grazing: number
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
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
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
  const stepped = stepPhysicsBodies(input, dt)
  const withTrackingContinuity = attachAbsorptionTrackingContinuity(input, stepped, dt)
  return finalizePhysicalBodies(input, withTrackingContinuity, dt)
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

function getTrackingCollisionGeometry(a: BodyState, b: BodyState): TrackingCollisionGeometry {
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const distance = Math.hypot(delta.x, delta.y, delta.z)
  const normal = distance > 1e-10
    ? { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance }
    : { x: 1, y: 0, z: 0 }
  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    y: b.velocity.y - a.velocity.y,
    z: b.velocity.z - a.velocity.z,
  }
  const relativeSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z)
  const normalSpeed = relativeVelocity.x * normal.x +
    relativeVelocity.y * normal.y +
    relativeVelocity.z * normal.z
  const headOn = relativeSpeed > 1e-9
    ? Math.min(1, Math.max(0, Math.abs(normalSpeed) / relativeSpeed))
    : 1
  const grazing = Math.sqrt(Math.max(0, 1 - headOn * headOn))
  const contactDistance = Math.max(getCollisionContactDistance(a, b), 1e-6)
  const escapeSpeed = Math.sqrt(Math.max(0, (2 * TRACKING_G * (a.mass + b.mass)) / contactDistance))

  return {
    speedRatio: relativeSpeed / Math.max(escapeSpeed, 1e-6),
    headOn,
    grazing,
  }
}

function isAbsorptionCollision(
  a: BodyState,
  b: BodyState,
  mode: CollisionPresentationMode,
) {
  if (mode !== 'merge') return false

  const typeA = getEffectiveBodyType(a)
  const typeB = getEffectiveBodyType(b)

  // In the core collision classifier, exactly one fragment plus one physical body
  // can only resolve as hit-and-run or absorb. Reaching a single-remnant frame
  // therefore means absorption.
  if (typeA === 'fragment' || typeB === 'fragment') {
    return typeA !== typeB
  }

  const starCount = Number(typeA === 'star') + Number(typeB === 'star')
  // One star plus one non-star can likewise only hit-and-run or absorb.
  if (starCount === 1) return true
  if (starCount === 2) return false

  const hasPlanet = typeA === 'planet' || typeB === 'planet'
  const hasMoon = typeA === 'moon' || typeB === 'moon'
  if (!hasPlanet || !hasMoon || typeA === typeB) return false

  const massRatio = Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, 1e-9)
  if (massRatio >= 0.28) return false

  // Mirror the planet-moon absorption gate from the core engine so ordinary
  // tracking never treats an energetic merge/disruption as an absorption.
  const geometry = getTrackingCollisionGeometry(a, b)
  return geometry.grazing < 0.72 && geometry.speedRatio < 2.05
}

function attachAbsorptionTrackingContinuity(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
) {
  const collisionPair = findNewCollisionPair(input, stepped, dt)
  if (!collisionPair) return stepped

  const { bodyA, bodyB } = collisionPair
  const mode = inferCollisionPresentationMode(stepped, bodyA, bodyB)
  if (!isAbsorptionCollision(bodyA, bodyB, mode)) return stepped

  // Equal-mass collisions have no unambiguous larger absorber, so do not transfer
  // ordinary tracking in that case.
  const larger = bodyA.mass > bodyB.mass
    ? bodyA
    : bodyB.mass > bodyA.mass
      ? bodyB
      : null
  if (!larger) return stepped

  const remnant = stepped.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.id !== bodyA.id &&
    body.id !== bodyB.id &&
    isBodyDescendedFrom(body.id, bodyA.id) &&
    isBodyDescendedFrom(body.id, bodyB.id),
  )
  if (!remnant) return stepped

  const continuationIds = Array.from(new Set([
    ...(larger.trackingContinuationIds ?? []),
    larger.id,
  ]))

  return stepped.map((body) => (
    body === remnant
      ? { ...body, trackingContinuationIds: continuationIds }
      : body
  ))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep01(value: number) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function isStellarMerge(a: BodyState, b: BodyState, mode: CollisionPresentationMode) {
  return mode === 'merge' &&
    getEffectiveBodyType(a) === 'star' &&
    getEffectiveBodyType(b) === 'star'
}

function getImpactDuration(a: BodyState, b: BodyState, mode: CollisionPresentationMode) {
  return isStellarMerge(a, b, mode)
    ? STELLAR_MERGE_IMPACT_SIM_DURATION
    : COLLISION_IMPACT_SIM_DURATION
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
  const overlapRatio = isStellarMerge(a, b, mode)
    ? STELLAR_MERGE_MAX_OVERLAP_RATIO
    : IMPACT_MAX_OVERLAP_RATIO
  const maxOverlap = Math.min(a.radius, b.radius) * overlapRatio
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

function getTransitionDuration(transition: CollisionTransition) {
  const pair = getTransitionBodies(transition)
  if (!pair) return COLLISION_IMPACT_SIM_DURATION
  return getImpactDuration(pair.bodyA, pair.bodyB, transition.mode)
}

function buildCollisionImpactFrame(transition: CollisionTransition) {
  const pair = getTransitionBodies(transition)
  if (!pair) return transition.sourceBodies.map(cloneBody)

  const impactDuration = getImpactDuration(pair.bodyA, pair.bodyB, transition.mode)
  const progress = Math.min(1, Math.max(0, transition.elapsed / impactDuration))
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
  const impactDuration = getImpactDuration(pair.bodyA, pair.bodyB, transition.mode)
  const contactPositions = getDriftedCollisionContactPositions(
    pair.bodyA,
    pair.bodyB,
    impactDuration,
    CONTACT_RESOLUTION_OVERLAP,
  )

  return transition.sourceBodies
    .map((body) => {
      const advanced = advanceDisplayBody(body, impactDuration)
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
    const impactDuration = getTransitionDuration(activeTransition)
    const elapsed = activeTransition.elapsed + dt
    if (elapsed + 1e-12 >= impactDuration) {
      return resolveTransition(
        activeTransition,
        Math.max(0, elapsed - impactDuration),
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

  const mode = inferCollisionPresentationMode(
    probedPhysicalBodies,
    collisionPair.bodyA,
    collisionPair.bodyB,
  )
  const impactDuration = getImpactDuration(collisionPair.bodyA, collisionPair.bodyB, mode)
  const transition: CollisionTransition = {
    bodyAId: collisionPair.bodyA.id,
    bodyBId: collisionPair.bodyB.id,
    sourceBodies: input.map(cloneBody),
    elapsed: Math.min(dt, impactDuration),
    mode,
  }

  if (transition.elapsed + 1e-12 >= impactDuration) {
    return resolveTransition(transition, 0)
  }

  const frame = buildCollisionImpactFrame(transition)
  collisionTransitionByFrame.set(frame, transition)
  return frame
}
