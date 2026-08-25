import type { BodyState, BodyType, Vec3 } from '../types'
import { getCollisionContactDistance, getCollisionContactScale } from './collisionContact'
import { add, magnitude, magnitudeSquared, scale, sub } from './vector'

const G = 1
const SOFTENING_SQUARED = 1e-6
const MAX_DYNAMIC_BODIES = 28
const MAX_FRAGMENTS_PER_COLLISION = 8
const MIN_PERSISTENT_FRAGMENT_RADIUS = 0.01
const MIN_PERSISTENT_FRAGMENT_MASS = 0.00025
const EFFECT_LIFETIME = 2
const STELLAR_PLASMA_LIFETIME = 1.35
const COLLISION_FLASH_RADIUS = 0.055
const HIT_RUN_COOLDOWN = 0.075
const FRAGMENT_COOLDOWN = 0.12
const TRANSIENT_COLLISION_NAMES = new Set(['Debris', 'Collision spark', 'Collision flash', 'Stellar plasma'])

let collisionSerial = 0

type PhysicalBodyType = Exclude<BodyType, 'effect'>
type CollisionMode = 'absorb' | 'merge' | 'disrupt' | 'hitRun'

type CollisionDecision = {
  mode: CollisionMode
  ejectaFraction: number
}

type CollisionGeometry = {
  normal: Vec3
  tangent: Vec3
  distance: number
  relativeVelocity: Vec3
  relativeSpeed: number
  escapeSpeed: number
  speedRatio: number
  headOn: number
  grazing: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

const cloneBody = (body: BodyState): BodyState => ({
  ...body,
  position: { ...body.position },
  velocity: { ...body.velocity },
})

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = magnitude(value)
  if (length > 1e-10) return scale(value, 1 / length)
  const fallbackLength = magnitude(fallback)
  return fallbackLength > 1e-10 ? scale(fallback, 1 / fallbackLength) : { x: 1, y: 0, z: 0 }
}

function inferBodyType(body: BodyState): PhysicalBodyType {
  if (body.bodyType && body.bodyType !== 'effect') return body.bodyType

  const name = body.name.toLowerCase()
  if (/moon|luna|satellite|trojan/.test(name)) return 'moon'
  if (/planet|inner|outer/.test(name) && body.mass < 0.75) return 'planet'
  if (/star|helios|primary/.test(name) && body.mass >= 0.75) return 'star'
  if (body.mass >= 0.75) return 'star'
  if (body.mass >= 0.045) return 'planet'
  return 'moon'
}

function dominantBodyType(a: BodyState, b: BodyState): PhysicalBodyType {
  const typeA = inferBodyType(a)
  const typeB = inferBodyType(b)
  if (typeA === 'star' || typeB === 'star') return 'star'
  if (typeA === 'planet' || typeB === 'planet') return 'planet'
  if (typeA === 'moon' || typeB === 'moon') return 'moon'
  return 'fragment'
}

