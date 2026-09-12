import type { StellarCollisionOutcome, Vec3 } from '../types'
import { add, magnitude, scale, sub } from './vector'

export type StellarEjectaDirectionInput = {
  seed: string
  index: number
  count: number
  is2d: boolean
  normal: Vec3
  tangent: Vec3
  grazing: number
  speedRatio: number
  outcome: StellarCollisionOutcome
  massAsymmetry: number
  strippedDirection: Vec3
  relativeDirection: Vec3
  dominantTangentSign: number
  sourceIsSmaller: boolean
  large: boolean
}

type CollisionFrame = {
  normal: Vec3
  tangent: Vec3
  binormal: Vec3
}

const GOLDEN_FRACTION = 0.6180339887498949
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = magnitude(value)
  if (length > 1e-10) return scale(value, 1 / length)
  const fallbackLength = magnitude(fallback)
  return fallbackLength > 1e-10 ? scale(fallback, 1 / fallbackLength) : { x: 1, y: 0, z: 0 }
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function sample(seed: string, channel: string, index?: number) {
  const suffix = index === undefined ? channel : `${channel}:${index}`
  return hashString(`${seed}:stellar-ejecta-direction:${suffix}`) / 4294967295
}

function smoothRange(value: number, start: number, end: number) {
  const t = clamp((value - start) / Math.max(end - start, 1e-9), 0, 1)
  return t * t * (3 - 2 * t)
}

function fract(value: number) {
  return value - Math.floor(value)
}

function buildCollisionFrame(normalInput: Vec3, tangentInput: Vec3, is2d: boolean): CollisionFrame {
  const normalCandidate = is2d
    ? { x: normalInput.x, y: normalInput.y, z: 0 }
    : normalInput
  const normal = normalize(normalCandidate, { x: 1, y: 0, z: 0 })
  let tangentCandidate = sub(tangentInput, scale(normal, dot(tangentInput, normal)))

  if (is2d) {
    tangentCandidate = { x: tangentCandidate.x, y: tangentCandidate.y, z: 0 }
    const tangent = normalize(tangentCandidate, { x: -normal.y, y: normal.x, z: 0 })
    return {
      normal,
      tangent,
      binormal: { x: 0, y: 0, z: 1 },
    }
  }

  const referenceAxis: Vec3 = Math.abs(normal.z) < 0.82
    ? { x: 0, y: 0, z: 1 }
    : Math.abs(normal.y) < 0.82
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 }
  const tangent = normalize(tangentCandidate, cross(referenceAxis, normal))
  const binormal = normalize(cross(normal, tangent), cross(normal, referenceAxis))
  return {
    normal,
    tangent: normalize(cross(binormal, normal), tangent),
    binormal,
  }
}

function projectToImpactPlane(value: Vec3, frame: CollisionFrame, fallback: Vec3) {
  return normalize(
    sub(value, scale(frame.normal, dot(value, frame.normal))),
    fallback,
  )
}

function getHeadOnSpreadSample(input: StellarEjectaDirectionInput) {
  const count = Math.max(1, input.count)
  const binOffset = Math.floor(sample(input.seed, `head-spread-bin:${input.outcome}`) * count)
  const bin = (input.index + binOffset) % count
  const jitter = (sample(input.seed, `head-spread-jitter:${input.outcome}`, input.index) - 0.5) * 0.32
  return clamp(((bin + 0.5 + jitter) / count) * 2 - 1, -1, 1)
}

function getHeadOnDirection(input: StellarEjectaDirectionInput, frame: CollisionFrame) {
  const sideOffset = sample(input.seed, `head-side:${input.outcome}`) < 0.5 ? 0 : 1
  const sideSign = (input.index + sideOffset) % 2 === 0 ? 1 : -1
  // Keep every head-on collision deterministic, but stratify the normal-axis
  // spread across the whole parcel set. Independent hashes can accidentally
  // cluster a small set of parcels into one narrow trajectory band even when
  // the configured fan width is broad. A seeded bin rotation plus small
  // per-parcel jitter preserves irregular spacing without allowing that collapse.
  const spreadSample = getHeadOnSpreadSample(input)
  const sizeScale = input.large ? 0.72 : 1

  if (input.is2d) {
    const halfWidth = (
      input.outcome === 'merge'
        ? 0.5
        : input.outcome === 'partialDisruption'
          ? 0.42 + input.massAsymmetry * 0.12
          : 0.34
    ) * sizeScale
    const angle = spreadSample * halfWidth
    return normalize(
      add(
        scale(frame.tangent, sideSign * Math.cos(angle)),
        scale(frame.normal, Math.sin(angle)),
      ),
      scale(frame.tangent, sideSign),
    )
  }

  const phaseBase = sample(input.seed, `head-phase:${input.outcome}`)
  const phaseJitter = (sample(input.seed, `head-phase-jitter:${input.outcome}`, input.index) - 0.5) * 0.18
  const phase = fract(phaseBase + input.index * GOLDEN_FRACTION + phaseJitter)
  const azimuth = phase * Math.PI * 2
  const equatorial = add(
    scale(frame.tangent, Math.cos(azimuth)),
    scale(frame.binormal, Math.sin(azimuth)),
  )
  const normalSpread = (
    input.outcome === 'merge'
      ? 0.24
      : input.outcome === 'partialDisruption'
        ? 0.2 + input.massAsymmetry * 0.1
        : 0.16
  ) * sizeScale
  return normalize(
    add(equatorial, scale(frame.normal, spreadSample * normalSpread)),
    equatorial,
  )
}

