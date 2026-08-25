import type { BodyState, BodyType, EffectVisualState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { add, magnitude, magnitudeSquared, scale, sub } from './vector'

const G = 1
const SOFTENING_SQUARED = 1e-6
const MAX_DYNAMIC_BODIES = 28
const MAX_FRAGMENTS_PER_COLLISION = 8
const MAX_STELLAR_EJECTA_PER_COLLISION = 10
const MIN_PERSISTENT_FRAGMENT_RADIUS = 0.01
const MIN_PERSISTENT_FRAGMENT_MASS = 0.00025
const EFFECT_LIFETIME = 2
const COLLISION_FLASH_LIFETIME = 0.72
const STELLAR_FLASH_LIFETIME = 0.58
const STELLAR_SHOCK_LIFETIME = 1.05
const STELLAR_AFTERGLOW_LIFETIME = 1.1
const STELLAR_PLASMA_LIFETIME = 1.55
const COLLISION_FLASH_RADIUS = 0.055
const HIT_RUN_COOLDOWN = 0.075
const FRAGMENT_COOLDOWN = 0.12
const TRANSIENT_COLLISION_NAMES = new Set([
  'Debris',
  'Collision spark',
  'Collision flash',
  'Stellar shock sheet',
  'Stellar plasma',
  'Stellar afterglow',
])

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

type StellarEjectaBias = {
  smaller: BodyState
  larger: BodyState
  massRatio: number
  massAsymmetry: number
  strippedDirection: Vec3
  relativeDirection: Vec3
  dominantTangentSign: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

function cloneEffectVisual(effectVisual: EffectVisualState | undefined) {
  if (!effectVisual) return undefined
  return {
    ...effectVisual,
    direction: { ...effectVisual.direction },
    normal: effectVisual.normal ? { ...effectVisual.normal } : undefined,
  }
}

const cloneBody = (body: BodyState): BodyState => ({
  ...body,
  position: { ...body.position },
  velocity: { ...body.velocity },
  effectVisual: cloneEffectVisual(body.effectVisual),
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

function isStellarCollision(a: BodyState, b: BodyState) {
  return inferBodyType(a) === 'star' && inferBodyType(b) === 'star'
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

function seededScalar(seed: string) {
  return hashString(seed) / 4294967295
}

function seededUnit(seed: string, index: number, is2d: boolean): Vec3 {
  const first = seededScalar(`${seed}:${index}:a`)
  const second = seededScalar(`${seed}:${index}:b`)
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

function collisionContactPoint(a: BodyState, b: BodyState, normal: Vec3): Vec3 {
  const pointA = add(a.position, scale(normal, a.radius))
  const pointB = sub(b.position, scale(normal, b.radius))
  return scale(add(pointA, pointB), 0.5)
}

function getStellarEjectaBias(a: BodyState, b: BodyState, geometry: CollisionGeometry): StellarEjectaBias {
  const smaller = a.mass <= b.mass ? a : b
  const larger = smaller === a ? b : a
  const massRatio = smaller.mass / Math.max(larger.mass, 1e-9)
  const massAsymmetry = 1 - clamp(massRatio, 0, 1)
  const relativeDirection = normalize(geometry.relativeVelocity, geometry.tangent)
  const strippedDirection = normalize(
    smaller === a ? scale(relativeDirection, -1) : relativeDirection,
    geometry.tangent,
  )
  const tangentProjection = dot(strippedDirection, geometry.tangent)
  const dominantTangentSign = tangentProjection < -1e-8 ? -1 : 1

  return {
    smaller,
    larger,
    massRatio,
    massAsymmetry,
    strippedDirection,
    relativeDirection,
    dominantTangentSign,
  }
}

function makeCollisionFlash(a: BodyState, b: BodyState, geometry: CollisionGeometry): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)
  const phaseOffset = seededScalar(`${a.id}:${b.id}:flash:${collisionSerial}`)
  const stellarCollision = isStellarCollision(a, b)

  return {
    id: `${a.id}+${b.id}+flash${collisionSerial}`,
    name: 'Collision flash',
    color: dominant.color,
    mass: 0,
    radius: stellarCollision
      ? Math.max(0.1, Math.min(0.28, totalRadius * 0.78))
      : Math.max(COLLISION_FLASH_RADIUS, Math.min(0.13, totalRadius * 0.42)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: stellarCollision ? STELLAR_FLASH_LIFETIME : COLLISION_FLASH_LIFETIME,
    effectVisual: {
      kind: 'contactFlash',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: stellarCollision
        ? clamp(4.15 + geometry.headOn * 1.25 + geometry.grazing * 0.55, 4.1, 5.8)
        : clamp(2.65 + geometry.headOn * 0.95 + geometry.grazing * 0.2, 2.6, 3.8),
      widthScale: stellarCollision
        ? clamp(0.31 - geometry.headOn * 0.07 + geometry.grazing * 0.05, 0.22, 0.36)
        : clamp(0.42 - geometry.headOn * 0.13 + geometry.grazing * 0.04, 0.25, 0.44),
      tailLength: 0,
      brightness: stellarCollision
        ? clamp(2.05 + geometry.headOn * 0.45 + speedHeat * 0.32, 2.05, 2.62)
        : clamp(1.28 + geometry.headOn * 0.48 + speedHeat * 0.34, 1.3, 2.05),
      turbulence: stellarCollision
        ? clamp(0.42 + geometry.grazing * 0.34 + speedHeat * 0.16, 0.42, 0.88)
        : clamp(0.12 + geometry.grazing * 0.3 + speedHeat * 0.18, 0.12, 0.58),
      pulseStrength: stellarCollision ? 0.09 : 0.16 + geometry.headOn * 0.1,
      phaseOffset,
      secondaryColor: secondary.color,
      temperatureBias: speedHeat,
      stellarCollision,
    },
  }
}

function makeStellarCompressionSheet(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)

  return {
    id: `${a.id}+${b.id}+shock${collisionSerial}`,
    name: 'Stellar shock sheet',
    color: dominant.color,
    mass: 0,
    radius: Math.max(0.09, Math.min(0.26, totalRadius * 0.62)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: STELLAR_SHOCK_LIFETIME,
    effectVisual: {
      kind: 'compressionShear',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: clamp(4.1 + geometry.grazing * 2.1 + geometry.headOn * 0.55, 4.2, 6.7),
      widthScale: clamp(0.31 - geometry.grazing * 0.08 + geometry.headOn * 0.03, 0.2, 0.34),
      tailLength: 0.22 + geometry.grazing * 0.34,
      brightness: clamp(1.48 + geometry.headOn * 0.22 + speedHeat * 0.24, 1.48, 1.92),
      turbulence: clamp(0.66 + geometry.grazing * 0.24 + speedHeat * 0.12, 0.66, 1),
      pulseStrength: 0.055,
      phaseOffset: seededScalar(`${a.id}:${b.id}:shock:${collisionSerial}`),
      secondaryColor: secondary.color,
      temperatureBias: speedHeat,
      stellarCollision: true,
    },
  }
}

function makeStellarAfterglow(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius

  return {
    id: `${a.id}+${b.id}+afterglow${collisionSerial}`,
    name: 'Stellar afterglow',
    color: dominant.color,
    mass: 0,
    radius: Math.max(0.11, Math.min(0.31, totalRadius * 0.72)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: STELLAR_AFTERGLOW_LIFETIME,
    effectVisual: {
      kind: 'stellarAfterglow',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: clamp(1.18 + geometry.grazing * 0.42, 1.18, 1.6),
      widthScale: clamp(0.9 - geometry.grazing * 0.14, 0.72, 0.92),
      brightness: 1.22,
      turbulence: 0.72 + geometry.grazing * 0.2,
      pulseStrength: 0.02,
      phaseOffset: seededScalar(`${a.id}:${b.id}:afterglow:${collisionSerial}`),
      secondaryColor: secondary.color,
      temperatureBias: 0.62,
      stellarCollision: true,
    },
  }
}

function makeCollisionEffects(a: BodyState, b: BodyState, geometry: CollisionGeometry) {
  const flash = makeCollisionFlash(a, b, geometry)
  if (!isStellarCollision(a, b)) return [flash]
  return [
    flash,
    makeStellarCompressionSheet(a, b, geometry),
    makeStellarAfterglow(a, b, geometry),
  ]
}

function getEjectaDirection(
  seed: string,
  index: number,
  is2d: boolean,
  geometry: CollisionGeometry,
  stellarBias?: StellarEjectaBias,
) {
  const randomDirection = seededUnit(seed, index, is2d)
  const randomProjected = sub(randomDirection, scale(geometry.normal, dot(randomDirection, geometry.normal)))
  const splashRandom = normalize(randomProjected, geometry.tangent)

  if (!stellarBias) {
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
      return normalize(
        add(scale(splashRandom, 0.76), scale(randomDirection, 0.24)),
        randomDirection,
      )
    }

    return randomDirection
  }

  const { massAsymmetry, strippedDirection, relativeDirection, dominantTangentSign } = stellarBias
  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)

  if (geometry.grazing > 0.6) {
    // Most of a grazing stellar spray follows one sheared tangent direction.
    // A minority counter-stream prevents a mechanically perfect one-sided fan.
    const counterStream = index % 4 === 3
    const sign = counterStream ? -dominantTangentSign : dominantTangentSign
    const tangentWeight = clamp(0.64 + geometry.grazing * 0.2 + speedEnergy * 0.05, 0.68, 0.9)
    const strippedWeight = 0.08 + massAsymmetry * 0.2
    const relativeWeight = 0.05 + speedEnergy * 0.08
    const normalSign = index % 3 === 0 ? 1 : -1
    const normalWeight = 0.025 + geometry.grazing * 0.035
    const randomWeight = clamp(1 - tangentWeight - strippedWeight - relativeWeight, 0.06, 0.16)
    return normalize(
      add(
        add(
          add(scale(geometry.tangent, sign * tangentWeight), scale(strippedDirection, strippedWeight)),
          add(scale(relativeDirection, relativeWeight), scale(geometry.normal, normalSign * normalWeight)),
        ),
        scale(splashRandom, randomWeight),
      ),
      scale(geometry.tangent, sign),
    )
  }

  if (geometry.headOn > 0.7) {
    // Head-on collisions vent sideways from the compressed contact layer. Keep
    // the spray short/thick in visuals, but derive its axis from the contact tangent.
    const sign = index % 2 === 0 ? 1 : -1
    const tangentWeight = 0.62 + geometry.headOn * 0.12
    const randomWeight = 0.14 + speedEnergy * 0.05
    const strippedWeight = 0.08 + massAsymmetry * 0.12
    const normalWeight = 0.04 + speedEnergy * 0.035
    return normalize(
      add(
        add(scale(geometry.tangent, sign * tangentWeight), scale(splashRandom, randomWeight)),
        add(
          scale(strippedDirection, strippedWeight),
          scale(geometry.normal, (index % 3 === 0 ? 1 : -1) * normalWeight),
        ),
      ),
      scale(geometry.tangent, sign),
    )
  }

  const sign = index % 3 === 2 ? -dominantTangentSign : dominantTangentSign
  return normalize(
    add(
      add(scale(geometry.tangent, sign * 0.48), scale(strippedDirection, 0.22 + massAsymmetry * 0.16)),
      add(scale(relativeDirection, 0.12 + speedEnergy * 0.08), scale(splashRandom, 0.1)),
    ),
    geometry.tangent,
  )
}

function makeStellarEffectVisual(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  direction: Vec3,
  index: number,
  count: number,
  largeCount: number,
  stellarBias: StellarEjectaBias,
  seed: string,
): EffectVisualState {
  const large = index < largeCount
  const stellarCollision = isStellarCollision(a, b)
  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)
  const geometryStretch = geometry.grazing * 2.4 - geometry.headOn * 0.45
  const sizeStretch = large ? 0.15 : 0.58
  const variance = seededScalar(`${seed}:shape:${index}`)
  const widthVariance = seededScalar(`${seed}:width:${index}`)
  const tailVariance = seededScalar(`${seed}:tail:${index}`)
  const phaseOffset = seededScalar(`${seed}:phase:${index}`)
  const sourceBias = stellarBias.massAsymmetry

  return {
    kind: 'stellarPlasma',
    direction: { ...direction },
    normal: { ...geometry.normal },
    stretch: clamp(
      2.0 + geometryStretch + speedEnergy * 0.72 + sizeStretch + variance * 0.55 + (stellarCollision ? 0.42 : 0),
      1.75,
      stellarCollision ? 6.2 : 5.8,
    ),
    widthScale: clamp(
      0.92 - geometry.grazing * 0.35 + geometry.headOn * 0.12 + (widthVariance - 0.5) * 0.18,
      0.42,
      1.08,
    ),
    tailLength: clamp(
      0.38 + geometry.grazing * 0.72 + speedEnergy * 0.34 + (large ? 0.08 : 0.28) + tailVariance * 0.22 + (stellarCollision ? 0.12 : 0),
      0.35,
      1.55,
    ),
    brightness: clamp(
      1.0 + speedEnergy * 0.28 + (large ? 0.18 : -0.02) + variance * 0.1 + (stellarCollision ? 0.16 : 0),
      0.92,
      stellarCollision ? 1.64 : 1.48,
    ),
    turbulence: clamp(
      0.38 + geometry.grazing * 0.27 + speedEnergy * 0.2 + (large ? 0.04 : 0.14) + (stellarCollision ? 0.08 : 0),
      0.38,
      1,
    ),
    pulseStrength: 0.035 + (1 - index / Math.max(count - 1, 1)) * 0.055,
    phaseOffset,
    secondaryColor: index % 3 === 0 || sourceBias < 0.32
      ? stellarBias.larger.color
      : stellarBias.smaller.color,
    temperatureBias: speedEnergy,
    stellarCollision,
  }
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
  const stellarCollision = isStellarCollision(a, b)
  const ejectaFraction = requestedMass / Math.max(a.mass + b.mass, 1e-9)
  const stellarBias = stellarEjecta ? getStellarEjectaBias(a, b, geometry) : undefined
  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)
  const desiredStellarCount = Math.max(
    stellarCollision ? 6 : 4,
    Math.round(
      (stellarCollision ? 6 : 4) + geometry.grazing * 2 + speedEnergy * 2 + clamp(ejectaFraction * 18, 0, 2),
    ),
  )
  const desiredSolidCount = Math.max(2, Math.ceil(3 + ejectaFraction * 10))
  const count = Math.min(
    stellarEjecta ? MAX_STELLAR_EJECTA_PER_COLLISION : MAX_FRAGMENTS_PER_COLLISION,
    availableSlots,
    stellarEjecta ? desiredStellarCount : desiredSolidCount,
  )
  if (count <= 0) return []

  const seed = `${a.id}:${b.id}:${serial}`
  const largeCount = stellarEjecta
    ? Math.min(
        count,
        clamp(
          Math.round(2 + geometry.grazing + speedEnergy * 0.7),
          2,
          stellarCollision ? 4 : 3,
        ),
      )
    : count
  const weights = Array.from({ length: count }, (_, index) => {
    const unit = seededScalar(`${seed}:weight:${index}`)
    if (!stellarEjecta) return 0.65 + unit * 0.7
    return index < largeCount ? 1.25 + unit * 0.85 : 0.28 + unit * 0.5
  })
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const centerPosition = centerOfMassPosition(a, b)
  const centerVelocity = centerOfMassVelocity(a, b)
  const contactPosition = collisionContactPoint(a, b, geometry.normal)
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
  ) * (stellarEjecta ? 1 + speedEnergy * 0.14 + geometry.grazing * 0.12 : 1)
  const contactScale = Math.max(a.radius, b.radius)
  const solidSpawnDistance = contactScale * (decision.mode === 'hitRun' ? 1.7 : 1.55)
  const plasmaSpawnDistance = Math.min(a.radius, b.radius) * (0.08 + geometry.grazing * 0.08)

  return weights.map((weight, index) => {
    const share = weight / weightTotal
    const mass = requestedMass * share
    const volume = requestedVolume * share
    const radius = Math.cbrt(Math.max(volume, 1e-12))
    const direction = getEjectaDirection(seed, index, is2d, geometry, stellarBias)
    const speedNoise = 0.78 + seededScalar(`${seed}:speed:${index}`) * 0.72
    const velocity = add(centerVelocity, scale(direction, baseKick * speedNoise))
    const position = stellarEjecta
      ? add(contactPosition, scale(direction, plasmaSpawnDistance + radius * 0.45))
      : add(centerPosition, scale(direction, solidSpawnDistance + radius * 2.5))
    const tiny = radius < MIN_PERSISTENT_FRAGMENT_RADIUS || mass < MIN_PERSISTENT_FRAGMENT_MASS

    if (stellarEjecta && stellarBias) {
      const strippedSourceChance = 0.52 + stellarBias.massAsymmetry * 0.34
      const source = seededScalar(`${seed}:source:${index}`) < strippedSourceChance
        ? stellarBias.smaller
        : stellarBias.larger
      const lifetimeNoise = seededScalar(`${seed}:life:${index}`)
      const lifetime = clamp(
        STELLAR_PLASMA_LIFETIME +
          (index < largeCount ? 0.18 : -0.08) +
          speedEnergy * 0.22 +
          lifetimeNoise * 0.2 +
          (stellarCollision ? 0.12 : -0.08),
        stellarCollision ? 1.4 : 1.2,
        stellarCollision ? 2.2 : 1.95,
      )

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
        lifetime,
        effectVisual: makeStellarEffectVisual(
          a,
          b,
          geometry,
          direction,
          index,
          count,
          largeCount,
          stellarBias,
          seed,
        ),
      }
    }

    const source = index % 2 === 0 ? a : b
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
      effectVisual: tiny
        ? {
            kind: 'collisionSpark',
            direction: { ...direction },
            normal: { ...geometry.normal },
            stretch: 1.7 + geometry.speedRatio * 0.18,
            widthScale: 0.46,
            tailLength: 0.4 + geometry.speedRatio * 0.08,
            brightness: 0.9 + speedEnergy * 0.18,
            turbulence: 0.25 + geometry.grazing * 0.2,
            pulseStrength: 0.06,
            phaseOffset: seededScalar(`${seed}:spark-phase:${index}`),
            secondaryColor: index % 2 === 0 ? b.color : a.color,
            temperatureBias: speedEnergy,
          }
        : undefined,
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

  return [remnant, ...fragments, ...makeCollisionEffects(a, b, geometry)]
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
  const separation = (radiusA + radiusB) * (1 + geometry.grazing * 0.08) + 1e-4
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

  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry)]
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
        // Reserve all non-physical VFX slots before allocating ejecta so large
        // stellar flashes/shock sheets/afterglow cannot exceed the dynamic-body cap.
        const collisionEffectReserve = isStellarCollision(a, b) ? 3 : 1
        const availableSlots = Math.max(
          0,
          MAX_DYNAMIC_BODIES - (bodies.length - 2 + baseResultCount + collisionEffectReserve),
        )
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
