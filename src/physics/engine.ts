import { getEquilibriumStellarDisplayColor, getStellarTemperatureKelvin } from '../starColors'
import type { BodyState, BodyType, EffectVisualState, StellarCollisionOutcome, Vec3 } from '../types'
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
  stellarOutcome?: StellarCollisionOutcome
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
  impactParameter: number
  compressionSeverity: number
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

function getStellarRadiusAfterMassChange(body: BodyState, newMass: number) {
  const massRatio = Math.max(newMass, 1e-9) / Math.max(body.mass, 1e-9)
  return Math.max(body.radius * 0.32, body.radius * massRatio ** 0.8)
}

function getMergedStellarRadius(
  a: BodyState,
  b: BodyState,
  remnantMass: number,
  remnantVolume: number,
) {
  const dominant = a.mass >= b.mass ? a : b
  const volumeRadius = Math.cbrt(Math.max(remnantVolume, 1e-12))
  const massScaledRadius = getStellarRadiusAfterMassChange(dominant, remnantMass)
  return clamp(
    volumeRadius * 0.55 + massScaledRadius * 0.45,
    Math.max(volumeRadius * 0.82, dominant.radius * 0.72),
    Math.max(a.radius + b.radius, volumeRadius),
  )
}

function getStellarCollisionAppearance(
  body: BodyState,
  newMass: number,
  outcome: StellarCollisionOutcome,
  geometry: CollisionGeometry,
  damageBias = 1,
) {
  const speedEnergy = clamp(geometry.speedRatio / 2.35, 0, 1)
  const compression = clamp(geometry.headOn * 0.64 + speedEnergy * 0.52, 0, 1)
  let heatStrength: number
  let heatDecayMs: number
  let temperatureBiasK: number
  let scarIntensity: number
  let trailExcitation: number

  if (outcome === 'merge') {
    heatStrength = clamp(0.82 + compression * 0.18, 0.82, 1)
    heatDecayMs = 2050 + compression * 450
    temperatureBiasK = 9000 + compression * 5500
    scarIntensity = 0.62 + compression * 0.3
    trailExcitation = 0.62 + speedEnergy * 0.26
  } else if (outcome === 'partialDisruption') {
    heatStrength = clamp((0.58 + speedEnergy * 0.2 + geometry.headOn * 0.1) * damageBias, 0.5, 0.94)
    heatDecayMs = clamp(1500 + speedEnergy * 520 + geometry.headOn * 260, 1500, 2350)
    temperatureBiasK = clamp((6200 + speedEnergy * 4300 + geometry.headOn * 1600) * damageBias, 5800, 12500)
    scarIntensity = clamp((0.46 + speedEnergy * 0.26) * damageBias, 0.38, 0.96)
    trailExcitation = clamp((0.48 + speedEnergy * 0.25) * damageBias, 0.42, 0.92)
  } else {
    heatStrength = clamp((0.46 + speedEnergy * 0.17 + geometry.grazing * 0.08) * damageBias, 0.42, 0.8)
    heatDecayMs = clamp(1050 + speedEnergy * 430 + geometry.grazing * 180, 1050, 1750)
    temperatureBiasK = clamp((3900 + speedEnergy * 3600 + geometry.grazing * 900) * damageBias, 3600, 8800)
    scarIntensity = clamp((0.26 + speedEnergy * 0.2 + geometry.grazing * 0.08) * damageBias, 0.22, 0.76)
    trailExcitation = clamp((0.34 + speedEnergy * 0.2 + geometry.grazing * 0.12) * damageBias, 0.3, 0.78)
  }

  return {
    color: getEquilibriumStellarDisplayColor(newMass),
    stellarTemperatureK: getStellarTemperatureKelvin(newMass),
    stellarCollisionOutcome: outcome,
    transientHeat01: heatStrength,
    transientHeatDecayMs: heatDecayMs,
    shockTemperatureBiasK: temperatureBiasK,
    transientHeatToken: `${collisionSerial}:${outcome}:${body.id}`,
    collisionScarIntensity: scarIntensity,
    trailExcitation01: trailExcitation,
  }
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
  const impactParameter = relativeSpeed > 1e-9
    ? clamp(magnitude(cross(delta, relativeVelocity)) / Math.max(relativeSpeed * contactDistance, 1e-9), 0, 1)
    : 0
  // Use the trajectory impact parameter rather than the instantaneous velocity/radius
  // angle after bodies have already numerically overlapped. This remains stable through
  // the contact step and does not turn a deep encounter into a fake grazing bounce.
  const grazing = impactParameter
  const headOn = Math.sqrt(Math.max(0, 1 - grazing * grazing))
  const compressionSeverity = clamp(
    (contactDistance - distance) / Math.max(Math.min(a.radius, b.radius), 1e-6),
    0,
    1,
  )

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
    impactParameter,
    compressionSeverity,
  }
}