function originalNameParts(body: BodyState) {
  if (body.bodyType === 'fragment' || body.bodyType === 'effect') return []

  return body.name
    .split(' + ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !TRANSIENT_COLLISION_NAMES.has(part))
}

function mergedBodyName(a: BodyState, b: BodyState) {
  const names = [...originalNameParts(a), ...originalNameParts(b)]
  const uniqueNames = names.filter((name, index) => names.indexOf(name) === index)
  if (uniqueNames.length > 0) return uniqueNames.join(' + ')
  return a.mass >= b.mass ? a.name : b.name
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(seed: string, index: number, is2d: boolean): Vec3 {
  const first = hashString(`${seed}:${index}:a`) / 4294967295
  const second = hashString(`${seed}:${index}:b`) / 4294967295
  const theta = first * Math.PI * 2

  if (is2d) return { x: Math.cos(theta), y: Math.sin(theta), z: 0 }

  const z = second * 2 - 1
  const radial = Math.sqrt(Math.max(0, 1 - z * z))
  return { x: radial * Math.cos(theta), y: radial * Math.sin(theta), z }
}

function getCollisionGeometry(a: BodyState, b: BodyState): CollisionGeometry {
  const delta = sub(b.position, a.position)
  const distance = magnitude(delta)
  const is2d =
    Math.abs(a.position.z) + Math.abs(b.position.z) + Math.abs(a.velocity.z) + Math.abs(b.velocity.z) < 1e-8
  const fallback = seededUnit(`${a.id}:${b.id}`, collisionSerial, is2d)
  const normal = distance > 1e-9 ? scale(delta, 1 / distance) : fallback
  const relativeVelocity = sub(b.velocity, a.velocity)
  const relativeSpeed = magnitude(relativeVelocity)
  const normalVelocity = scale(normal, dot(relativeVelocity, normal))
  const tangentialVelocity = sub(relativeVelocity, normalVelocity)
  const referenceAxis: Vec3 = is2d
    ? { x: 0, y: 0, z: 1 }
    : Math.abs(normal.z) < 0.85
      ? { x: 0, y: 0, z: 1 }
      : { x: 0, y: 1, z: 0 }
  const tangent = normalize(tangentialVelocity, cross(referenceAxis, normal))
  const contactDistance = getCollisionContactDistance(a, b)
  const escapeSpeed = Math.sqrt(
    Math.max(0, (2 * G * (a.mass + b.mass)) / Math.max(contactDistance, 1e-6)),
  )
  const speedRatio = relativeSpeed / Math.max(escapeSpeed, 1e-6)
  const headOn = relativeSpeed > 1e-9
    ? clamp(Math.abs(dot(relativeVelocity, normal)) / relativeSpeed, 0, 1)
    : 1
  const grazing = Math.sqrt(Math.max(0, 1 - headOn * headOn))

  return {
    normal,
    tangent,
    distance,
    relativeVelocity,
    relativeSpeed,
    escapeSpeed,
    speedRatio,
    headOn,
    grazing,
  }
}

function classifyCollision(a: BodyState, b: BodyState, geometry: CollisionGeometry): CollisionDecision {
  const typeA = inferBodyType(a)
  const typeB = inferBodyType(b)
  const totalMass = a.mass + b.mass
  const smallerMassFraction = Math.min(a.mass, b.mass) / Math.max(totalMass, 1e-9)
  const massRatio = Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, 1e-9)
  const { speedRatio, headOn, grazing } = geometry

  if (typeA === 'fragment' || typeB === 'fragment') {
    if (typeA === 'star' || typeB === 'star') {
      return {
        mode: 'absorb',
        ejectaFraction: clamp(smallerMassFraction * (0.14 + speedRatio * 0.06 + headOn * 0.02), 0, 0.06),
      }
    }

    if (typeA !== 'fragment' || typeB !== 'fragment') {
      if (grazing > 0.9 && speedRatio > 1.05 && speedRatio < 2.8) {
        return {
          mode: 'hitRun',
          ejectaFraction: clamp(smallerMassFraction * (0.08 + speedRatio * 0.04), 0.002, 0.045),
        }
      }
      return {
        mode: 'absorb',
        ejectaFraction: clamp(smallerMassFraction * (0.12 + speedRatio * 0.05), 0, 0.08),
      }
    }
    if (grazing > 0.86 && speedRatio > 0.8 && speedRatio < 2.4) {
      return { mode: 'hitRun', ejectaFraction: clamp(0.02 + speedRatio * 0.025, 0.02, 0.08) }
    }
    if (speedRatio > 1.4) {
      return { mode: 'disrupt', ejectaFraction: clamp(0.2 + speedRatio * 0.09, 0.22, 0.5) }
    }
    return { mode: 'merge', ejectaFraction: clamp(0.012 + speedRatio * 0.018, 0.01, 0.055) }
  }

  const starCount = Number(typeA === 'star') + Number(typeB === 'star')
  if (starCount === 1) {
    if (grazing > 0.92 && speedRatio > 0.95 && speedRatio < 2.65 && massRatio > 0.015) {
      return {
        mode: 'hitRun',
        ejectaFraction: clamp(smallerMassFraction * (0.11 + speedRatio * 0.055), 0.003, 0.055),
      }
    }
    return {
      mode: 'absorb',
      ejectaFraction: clamp(smallerMassFraction * (0.18 + speedRatio * 0.08 + headOn * 0.04), 0.002, 0.075),
    }
  }

  if (starCount === 2) {
    if (grazing > 0.82 && speedRatio > 0.65 && speedRatio < 2.8) {
      return { mode: 'hitRun', ejectaFraction: clamp(0.012 + speedRatio * 0.022, 0.018, 0.075) }
    }
    const stellarFlyThroughThreshold = 2.25 - headOn * 0.2
    if (speedRatio > stellarFlyThroughThreshold) {
      return {
        mode: 'hitRun',
        ejectaFraction: clamp(0.1 + (speedRatio - stellarFlyThroughThreshold) * 0.1, 0.1, 0.3),
      }
    }
    return { mode: 'merge', ejectaFraction: clamp(0.008 + speedRatio * 0.018 + headOn * 0.008, 0.008, 0.07) }
  }

  const hasPlanet = typeA === 'planet' || typeB === 'planet'
  const hasMoon = typeA === 'moon' || typeB === 'moon'

  if (
    hasPlanet &&
    hasMoon &&
    typeA !== typeB &&
    massRatio < 0.28 &&
    grazing < 0.72 &&
    speedRatio < 2.05
  ) {
    return {
      mode: 'absorb',
      ejectaFraction: clamp(smallerMassFraction * (0.18 + speedRatio * 0.11 + headOn * 0.04), 0.004, 0.12),
    }
  }

  // A tiny impactor should not survive simply because the contact is grazing.
  // Extreme mass-ratio impacts fall through to absorb/disrupt/merge handling.
  if (massRatio >= 0.02 && grazing > 0.8 && speedRatio > 0.55 && speedRatio < 2.8) {
    return {
      mode: 'hitRun',
      ejectaFraction: clamp(0.018 + speedRatio * 0.028 + (grazing - 0.8) * 0.08, 0.025, 0.12),
    }
  }

  const baseDisruptionThreshold = typeA === 'moon' && typeB === 'moon' ? 1.28 : 1.62
  const impactCoupling = 1.12 - headOn * 0.24
  const disruptionThreshold = baseDisruptionThreshold * impactCoupling
  if (speedRatio > disruptionThreshold) {
    return {
      mode: 'disrupt',
      ejectaFraction: clamp(
        0.22 + (speedRatio - disruptionThreshold) * 0.17 + headOn * 0.07,
        0.22,
        0.6,
      ),
    }
  }

  return {
    mode: 'merge',
    ejectaFraction: clamp(0.012 + speedRatio * 0.03 + headOn * 0.025, 0.012, 0.13),
  }
}

function accelerations(bodies: BodyState[]): Vec3[] {
  return bodies.map((body, i) => {
    if (body.bodyType === 'effect') return { x: 0, y: 0, z: 0 }

    let acceleration: Vec3 = { x: 0, y: 0, z: 0 }
    bodies.forEach((other, j) => {
      if (i === j || other.bodyType === 'effect' || other.mass <= 0) return
      const delta = sub(other.position, body.position)
      const distanceSquared = magnitudeSquared(delta) + SOFTENING_SQUARED
      const invDistanceCubed = 1 / Math.pow(distanceSquared, 1.5)
      acceleration = add(acceleration, scale(delta, G * other.mass * invDistanceCubed))
    })
    return acceleration
  })
}

function momentum(body: BodyState): Vec3 {
  return scale(body.velocity, body.mass)
}

function centerOfMassPosition(a: BodyState, b: BodyState): Vec3 {
  const totalMass = a.mass + b.mass
  return scale(add(scale(a.position, a.mass), scale(b.position, b.mass)), 1 / Math.max(totalMass, 1e-9))
}

function centerOfMassVelocity(a: BodyState, b: BodyState): Vec3 {
  const totalMass = a.mass + b.mass
  return scale(add(momentum(a), momentum(b)), 1 / Math.max(totalMass, 1e-9))
}

function makeCollisionFlash(a: BodyState, b: BodyState): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const totalRadius = a.radius + b.radius

  return {
    id: `${a.id}+${b.id}+flash${collisionSerial}`,
    name: 'Collision flash',
    color: dominant.color,
    mass: 0,
    radius: Math.max(COLLISION_FLASH_RADIUS, Math.min(0.11, totalRadius * 0.42)),
    position: centerOfMassPosition(a, b),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: EFFECT_LIFETIME,
  }
}

