import { getEffectiveBodyType } from '../bodyTypes'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import { getBodyPresentationRadius } from '../rendering/bodyPresentationRadius'
import type { BodyState, Vec3 } from '../types'
import { getCollisionContactDistance } from './collisionContact'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'
const COLLISION_FLASH_NAME = 'Collision flash'

// Collision-watch slow motion is real-time phase controlled in App.tsx. Keep a
// visible contact bridge for solid-body collisions too so 0.03x observation has
// enough wall-clock time to show compression/contact before the solver reveals
// the remnant and ejecta.
const COLLISION_IMPACT_SIM_DURATION = 0.024
const STELLAR_HIT_RUN_IMPACT_SIM_DURATION = 0.018
const STELLAR_MERGE_IMPACT_SIM_DURATION = 0.024
const STELLAR_PARTIAL_IMPACT_SIM_DURATION = 0.021
const IMPACT_MAX_OVERLAP_RATIO = 0.14
const STELLAR_HIT_RUN_MAX_OVERLAP_RATIO = 0.18
const STELLAR_MERGE_MAX_OVERLAP_RATIO = 0.36
const STELLAR_PARTIAL_MAX_OVERLAP_RATIO = 0.24
const STELLAR_MERGE_COMPRESSION_END_PROGRESS = 0.55
const CONTACT_RESOLUTION_OVERLAP = 1e-6
const CONTACT_RESOLUTION_DT = 1e-8
const TRACKING_G = 1
const EXTREME_MASS_RATIO_ABSORPTION_MAX_RATIO = 0.02
const EXTREME_MASS_RATIO_ABSORPTION_MAX_SPEED_RATIO = 1.05
const ABSORPTION_SINK_START_PROGRESS = 0.18
const ABSORPTION_COLLAPSE_START_PROGRESS = 0.32
const ABSORPTION_SINK_FRACTION = 0.44
const ABSORPTION_MIN_RADIUS_SCALE = 0.06
const ABSORPTION_EJECTA_LIFETIME = 0.55

// Large solid fragments behave as long-lived asteroids. Keep the cap deliberately
// small so N-body cost remains predictable even after many collisions.
const ASTEROID_MIN_RADIUS = 0.012
const ASTEROID_MIN_MASS = 0.0003
const MAX_PERSISTENT_ASTEROIDS = 10

type CollisionPresentationMode = 'merge' | 'hitRun' | 'partialDisruption'

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
    collisionLineageIds: body.collisionLineageIds
      ? [...body.collisionLineageIds]
      : undefined,
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
  }
}

function isBodyDescendedFrom(bodyId: string, ancestorId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return ancestorId.split('+').every((part) => bodyParts.has(part))
}

function findMergedPhysicalRemnant(
  stepped: BodyState[],
  bodyA: BodyState,
  bodyB: BodyState,
) {
  return stepped.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, bodyA.id) &&
    bodyCarriesCollisionLineage(body, bodyB.id),
  )
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
          lifetime: Math.min(body.lifetime ?? 0.9, 0.9),
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
  const withLocalizedAbsorptionEjecta = localizeExtremeAbsorptionEjecta(input, stepped, dt)
  const withMassCorrection = normalizeExtremeMassRatioAbsorption(
    input,
    withLocalizedAbsorptionEjecta,
    dt,
  )
  const withTrackingContinuity = attachCollisionTrackingContinuity(input, withMassCorrection, dt)
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
  const stellarOutcome = stepped.find((body) => (
    body.bodyType === 'effect' &&
    body.name === COLLISION_FLASH_NAME &&
    body.effectVisual?.stellarOutcome &&
    (
      body.id.startsWith(`${bodyA.id}+${bodyB.id}+flash`) ||
      body.id.startsWith(`${bodyB.id}+${bodyA.id}+flash`)
    )
  ))?.effectVisual?.stellarOutcome
  if (stellarOutcome === 'partialDisruption') return 'partialDisruption'

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