function classifyCollision(a: BodyState, b: BodyState, geometry: CollisionGeometry): CollisionDecision {
  const typeA = inferBodyType(a)
  const typeB = inferBodyType(b)
  const totalMass = a.mass + b.mass
  const smallerMassFraction = Math.min(a.mass, b.mass) / Math.max(totalMass, 1e-9)
  const massRatio = Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, 1e-9)
  const { speedRatio, headOn, grazing, compressionSeverity } = geometry

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
    const shallowGrazingPass =
      grazing > 0.86 &&
      compressionSeverity < 0.16 &&
      speedRatio > 1.02 &&
      speedRatio < 2.8
    const partialSeverity = clamp(
      clamp((speedRatio - 0.82) / 1.25, 0, 1) * 0.5 +
        headOn * 0.18 +
        compressionSeverity * 0.72 +
        (1 - massRatio) * 0.16,
      0,
      1,
    )

    // Unequal-mass, strongly coupled impacts can strip the smaller star even
    // when contact is first detected near the photospheric boundary. Preserve
    // this physical partial-disruption branch before evaluating a true graze.
    if (
      massRatio < 0.82 &&
      speedRatio > 0.95 &&
      speedRatio < 2.3 &&
      headOn > 0.34 &&
      grazing < 0.86 &&
      partialSeverity > 0.16
    ) {
      const strippedFractionOfSmaller = clamp(
        0.055 + partialSeverity * 0.14 + (1 - massRatio) * 0.03,
        0.055,
        0.2,
      )
      return {
        mode: 'disrupt',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'partialDisruption',
      }
    }

    // A stellar hit-and-run must actually have enough relative energy to escape
    // and must remain a shallow surface-skimming encounter. Sub-escape contacts
    // are capture/merge events; deeper overlaps are fluid compression/stripping,
    // not rigid-body bounces.
    if (shallowGrazingPass) {
      const strippedFractionOfSmaller = clamp(
        0.03 + (speedRatio - 1.02) * 0.035 + (grazing - 0.86) * 0.11,
        0.025,
        0.09,
      )
      return {
        mode: 'hitRun',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'hitAndRun',
      }
    }

    // High-energy contacts that penetrate substantially through either photosphere
    // remain two remnants only as a stripping/disruption event. Never teleport
    // them apart as an elastic hit-and-run.
    if (
      speedRatio > 1.08 &&
      compressionSeverity >= 0.14 &&
      (compressionSeverity >= 0.22 || headOn > 0.42 || massRatio < 0.9)
    ) {
      const strippedFractionOfSmaller = clamp(
        0.055 + partialSeverity * 0.145,
        0.055,
        0.2,
      )
      return {
        mode: 'disrupt',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'partialDisruption',
      }
    }

    const stellarFlyThroughThreshold = 2.25 - headOn * 0.2
    if (speedRatio > stellarFlyThroughThreshold) {
      if (grazing > 0.8 && compressionSeverity < 0.12) {
        const strippedFractionOfSmaller = clamp(
          0.05 + (speedRatio - stellarFlyThroughThreshold) * 0.06,
          0.05,
          0.11,
        )
        return {
          mode: 'hitRun',
          ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
          stellarOutcome: 'hitAndRun',
        }
      }

      const strippedFractionOfSmaller = clamp(
        0.07 + partialSeverity * 0.13,
        0.07,
        0.2,
      )
      return {
        mode: 'disrupt',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'partialDisruption',
      }
    }

    return {
      mode: 'merge',
      ejectaFraction: clamp(
        0.01 + speedRatio * 0.018 + headOn * 0.01 + compressionSeverity * 0.025,
        0.01,
        0.075,
      ),
      stellarOutcome: 'merge',
    }
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

function projectToCollisionPlane(value: Vec3, geometry: CollisionGeometry, fallback: Vec3) {
  return normalize(
    sub(value, scale(geometry.normal, dot(value, geometry.normal))),
    fallback,
  )
}

