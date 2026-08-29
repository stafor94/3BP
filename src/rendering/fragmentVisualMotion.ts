
import type { BodyState, Vec3 } from '../types'

export type FragmentVisualMotionContext = {
  direction: Vec3
  burstDistance: number
  burstDuration: number
  sizeScale: number
}

type FragmentIdentity = {
  prefix: string
  serial: string
  index: number
}

const fragmentMotionById = new Map<string, FragmentVisualMotionContext>()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (value: Vec3, scalar: number): Vec3 => ({
  x: value.x * scalar,
  y: value.y * scalar,
  z: value.z * scalar,
})
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const magnitude = (value: Vec3) => Math.hypot(value.x, value.y, value.z)

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

function seededScalar(seed: string) {
  return hashString(seed) / 4294967295
}

function parseFragmentIdentity(id: string): FragmentIdentity | null {
  const match = id.match(/^(.*)\+frag(\d+)-(\d+)$/)
  if (!match) return null
  return {
    prefix: match[1],
    serial: match[2],
    index: Number(match[3]),
  }
}

function getLateralDirection(outward: Vec3, seed: string, is2d: boolean): Vec3 {
  if (is2d) {
    const tangent = normalize({ x: -outward.y, y: outward.x, z: 0 }, { x: 0, y: 1, z: 0 })
    return scale(tangent, seededScalar(`${seed}:side`) < 0.5 ? -1 : 1)
  }

  const reference = Math.abs(outward.z) < 0.82
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 }
  const basisA = normalize(cross(reference, outward), { x: 1, y: 0, z: 0 })
  const basisB = normalize(cross(outward, basisA), { x: 0, y: 1, z: 0 })
  const azimuth = seededScalar(`${seed}:azimuth`) * Math.PI * 2
  return normalize(
    add(scale(basisA, Math.cos(azimuth)), scale(basisB, Math.sin(azimuth))),
    basisA,
  )
}

export function createFragmentVisualMotionContext(
  fragment: BodyState,
  flash: BodyState,
): FragmentVisualMotionContext | null {
  const identity = parseFragmentIdentity(fragment.id)
  if (
    !identity ||
    fragment.bodyType !== 'fragment' ||
    fragment.age === undefined ||
    flash.bodyType !== 'effect' ||
    flash.name !== 'Collision flash'
  ) return null

  const collisionNormal = normalize(
    flash.effectVisual?.normal ?? sub(fragment.position, flash.position),
    { x: 1, y: 0, z: 0 },
  )
  const collisionOffset = sub(fragment.position, flash.position)
  const sideProjection = dot(collisionOffset, collisionNormal)
  const sideSign = Math.abs(sideProjection) > 1e-7
    ? Math.sign(sideProjection)
    : identity.index % 2 === 0 ? 1 : -1
  const outward = scale(collisionNormal, sideSign)
  const relativeVelocity = sub(fragment.velocity, flash.velocity)
  const is2d =
    Math.abs(outward.z) + Math.abs(collisionOffset.z) + Math.abs(relativeVelocity.z) < 1e-8
  const lateral = getLateralDirection(outward, fragment.id, is2d)
  const energy = clamp(flash.effectVisual?.temperatureBias ?? 0.35, 0, 1)
  const angle = 0.14 + seededScalar(`${fragment.id}:angle`) * (0.24 + energy * 0.08)
  const direction = normalize(
    add(scale(outward, Math.cos(angle)), scale(lateral, Math.sin(angle))),
    outward,
  )

  const sourceRadius = Math.max(
    flash.effectVisual?.sourceMaxRadius ?? 0,
    fragment.radius * 2.5,
    1e-6,
  )
  const kickSpeed = magnitude(relativeVelocity)
  const distanceVariation = 0.82 + seededScalar(`${fragment.id}:distance`) * 0.36
  const speedVariation = 0.86 + seededScalar(`${fragment.id}:speed`) * 0.32
  const sourceDrivenDistance = sourceRadius * (0.18 + energy * 0.28) * distanceVariation
  const kickDrivenDistance = kickSpeed * (0.055 + energy * 0.055) * speedVariation
  const minimumDistance = fragment.radius * (1.05 + energy * 0.65)
  const burstDistance = clamp(
    Math.max(sourceDrivenDistance, kickDrivenDistance, minimumDistance),
    fragment.radius * 0.8,
    sourceRadius * 0.58,
  )
  const durationVariation = (seededScalar(`${fragment.id}:duration`) - 0.5) * 0.14
  const burstDuration = clamp(0.5 - energy * 0.16 + durationVariation, 0.26, 0.58)
  const sizeScale = 0.84 + seededScalar(`${fragment.id}:size`) * 0.32

  return { direction, burstDistance, burstDuration, sizeScale }
}

function getBurstProgress(age: number, duration: number) {
  const linear = clamp(age / Math.max(duration, 1e-6), 0, 1)
  const remaining = 1 - linear
  return 1 - remaining * remaining * remaining
}

export function applyCollisionFragmentVisualMotion(
  renderBodies: BodyState[],
  allBodies: BodyState[],
) {
  const transientFragments = renderBodies.filter(
    (body) => body.bodyType === 'fragment' && body.age !== undefined,
  )
  const liveIds = new Set(transientFragments.map((body) => body.id))
  Array.from(fragmentMotionById.keys()).forEach((id) => {
    if (!liveIds.has(id)) fragmentMotionById.delete(id)
  })

  const bodyById = new Map(allBodies.map((body) => [body.id, body]))
  transientFragments.forEach((fragment) => {
    if (fragmentMotionById.has(fragment.id)) return
    const identity = parseFragmentIdentity(fragment.id)
    if (!identity) return
    const flash = bodyById.get(`${identity.prefix}+flash${identity.serial}`)
    if (!flash) return
    const context = createFragmentVisualMotionContext(fragment, flash)
    if (context) fragmentMotionById.set(fragment.id, context)
  })

  return renderBodies.map((body) => {
    if (body.bodyType !== 'fragment' || body.age === undefined) return body
    const context = fragmentMotionById.get(body.id)
    if (!context) return body

    const progress = getBurstProgress(body.age, context.burstDuration)
    const offset = scale(context.direction, context.burstDistance * progress)
    return {
      ...body,
      radius: body.radius * context.sizeScale,
      position: add(body.position, offset),
    }
  })
}