function isExtremeMassRatioLowEnergyAbsorption(
  a: BodyState,
  b: BodyState,
  geometry = getTrackingCollisionGeometry(a, b),
) {
  const typeA = getEffectiveBodyType(a)
  const typeB = getEffectiveBodyType(b)
  const hasPlanet = typeA === 'planet' || typeB === 'planet'
  const hasMoon = typeA === 'moon' || typeB === 'moon'
  if (!hasPlanet || !hasMoon || typeA === typeB) return false

  const massRatio = Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, 1e-9)
  return massRatio < EXTREME_MASS_RATIO_ABSORPTION_MAX_RATIO &&
    geometry.speedRatio <= EXTREME_MASS_RATIO_ABSORPTION_MAX_SPEED_RATIO
}

function getExtremeMassRatioEjectaFraction(
  a: BodyState,
  b: BodyState,
  geometry: TrackingCollisionGeometry,
) {
  const totalMass = Math.max(a.mass + b.mass, 1e-9)
  const smallerMassFraction = Math.min(a.mass, b.mass) / totalMass
  const strippedFractionOfImpactor = Math.min(
    0.35,
    Math.max(
      0.12,
      0.12 + geometry.speedRatio * 0.14 + geometry.headOn * 0.06 + geometry.grazing * 0.04,
    ),
  )
  return smallerMassFraction * strippedFractionOfImpactor
}

function normalizeExtremeMassRatioAbsorption(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
) {
  const collisionPair = findNewCollisionPair(input, stepped, dt)
  if (!collisionPair) return stepped

  const { bodyA, bodyB } = collisionPair
  const mode = inferCollisionPresentationMode(stepped, bodyA, bodyB)
  if (mode !== 'merge') return stepped

  const geometry = getTrackingCollisionGeometry(bodyA, bodyB)
  if (!isExtremeMassRatioLowEnergyAbsorption(bodyA, bodyB, geometry)) return stepped

  const remnant = findMergedPhysicalRemnant(stepped, bodyA, bodyB)
  if (!remnant) return stepped

  const totalMass = bodyA.mass + bodyB.mass
  const targetEjectaFraction = getExtremeMassRatioEjectaFraction(bodyA, bodyB, geometry)
  const targetEjectaMass = totalMass * targetEjectaFraction
  const currentMassLoss = Math.max(0, totalMass - remnant.mass)

  // The core fallback merge formula is based on total system mass. For a tiny,
  // sub-escape impactor that can remove several times the impactor's own mass
  // from the primary. Reclassify this effective outcome as absorption and cap
  // escaped mass to a speed/geometry-dependent fraction of the small impactor.
  if (currentMassLoss <= targetEjectaMass + 1e-12) return stepped

  const ejecta = stepped.filter((body) =>
    body !== remnant &&
    body.mass > 0 &&
    (body.bodyType === 'fragment' || body.bodyType === 'effect') &&
    isBodyDescendedFrom(body.id, bodyA.id) &&
    isBodyDescendedFrom(body.id, bodyB.id),
  )
  const representedEjectaMass = ejecta.reduce((sum, body) => sum + body.mass, 0)
  const ejectaScale = representedEjectaMass > targetEjectaMass && representedEjectaMass > 1e-12
    ? targetEjectaMass / representedEjectaMass
    : 1
  const radiusScale = Math.cbrt(ejectaScale)
  const scaledStepped = stepped.map((body) => (
    ejecta.includes(body)
      ? { ...body, mass: body.mass * ejectaScale, radius: body.radius * radiusScale }
      : body
  ))
  const scaledEjecta = scaledStepped.filter((body) =>
    body.id !== remnant.id &&
    body.mass > 0 &&
    (body.bodyType === 'fragment' || body.bodyType === 'effect') &&
    isBodyDescendedFrom(body.id, bodyA.id) &&
    isBodyDescendedFrom(body.id, bodyB.id),
  )
  const representedScaledMass = scaledEjecta.reduce((sum, body) => sum + body.mass, 0)
  const representedMomentum = scaledEjecta.reduce(
    (sum, body) => ({
      x: sum.x + body.velocity.x * body.mass,
      y: sum.y + body.velocity.y * body.mass,
      z: sum.z + body.velocity.z * body.mass,
    }),
    { x: 0, y: 0, z: 0 },
  )
  const missingEjectaMass = Math.max(0, targetEjectaMass - representedScaledMass)
  const centerVelocity = getCenterVelocity(bodyA, bodyB)
  const totalMomentum = {
    x: bodyA.velocity.x * bodyA.mass + bodyB.velocity.x * bodyB.mass,
    y: bodyA.velocity.y * bodyA.mass + bodyB.velocity.y * bodyB.mass,
    z: bodyA.velocity.z * bodyA.mass + bodyB.velocity.z * bodyB.mass,
  }
  const remnantMass = Math.max(totalMass - targetEjectaMass, totalMass * 0.05)
  const remnantVelocity = {
    x: (
      totalMomentum.x - representedMomentum.x - centerVelocity.x * missingEjectaMass
    ) / remnantMass,
    y: (
      totalMomentum.y - representedMomentum.y - centerVelocity.y * missingEjectaMass
    ) / remnantMass,
    z: (
      totalMomentum.z - representedMomentum.z - centerVelocity.z * missingEjectaMass
    ) / remnantMass,
  }
  const totalVolume = bodyA.radius ** 3 + bodyB.radius ** 3
  const remnantRadius = Math.cbrt(Math.max(totalVolume * (1 - targetEjectaFraction), 1e-12))

  return scaledStepped.map((body) => (
    body.id === remnant.id
      ? {
          ...body,
          mass: remnantMass,
          radius: remnantRadius,
          velocity: remnantVelocity,
        }
      : body
  ))
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

  // Preserve the normal planet-moon absorption gate, but also treat extreme
  // mass-ratio sub-escape encounters as absorption even when the impact is very
  // grazing. Those contacts are captured instead of becoming a destructive
  // total-mass-based generic merge.
  const geometry = getTrackingCollisionGeometry(a, b)
  if (isExtremeMassRatioLowEnergyAbsorption(a, b, geometry)) return true
  return geometry.grazing < 0.72 && geometry.speedRatio < 2.05
}

