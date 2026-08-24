import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState, Vec3 } from '../types'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'
const PLASMA_ID_TOKEN = '+plasma'
const STELLAR_PLASMA_LIFETIME = 1.35
const COLLISION_SPARK_LIFETIME = 0.9
const PLASMA_EXPANSION_RATE = 0.009
const PLASMA_MAX_RADIUS = 0.06
const PLASMA_DRAG_PER_SECOND = 0.28

const addVec = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const subVec = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scaleVec = (value: Vec3, scale: number): Vec3 => ({
  x: value.x * scale,
  y: value.y * scale,
  z: value.z * scale,
})

function isBodyDescendedFrom(bodyId: string, ancestorId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return ancestorId.split('+').every((part) => bodyParts.has(part))
}

function getEjectaGroupId(id: string) {
  const match = id.match(/\+(?:frag|fx)\d+-\d+$/)
  return match ? id.slice(0, -match[0].length) : null
}

function isFreshStellarEjecta(body: BodyState, inputStars: BodyState[]) {
  if (body.id.includes(PLASMA_ID_TOKEN)) return false
  const isEjecta = body.bodyType === 'fragment' || (
    body.bodyType === 'effect' && body.name === COLLISION_SPARK_NAME
  )
  if (!isEjecta || !getEjectaGroupId(body.id)) return false
  return inputStars.some((star) => isBodyDescendedFrom(body.id, star.id))
}

function isPlasmaEffect(body: BodyState) {
  return body.bodyType === 'effect' && body.id.includes(PLASMA_ID_TOKEN)
}

function restoreStellarEjectaMass(
  bodies: BodyState[],
  inputStars: BodyState[],
  groupId: string,
  ejecta: BodyState[],
) {
  if (ejecta.length === 0) return

  const exactRemnant = bodies.find((body) => body.id === groupId && body.bodyType === 'star')
  const descendantRemnants = bodies
    .filter((body) => body.bodyType === 'star' && isBodyDescendedFrom(body.id, groupId))
    .sort((a, b) => b.mass - a.mass)
  const participantStars = inputStars.filter((star) => isBodyDescendedFrom(groupId, star.id))
  const survivingParticipants = participantStars
    .map((star) => bodies.find((body) => body.id === star.id && body.bodyType === 'star'))
    .filter((body): body is BodyState => Boolean(body))

  const targets = exactRemnant
    ? [exactRemnant]
    : descendantRemnants.length > 0
      ? [descendantRemnants[0]]
      : survivingParticipants

  if (targets.length === 0) return

  const ejectedMass = ejecta.reduce((sum, body) => sum + Math.max(body.mass, 0), 0)
  const ejectedVolume = ejecta.reduce((sum, body) => sum + Math.max(body.radius, 0) ** 3, 0)
  const ejectedMomentum = ejecta.reduce<Vec3>(
    (sum, body) => addVec(sum, scaleVec(body.velocity, Math.max(body.mass, 0))),
    { x: 0, y: 0, z: 0 },
  )
  if (ejectedMass <= 1e-12 && ejectedVolume <= 1e-12) return

  const originalTargetMass = targets.reduce((sum, target) => sum + Math.max(target.mass, 0), 0)
  const equalWeight = 1 / targets.length
  let momentumAddedByRestoredMass: Vec3 = { x: 0, y: 0, z: 0 }

  targets.forEach((target) => {
    const weight = originalTargetMass > 1e-12 ? target.mass / originalTargetMass : equalWeight
    const restoredMass = ejectedMass * weight
    const restoredVolume = ejectedVolume * weight
    momentumAddedByRestoredMass = addVec(
      momentumAddedByRestoredMass,
      scaleVec(target.velocity, restoredMass),
    )
    target.mass += restoredMass
    target.radius = Math.cbrt(Math.max(target.radius ** 3 + restoredVolume, 1e-12))
  })

  const restoredTargetMass = targets.reduce((sum, target) => sum + Math.max(target.mass, 0), 0)
  if (restoredTargetMass <= 1e-12) return

  const momentumCorrection = scaleVec(
    subVec(ejectedMomentum, momentumAddedByRestoredMass),
    1 / restoredTargetMass,
  )
  targets.forEach((target) => {
    target.velocity = addVec(target.velocity, momentumCorrection)
  })
}

function convertToStellarPlasma(body: BodyState, inputStars: BodyState[]): BodyState {
  const sourceStars = inputStars.filter((star) => isBodyDescendedFrom(body.id, star.id))
  const plasmaColor = sourceStars.length === 1
    ? sourceStars[0].color
    : body.color
  const plasmaId = body.id.replace(/\+(?:frag|fx)(\d+-\d+)$/, '+plasma$1')

  return {
    ...body,
    id: plasmaId,
    name: COLLISION_SPARK_NAME,
    color: plasmaColor,
    mass: 0,
    radius: Math.max(0.012, Math.min(0.032, body.radius * 0.35)),
    bodyType: 'effect',
    age: 0,
    lifetime: STELLAR_PLASMA_LIFETIME,
    collisionCooldown: undefined,
  }
}

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const stepped = stepPhysicsBodies(input, dt)
  const inputStars = input.filter((body) => body.bodyType === 'star')

  if (inputStars.length > 0) {
    const stellarEjectaGroups = new Map<string, BodyState[]>()
    stepped.forEach((body) => {
      if (!isFreshStellarEjecta(body, inputStars)) return
      const groupId = getEjectaGroupId(body.id)
      if (!groupId) return
      const group = stellarEjectaGroups.get(groupId) ?? []
      group.push(body)
      stellarEjectaGroups.set(groupId, group)
    })

    stellarEjectaGroups.forEach((ejecta, groupId) => {
      restoreStellarEjectaMass(stepped, inputStars, groupId, ejecta)
    })
  }

  return stepped
    .map((body) => (
      isFreshStellarEjecta(body, inputStars)
        ? convertToStellarPlasma(body, inputStars)
        : body
    ))
    .map((body) => {
      if (isPlasmaEffect(body)) {
        const age = body.age ?? 0
        const expansionBoost = 1 + Math.min(age, STELLAR_PLASMA_LIFETIME) * 0.18
        const drag = Math.exp(-PLASMA_DRAG_PER_SECOND * dt)
        return {
          ...body,
          radius: Math.min(
            PLASMA_MAX_RADIUS,
            body.radius + PLASMA_EXPANSION_RATE * expansionBoost * dt,
          ),
          velocity: scaleVec(body.velocity, drag),
          lifetime: STELLAR_PLASMA_LIFETIME,
        }
      }

      if (body.bodyType === 'fragment') {
        return {
          ...body,
          age: (body.age ?? 0) + dt,
          lifetime: FRAGMENT_LIFETIME,
        }
      }

      if (body.bodyType === 'effect' && body.name === COLLISION_SPARK_NAME) {
        return {
          ...body,
          lifetime: COLLISION_SPARK_LIFETIME,
        }
      }

      return body
    })
    .filter((body) => body.bodyType !== 'fragment' || (body.age ?? 0) < FRAGMENT_LIFETIME)
}