function getEjectaDirection(
  seed: string,
  index: number,
  is2d: boolean,
  geometry: CollisionGeometry,
) {
  const randomDirection = seededUnit(seed, index, is2d)

  if (geometry.grazing > 0.68) {
    const sign = index % 2 === 0 ? 1 : -1
    const tangentWeight = clamp(0.58 + geometry.grazing * 0.28, 0.72, 0.86)
    return normalize(
      add(
        scale(randomDirection, 1 - tangentWeight),
        scale(geometry.tangent, sign * tangentWeight),
      ),
      randomDirection,
    )
  }

  if (geometry.headOn > 0.72) {
    const splash = sub(randomDirection, scale(geometry.normal, dot(randomDirection, geometry.normal)))
    if (magnitude(splash) > 1e-8) {
      return normalize(
        add(scale(normalize(splash, randomDirection), 0.76), scale(randomDirection, 0.24)),
        randomDirection,
      )
    }
  }

  return randomDirection
}

function makeEjecta(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  requestedMass: number,
  requestedVolume: number,
  availableSlots: number,
): BodyState[] {
  if (requestedMass <= 1e-9 || requestedVolume <= 1e-12 || availableSlots <= 0) return []

  const serial = collisionSerial
  const stellarEjecta = inferBodyType(a) === 'star' || inferBodyType(b) === 'star'
  const ejectaFraction = requestedMass / Math.max(a.mass + b.mass, 1e-9)
  const count = Math.min(
    MAX_FRAGMENTS_PER_COLLISION,
    availableSlots,
    Math.max(2, Math.ceil(3 + ejectaFraction * 10)),
  )
  const seed = `${a.id}:${b.id}:${serial}`
  const weights = Array.from({ length: count }, (_, index) => {
    const unit = hashString(`${seed}:weight:${index}`) / 4294967295
    return 0.65 + unit * 0.7
  })
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const centerPosition = centerOfMassPosition(a, b)
  const centerVelocity = centerOfMassVelocity(a, b)
  const is2d =
    Math.abs(a.position.z) + Math.abs(b.position.z) + Math.abs(a.velocity.z) + Math.abs(b.velocity.z) < 1e-8
  const kickRatio = decision.mode === 'disrupt'
    ? 0.78
    : decision.mode === 'hitRun'
      ? 0.58
      : decision.mode === 'absorb'
        ? 0.42
        : 0.5
  const baseKick = Math.max(
    geometry.relativeSpeed * kickRatio * (0.92 + geometry.headOn * 0.16),
    geometry.escapeSpeed * (decision.mode === 'disrupt' ? 0.42 : 0.3),
    0.08,
  )
  const contactScale = Math.max(a.radius, b.radius)
  const spawnDistance = contactScale * (decision.mode === 'hitRun' ? 1.7 : 1.55)

  return weights.map((weight, index) => {
    const share = weight / weightTotal
    const mass = requestedMass * share
    const volume = requestedVolume * share
    const radius = Math.cbrt(Math.max(volume, 1e-12))
    const direction = getEjectaDirection(seed, index, is2d, geometry)
    const speedNoise = 0.78 + (hashString(`${seed}:speed:${index}`) / 4294967295) * 0.72
    const velocity = add(centerVelocity, scale(direction, baseKick * speedNoise))
    const position = add(centerPosition, scale(direction, spawnDistance + radius * 2.5))
    const tiny = radius < MIN_PERSISTENT_FRAGMENT_RADIUS || mass < MIN_PERSISTENT_FRAGMENT_MASS
    const source = index % 2 === 0 ? a : b

    if (stellarEjecta) {
      return {
        id: `${a.id}+${b.id}+plasma${serial}-${index}`,
        name: 'Stellar plasma',
        color: source.color,
        mass,
        radius,
        position,
        velocity,
        bodyType: 'effect',
        age: 0,
        lifetime: STELLAR_PLASMA_LIFETIME,
      }
    }

    return {
      id: `${a.id}+${b.id}+${tiny ? 'fx' : 'frag'}${serial}-${index}`,
      name: tiny ? 'Collision spark' : 'Debris',
      color: source.color,
      mass,
      radius,
      position,
      velocity,
      bodyType: tiny ? 'effect' : 'fragment',
      age: tiny ? 0 : undefined,
      lifetime: tiny ? EFFECT_LIFETIME : undefined,
      collisionCooldown: FRAGMENT_COOLDOWN,
    }
  })
}