function normalizeDirection(value: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length > 1e-10) {
    return { x: value.x / length, y: value.y / length, z: value.z / length }
  }
  const fallbackLength = Math.hypot(fallback.x, fallback.y, fallback.z)
  if (fallbackLength > 1e-10) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
      z: fallback.z / fallbackLength,
    }
  }
  return { x: 1, y: 0, z: 0 }
}

function localizeExtremeAbsorptionEjecta(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
): BodyState[] {
  const collisionPair = findNewCollisionPair(input, stepped, dt)
  if (!collisionPair) return stepped

  const { bodyA, bodyB } = collisionPair
  const mode = inferCollisionPresentationMode(stepped, bodyA, bodyB)
  if (mode !== 'merge') return stepped
  if (
    getEffectiveBodyType(bodyA) === 'star' ||
    getEffectiveBodyType(bodyB) === 'star'
  ) return stepped

  const geometry = getTrackingCollisionGeometry(bodyA, bodyB)
  if (!isExtremeMassRatioLowEnergyAbsorption(bodyA, bodyB, geometry)) return stepped

  const remnant = findMergedPhysicalRemnant(stepped, bodyA, bodyB)
  if (!remnant) return stepped

  const delta = {
    x: bodyB.position.x - bodyA.position.x,
    y: bodyB.position.y - bodyA.position.y,
    z: bodyB.position.z - bodyA.position.z,
  }
  const relativeVelocity = {
    x: bodyB.velocity.x - bodyA.velocity.x,
    y: bodyB.velocity.y - bodyA.velocity.y,
    z: bodyB.velocity.z - bodyA.velocity.z,
  }
  const normal = normalizeDirection(delta, relativeVelocity)
  const surfaceA = {
    x: bodyA.position.x + normal.x * bodyA.radius,
    y: bodyA.position.y + normal.y * bodyA.radius,
    z: bodyA.position.z + normal.z * bodyA.radius,
  }
  const surfaceB = {
    x: bodyB.position.x - normal.x * bodyB.radius,
    y: bodyB.position.y - normal.y * bodyB.radius,
    z: bodyB.position.z - normal.z * bodyB.radius,
  }
  const contactPoint = {
    x: (surfaceA.x + surfaceB.x) * 0.5,
    y: (surfaceA.y + surfaceB.y) * 0.5,
    z: (surfaceA.z + surfaceB.z) * 0.5,
  }
  const totalMass = Math.max(bodyA.mass + bodyB.mass, 1e-9)
  const centerPosition = {
    x: (bodyA.position.x * bodyA.mass + bodyB.position.x * bodyB.mass) / totalMass,
    y: (bodyA.position.y * bodyA.mass + bodyB.position.y * bodyB.mass) / totalMass,
    z: (bodyA.position.z * bodyA.mass + bodyB.position.z * bodyB.mass) / totalMass,
  }
  const centerVelocity = getCenterVelocity(bodyA, bodyB)
  const minRadius = Math.max(Math.min(bodyA.radius, bodyB.radius), 1e-6)

  return stepped.map((body) => {
    const isEjecta = body !== remnant &&
      body.mass > 0 &&
      (body.bodyType === 'fragment' || body.bodyType === 'effect') &&
      isBodyDescendedFrom(body.id, bodyA.id) &&
      isBodyDescendedFrom(body.id, bodyB.id)
    if (!isEjecta) return body

    const displacement = {
      x: body.position.x - centerPosition.x,
      y: body.position.y - centerPosition.y,
      z: body.position.z - centerPosition.z,
    }
    const velocityDelta = {
      x: body.velocity.x - centerVelocity.x,
      y: body.velocity.y - centerVelocity.y,
      z: body.velocity.z - centerVelocity.z,
    }
    const direction = normalizeDirection(displacement, velocityDelta)
    const radiusFraction = Math.min(1, Math.max(0, body.radius / minRadius))
    const spawnOffset = minRadius * (0.055 + radiusFraction * 0.025)

    return {
      ...body,
      name: COLLISION_SPARK_NAME,
      bodyType: 'effect' as const,
      position: {
        x: contactPoint.x + direction.x * spawnOffset,
        y: contactPoint.y + direction.y * spawnOffset,
        z: contactPoint.z + direction.z * spawnOffset,
      },
      age: 0,
      lifetime: ABSORPTION_EJECTA_LIFETIME,
      effectVisual: {
        ...(body.effectVisual ?? {}),
        kind: 'collisionSpark',
        direction: { ...direction },
        normal: { ...normal },
        stretch: 1.1,
        widthScale: 0.82,
        tailLength: 0.08,
        brightness: 0.58,
        turbulence: 0.08,
        pulseStrength: 0.01,
      },
    }
  })
}

