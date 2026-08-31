import { getEffectiveBodyType } from '../bodyTypes'
import { getBodyPresentationRadius } from '../rendering/bodyPresentationRadius'
import type { BodyState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { stepBodies as stepFragmentAwareBodies } from './fragmentAwareEngineCore'

// The core engine already resolves swept collisions at first physical contact.
// This guard owns only the short-lived non-stellar impact bridge returned before
// that exact physical outcome is revealed. Limiting overlap as a fraction of the
// smaller current body radius keeps an intact/partially collapsed collider near
// the contact surface instead of letting its center sink deep into its partner.
export const MAX_NON_STELLAR_NORMALIZED_PENETRATION = 0.18

const POSITION_EPSILON = 1e-12
const POST_IMPACT_MOTION_SIM_DURATION = 0.024
const POST_IMPACT_NORMAL_TRAVEL_RATIO = 0.14
const POST_IMPACT_TANGENTIAL_TRAVEL_RATIO = 0.6

type PostImpactMotionState = {
  bodyAId: string
  bodyBId: string
  elapsed: number
  normal: Vec3
  relativeVelocity: Vec3
  massA: number
  massB: number
  minimumPhysicalRadius: number
  minimumPresentationRadius: number
}

const postImpactMotionByFrame = new WeakMap<BodyState[], PostImpactMotionState>()
const postImpactMotionOffsetByBody = new WeakMap<BodyState, Vec3>()

function isCorrectableSolid(body: BodyState) {
  return body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    getEffectiveBodyType(body) !== 'star'
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function vectorLength(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = vectorLength(value)
  if (length > POSITION_EPSILON) {
    return { x: value.x / length, y: value.y / length, z: value.z / length }
  }
  const fallbackLength = vectorLength(fallback)
  if (fallbackLength > POSITION_EPSILON) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
      z: fallback.z / fallbackLength,
    }
  }
  return { x: 1, y: 0, z: 0 }
}

function isSameVelocity(a: BodyState, b: BodyState) {
  return Math.abs(a.velocity.x - b.velocity.x) <= POSITION_EPSILON &&
    Math.abs(a.velocity.y - b.velocity.y) <= POSITION_EPSILON &&
    Math.abs(a.velocity.z - b.velocity.z) <= POSITION_EPSILON
}

function limitVectorLength(value: Vec3, maximum: number): Vec3 {
  const length = vectorLength(value)
  if (length <= maximum || length <= POSITION_EPSILON) return value
  return scale(value, maximum / length)
}

function findNewPostImpactMotionState(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
): PostImpactMotionState | null {
  const nextById = new Map(
    stepped
      .filter(isCorrectableSolid)
      .map((body) => [body.id, body]),
  )
  const solids = input.filter(isCorrectableSolid)

  for (let i = 0; i < solids.length; i += 1) {
    const bodyA = solids[i]
    const nextA = nextById.get(bodyA.id)
    if (!nextA || !isSameVelocity(bodyA, nextA)) continue

    for (let j = i + 1; j < solids.length; j += 1) {
      const bodyB = solids[j]
      const nextB = nextById.get(bodyB.id)
      if (!nextB || !isSameVelocity(bodyB, nextB)) continue

      const delta = subtract(bodyB.position, bodyA.position)
      const relativeVelocity = subtract(bodyB.velocity, bodyA.velocity)
      const normal = normalize(delta, relativeVelocity)
      const closingSpeed = dot(relativeVelocity, normal)
      if (closingSpeed >= -POSITION_EPSILON) continue

      const contactDistance = getCollisionContactDistance(bodyA, bodyB)
      const distance = vectorLength(delta)
      const nextDistance = vectorLength(subtract(nextB.position, nextA.position))
      const minimumPhysicalRadius = Math.max(
        Math.min(bodyA.radius, bodyB.radius),
        POSITION_EPSILON,
      )
      const sweptSlack = Math.max(
        1e-6,
        Math.abs(closingSpeed) * dt * 1.5,
        minimumPhysicalRadius * 0.02,
      )
      if (Math.min(distance, nextDistance) > contactDistance + sweptSlack) continue

      return {
        bodyAId: bodyA.id,
        bodyBId: bodyB.id,
        elapsed: dt,
        normal,
        relativeVelocity,
        massA: bodyA.mass,
        massB: bodyB.mass,
        minimumPhysicalRadius,
        minimumPresentationRadius: Math.max(
          Math.min(
            getBodyPresentationRadius(bodyA.radius),
            getBodyPresentationRadius(bodyB.radius),
          ),
          POSITION_EPSILON,
        ),
      }
    }
  }

  return null
}