function resolveMergedCollision(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
): BodyState[] {
  const totalMass = a.mass + b.mass
  const totalVolume = a.radius ** 3 + b.radius ** 3
  const requestedEjectaMass = totalMass * decision.ejectaFraction
  const requestedEjectaVolume = totalVolume * decision.ejectaFraction
  const fragments = makeEjecta(
    a,
    b,
    geometry,
    decision,
    requestedEjectaMass,
    requestedEjectaVolume,
    availableSlots,
  )
  const ejectedMass = fragments.reduce((sum, fragment) => sum + fragment.mass, 0)
  const ejectedVolume = fragments.reduce((sum, fragment) => sum + fragment.radius ** 3, 0)
  const remnantMass = Math.max(totalMass - ejectedMass, totalMass * 0.05)
  const remnantVolume = Math.max(totalVolume - ejectedVolume, totalVolume * 0.02)
  const totalMomentum = add(momentum(a), momentum(b))
  const ejectaMomentum = fragments.reduce(
    (sum, fragment) => add(sum, momentum(fragment)),
    { x: 0, y: 0, z: 0 },
  )
  const remnantVelocity = scale(sub(totalMomentum, ejectaMomentum), 1 / remnantMass)
  const dominant = a.mass >= b.mass ? a : b
  const remnant: BodyState = {
    id: `${a.id}+${b.id}`,
    name: mergedBodyName(a, b),
    color: dominant.color,
    mass: remnantMass,
    radius: Math.cbrt(remnantVolume),
    position: centerOfMassPosition(a, b),
    velocity: remnantVelocity,
    bodyType: dominantBodyType(a, b),
  }

  return [remnant, ...fragments, makeCollisionFlash(a, b)]
}