function getStableEjectaSeed(a: BodyState, b: BodyState, geometry: CollisionGeometry) {
  const scalar = (value: number) => Number.isFinite(value) ? value.toFixed(9) : String(value)
  return [
    a.id,
    b.id,
    scalar(a.position.x),
    scalar(a.position.y),
    scalar(a.position.z),
    scalar(b.position.x),
    scalar(b.position.y),
    scalar(b.position.z),
    scalar(a.velocity.x),
    scalar(a.velocity.y),
    scalar(a.velocity.z),
    scalar(b.velocity.x),
    scalar(b.velocity.y),
    scalar(b.velocity.z),
    scalar(geometry.grazing),
    scalar(geometry.headOn),
  ].join(':')
}

function selectStellarEjectaSource(
  seed: string,
  index: number,
  geometry: CollisionGeometry,
  stellarBias: StellarEjectaBias,
) {
  const smallerSourceProbability = clamp(
    0.55 + stellarBias.massAsymmetry * 0.25 + geometry.grazing * 0.05,
    0.55,
    0.85,
  )
  return seededScalar(`${seed}:source:${index}`) < smallerSourceProbability
    ? stellarBias.smaller
    : stellarBias.larger
}

function getStellarEjectaSpawnPosition(
  source: BodyState,
  a: BodyState,
  geometry: CollisionGeometry,
  seed: string,
  index: number,
  is2d: boolean,
  large: boolean,
  ejectaRadius: number,
) {
  const contactNormal = source === a ? geometry.normal : scale(geometry.normal, -1)
  const patchScale = large ? 0.13 : 0.22
  const tangentOffset = (seededScalar(`${seed}:patch-tangent:${index}`) * 2 - 1) *
    patchScale * (0.8 + geometry.grazing * 0.45)
  let patchDirection = add(contactNormal, scale(geometry.tangent, tangentOffset))

  if (!is2d) {
    const referenceAxis: Vec3 = Math.abs(contactNormal.z) < 0.86
      ? { x: 0, y: 0, z: 1 }
      : { x: 0, y: 1, z: 0 }
    const binormal = normalize(cross(contactNormal, geometry.tangent), cross(contactNormal, referenceAxis))
    const binormalOffset = (seededScalar(`${seed}:patch-binormal:${index}`) * 2 - 1) *
      (large ? 0.11 : 0.2) * (0.85 + geometry.headOn * 0.25)
    patchDirection = add(patchDirection, scale(binormal, binormalOffset))
  }

  const surfaceDirection = normalize(patchDirection, contactNormal)
  const surfacePoint = add(source.position, scale(surfaceDirection, source.radius))
  const surfaceLift = source.radius * (0.006 + seededScalar(`${seed}:patch-lift:${index}`) * 0.008) +
    ejectaRadius * (large ? 0.08 : 0.14)
  return add(surfacePoint, scale(surfaceDirection, surfaceLift))
}

function makeCollisionFlash(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)
  const phaseOffset = seededScalar(`${a.id}:${b.id}:flash:${collisionSerial}`)
  const stellarCollision = isStellarCollision(a, b)
  const stellarOutcome = decision.stellarOutcome
  const outcomeRadiusScale = stellarOutcome === 'merge'
    ? 1.12
    : stellarOutcome === 'partialDisruption'
      ? 1.02
      : stellarOutcome === 'hitAndRun'
        ? 0.9
        : 1
  const outcomeBrightness = stellarOutcome === 'merge'
    ? 0.28
    : stellarOutcome === 'partialDisruption'
      ? 0.14
      : 0

  return {
    id: `${a.id}+${b.id}+flash${collisionSerial}`,
    name: 'Collision flash',
    color: dominant.color,
    mass: 0,
    radius: stellarCollision
      ? Math.max(0.1, Math.min(0.31, totalRadius * 0.78 * outcomeRadiusScale))
      : Math.max(COLLISION_FLASH_RADIUS, Math.min(0.13, totalRadius * 0.42)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: stellarCollision
      ? STELLAR_FLASH_LIFETIME + (stellarOutcome === 'merge' ? 0.1 : stellarOutcome === 'partialDisruption' ? 0.05 : 0)
      : COLLISION_FLASH_LIFETIME,
    effectVisual: {
      kind: 'contactFlash',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: stellarCollision
        ? clamp(
            4.15 + geometry.headOn * 1.25 + geometry.grazing * 0.55 + (stellarOutcome === 'merge' ? 0.45 : 0),
            4.1,
            6.15,
          )
        : clamp(2.65 + geometry.headOn * 0.95 + geometry.grazing * 0.2, 2.6, 3.8),
      widthScale: stellarCollision
        ? clamp(0.31 - geometry.headOn * 0.07 + geometry.grazing * 0.05, 0.22, 0.36)
        : clamp(0.42 - geometry.headOn * 0.13 + geometry.grazing * 0.04, 0.25, 0.44),
      tailLength: 0,
      brightness: stellarCollision
        ? clamp(2.05 + geometry.headOn * 0.45 + speedHeat * 0.32 + outcomeBrightness, 2.05, 2.82)
        : clamp(1.28 + geometry.headOn * 0.48 + speedHeat * 0.34, 1.3, 2.05),
      turbulence: stellarCollision
        ? clamp(0.42 + geometry.grazing * 0.34 + speedHeat * 0.16, 0.42, 0.88)
        : clamp(0.12 + geometry.grazing * 0.3 + speedHeat * 0.18, 0.12, 0.58),
      pulseStrength: stellarCollision ? 0.09 : 0.16 + geometry.headOn * 0.1,
      phaseOffset,
      secondaryColor: secondary.color,
      temperatureBias: speedHeat,
      stellarCollision,
      stellarOutcome,
    },
  }
}