function attachCollisionTrackingContinuity(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
) {
  const collisionPair = findNewCollisionPair(input, stepped, dt)
  if (!collisionPair) return stepped

  const { bodyA, bodyB } = collisionPair
  const mode = inferCollisionPresentationMode(stepped, bodyA, bodyB)
  if (mode !== 'merge') return stepped

  const remnant = findMergedPhysicalRemnant(stepped, bodyA, bodyB)
  if (!remnant) return stepped

  // Any physical 2→1 result continues both source selections onto the one
  // surviving body. App.tsx still applies the original captured 50% mass gate,
  // so this metadata authorizes lineage transfer without weakening eligibility.
  const continuationIds = Array.from(new Set([
    ...(bodyA.trackingContinuationIds ?? []),
    bodyA.id,
    ...(bodyB.trackingContinuationIds ?? []),
    bodyB.id,
  ]))

  return stepped.map((body) => (
    body === remnant
      ? { ...body, trackingContinuationIds: continuationIds }
      : body
  ))
}

function smoothstep01(value: number) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function isStellarPair(a: BodyState, b: BodyState) {
  return getEffectiveBodyType(a) === 'star' && getEffectiveBodyType(b) === 'star'
}

function isStellarMerge(a: BodyState, b: BodyState, mode: CollisionPresentationMode) {
  return mode === 'merge' && isStellarPair(a, b)
}

