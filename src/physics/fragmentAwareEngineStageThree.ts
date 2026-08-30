import { getEffectiveBodyType } from '../bodyTypes'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import {
  getBodyPresentationRadius,
  getFragmentPresentationRadius,
} from '../rendering/bodyPresentationRadius'
import type { BodyState, Vec3 } from '../types'
import { stepBodies as stepStageTwoBodies } from './fragmentAwareEngineStageTwo'

const COLLISION_FLASH_NAME = 'Collision flash'
const COLLISION_SPARK_NAME = 'Collision spark'
const EPSILON = 1e-12

type CollisionPair = {
  bodyA: BodyState
  bodyB: BodyState
}

type EjectaGeometry = {
  impactor: BodyState
  target: BodyState
  outwardNormal: Vec3
  forwardTangent: Vec3
  contactPoint: Vec3
  headOn: number
  grazing: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

function length(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const valueLength = length(value)
  if (valueLength > EPSILON) return scale(value, 1 / valueLength)
  const fallbackLength = length(fallback)
  return fallbackLength > EPSILON
    ? scale(fallback, 1 / fallbackLength)
    : { x: 1, y: 0, z: 0 }
}

function projectToPlane(value: Vec3, normal: Vec3) {
  return subtract(value, scale(normal, dot(value, normal)))
}

function isPhysicalEjecta(body: BodyState, pair: CollisionPair) {
  if (body.mass <= EPSILON) return false
  if (body.bodyType !== 'fragment' && body.name !== COLLISION_SPARK_NAME) return false
  return bodyCarriesCollisionLineage(body, pair.bodyA.id) &&
    bodyCarriesCollisionLineage(body, pair.bodyB.id)
}

function findFreshCollisionPair(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
): CollisionPair | null {
  const freshFlashes = stepped.filter((body) =>
    body.bodyType === 'effect' &&
    body.name === COLLISION_FLASH_NAME &&
    (body.age ?? Number.POSITIVE_INFINITY) <= dt + 1e-9,
  )
  if (freshFlashes.length === 0) return null

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

function selectImpactor(pair: CollisionPair) {
  const { bodyA, bodyB } = pair
  const massScale = Math.max(bodyA.mass, bodyB.mass, EPSILON)
  if (Math.abs(bodyA.mass - bodyB.mass) > massScale * 1e-9) {
    return bodyA.mass < bodyB.mass ? bodyA : bodyB
  }

  const centerVelocity = scale(
    add(scale(bodyA.velocity, bodyA.mass), scale(bodyB.velocity, bodyB.mass)),
    1 / Math.max(bodyA.mass + bodyB.mass, EPSILON),
  )
  const speedA = length(subtract(bodyA.velocity, centerVelocity))
  const speedB = length(subtract(bodyB.velocity, centerVelocity))
  if (Math.abs(speedA - speedB) > 1e-12) return speedA > speedB ? bodyA : bodyB
  return bodyA.id.localeCompare(bodyB.id) <= 0 ? bodyA : bodyB
}

function getEjectaGeometry(pair: CollisionPair): EjectaGeometry {
  const impactor = selectImpactor(pair)
  const target = impactor === pair.bodyA ? pair.bodyB : pair.bodyA
  const impactorFromTarget = subtract(impactor.position, target.position)
  const relativeTravel = subtract(impactor.velocity, target.velocity)
  const outwardNormal = normalize(impactorFromTarget, scale(relativeTravel, -1))
  const tangentialTravel = projectToPlane(relativeTravel, outwardNormal)
  const relativeSpeed = length(relativeTravel)
  const tangentialSpeed = length(tangentialTravel)
  const grazing = relativeSpeed > EPSILON
    ? clamp(tangentialSpeed / relativeSpeed, 0, 1)
    : 0
  const headOn = Math.sqrt(Math.max(0, 1 - grazing * grazing))
  const referenceAxis: Vec3 = Math.abs(outwardNormal.z) < 0.85
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 }
  const forwardTangent = normalize(
    tangentialTravel,
    cross(referenceAxis, outwardNormal),
  )
  const targetSurface = add(target.position, scale(outwardNormal, target.radius))
  const impactorSurface = subtract(impactor.position, scale(outwardNormal, impactor.radius))
  const contactPoint = scale(add(targetSurface, impactorSurface), 0.5)

  return {
    impactor,
    target,
    outwardNormal,
    forwardTangent,
    contactPoint,
    headOn,
    grazing,
  }
}

function getCollisionSolids(bodies: BodyState[], pair: CollisionPair) {
  return bodies.filter((body) =>
    body.mass > EPSILON &&
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    (
      bodyCarriesCollisionLineage(body, pair.bodyA.id) ||
      bodyCarriesCollisionLineage(body, pair.bodyB.id) ||
      body.id === pair.bodyA.id ||
      body.id === pair.bodyB.id
    ),
  )
}

function getMassWeightedVelocity(bodies: BodyState[], fallback: Vec3) {
  const totalMass = bodies.reduce((sum, body) => sum + body.mass, 0)
  if (totalMass <= EPSILON) return { ...fallback }
  return bodies.reduce((sum, body) => ({
    x: sum.x + body.velocity.x * body.mass / totalMass,
    y: sum.y + body.velocity.y * body.mass / totalMass,
    z: sum.z + body.velocity.z * body.mass / totalMass,
  }), { x: 0, y: 0, z: 0 })
}

function raySphereExitDistance(
  origin: Vec3,
  direction: Vec3,
  center: Vec3,
  clearanceRadius: number,
) {
  const toCenter = subtract(center, origin)
  const projected = dot(toCenter, direction)
  const centerDistanceSquared = dot(toCenter, toCenter)
  const perpendicularSquared = Math.max(0, centerDistanceSquared - projected * projected)
  const clearanceSquared = clearanceRadius * clearanceRadius
  if (perpendicularSquared >= clearanceSquared) return 0
  return Math.max(0, projected + Math.sqrt(Math.max(0, clearanceSquared - perpendicularSquared)))
}

function getSafeSpawnDistance(
  geometry: EjectaGeometry,
  ejecta: BodyState,
  direction: Vec3,
  solids: BodyState[],
) {
  const collisionScale = Math.max(
    Math.min(geometry.impactor.radius, geometry.target.radius),
    EPSILON,
  )
  const clearanceMargin = collisionScale * (0.15 + geometry.headOn * 0.03)
  const visibleEjectaRadius = Math.max(
    ejecta.radius,
    getFragmentPresentationRadius(ejecta.radius),
  )

  return solids.reduce((distance, solid) => {
    const solidRadius = Math.max(solid.radius, getBodyPresentationRadius(solid.radius))
    const exitDistance = raySphereExitDistance(
      geometry.contactPoint,
      direction,
      solid.position,
      solidRadius + visibleEjectaRadius + clearanceMargin,
    )
    return Math.max(distance, exitDistance)
  }, 0)
}

function getDirectionalEjectaVelocity(
  body: BodyState,
  geometry: EjectaGeometry,
  collisionCenterVelocity: Vec3,
  rankFraction: number,
  index: number,
) {
  const relativeVelocity = subtract(body.velocity, collisionCenterVelocity)
  const speed = length(relativeVelocity)
  if (speed <= EPSILON) return { ...body.velocity }

  const rawPlane = normalize(
    projectToPlane(relativeVelocity, geometry.outwardNormal),
    geometry.forwardTangent,
  )
  const useHeadOnFan = geometry.headOn > 0.72 && geometry.grazing < 0.45
  const fanSign = useHeadOnFan && index % 2 === 1 ? -1 : 1
  const preferredTangent = scale(geometry.forwardTangent, fanSign)

  // Large fragments stay coherent with the impactor's tangential motion. Smaller
  // debris keeps progressively more of the solver's seeded angular variation,
  // producing a fan/cone without reverting to an isotropic explosion.
  const coherence = clamp(
    0.9 - rankFraction * 0.46 + geometry.grazing * 0.04,
    0.44,
    0.94,
  )
  const planeDirection = normalize(
    add(
      scale(preferredTangent, coherence),
      scale(rawPlane, 1 - coherence),
    ),
    preferredTangent,
  )
  const outwardWeight = clamp(
    0.34 + geometry.headOn * 0.36 + rankFraction * 0.08,
    0.34,
    0.78,
  )
  const direction = normalize(
    add(
      scale(geometry.outwardNormal, outwardWeight),
      scale(planeDirection, 1 - outwardWeight),
    ),
    geometry.outwardNormal,
  )

  // Rotate the solver's already-budgeted COM-relative velocity instead of adding
  // a kick. Magnitude stays unchanged; the distributed survivor correction below
  // restores represented linear momentum after the direction rotation.
  return add(collisionCenterVelocity, scale(direction, speed))
}

function representedMomentum(bodies: BodyState[]) {
  return bodies.reduce((sum, body) => ({
    x: sum.x + body.velocity.x * body.mass,
    y: sum.y + body.velocity.y * body.mass,
    z: sum.z + body.velocity.z * body.mass,
  }), { x: 0, y: 0, z: 0 })
}

function shapeDirectionalCollisionEjecta(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
) {
  const pair = findFreshCollisionPair(input, stepped, dt)
  if (!pair) return
  if (
    getEffectiveBodyType(pair.bodyA) === 'star' ||
    getEffectiveBodyType(pair.bodyB) === 'star'
  ) return

  const ejecta = stepped.filter((body) => isPhysicalEjecta(body, pair))
  if (ejecta.length === 0) return
  const solids = getCollisionSolids(stepped, pair)
  if (solids.length === 0) return

  const geometry = getEjectaGeometry(pair)
  const collisionCenterVelocity = getMassWeightedVelocity(
    [pair.bodyA, pair.bodyB],
    geometry.target.velocity,
  )
  const beforeMomentum = representedMomentum(ejecta)
  const ranked = ejecta
    .slice()
    .sort((a, b) => b.radius - a.radius || b.mass - a.mass || a.id.localeCompare(b.id))
  const denominator = Math.max(ranked.length - 1, 1)

  ranked.forEach((body, index) => {
    const rankFraction = index / denominator
    const velocity = getDirectionalEjectaVelocity(
      body,
      geometry,
      collisionCenterVelocity,
      rankFraction,
      index,
    )
    const relativeDirection = normalize(
      subtract(velocity, collisionCenterVelocity),
      geometry.outwardNormal,
    )
    const spawnDistance = getSafeSpawnDistance(
      geometry,
      body,
      relativeDirection,
      solids,
    )

    body.position = add(
      geometry.contactPoint,
      scale(relativeDirection, spawnDistance),
    )
    body.velocity = velocity
    if (body.effectVisual) {
      body.effectVisual = {
        ...body.effectVisual,
        direction: { ...relativeDirection },
        normal: { ...geometry.outwardNormal },
      }
    }
  })

  const afterMomentum = representedMomentum(ejecta)
  const momentumDelta = subtract(afterMomentum, beforeMomentum)
  const survivorMass = solids.reduce((sum, body) => sum + body.mass, 0)
  if (survivorMass <= EPSILON) return
  const correction = scale(momentumDelta, -1 / survivorMass)
  solids.forEach((body) => {
    body.velocity = add(body.velocity, correction)
  })
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const next = stepStageTwoBodies(input, dt)

  // Stage 2 already owns contact/penetration staging. Stage 3 only touches the
  // first physical non-stellar ejecta frame and preserves the same array identity
  // so the core WeakMap collision transition remains intact.
  shapeDirectionalCollisionEjecta(input, next, dt)
  return next
}