function makeStellarCompressionSheet(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)
  const stellarOutcome = decision.stellarOutcome
  const mergeBoost = stellarOutcome === 'merge' ? 1 : 0
  const partialBoost = stellarOutcome === 'partialDisruption' ? 1 : 0

  return {
    id: `${a.id}+${b.id}+shock${collisionSerial}`,
    name: 'Stellar shock sheet',
    color: dominant.color,
    mass: 0,
    radius: Math.max(0.09, Math.min(0.29, totalRadius * (0.62 + mergeBoost * 0.08))),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: STELLAR_SHOCK_LIFETIME + mergeBoost * 0.18 + partialBoost * 0.08,
    effectVisual: {
      kind: 'compressionShear',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: clamp(
        4.1 + geometry.grazing * 2.1 + geometry.headOn * 0.55 + mergeBoost * 0.5,
        4.2,
        7.2,
      ),
      widthScale: clamp(
        0.31 - geometry.grazing * 0.08 + geometry.headOn * 0.03 + mergeBoost * 0.035,
        0.2,
        0.38,
      ),
      tailLength: 0.22 + geometry.grazing * 0.34 + (stellarOutcome === 'hitAndRun' ? 0.14 : 0),
      brightness: clamp(
        1.48 + geometry.headOn * 0.22 + speedHeat * 0.24 + mergeBoost * 0.2 + partialBoost * 0.1,
        1.48,
        2.12,
      ),
      turbulence: clamp(0.66 + geometry.grazing * 0.24 + speedHeat * 0.12, 0.66, 1),
      pulseStrength: 0.055,
      phaseOffset: seededScalar(`${a.id}:${b.id}:shock:${collisionSerial}`),
      secondaryColor: secondary.color,
      temperatureBias: speedHeat,
      stellarCollision: true,
      stellarOutcome,
    },
  }
}