function resolveHitAndRun(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
): BodyState[] {
  const totalMass = a.mass + b.mass
  const totalVolume = a.radius ** 3 + b.radius ** 3
  const requestedEjectaMass = totalMass * decision.ejectaFraction
  const requestedEjectaVolume = totalVolume * decision.ejectaFraction
  const fragments = makeEjecta(
    a,
    b,
    geometry,
    decision,
    requestedEjectaMass,
    requestedEjectaVolume,
    availableSlots,
  )
  const ejectedMass = fragments.reduce((sum, fragment) => sum + fragment.mass, 0)
  const lossRatio = clamp(ejectedMass / Math.max(totalMass, 1e-9), 0, 0.45)
  const massA = Math.max(a.mass * (1 - lossRatio), a.mass * 0.2)
  const massB = Math.max(b.mass * (1 - lossRatio), b.mass * 0.2)
  const radiusA = a.radius * Math.cbrt(massA / a.mass)
  const radiusB = b.radius * Math.cbrt(massB / b.mass)

  const relativeNormalSpeed = dot(geometry.relativeVelocity, geometry.normal)
  const restitution = clamp(0.16 + geometry.grazing * 0.28, 0.18, 0.42)
  const impulseMagnitude = relativeNormalSpeed < 0
    ? (-(1 + restitution) * relativeNormalSpeed) / (1 / a.mass + 1 / b.mass)
    : 0
  let velocityA = sub(a.velocity, scale(geometry.normal, impulseMagnitude / a.mass))
  let velocityB = add(b.velocity, scale(geometry.normal, impulseMagnitude / b.mass))

  const center = centerOfMassPosition(a, b)
  const separation = (
    (radiusA + radiusB) *
    getCollisionContactScale(a, b) *
    (1 + geometry.grazing * 0.08)
  ) + 1e-4
  const survivorMass = massA + massB
  const positionA = sub(center, scale(geometry.normal, separation * (massB / survivorMass)))
  const positionB = add(center, scale(geometry.normal, separation * (massA / survivorMass)))

  const fragmentMomentum = fragments.reduce(
    (sum, fragment) => add(sum, momentum(fragment)),
    { x: 0, y: 0, z: 0 },
  )
  const targetMomentum = sub(add(momentum(a), momentum(b)), fragmentMomentum)
  const survivorMomentum = add(scale(velocityA, massA), scale(velocityB, massB))
  const correction = scale(sub(targetMomentum, survivorMomentum), 1 / survivorMass)
  velocityA = add(velocityA, correction)
  velocityB = add(velocityB, correction)

  const survivorA: BodyState = {
    ...cloneBody(a),
    mass: massA,
    radius: radiusA,
    position: positionA,
    velocity: velocityA,
    bodyType: inferBodyType(a),
    collisionCooldown: HIT_RUN_COOLDOWN,
  }
  const survivorB: BodyState = {
    ...cloneBody(b),
    mass: massB,
    radius: radiusB,
    position: positionB,
    velocity: velocityB,
    bodyType: inferBodyType(b),
    collisionCooldown: HIT_RUN_COOLDOWN,
  }

  return [survivorA, survivorB, ...fragments, makeCollisionFlash(a, b)]
}