function isNonStellarPair(a: BodyState, b: BodyState) {
  return getEffectiveBodyType(a) !== 'star' && getEffectiveBodyType(b) !== 'star'
}

function getCollisionPresentationContactDistance(a: BodyState, b: BodyState) {
  // Stellar collision staging intentionally keeps its dedicated geometry. For
  // ordinary bodies, mirror the renderer's visibility floor only in the display
  // bridge; physical contact remains getCollisionContactDistance(a, b).
  if (!isNonStellarPair(a, b)) return getCollisionContactDistance(a, b)
  return getBodyPresentationRadius(a.radius) + getBodyPresentationRadius(b.radius)
}

function getBodySeparation(a: BodyState, b: BodyState) {
  return Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
}

function getCollisionImpactContactDistance(a: BodyState, b: BodyState, overlap: number) {
  const presentationTarget = Math.max(
    0,
    getCollisionPresentationContactDistance(a, b) - overlap,
  )
  if (!isNonStellarPair(a, b)) return presentationTarget

  // Once a non-stellar transition starts, the source frame is the continuity
  // boundary. Render-radius staging may compress farther inward, but it must
  // never rewind an already-touching/overlapping pair back out toward the
  // presentation-radius contact shell.
  return Math.min(getBodySeparation(a, b), presentationTarget)
}

function getImpactDuration(a: BodyState, b: BodyState, mode: CollisionPresentationMode) {
  if (!isStellarPair(a, b)) return COLLISION_IMPACT_SIM_DURATION
  if (mode === 'merge') return STELLAR_MERGE_IMPACT_SIM_DURATION
  if (mode === 'partialDisruption') return STELLAR_PARTIAL_IMPACT_SIM_DURATION
  return STELLAR_HIT_RUN_IMPACT_SIM_DURATION
}

function getCollisionContactPositions(
  a: BodyState,
  b: BodyState,
  overlap = 0,
  baseContactDistance = getCollisionContactDistance(a, b),
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
  const contactDistance = Math.max(0, baseContactDistance - overlap)

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
  baseContactDistance = getCollisionContactDistance(a, b),
): CollisionContactPositions {
  const contact = getCollisionContactPositions(a, b, overlap, baseContactDistance)
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
  const overlapRatio = isStellarPair(a, b)
    ? mode === 'merge'
      ? STELLAR_MERGE_MAX_OVERLAP_RATIO
      : mode === 'partialDisruption'
        ? STELLAR_PARTIAL_MAX_OVERLAP_RATIO
        : STELLAR_HIT_RUN_MAX_OVERLAP_RATIO
    : IMPACT_MAX_OVERLAP_RATIO
  const minPresentationRadius = isNonStellarPair(a, b)
    ? Math.min(getBodyPresentationRadius(a.radius), getBodyPresentationRadius(b.radius))
    : Math.min(a.radius, b.radius)
  const maxOverlap = minPresentationRadius * overlapRatio
  if (mode !== 'merge') return maxOverlap * Math.sin(Math.PI * progress)

  // Merge compression reaches its visual maximum early, then plateaus while the
  // topology-mask VFX owns the center. Do not let the stars keep tunneling through
  // each other all the way to the solver handoff.
  if (progress >= STELLAR_MERGE_COMPRESSION_END_PROGRESS) return maxOverlap
  return maxOverlap * smoothstep01(progress / STELLAR_MERGE_COMPRESSION_END_PROGRESS)
}