function makeStellarAfterglow(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const stellarOutcome = decision.stellarOutcome
  const radiusScale = stellarOutcome === 'merge'
    ? 0.82
    : stellarOutcome === 'partialDisruption'
      ? 0.7
      : 0.58
  const lifetime = stellarOutcome === 'merge'
    ? 1.55
    : stellarOutcome === 'partialDisruption'
      ? 1.25
      : 0.95

  return {
    id: `${a.id}+${b.id}+afterglow${collisionSerial}`,
    name: 'Stellar afterglow',
    color: dominant.color,
    mass: 0,
    radius: Math.max(0.1, Math.min(0.36, totalRadius * radiusScale)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime,
    effectVisual: {
      kind: 'stellarAfterglow',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: clamp(
        1.18 + geometry.grazing * 0.42 + (stellarOutcome === 'hitAndRun' ? 0.18 : 0),
        1.18,
        1.8,
      ),
      widthScale: clamp(0.9 - geometry.grazing * 0.14, 0.72, 0.92),
      brightness: stellarOutcome === 'merge' ? 1.38 : stellarOutcome === 'partialDisruption' ? 1.25 : 1.08,
      turbulence: 0.72 + geometry.grazing * 0.2,
      pulseStrength: 0.02,
      phaseOffset: seededScalar(`${a.id}:${b.id}:afterglow:${collisionSerial}`),
      secondaryColor: secondary.color,
      temperatureBias: 0.62,
      stellarCollision: true,
      stellarOutcome,
    },
  }
}

function makeCollisionEffects(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
) {
  const flash = makeCollisionFlash(a, b, geometry, decision)
  if (!isStellarCollision(a, b)) return [flash]
  return [
    flash,
    makeStellarCompressionSheet(a, b, geometry, decision),
    makeStellarAfterglow(a, b, geometry, decision),
  ]
}

function getEjectaDirection(
  seed: string,
  index: number,
  is2d: boolean,
  geometry: CollisionGeometry,
  stellarBias?: StellarEjectaBias,
  large = false,
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
  const planarStripped = projectToCollisionPlane(strippedDirection, geometry, geometry.tangent)
  const planarRelative = projectToCollisionPlane(relativeDirection, geometry, geometry.tangent)

  if (geometry.grazing > 0.6) {
    // Grazing collisions are stripping events: most streams share one dominant
    // tangent direction, while only a sparse minority forms a counter-stream.
    const counterStream = index % 5 === 4
    const sign = counterStream ? -dominantTangentSign : dominantTangentSign
    const tangentWeight = large
      ? clamp(0.78 + geometry.grazing * 0.14 + speedEnergy * 0.03, 0.84, 0.95)
      : clamp(0.73 + geometry.grazing * 0.16 + speedEnergy * 0.03, 0.79, 0.93)
    const strippedWeight = 0.07 + massAsymmetry * 0.13
    const relativeWeight = 0.035 + speedEnergy * 0.045
    const normalSign = index % 3 === 0 ? 1 : -1
    const normalWeight = large
      ? 0.01 + speedEnergy * 0.012
      : 0.016 + speedEnergy * 0.02
    const randomWeight = large ? 0.035 : 0.075
    const alignedSplash = dot(splashRandom, geometry.tangent) * sign < 0
      ? scale(splashRandom, -1)
      : splashRandom
    return normalize(
      add(
        add(
          add(scale(geometry.tangent, sign * tangentWeight), scale(planarStripped, strippedWeight)),
          add(scale(planarRelative, relativeWeight), scale(geometry.normal, normalSign * normalWeight)),
        ),
        scale(alignedSplash, randomWeight),
      ),
      scale(geometry.tangent, sign),
    )
  }

  if (geometry.headOn > 0.7) {
    // Vent compressed material mostly inside the plane perpendicular to the
    // collision normal. In 2D this becomes the two ±tangent splash directions;
    // in 3D seeded in-plane turbulence prevents a perfectly symmetric ring.
    const sign = index % 2 === 0 ? 1 : -1
    const alignedSplash = dot(splashRandom, geometry.tangent) * sign < 0
      ? scale(splashRandom, -1)
      : splashRandom
    const tangentWeight = large ? 0.64 : 0.52
    const splashWeight = large ? 0.23 : 0.36
    const strippedWeight = 0.055 + massAsymmetry * 0.075
    const normalWeight = large
      ? 0.012 + speedEnergy * 0.014
      : 0.018 + speedEnergy * 0.02
    return normalize(
      add(
        add(scale(geometry.tangent, sign * tangentWeight), scale(alignedSplash, splashWeight)),
        add(
          scale(planarStripped, strippedWeight),
          scale(geometry.normal, (index % 3 === 0 ? 1 : -1) * normalWeight),
        ),
      ),
      scale(geometry.tangent, sign),
    )
  }

  const sign = index % 4 === 3 ? -dominantTangentSign : dominantTangentSign
  return normalize(
    add(
      add(scale(geometry.tangent, sign * 0.58), scale(planarStripped, 0.2 + massAsymmetry * 0.12)),
      add(scale(planarRelative, 0.1 + speedEnergy * 0.06), scale(splashRandom, large ? 0.05 : 0.1)),
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
  source: BodyState,
  decision: CollisionDecision,
  seed: string,
): EffectVisualState {
  const large = index < largeCount
  const stellarCollision = isStellarCollision(a, b)
  const stellarOutcome = decision.stellarOutcome
  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)
  const geometryStretch = geometry.grazing * 2.4 - geometry.headOn * 0.45
  const sizeStretch = large ? 0.02 : 0.64
  const variance = seededScalar(`${seed}:shape:${index}`)
  const widthVariance = seededScalar(`${seed}:width:${index}`)
  const tailVariance = seededScalar(`${seed}:tail:${index}`)
  const phaseOffset = seededScalar(`${seed}:phase:${index}`)
  const outcomeTailBoost = stellarOutcome === 'hitAndRun'
    ? 0.34
    : stellarOutcome === 'partialDisruption'
      ? 0.2
      : 0
  const outcomeBrightness = stellarOutcome === 'merge'
    ? 0.14
    : stellarOutcome === 'partialDisruption'
      ? 0.1
      : 0.05

  return {
    kind: 'stellarPlasma',
    direction: { ...direction },
    normal: { ...geometry.normal },
    stretch: clamp(
      2.0 + geometryStretch + speedEnergy * 0.72 + sizeStretch + variance * 0.55 +
        (stellarCollision ? 0.42 : 0) + outcomeTailBoost * 0.75,
      1.75,
      stellarCollision ? 6.8 : 5.8,
    ),
    widthScale: clamp(
      0.92 - geometry.grazing * 0.35 + geometry.headOn * 0.12 + (widthVariance - 0.5) * 0.18 +
        (large ? 0.07 : -0.035),
      0.42,
      1.08,
    ),
    tailLength: clamp(
      0.38 + geometry.grazing * 0.72 + speedEnergy * 0.34 + (large ? 0.02 : 0.34) +
        tailVariance * 0.22 + (stellarCollision ? 0.12 : 0) + outcomeTailBoost,
      0.35,
      1.9,
    ),
    brightness: clamp(
      1.0 + speedEnergy * 0.28 + (large ? 0.18 : -0.02) + variance * 0.1 +
        (stellarCollision ? 0.16 : 0) + outcomeBrightness,
      0.92,
      stellarCollision ? 1.78 : 1.48,
    ),
    turbulence: clamp(
      0.38 + geometry.grazing * 0.27 + speedEnergy * 0.2 + (large ? -0.035 : 0.18) +
        (stellarCollision ? 0.08 : 0) + (stellarOutcome === 'partialDisruption' ? 0.08 : 0),
      0.34,
      1,
    ),
    pulseStrength: 0.035 + (1 - index / Math.max(count - 1, 1)) * 0.055,
    phaseOffset,
    secondaryColor: source === stellarBias.smaller
      ? stellarBias.larger.color
      : stellarBias.smaller.color,
    temperatureBias: speedEnergy,
    stellarCollision,
    stellarOutcome,
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

  // Keep IDs serialised for uniqueness, but derive all ejecta randomness from
  // collision state so replaying the same initial state produces the same patch,
  // source selection, directions, speeds, and visual variation.
  const seed = getStableEjectaSeed(a, b, geometry)
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

  return weights.map((weight, index) => {
    const share = weight / weightTotal
    const mass = requestedMass * share
    const volume = requestedVolume * share
    const radius = Math.cbrt(Math.max(volume, 1e-12))
    const large = stellarEjecta && index < largeCount
    const direction = getEjectaDirection(seed, index, is2d, geometry, stellarBias, large)
    const tiny = radius < MIN_PERSISTENT_FRAGMENT_RADIUS || mass < MIN_PERSISTENT_FRAGMENT_MASS

    if (stellarEjecta && stellarBias) {
      const source = selectStellarEjectaSource(seed, index, geometry, stellarBias)
      const inheritedSourceWeight = large ? 0.82 : 0.62
      const inheritedVelocity = add(
        scale(source.velocity, inheritedSourceWeight),
        scale(centerVelocity, 1 - inheritedSourceWeight),
      )
      const kickScale = large
        ? 0.72 + seededScalar(`${seed}:speed:${index}`) * 0.34
        : 0.98 + seededScalar(`${seed}:speed:${index}`) * 0.52
      const velocity = add(inheritedVelocity, scale(direction, baseKick * kickScale))
      const travelDirection = normalize(sub(velocity, centerVelocity), direction)
      const position = getStellarEjectaSpawnPosition(
        source,
        a,
        geometry,
        seed,
        index,
        is2d,
        large,
        radius,
      )
      const lifetimeNoise = seededScalar(`${seed}:life:${index}`)
      const lifetime = clamp(
        STELLAR_PLASMA_LIFETIME +
          (large ? 0.18 : -0.08) +
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
          travelDirection,
          index,
          count,
          largeCount,
          stellarBias,
          source,
          decision,
          seed,
        ),
      }
    }

    const speedNoise = 0.78 + seededScalar(`${seed}:speed:${index}`) * 0.72
    const velocity = add(centerVelocity, scale(direction, baseKick * speedNoise))
    const position = add(centerPosition, scale(direction, solidSpawnDistance + radius * 2.5))
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
  const representedEjectaMass = fragments.reduce((sum, fragment) => sum + fragment.mass, 0)
  const representedEjectaVolume = fragments.reduce((sum, fragment) => sum + fragment.radius ** 3, 0)
  const missingEjectaMass = Math.max(0, requestedEjectaMass - representedEjectaMass)
  const missingEjectaVolume = Math.max(0, requestedEjectaVolume - representedEjectaVolume)
  const remnantMass = Math.max(totalMass - requestedEjectaMass, totalMass * 0.05)
  const remnantVolume = Math.max(totalVolume - representedEjectaVolume - missingEjectaVolume, totalVolume * 0.02)
  const totalMomentum = add(momentum(a), momentum(b))
  const representedEjectaMomentum = fragments.reduce(
    (sum, fragment) => add(sum, momentum(fragment)),
    { x: 0, y: 0, z: 0 },
  )
  const missingEjectaMomentum = scale(centerOfMassVelocity(a, b), missingEjectaMass)
  const remnantVelocity = scale(
    sub(totalMomentum, add(representedEjectaMomentum, missingEjectaMomentum)),
    1 / remnantMass,
  )
  const dominant = a.mass >= b.mass ? a : b
  const bodyType = dominantBodyType(a, b)
  const remnantRadius = bodyType === 'star'
    ? getMergedStellarRadius(a, b, remnantMass, remnantVolume)
    : Math.cbrt(remnantVolume)
  const stellarOutcome = decision.stellarOutcome ?? 'merge'
  const remnant: BodyState = {
    id: `${a.id}+${b.id}`,
    name: mergedBodyName(a, b),
    color: dominant.color,
    mass: remnantMass,
    radius: remnantRadius,
    position: centerOfMassPosition(a, b),
    velocity: remnantVelocity,
    bodyType,
    ...(bodyType === 'star'
      ? getStellarCollisionAppearance(dominant, remnantMass, stellarOutcome, geometry)
      : {}),
  }

  return [remnant, ...fragments, ...makeCollisionEffects(a, b, geometry, decision)]
}

function resolveStellarSeparatedCollision(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
  outcome: Extract<StellarCollisionOutcome, 'hitAndRun' | 'partialDisruption'>,
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
  const representedEjectaMass = fragments.reduce((sum, fragment) => sum + fragment.mass, 0)
  const missingEjectaMass = Math.max(0, requestedEjectaMass - representedEjectaMass)
  const smaller = a.mass <= b.mass ? a : b
  const larger = smaller === a ? b : a
  const massRatio = smaller.mass / Math.max(larger.mass, 1e-9)
  const massAsymmetry = 1 - clamp(massRatio, 0, 1)
  const smallerLossShare = outcome === 'partialDisruption'
    ? clamp(0.76 + massAsymmetry * 0.15 + geometry.headOn * 0.05, 0.74, 0.94)
    : clamp(0.58 + massAsymmetry * 0.18 + geometry.headOn * 0.04, 0.56, 0.82)
  const smallerLoss = requestedEjectaMass * smallerLossShare
  const largerLoss = Math.max(0, requestedEjectaMass - smallerLoss)
  const transferFraction = outcome === 'partialDisruption'
    ? clamp(0.012 + geometry.speedRatio * 0.01 + geometry.grazing * 0.014, 0.012, 0.045)
    : clamp(0.006 + geometry.speedRatio * 0.006 + geometry.grazing * 0.008, 0.006, 0.025)
  const transferMass = Math.min(
    smaller.mass * transferFraction,
    Math.max(0, smaller.mass - smallerLoss - smaller.mass * 0.22),
  )

  const smallerMass = Math.max(smaller.mass - smallerLoss - transferMass, smaller.mass * 0.2)
  const largerMass = Math.max(larger.mass - largerLoss + transferMass, larger.mass * 0.2)
  const massA = smaller === a ? smallerMass : largerMass
  const massB = smaller === b ? smallerMass : largerMass
  const radiusA = getStellarRadiusAfterMassChange(a, massA)
  const radiusB = getStellarRadiusAfterMassChange(b, massB)

  const relativeNormalSpeed = dot(geometry.relativeVelocity, geometry.normal)
  const restitution = outcome === 'partialDisruption'
    ? clamp(0.08 + geometry.grazing * 0.19, 0.09, 0.27)
    : clamp(0.16 + geometry.grazing * 0.28, 0.18, 0.42)
  const impulseMagnitude = relativeNormalSpeed < 0
    ? (-(1 + restitution) * relativeNormalSpeed) / (1 / a.mass + 1 / b.mass)
    : 0
  let velocityA = sub(a.velocity, scale(geometry.normal, impulseMagnitude / a.mass))
  let velocityB = add(b.velocity, scale(geometry.normal, impulseMagnitude / b.mass))

  const relativeAfterNormalImpulse = sub(velocityB, velocityA)
  const normalAfterImpulse = scale(
    geometry.normal,
    dot(relativeAfterNormalImpulse, geometry.normal),
  )
  const tangentAfterImpulse = sub(relativeAfterNormalImpulse, normalAfterImpulse)
  const tangentRetention = outcome === 'partialDisruption'
    ? clamp(0.42 + geometry.grazing * 0.12 - geometry.compressionSeverity * 0.2, 0.32, 0.56)
    : clamp(0.72 + geometry.grazing * 0.1 - geometry.compressionSeverity * 0.24, 0.62, 0.82)
  const tangentToDissipate = scale(tangentAfterImpulse, 1 - tangentRetention)
  const tangentialImpulse = scale(
    tangentToDissipate,
    1 / Math.max(1 / a.mass + 1 / b.mass, 1e-9),
  )
  velocityA = add(velocityA, scale(tangentialImpulse, 1 / a.mass))
  velocityB = sub(velocityB, scale(tangentialImpulse, 1 / b.mass))

  const center = centerOfMassPosition(a, b)
  const separationScale = outcome === 'partialDisruption' ? 1.035 : 1 + geometry.grazing * 0.08
  const separation = (radiusA + radiusB) * separationScale + 1e-4
  const survivorMass = massA + massB
  const positionA = sub(center, scale(geometry.normal, separation * (massB / survivorMass)))
  const positionB = add(center, scale(geometry.normal, separation * (massA / survivorMass)))

  const fragmentMomentum = fragments.reduce(
    (sum, fragment) => add(sum, momentum(fragment)),
    { x: 0, y: 0, z: 0 },
  )
  const missingEjectaMomentum = scale(centerOfMassVelocity(a, b), missingEjectaMass)
  const targetMomentum = sub(
    add(momentum(a), momentum(b)),
    add(fragmentMomentum, missingEjectaMomentum),
  )
  const survivorMomentum = add(scale(velocityA, massA), scale(velocityB, massB))
  const correction = scale(sub(targetMomentum, survivorMomentum), 1 / survivorMass)
  velocityA = add(velocityA, correction)
  velocityB = add(velocityB, correction)

  const smallerDamageBias = outcome === 'partialDisruption' ? 1.18 : 1.08
  const largerDamageBias = outcome === 'partialDisruption' ? 0.82 : 0.92
  const survivorA: BodyState = {
    ...cloneBody(a),
    mass: massA,
    radius: radiusA,
    position: positionA,
    velocity: velocityA,
    bodyType: 'star',
    collisionCooldown: HIT_RUN_COOLDOWN,
    ...getStellarCollisionAppearance(
      a,
      massA,
      outcome,
      geometry,
      a === smaller ? smallerDamageBias : largerDamageBias,
    ),
  }
  const survivorB: BodyState = {
    ...cloneBody(b),
    mass: massB,
    radius: radiusB,
    position: positionB,
    velocity: velocityB,
    bodyType: 'star',
    collisionCooldown: HIT_RUN_COOLDOWN,
    ...getStellarCollisionAppearance(
      b,
      massB,
      outcome,
      geometry,
      b === smaller ? smallerDamageBias : largerDamageBias,
    ),
  }

  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry, decision)]
}

function resolveHitAndRun(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
): BodyState[] {
  if (isStellarCollision(a, b)) {
    return resolveStellarSeparatedCollision(a, b, geometry, decision, availableSlots, 'hitAndRun')
  }

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

  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry, decision)]
}

function resolvePartialDisruption(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
): BodyState[] {
  if (!isStellarCollision(a, b)) {
    return resolveMergedCollision(a, b, geometry, decision, availableSlots)
  }
  return resolveStellarSeparatedCollision(
    a,
    b,
    geometry,
    decision,
    availableSlots,
    'partialDisruption',
  )
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
        const baseResultCount = decision.mode === 'hitRun' || decision.stellarOutcome === 'partialDisruption' ? 2 : 1
        // Reserve all non-physical VFX slots before allocating ejecta so large
        // stellar flashes/shock sheets/afterglow cannot exceed the dynamic-body cap.
        const collisionEffectReserve = isStellarCollision(a, b) ? 3 : 1
        const availableSlots = Math.max(
          0,
          MAX_DYNAMIC_BODIES - (bodies.length - 2 + baseResultCount + collisionEffectReserve),
        )
        const replacement = decision.stellarOutcome === 'partialDisruption'
          ? resolvePartialDisruption(a, b, geometry, decision, availableSlots)
          : decision.mode === 'hitRun'
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