function getPostImpactRelativeDisplacement(state: PostImpactMotionState) {
  const progress = Math.min(1, Math.max(0, state.elapsed / POST_IMPACT_MOTION_SIM_DURATION))

  // Integrate a linearly damped velocity over the existing impact bridge. The
  // derivative starts in the incoming direction and reaches zero continuously at
  // the bridge end, instead of visually pinning both sources to pair COM drift.
  const displacementProgress = 1 - (1 - progress) * (1 - progress)
  const integratedVelocityScale = POST_IMPACT_MOTION_SIM_DURATION * 0.5
  const normalSpeed = dot(state.relativeVelocity, state.normal)
  const closingNormalTravel = Math.max(
    -state.minimumPhysicalRadius * POST_IMPACT_NORMAL_TRAVEL_RATIO,
    Math.min(0, normalSpeed) * integratedVelocityScale,
  )
  const tangentialVelocity = subtract(
    state.relativeVelocity,
    scale(state.normal, normalSpeed),
  )
  const tangentialTravel = limitVectorLength(
    scale(tangentialVelocity, integratedVelocityScale),
    state.minimumPresentationRadius * POST_IMPACT_TANGENTIAL_TRAVEL_RATIO,
  )
  const finalRelativeDisplacement = add(
    scale(state.normal, closingNormalTravel),
    tangentialTravel,
  )
  return scale(finalRelativeDisplacement, displacementProgress)
}

function registerPostImpactMotionContinuity(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
) {
  const previousState = postImpactMotionByFrame.get(input)
  const state = previousState
    ? { ...previousState, elapsed: previousState.elapsed + dt }
    : findNewPostImpactMotionState(input, stepped, dt)
  if (!state) return

  const bodyA = stepped.find((body) => body.id === state.bodyAId && isCorrectableSolid(body))
  const bodyB = stepped.find((body) => body.id === state.bodyBId && isCorrectableSolid(body))
  if (!bodyA || !bodyB) return

  const relativeDisplacement = getPostImpactRelativeDisplacement(state)
  const totalMass = Math.max(state.massA + state.massB, POSITION_EPSILON)
  const weightA = state.massB / totalMass
  const weightB = state.massA / totalMass

  // Keep the solver state exactly where Stage 2 previously left it. The offsets
  // are keyed to the returned BodyState objects and consumed only by the renderer,
  // so Stage 3 ejecta geometry and the eventual physical solver handoff never see
  // presentation motion as collision input.
  postImpactMotionOffsetByBody.set(bodyA, scale(relativeDisplacement, -weightA))
  postImpactMotionOffsetByBody.set(bodyB, scale(relativeDisplacement, weightB))
  postImpactMotionByFrame.set(stepped, state)
}

export function getPostImpactMotionPresentationOffset(body: BodyState): Vec3 | null {
  const offset = postImpactMotionOffsetByBody.get(body)
  return offset ? { ...offset } : null
}

function limitPairPenetration(a: BodyState, b: BodyState) {
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const distance = Math.hypot(delta.x, delta.y, delta.z)
  const contactDistance = getCollisionContactDistance(a, b)
  const penetration = contactDistance - distance
  if (penetration <= 0) return

  const minimumRadius = Math.max(Math.min(a.radius, b.radius), POSITION_EPSILON)
  const maximumPenetration = minimumRadius * MAX_NON_STELLAR_NORMALIZED_PENETRATION
  if (penetration <= maximumPenetration + POSITION_EPSILON) return

  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    y: b.velocity.y - a.velocity.y,
    z: b.velocity.z - a.velocity.z,
  }
  const normal = normalize(delta, relativeVelocity)
  const correction = penetration - maximumPenetration
  const totalMass = Math.max(a.mass + b.mass, POSITION_EPSILON)
  const weightA = b.mass / totalMass
  const weightB = a.mass / totalMass

  // Correct only the excess overlap and split the displacement by inverse
  // center-of-mass weights. Velocities, mass, momentum, collision outcome and
  // the core solver's exact contact frame remain untouched.
  a.position = {
    x: a.position.x - normal.x * correction * weightA,
    y: a.position.y - normal.y * correction * weightA,
    z: a.position.z - normal.z * correction * weightA,
  }
  b.position = {
    x: b.position.x + normal.x * correction * weightB,
    y: b.position.y + normal.y * correction * weightB,
    z: b.position.z + normal.z * correction * weightB,
  }
}

function limitNonStellarPenetration(bodies: BodyState[]) {
  const solids = bodies.filter(isCorrectableSolid)
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      limitPairPenetration(solids[i], solids[j])
    }
  }
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const next = stepFragmentAwareBodies(input, dt)

  // Keep the Stage 2 physical/presentation-penetration baseline unchanged, then
  // attach the additional incoming-motion continuity as renderer-only sidecar data.
  limitNonStellarPenetration(next)
  registerPostImpactMotionContinuity(input, next, dt)
  return next
}