function animateCollider(
  body: BodyState,
  impactPosition: Vec3,
) {
  // The overlap bridge is positional only. Never rewrite body.color here: doing
  // so made the additive synthetic contact sheet read as a permanent yellow/white
  // recolor of the stellar disc. Shock heating is rendered from transient state
  // only after the physical outcome exists.
  return {
    ...cloneBody(body),
    position: { ...impactPosition },
  }
}

function animateAbsorbedCollider(
  body: BodyState,
  impactPosition: Vec3,
  absorberImpactPosition: Vec3,
  progress: number,
) {
  const sinkProgress = smoothstep01(
    (progress - ABSORPTION_SINK_START_PROGRESS) /
      Math.max(1e-6, 1 - ABSORPTION_SINK_START_PROGRESS),
  )
  const collapseProgress = smoothstep01(
    (progress - ABSORPTION_COLLAPSE_START_PROGRESS) /
      Math.max(1e-6, 1 - ABSORPTION_COLLAPSE_START_PROGRESS),
  )
  const position = {
    x: impactPosition.x +
      (absorberImpactPosition.x - impactPosition.x) * sinkProgress * ABSORPTION_SINK_FRACTION,
    y: impactPosition.y +
      (absorberImpactPosition.y - impactPosition.y) * sinkProgress * ABSORPTION_SINK_FRACTION,
    z: impactPosition.z +
      (absorberImpactPosition.z - impactPosition.z) * sinkProgress * ABSORPTION_SINK_FRACTION,
  }
  const radiusScale = Math.max(
    ABSORPTION_MIN_RADIUS_SCALE,
    1 - collapseProgress * (1 - ABSORPTION_MIN_RADIUS_SCALE),
  )

  return {
    ...animateCollider(body, position),
    radius: body.radius * radiusScale,
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
  const impactContactDistance = getCollisionImpactContactDistance(
    pair.bodyA,
    pair.bodyB,
    overlap,
  )
  const impactPositions = getDriftedCollisionContactPositions(
    pair.bodyA,
    pair.bodyB,
    transition.elapsed,
    0,
    impactContactDistance,
  )

  const nonStellarAbsorption =
    isAbsorptionCollision(pair.bodyA, pair.bodyB, transition.mode) &&
    getEffectiveBodyType(pair.bodyA) !== 'star' &&
    getEffectiveBodyType(pair.bodyB) !== 'star'
  const absorbedId = nonStellarAbsorption
    ? pair.bodyA.mass < pair.bodyB.mass
      ? pair.bodyA.id
      : pair.bodyB.mass < pair.bodyA.mass
        ? pair.bodyB.id
        : null
    : null
  const absorberImpactPosition = absorbedId === pair.bodyA.id
    ? impactPositions.bodyB
    : impactPositions.bodyA

  return transition.sourceBodies
    .map((body) => {
      if (body.id === pair.bodyA.id) {
        return body.id === absorbedId
          ? animateAbsorbedCollider(
              body,
              impactPositions.bodyA,
              absorberImpactPosition,
              progress,
            )
          : animateCollider(body, impactPositions.bodyA)
      }
      if (body.id === pair.bodyB.id) {
        return body.id === absorbedId
          ? animateAbsorbedCollider(
              body,
              impactPositions.bodyB,
              absorberImpactPosition,
              progress,
            )
          : animateCollider(body, impactPositions.bodyB)
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

  // Stage both crossing contacts and exact/shallow contact frames. Collision-watch
  // replay can legitimately resume on the mathematical surface; resolving those
  // frames immediately is what made solid-body impacts collapse into a single
  // flash frame instead of showing the contact bridge.
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