function getGrazingDirection(input: StellarEjectaDirectionInput, frame: CollisionFrame) {
  const stripped = projectToImpactPlane(input.strippedDirection, frame, frame.tangent)
  const relative = projectToImpactPlane(input.relativeDirection, frame, frame.tangent)
  const speedEnergy = clamp(input.speedRatio / 2.6, 0, 1)
  const damageBias = input.outcome === 'partialDisruption' && input.sourceIsSmaller ? 1 : 0
  const count = Math.max(1, input.count)
  const counterPoolSize = count >= 4 ? 2 : 1
  const counterPoolStart = count - counterPoolSize
  const guaranteedCounterSlot = counterPoolStart + Math.min(
    counterPoolSize - 1,
    Math.floor(sample(input.seed, `counter-slot:${input.outcome}`) * counterPoolSize),
  )
  const extraCounterChance = input.outcome === 'hitAndRun'
    ? 0.035
    : input.outcome === 'partialDisruption'
      ? 0.07
      : 0.32
  const guaranteedCounter = count >= 4 && input.index === guaranteedCounterSlot
  const counterStream = input.outcome === 'merge'
    ? sample(input.seed, `counter:${input.outcome}`, input.index) < extraCounterChance
    : guaranteedCounter || sample(input.seed, `counter:${input.outcome}`, input.index) < extraCounterChance
  const sign = counterStream ? -input.dominantTangentSign : input.dominantTangentSign
  const signedStripped = dot(stripped, frame.tangent) * sign < 0 ? scale(stripped, -1) : stripped
  const signedRelative = dot(relative, frame.tangent) * sign < 0 ? scale(relative, -1) : relative

  const tangentWeight = input.outcome === 'hitAndRun'
    ? 0.74
    : input.outcome === 'partialDisruption'
      ? 0.54
      : 0.48
  const strippedWeight = input.outcome === 'hitAndRun'
    ? 0.3 + input.massAsymmetry * 0.1
    : input.outcome === 'partialDisruption'
      ? 0.4 + input.massAsymmetry * 0.2 + damageBias * 0.12
      : 0.2 + input.massAsymmetry * 0.1
  const relativeWeight = input.outcome === 'hitAndRun'
    ? 0.08 + speedEnergy * 0.03
    : input.outcome === 'partialDisruption'
      ? 0.09 + speedEnergy * 0.04
      : 0.06 + speedEnergy * 0.025
  const primary = normalize(
    add(
      add(scale(frame.tangent, sign * tangentWeight), scale(signedStripped, strippedWeight)),
      scale(signedRelative, relativeWeight),
    ),
    scale(frame.tangent, sign),
  )

  const sizeScale = input.large ? 0.7 : 1
  const spread = (
    input.outcome === 'hitAndRun'
      ? 0.2
      : input.outcome === 'partialDisruption'
        ? 0.31 + damageBias * 0.05
        : 0.38
  ) * sizeScale
  const normalScatter = (sample(input.seed, `grazing-normal:${input.outcome}`, input.index) * 2 - 1) * spread

  if (input.is2d) {
    return normalize(
      add(primary, scale(frame.normal, normalScatter)),
      primary,
    )
  }

  const lateral = normalize(cross(frame.normal, primary), frame.binormal)
  const lateralScatter = (sample(input.seed, `grazing-lateral:${input.outcome}`, input.index) * 2 - 1) * spread
  return normalize(
    add(
      primary,
      add(
        scale(lateral, lateralScatter),
        scale(frame.normal, normalScatter * 0.55),
      ),
    ),
    primary,
  )
}

/**
 * Deterministic physical launch direction for star-star ejecta.
 * The seed is intentionally identity-based; collision geometry then rotates and
 * blends a stable set of per-parcel samples instead of rehashing at grazing thresholds.
 */
export function getStellarCollisionEjectaDirection(input: StellarEjectaDirectionInput): Vec3 {
  const frame = buildCollisionFrame(input.normal, input.tangent, input.is2d)
  const headOnDirection = getHeadOnDirection(input, frame)
  const grazingDirection = getGrazingDirection(input, frame)
  const grazingBlend = smoothRange(input.grazing, 0.28, 0.82)
  const blended = add(
    scale(headOnDirection, 1 - grazingBlend),
    scale(grazingDirection, grazingBlend),
  )
  const bridgeAxis = input.is2d ? frame.normal : frame.binormal
  const bridgeSign = sample(input.seed, `blend-bridge:${input.outcome}`, input.index) < 0.5 ? -1 : 1
  const bridgeWeight = Math.sin(Math.PI * grazingBlend) * 0.05
  return normalize(
    add(blended, scale(bridgeAxis, bridgeSign * bridgeWeight)),
    grazingBlend >= 0.5 ? grazingDirection : headOnDirection,
  )
}
