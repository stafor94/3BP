import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import {
  getBodyPresentationRadius,
  getSimulationBodyPresentationRadius,
  MIN_BODY_RENDER_RADIUS,
  MIN_FRAGMENT_RENDER_RADIUS,
} from '../src/rendering/bodyPresentationRadius'
import { getCollisionEffectProfile } from '../src/rendering/collisionEffectProfile'
import type { BodyState, Vec3 } from '../src/types'

const CONTACT_RESOLUTION_OVERLAP = 1e-6
const CONTACT_RESOLUTION_DT = 1e-8
const IMPACT_DURATION = 0.024
const STAGING_DT = 0.0015
const LEGACY_SOLID_FLASH_VISUAL_RADIUS = 0.038
const LEGACY_SPARK_STRETCH = 1.55
const LEGACY_SPARK_WIDTH = 0.6
const LEGACY_SPARK_TAIL = 0.22
const LEGACY_SPARK_BODY_LIFETIME = 0.9

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: Vec3, factor: number): Vec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor }
}

function length(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function normalize(value: Vec3): Vec3 {
  const magnitude = Math.max(length(value), 1e-12)
  return scale(value, 1 / magnitude)
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function centerOfMassPosition(a: BodyState, b: BodyState): Vec3 {
  const totalMass = a.mass + b.mass
  return scale(add(scale(a.position, a.mass), scale(b.position, b.mass)), 1 / totalMass)
}

function centerOfMassVelocity(a: BodyState, b: BodyState): Vec3 {
  const totalMass = a.mass + b.mass
  return scale(add(scale(a.velocity, a.mass), scale(b.velocity, b.mass)), 1 / totalMass)
}

function makeContactPair({
  idPrefix,
  radiusA,
  radiusB,
  massA,
  massB,
  typeA = 'moon',
  typeB = 'moon',
  closingSpeed = 0.35,
}: {
  idPrefix: string
  radiusA: number
  radiusB: number
  massA: number
  massB: number
  typeA?: 'moon' | 'planet'
  typeB?: 'moon' | 'planet'
  closingSpeed?: number
}): [BodyState, BodyState] {
  const totalMass = massA + massB
  const separation = radiusA + radiusB - CONTACT_RESOLUTION_OVERLAP
  const normal: Vec3 = { x: 1, y: 0, z: 0 }

  return [
    {
      id: `${idPrefix}-a`,
      name: `${idPrefix}-a`,
      color: '#8ca0b4',
      mass: massA,
      radius: radiusA,
      position: scale(normal, -separation * (massB / totalMass)),
      velocity: scale(normal, closingSpeed * (massB / totalMass)),
      bodyType: typeA,
    },
    {
      id: `${idPrefix}-b`,
      name: `${idPrefix}-b`,
      color: '#b49b83',
      mass: massB,
      radius: radiusB,
      position: scale(normal, separation * (massA / totalMass)),
      velocity: scale(normal, -closingSpeed * (massA / totalMass)),
      bodyType: typeB,
    },
  ]
}

function makePhysicalResolutionFrame(pair: [BodyState, BodyState]) {
  const a = pair[0]
  const b = pair[1]
  const normal = normalize(subtract(b.position, a.position))
  const totalMass = a.mass + b.mass
  const center = add(centerOfMassPosition(a, b), scale(centerOfMassVelocity(a, b), IMPACT_DURATION))
  const contactDistance = a.radius + b.radius - CONTACT_RESOLUTION_OVERLAP

  return [
    {
      ...a,
      position: add(center, scale(normal, -contactDistance * (b.mass / totalMass))),
    },
    {
      ...b,
      position: add(center, scale(normal, contactDistance * (a.mass / totalMass))),
    },
  ]
}

function resolveFragmentAware(pair: [BodyState, BodyState]) {
  let frame: BodyState[] = pair
  for (let index = 0; index < 15; index += 1) {
    frame = stepFragmentAwareBodies(frame, STAGING_DT)
  }
  return stepFragmentAwareBodies(frame, STAGING_DT - 5e-13)
}

function resolveCore(pair: [BodyState, BodyState]) {
  return stepCoreBodies(makePhysicalResolutionFrame(pair), CONTACT_RESOLUTION_DT)
}

function findFlash(frame: BodyState[]) {
  const flash = frame.find((body) => body.name === 'Collision flash')
  assert(flash, 'collision fixture must emit a contact flash')
  return flash
}

function renderedLargestAxis(body: BodyState) {
  const profile = getCollisionEffectProfile(body)
  const diameter = profile.visualRadius * 2
  return {
    profile,
    scaleX: diameter * profile.anisotropicStretch,
    scaleY: diameter * profile.widthScale,
    largestAxis: diameter * Math.max(profile.anisotropicStretch, profile.widthScale),
  }
}

function testFragmentPresentationRadiusUsesPhysicalScale() {
  const pair = makeContactPair({
    idPrefix: 'vfx-fragment-radius',
    radiusA: 0.024,
    radiusB: 0.023,
    massA: 0.02,
    massB: 0.02,
    closingSpeed: 1.8,
  })
  const frame = resolveCore(pair)
  const fragments = frame.filter((body) => body.bodyType === 'fragment')
  assert(fragments.length >= 2,
    'high-energy small moon-moon collision must produce persistent physical fragments')

  const fragment = [...fragments].sort((a, b) => a.radius - b.radius)[0]
  const physicalRadius = fragment.radius
  assert(physicalRadius < MIN_BODY_RENDER_RADIUS,
    'fixture fragment must be physically smaller than the normal-body render floor')
  assert(physicalRadius >= MIN_FRAGMENT_RENDER_RADIUS,
    'actual persistent fragment fixture should exercise physical-radius rendering above the fragment floor')
  assertClose(getBodyPresentationRadius(physicalRadius), MIN_BODY_RENDER_RADIUS, 1e-12,
    'the general body presentation helper must still inflate the same radius to the normal-body floor')

  const fragmentPresentationRadius = getSimulationBodyPresentationRadius(fragment)
  assertClose(fragmentPresentationRadius, physicalRadius, 1e-12,
    'persistent fragment rendering must preserve its physical radius instead of applying the normal-body floor')
  assert(fragmentPresentationRadius < MIN_BODY_RENDER_RADIUS,
    'fragment presentation radius must stay below the 0.025 normal-body minimum')
  assertClose(fragment.radius, physicalRadius, 1e-12,
    'presentation radius lookup must not mutate the physical fragment radius')

  const tinyFragment: BodyState = {
    ...fragment,
    id: 'regression:tiny-fragment-presentation-floor',
    radius: MIN_FRAGMENT_RENDER_RADIUS * 0.25,
  }
  assertClose(
    getSimulationBodyPresentationRadius(tinyFragment),
    MIN_FRAGMENT_RENDER_RADIUS,
    1e-12,
    'sub-floor fragments may use only the dedicated small fragment visibility floor',
  )

  const smallMoon: BodyState = {
    ...pair[0],
    id: 'regression:small-moon-render-floor',
    radius: 0.008,
    bodyType: 'moon',
  }
  const smallPlanet: BodyState = {
    ...pair[1],
    id: 'regression:small-planet-render-floor',
    radius: 0.009,
    bodyType: 'planet',
  }
  assertClose(getSimulationBodyPresentationRadius(smallMoon), MIN_BODY_RENDER_RADIUS, 1e-12,
    'small normal moons must retain the existing 0.025 render floor')
  assertClose(getSimulationBodyPresentationRadius(smallPlanet), MIN_BODY_RENDER_RADIUS, 1e-12,
    'small normal planets must retain the existing 0.025 render floor')

  return {
    fragmentCount: fragments.length,
    physicalRadius,
    oldGeneralPresentationRadius: getBodyPresentationRadius(physicalRadius),
    fragmentPresentationRadius,
    fragmentVisualFloor: MIN_FRAGMENT_RENDER_RADIUS,
    normalBodyVisualFloor: MIN_BODY_RENDER_RADIUS,
  }
}

function testBodyRelativeFlashScale() {
  const smallSmall = makeContactPair({
    idPrefix: 'vfx-small-small',
    radiusA: 0.018,
    radiusB: 0.017,
    massA: 0.02,
    massB: 0.02,
  })
  const smallSmallFrame = resolveFragmentAware(smallSmall)
  const smallFlash = findFlash(smallSmallFrame)
  const smallMetrics = renderedLargestAxis(smallFlash)
  const largestSmallSourceRadius = Math.max(...smallSmall.map((body) => getBodyPresentationRadius(body.radius)))
  const largestSmallSourceDiameter = largestSmallSourceRadius * 2

  assertClose(smallFlash.radius, 0.055, 1e-12,
    'presentation fix must not rewrite the existing collision flash BodyState radius')
  assertClose(smallFlash.effectVisual?.sourceMaxRadius ?? -1, 0.018, 1e-12,
    'small-small flash must carry the largest physical source radius as presentation metadata')
  assertClose(smallMetrics.profile.visualRadius, largestSmallSourceRadius * 0.98, 1e-12,
    'small-small flash visual radius must scale from source presentation radius')
  assert(
    smallMetrics.largestAxis / largestSmallSourceDiameter <= 1.5,
    'small-small flash largest axis must remain local to the rendered source silhouettes',
  )

  const smallNormal = makeContactPair({
    idPrefix: 'vfx-small-normal',
    radiusA: 0.018,
    radiusB: 0.04,
    massA: 0.02,
    massB: 0.2,
    typeA: 'moon',
    typeB: 'planet',
  })
  const smallNormalFlash = findFlash(resolveCore(smallNormal))
  const smallNormalProfile = getCollisionEffectProfile(smallNormalFlash)
  assertClose(smallNormalFlash.effectVisual?.sourceMaxRadius ?? -1, 0.04, 1e-12,
    'small-normal flash must reference the larger physical source')
  assertClose(smallNormalProfile.visualRadius, LEGACY_SOLID_FLASH_VISUAL_RADIUS, 1e-12,
    'small-normal flash must retain the existing normal-source footprint when the relative cap does not bind')

  const normalNormal = makeContactPair({
    idPrefix: 'vfx-normal-normal',
    radiusA: 0.04,
    radiusB: 0.05,
    massA: 0.05,
    massB: 0.07,
    typeA: 'planet',
    typeB: 'planet',
  })
  const normalNormalFlash = findFlash(resolveCore(normalNormal))
  const normalNormalProfile = getCollisionEffectProfile(normalNormalFlash)
  assertClose(normalNormalProfile.visualRadius, LEGACY_SOLID_FLASH_VISUAL_RADIUS, 1e-12,
    'normal-normal flash footprint must remain on the legacy non-stellar profile')

  return {
    flashBodyRadius: smallFlash.radius,
    sourcePhysicalRadius: 0.018,
    sourcePresentationRadius: largestSmallSourceRadius,
    legacyVisualRadius: LEGACY_SOLID_FLASH_VISUAL_RADIUS,
    newVisualRadius: smallMetrics.profile.visualRadius,
    legacyScaleX: LEGACY_SOLID_FLASH_VISUAL_RADIUS * 2 * 1.45,
    newScaleX: smallMetrics.scaleX,
    newScaleY: smallMetrics.scaleY,
    legacyLargestAxisToSourceDiameter: (LEGACY_SOLID_FLASH_VISUAL_RADIUS * 2 * 1.45) / largestSmallSourceDiameter,
    newLargestAxisToSourceDiameter: smallMetrics.largestAxis / largestSmallSourceDiameter,
  }
}

function testHeadOnSparkPresentationKeepsPhysicalMotion() {
  const pair = makeContactPair({
    idPrefix: 'vfx-head-on-spark',
    radiusA: 0.018,
    radiusB: 0.017,
    massA: 0.02,
    massB: 0.02,
  })
  const frame = resolveFragmentAware(pair)
  const sparks = frame.filter((body) => body.name === 'Collision spark')
  assert(sparks.length >= 2, 'small moon-moon merge must exercise mass-bearing tiny collision sparks')
  assert(sparks.every((spark) => spark.mass > 0), 'collision spark fixture must remain mass-bearing')

  const centerVelocity = centerOfMassVelocity(pair[0], pair[1])
  const centerPosition = centerOfMassPosition(pair[0], pair[1])
  const spark = sparks[0]
  const direction = spark.effectVisual?.direction
  assert(direction, 'collision spark must retain its physical ejecta direction metadata')
  const travelVelocity = normalize(subtract(spark.velocity, centerVelocity))
  const spawnDirection = normalize(subtract(spark.position, centerPosition))
  assert(dot(direction, travelVelocity) > 0.999999999,
    'presentation compaction must not rotate spark physical velocity away from ejecta direction')
  assert(dot(direction, spawnDirection) > 0.999999,
    'presentation compaction must not move the mass-bearing spark spawn off its ejecta direction')
  assertClose(spark.lifetime ?? -1, LEGACY_SPARK_BODY_LIFETIME, 1e-12,
    'mass-bearing collision spark production lifetime must remain on the pre-existing fragment-aware cap')
  assert((spark.effectVisual?.headOn ?? 0) > 0.99 && (spark.effectVisual?.grazing ?? 1) < 0.01,
    'head-on spark fixture must expose presentation geometry without changing physical direction')

  const profile = getCollisionEffectProfile(spark)
  assertClose(profile.fadeAlpha, 0, 1e-12,
    'very head-on collision spark must hide the directional body presentation at impact')
  assertClose(profile.anisotropicStretch, 1, 1e-12,
    'very head-on collision spark presentation must be isotropic before it is suppressed')
  assertClose(profile.widthScale, 1, 1e-12,
    'very head-on collision spark presentation must remove narrow directional width')
  assertClose(profile.tailLength, 0, 1e-12,
    'very head-on collision spark presentation must remove the directional tail channel')

  const fadedProfile = getCollisionEffectProfile({ ...spark, age: 0.6 })
  assertClose(fadedProfile.fadeAlpha, 0, 1e-12,
    'suppressed head-on spark must remain visually hidden while its mass-bearing BodyState persists')
  assertClose(spark.lifetime ?? -1, LEGACY_SPARK_BODY_LIFETIME, 1e-12,
    'visual suppression must not mutate the existing physical/effect BodyState lifetime')

  const legacyVisualRadius = clamp(spark.radius * 0.62, 0.01, 0.025)
  const legacyVisibleUntil = LEGACY_SPARK_BODY_LIFETIME * (1 - Math.pow(0.002, 1 / 2.15))

  const grazingSpark: BodyState = {
    ...spark,
    id: 'regression:grazing-spark',
    age: 0,
    effectVisual: {
      ...spark.effectVisual,
      headOn: 0.2,
      grazing: 0.98,
    },
  }
  const grazingProfile = getCollisionEffectProfile(grazingSpark)
  assertClose(grazingProfile.anisotropicStretch, LEGACY_SPARK_STRETCH, 1e-12,
    'grazing spark must retain the existing directional stretch envelope')
  assertClose(grazingProfile.widthScale, LEGACY_SPARK_WIDTH, 1e-12,
    'grazing spark must retain the existing directional width envelope')
  assertClose(grazingProfile.tailLength, LEGACY_SPARK_TAIL, 1e-12,
    'grazing spark must retain the existing directional tail envelope')
  assertClose(grazingProfile.fadeAlpha, 1, 1e-12,
    'grazing spark must retain its existing impact visibility')

  return {
    sparkMass: spark.mass,
    sparkPhysicalRadius: spark.radius,
    headOn: spark.effectVisual?.headOn,
    grazing: spark.effectVisual?.grazing,
    bodyLifetime: spark.lifetime,
    legacyStretch: LEGACY_SPARK_STRETCH,
    newStretch: profile.anisotropicStretch,
    legacyWidth: LEGACY_SPARK_WIDTH,
    newWidth: profile.widthScale,
    legacyTail: LEGACY_SPARK_TAIL,
    newTail: profile.tailLength,
    legacyLargestAxis: legacyVisualRadius * 2 * LEGACY_SPARK_STRETCH,
    newLargestAxis: profile.visualRadius * 2 * Math.max(profile.anisotropicStretch, profile.widthScale),
    legacyVisibleUntil,
    newVisibleUntil: 0,
  }
}

function testStellarContactFlashProfileUnchanged() {
  const stellarFlash: BodyState = {
    id: 'regression:stellar-contact-flash',
    name: 'Collision flash',
    color: '#ffd36b',
    mass: 0,
    radius: 0.22,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age: 0.08,
    lifetime: 0.68,
    effectVisual: {
      kind: 'contactFlash',
      direction: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      stretch: 6.1,
      widthScale: 0.22,
      brightness: 2.8,
      pulseStrength: 0.12,
      stellarCollision: true,
      stellarOutcome: 'merge',
    },
  }
  const profile = getCollisionEffectProfile(stellarFlash)
  assertClose(profile.visualRadius, 0.1936, 1e-12,
    'stellar contact flash radius must remain on the existing physical-stellar formula')
  assertClose(profile.anisotropicStretch, 3.05, 1e-12,
    'stellar contact flash stretch cap must remain unchanged')
  assertClose(profile.widthScale, 0.38, 1e-12,
    'stellar contact flash width cap must remain unchanged')
  assertClose(profile.brightness, 3.08, 1e-12,
    'stellar merge contact flash brightness must remain unchanged')
}

const fragmentMetrics = testFragmentPresentationRadiusUsesPhysicalScale()
const flashMetrics = testBodyRelativeFlashScale()
const sparkMetrics = testHeadOnSparkPresentationKeepsPhysicalMotion()
testStellarContactFlashProfileUnchanged()

console.log('non-stellar collision VFX regression checks passed (4)')
console.log(JSON.stringify({ fragmentMetrics, flashMetrics, sparkMetrics }))