function resolveCollisions(input: BodyState[]): BodyState[] {
  const bodies = input.map(cloneBody)
  let resolved = true

  while (resolved) {
    resolved = false
    outer: for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i]
        const b = bodies[j]
        if (a.bodyType === 'effect' || b.bodyType === 'effect') continue
        if ((a.collisionCooldown ?? 0) > 0 || (b.collisionCooldown ?? 0) > 0) continue
        if (magnitude(sub(a.position, b.position)) > getCollisionContactDistance(a, b)) continue

        collisionSerial += 1
        const geometry = getCollisionGeometry(a, b)
        const decision = classifyCollision(a, b, geometry)
        const baseResultCount = decision.mode === 'hitRun' ? 2 : 1
        const availableSlots = Math.max(0, MAX_DYNAMIC_BODIES - (bodies.length - 2 + baseResultCount))
        const replacement = decision.mode === 'hitRun'
          ? resolveHitAndRun(a, b, geometry, decision, availableSlots)
          : resolveMergedCollision(a, b, geometry, decision, availableSlots)

        bodies.splice(j, 1)
        bodies.splice(i, 1, ...replacement)
        resolved = true
        break outer
      }
    }
  }

  return bodies
}

function advanceTransientState(input: BodyState[], dt: number): BodyState[] {
  return input
    .map((body) => {
      const next = cloneBody(body)
      if (next.collisionCooldown !== undefined) {
        next.collisionCooldown = Math.max(0, next.collisionCooldown - dt)
      }
      if (next.bodyType === 'effect') next.age = (next.age ?? 0) + dt
      return next
    })
    .filter((body) => body.bodyType !== 'effect' || (body.age ?? 0) < (body.lifetime ?? EFFECT_LIFETIME))
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  if (dt <= 0) return input.map(cloneBody)
  if (input.length === 0) return []

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

  return advanceTransientState(resolveCollisions(integrated), dt)
}