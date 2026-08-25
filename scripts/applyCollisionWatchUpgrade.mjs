import { readFileSync, writeFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content, 'utf8')
}

function replaceOnce(path, before, after) {
  const source = read(path)
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Missing patch target in ${path}: ${before.slice(0, 100)}`)
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch target is not unique in ${path}: ${before.slice(0, 100)}`)
  }
  write(path, source.slice(0, first) + after + source.slice(first + before.length))
}

write('src/collisionWatchTiming.ts', `import type { BodyType } from './types'

export const COLLISION_WATCH_APPROACH_SPEED = 0.1
export const COLLISION_WATCH_IMPACT_SPEED = 0.03
export const COLLISION_WATCH_POST_IMPACT_SPEED = 0.08

export type CollisionWatchPhase = 'approach' | 'impact' | 'postImpact' | 'restoring'
export type CollisionWatchCollisionType = 'stellar' | 'stellarMixed' | 'standard' | 'fragment'

export type CollisionWatchTimingProfile = {
  collisionType: CollisionWatchCollisionType
  isStellarCollision: boolean
  impactHoldMs: number
  postImpactHoldMs: number
  restoreRampMs: number
  cameraHoldMs: number
  infoHoldMs: number
}

export function getCollisionWatchTimingProfile(
  bodyAType: BodyType,
  bodyBType: BodyType,
): CollisionWatchTimingProfile {
  const isStellarCollision = bodyAType === 'star' && bodyBType === 'star'
  if (isStellarCollision) {
    return {
      collisionType: 'stellar',
      isStellarCollision: true,
      impactHoldMs: 850,
      postImpactHoldMs: 1650,
      restoreRampMs: 700,
      cameraHoldMs: 2800,
      infoHoldMs: 2500,
    }
  }

  const hasFragment = bodyAType === 'fragment' || bodyBType === 'fragment'
  if (hasFragment) {
    return {
      collisionType: 'fragment',
      isStellarCollision: false,
      impactHoldMs: 425,
      postImpactHoldMs: 800,
      restoreRampMs: 550,
      cameraHoldMs: 1450,
      infoHoldMs: 1300,
    }
  }

  const hasStar = bodyAType === 'star' || bodyBType === 'star'
  if (hasStar) {
    return {
      collisionType: 'stellarMixed',
      isStellarCollision: false,
      impactHoldMs: 500,
      postImpactHoldMs: 1000,
      restoreRampMs: 600,
      cameraHoldMs: 1750,
      infoHoldMs: 1600,
    }
  }

  return {
    collisionType: 'standard',
    isStellarCollision: false,
    impactHoldMs: 550,
    postImpactHoldMs: 1000,
    restoreRampMs: 600,
    cameraHoldMs: 1800,
    infoHoldMs: 1650,
  }
}

export function getCollisionWatchRestoreSpeed(
  startSpeed: number,
  targetSpeed: number,
  elapsedMs: number,
  durationMs: number,
) {
  if (durationMs <= 0) return targetSpeed
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs))
  const eased = 1 - Math.pow(1 - t, 3)
  return startSpeed + (targetSpeed - startSpeed) * eased
}
`)

write('scripts/collisionWatchTimingRegression.ts', `import {
  getCollisionWatchRestoreSpeed,
  getCollisionWatchTimingProfile,
} from '../src/collisionWatchTiming'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const stellar = getCollisionWatchTimingProfile('star', 'star')
assert(stellar.isStellarCollision, 'star-star must use the stellar collision timing profile')
assert(stellar.impactHoldMs >= 800 && stellar.impactHoldMs <= 900, 'stellar impact hold must remain within 800-900ms')
assert(stellar.postImpactHoldMs >= 1500 && stellar.postImpactHoldMs <= 1800, 'stellar post-impact hold must remain within 1500-1800ms')
assert(stellar.cameraHoldMs !== stellar.impactHoldMs, 'camera hold must not be coupled to the impact-speed hold')

const fragment = getCollisionWatchTimingProfile('fragment', 'planet')
assert(fragment.impactHoldMs >= 350 && fragment.impactHoldMs <= 500, 'fragment impact hold must stay short')
assert(fragment.postImpactHoldMs >= 700 && fragment.postImpactHoldMs <= 1000, 'fragment post-impact hold must stay short')

const mixed = getCollisionWatchTimingProfile('star', 'planet')
assert(!mixed.isStellarCollision, 'star-planet must not use the star-star timing profile')
assert(mixed.impactHoldMs < stellar.impactHoldMs, 'star-planet slow motion must be shorter than star-star')

const start = 0.08
const target = 2
const duration = 650
assert(getCollisionWatchRestoreSpeed(start, target, 0, duration) === start, 'restore ramp must start at its captured speed')
const mid = getCollisionWatchRestoreSpeed(start, target, duration / 2, duration)
assert(mid > start && mid < target, 'restore ramp must interpolate instead of jumping')
assert(Math.abs(getCollisionWatchRestoreSpeed(start, target, duration, duration) - target) < 1e-12, 'restore ramp must end at the user speed')

console.log('collision watch timing regression: ok')
`)

replaceOnce(
  'scripts/runPhysicsRegression.mjs',
  `  { source: 'trackingRegression.ts', output: 'trackingRegression.mjs' },\n`,
  `  { source: 'trackingRegression.ts', output: 'trackingRegression.mjs' },\n  { source: 'collisionWatchTimingRegression.ts', output: 'collisionWatchTimingRegression.mjs' },\n`,
)

replaceOnce(
  'src/types.ts',
  `  | 'stellarPlasma'\n  | 'collisionSpark'\n`,
  `  | 'stellarPlasma'\n  | 'stellarAfterglow'\n  | 'collisionSpark'\n`,
)
replaceOnce(
  'src/types.ts',
  `  temperatureBias?: number\n`,
  `  temperatureBias?: number\n  stellarCollision?: boolean\n`,
)

replaceOnce(
  'src/physics/fragmentAwareEngine.ts',
  `// Ordinary impacts keep the existing ~1.5 real-second contact presentation at\n// collision-watch speed (0.03x). Stellar merges get a longer absorption window:\n// 0.12 simulated seconds is roughly 4 real seconds at 0.03x, matching the\n// increased 160% display-only overlap before the physical remnant replaces both stars.\nconst COLLISION_IMPACT_SIM_DURATION = 0.045\nconst STELLAR_MERGE_IMPACT_SIM_DURATION = 0.12\nconst IMPACT_MAX_OVERLAP_RATIO = 0.18\nconst STELLAR_MERGE_MAX_OVERLAP_RATIO = 1.6\n`,
  `// Keep only a very short display-only contact bridge before topology resolution.\n// Collision-watch slow motion is real-time phase controlled in App.tsx; stretching\n// this simulated overlap would otherwise recreate a multi-second 0.03x stall.\nconst COLLISION_IMPACT_SIM_DURATION = 0.006\nconst STELLAR_MERGE_IMPACT_SIM_DURATION = 0.009\nconst IMPACT_MAX_OVERLAP_RATIO = 0.14\nconst STELLAR_MERGE_MAX_OVERLAP_RATIO = 0.34\n`,
)

replaceOnce(
  'src/physics/engine.ts',
  `const COLLISION_FLASH_LIFETIME = 0.72\nconst STELLAR_PLASMA_LIFETIME = 1.55\nconst COLLISION_FLASH_RADIUS = 0.055\n`,
  `const COLLISION_FLASH_LIFETIME = 0.72\nconst STELLAR_FLASH_LIFETIME = 0.58\nconst STELLAR_SHOCK_LIFETIME = 1.05\nconst STELLAR_AFTERGLOW_LIFETIME = 1.1\nconst STELLAR_PLASMA_LIFETIME = 1.55\nconst COLLISION_FLASH_RADIUS = 0.055\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `const TRANSIENT_COLLISION_NAMES = new Set(['Debris', 'Collision spark', 'Collision flash', 'Stellar plasma'])\n`,
  `const TRANSIENT_COLLISION_NAMES = new Set([\n  'Debris',\n  'Collision spark',\n  'Collision flash',\n  'Stellar shock sheet',\n  'Stellar plasma',\n  'Stellar afterglow',\n])\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `function dominantBodyType(a: BodyState, b: BodyState): PhysicalBodyType {\n  const typeA = inferBodyType(a)\n  const typeB = inferBodyType(b)\n  if (typeA === 'star' || typeB === 'star') return 'star'\n  if (typeA === 'planet' || typeB === 'planet') return 'planet'\n  if (typeA === 'moon' || typeB === 'moon') return 'moon'\n  return 'fragment'\n}\n`,
  `function dominantBodyType(a: BodyState, b: BodyState): PhysicalBodyType {\n  const typeA = inferBodyType(a)\n  const typeB = inferBodyType(b)\n  if (typeA === 'star' || typeB === 'star') return 'star'\n  if (typeA === 'planet' || typeB === 'planet') return 'planet'\n  if (typeA === 'moon' || typeB === 'moon') return 'moon'\n  return 'fragment'\n}\n\nfunction isStellarCollision(a: BodyState, b: BodyState) {\n  return inferBodyType(a) === 'star' && inferBodyType(b) === 'star'\n}\n`,
)

replaceOnce(
  'src/physics/engine.ts',
  `function makeCollisionFlash(a: BodyState, b: BodyState, geometry: CollisionGeometry): BodyState {\n  const dominant = a.mass >= b.mass ? a : b\n  const secondary = dominant === a ? b : a\n  const totalRadius = a.radius + b.radius\n  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)\n  const phaseOffset = seededScalar(\`${'${a.id}:${b.id}:flash:${collisionSerial}'}\`)\n\n  return {\n    id: \`${'${a.id}+${b.id}+flash${collisionSerial}'}\`,\n    name: 'Collision flash',\n    color: dominant.color,\n    mass: 0,\n    radius: Math.max(COLLISION_FLASH_RADIUS, Math.min(0.13, totalRadius * 0.42)),\n    position: collisionContactPoint(a, b, geometry.normal),\n    velocity: centerOfMassVelocity(a, b),\n    bodyType: 'effect',\n    age: 0,\n    lifetime: COLLISION_FLASH_LIFETIME,\n    effectVisual: {\n      kind: 'contactFlash',\n      direction: { ...geometry.tangent },\n      normal: { ...geometry.normal },\n      stretch: clamp(2.65 + geometry.headOn * 0.95 + geometry.grazing * 0.2, 2.6, 3.8),\n      widthScale: clamp(0.42 - geometry.headOn * 0.13 + geometry.grazing * 0.04, 0.25, 0.44),\n      tailLength: 0,\n      brightness: clamp(1.28 + geometry.headOn * 0.48 + speedHeat * 0.34, 1.3, 2.05),\n      turbulence: clamp(0.12 + geometry.grazing * 0.3 + speedHeat * 0.18, 0.12, 0.58),\n      pulseStrength: 0.16 + geometry.headOn * 0.1,\n      phaseOffset,\n      secondaryColor: secondary.color,\n      temperatureBias: speedHeat,\n    },\n  }\n}\n`,
  `function makeCollisionFlash(a: BodyState, b: BodyState, geometry: CollisionGeometry): BodyState {\n  const dominant = a.mass >= b.mass ? a : b\n  const secondary = dominant === a ? b : a\n  const totalRadius = a.radius + b.radius\n  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)\n  const phaseOffset = seededScalar(\`${'${a.id}:${b.id}:flash:${collisionSerial}'}\`)\n  const stellarCollision = isStellarCollision(a, b)\n\n  return {\n    id: \`${'${a.id}+${b.id}+flash${collisionSerial}'}\`,\n    name: 'Collision flash',\n    color: dominant.color,\n    mass: 0,\n    radius: stellarCollision\n      ? Math.max(0.1, Math.min(0.28, totalRadius * 0.78))\n      : Math.max(COLLISION_FLASH_RADIUS, Math.min(0.13, totalRadius * 0.42)),\n    position: collisionContactPoint(a, b, geometry.normal),\n    velocity: centerOfMassVelocity(a, b),\n    bodyType: 'effect',\n    age: 0,\n    lifetime: stellarCollision ? STELLAR_FLASH_LIFETIME : COLLISION_FLASH_LIFETIME,\n    effectVisual: {\n      kind: 'contactFlash',\n      direction: { ...geometry.tangent },\n      normal: { ...geometry.normal },\n      stretch: stellarCollision\n        ? clamp(4.15 + geometry.headOn * 1.25 + geometry.grazing * 0.55, 4.1, 5.8)\n        : clamp(2.65 + geometry.headOn * 0.95 + geometry.grazing * 0.2, 2.6, 3.8),\n      widthScale: stellarCollision\n        ? clamp(0.31 - geometry.headOn * 0.07 + geometry.grazing * 0.05, 0.22, 0.36)\n        : clamp(0.42 - geometry.headOn * 0.13 + geometry.grazing * 0.04, 0.25, 0.44),\n      tailLength: 0,\n      brightness: stellarCollision\n        ? clamp(2.05 + geometry.headOn * 0.45 + speedHeat * 0.32, 2.05, 2.62)\n        : clamp(1.28 + geometry.headOn * 0.48 + speedHeat * 0.34, 1.3, 2.05),\n      turbulence: stellarCollision\n        ? clamp(0.42 + geometry.grazing * 0.34 + speedHeat * 0.16, 0.42, 0.88)\n        : clamp(0.12 + geometry.grazing * 0.3 + speedHeat * 0.18, 0.12, 0.58),\n      pulseStrength: stellarCollision ? 0.09 : 0.16 + geometry.headOn * 0.1,\n      phaseOffset,\n      secondaryColor: secondary.color,\n      temperatureBias: speedHeat,\n      stellarCollision,\n    },\n  }\n}\n\nfunction makeStellarCompressionSheet(\n  a: BodyState,\n  b: BodyState,\n  geometry: CollisionGeometry,\n): BodyState {\n  const dominant = a.mass >= b.mass ? a : b\n  const secondary = dominant === a ? b : a\n  const totalRadius = a.radius + b.radius\n  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)\n\n  return {\n    id: \`${'${a.id}+${b.id}+shock${collisionSerial}'}\`,\n    name: 'Stellar shock sheet',\n    color: dominant.color,\n    mass: 0,\n    radius: Math.max(0.09, Math.min(0.26, totalRadius * 0.62)),\n    position: collisionContactPoint(a, b, geometry.normal),\n    velocity: centerOfMassVelocity(a, b),\n    bodyType: 'effect',\n    age: 0,\n    lifetime: STELLAR_SHOCK_LIFETIME,\n    effectVisual: {\n      kind: 'compressionShear',\n      direction: { ...geometry.tangent },\n      normal: { ...geometry.normal },\n      stretch: clamp(4.1 + geometry.grazing * 2.1 + geometry.headOn * 0.55, 4.2, 6.7),\n      widthScale: clamp(0.31 - geometry.grazing * 0.08 + geometry.headOn * 0.03, 0.2, 0.34),\n      tailLength: 0.22 + geometry.grazing * 0.34,\n      brightness: clamp(1.48 + geometry.headOn * 0.22 + speedHeat * 0.24, 1.48, 1.92),\n      turbulence: clamp(0.66 + geometry.grazing * 0.24 + speedHeat * 0.12, 0.66, 1),\n      pulseStrength: 0.055,\n      phaseOffset: seededScalar(\`${'${a.id}:${b.id}:shock:${collisionSerial}'}\`),\n      secondaryColor: secondary.color,\n      temperatureBias: speedHeat,\n      stellarCollision: true,\n    },\n  }\n}\n\nfunction makeStellarAfterglow(\n  a: BodyState,\n  b: BodyState,\n  geometry: CollisionGeometry,\n): BodyState {\n  const dominant = a.mass >= b.mass ? a : b\n  const secondary = dominant === a ? b : a\n  const totalRadius = a.radius + b.radius\n\n  return {\n    id: \`${'${a.id}+${b.id}+afterglow${collisionSerial}'}\`,\n    name: 'Stellar afterglow',\n    color: dominant.color,\n    mass: 0,\n    radius: Math.max(0.11, Math.min(0.31, totalRadius * 0.72)),\n    position: collisionContactPoint(a, b, geometry.normal),\n    velocity: centerOfMassVelocity(a, b),\n    bodyType: 'effect',\n    age: 0,\n    lifetime: STELLAR_AFTERGLOW_LIFETIME,\n    effectVisual: {\n      kind: 'stellarAfterglow',\n      direction: { ...geometry.tangent },\n      normal: { ...geometry.normal },\n      stretch: clamp(1.18 + geometry.grazing * 0.42, 1.18, 1.6),\n      widthScale: clamp(0.9 - geometry.grazing * 0.14, 0.72, 0.92),\n      brightness: 1.22,\n      turbulence: 0.72 + geometry.grazing * 0.2,\n      pulseStrength: 0.02,\n      phaseOffset: seededScalar(\`${'${a.id}:${b.id}:afterglow:${collisionSerial}'}\`),\n      secondaryColor: secondary.color,\n      temperatureBias: 0.62,\n      stellarCollision: true,\n    },\n  }\n}\n\nfunction makeCollisionEffects(a: BodyState, b: BodyState, geometry: CollisionGeometry) {\n  const flash = makeCollisionFlash(a, b, geometry)\n  if (!isStellarCollision(a, b)) return [flash]\n  return [\n    flash,\n    makeStellarCompressionSheet(a, b, geometry),\n    makeStellarAfterglow(a, b, geometry),\n  ]\n}\n`,
)

replaceOnce(
  'src/physics/engine.ts',
  `  const large = index < largeCount\n  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)\n`,
  `  const large = index < largeCount\n  const stellarCollision = isStellarCollision(a, b)\n  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `    stretch: clamp(2.0 + geometryStretch + speedEnergy * 0.72 + sizeStretch + variance * 0.55, 1.75, 5.8),\n`,
  `    stretch: clamp(\n      2.0 + geometryStretch + speedEnergy * 0.72 + sizeStretch + variance * 0.55 + (stellarCollision ? 0.42 : 0),\n      1.75,\n      stellarCollision ? 6.2 : 5.8,\n    ),\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `      0.38 + geometry.grazing * 0.72 + speedEnergy * 0.34 + (large ? 0.08 : 0.28) + tailVariance * 0.22,\n`,
  `      0.38 + geometry.grazing * 0.72 + speedEnergy * 0.34 + (large ? 0.08 : 0.28) + tailVariance * 0.22 + (stellarCollision ? 0.12 : 0),\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `    brightness: clamp(1.0 + speedEnergy * 0.28 + (large ? 0.18 : -0.02) + variance * 0.1, 0.92, 1.48),\n    turbulence: clamp(0.38 + geometry.grazing * 0.27 + speedEnergy * 0.2 + (large ? 0.04 : 0.14), 0.38, 0.95),\n`,
  `    brightness: clamp(\n      1.0 + speedEnergy * 0.28 + (large ? 0.18 : -0.02) + variance * 0.1 + (stellarCollision ? 0.16 : 0),\n      0.92,\n      stellarCollision ? 1.64 : 1.48,\n    ),\n    turbulence: clamp(\n      0.38 + geometry.grazing * 0.27 + speedEnergy * 0.2 + (large ? 0.04 : 0.14) + (stellarCollision ? 0.08 : 0),\n      0.38,\n      1,\n    ),\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `    temperatureBias: speedEnergy,\n  }\n}\n\nfunction makeEjecta(\n`,
  `    temperatureBias: speedEnergy,\n    stellarCollision,\n  }\n}\n\nfunction makeEjecta(\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `  const stellarEjecta = inferBodyType(a) === 'star' || inferBodyType(b) === 'star'\n  const ejectaFraction = requestedMass / Math.max(a.mass + b.mass, 1e-9)\n`,
  `  const stellarEjecta = inferBodyType(a) === 'star' || inferBodyType(b) === 'star'\n  const stellarCollision = isStellarCollision(a, b)\n  const ejectaFraction = requestedMass / Math.max(a.mass + b.mass, 1e-9)\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `  const desiredStellarCount = Math.max(\n    5,\n    Math.round(5 + geometry.grazing * 2 + speedEnergy * 2 + clamp(ejectaFraction * 18, 0, 2)),\n  )\n`,
  `  const desiredStellarCount = Math.max(\n    stellarCollision ? 6 : 4,\n    Math.round(\n      (stellarCollision ? 6 : 4) + geometry.grazing * 2 + speedEnergy * 2 + clamp(ejectaFraction * 18, 0, 2),\n    ),\n  )\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `  const largeCount = stellarEjecta\n    ? Math.min(count, clamp(Math.round(2 + geometry.grazing + speedEnergy * 0.7), 2, 4))\n    : count\n`,
  `  const largeCount = stellarEjecta\n    ? Math.min(\n        count,\n        clamp(\n          Math.round(2 + geometry.grazing + speedEnergy * 0.7),\n          2,\n          stellarCollision ? 4 : 3,\n        ),\n      )\n    : count\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `      const lifetime = clamp(\n        STELLAR_PLASMA_LIFETIME + (index < largeCount ? 0.18 : -0.08) + speedEnergy * 0.22 + lifetimeNoise * 0.2,\n        1.25,\n        2.05,\n      )\n`,
  `      const lifetime = clamp(\n        STELLAR_PLASMA_LIFETIME +\n          (index < largeCount ? 0.18 : -0.08) +\n          speedEnergy * 0.22 +\n          lifetimeNoise * 0.2 +\n          (stellarCollision ? 0.12 : -0.08),\n        stellarCollision ? 1.4 : 1.2,\n        stellarCollision ? 2.2 : 1.95,\n      )\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `  return [remnant, ...fragments, makeCollisionFlash(a, b, geometry)]\n`,
  `  return [remnant, ...fragments, ...makeCollisionEffects(a, b, geometry)]\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `  return [survivorA, survivorB, ...fragments, makeCollisionFlash(a, b, geometry)]\n`,
  `  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry)]\n`,
)
replaceOnce(
  'src/physics/engine.ts',
  `        // Reserve one slot for the contact flash so a visually richer stellar\n        // collision still respects the global dynamic-body performance ceiling.\n        const availableSlots = Math.max(\n          0,\n          MAX_DYNAMIC_BODIES - (bodies.length - 2 + baseResultCount + 1),\n        )\n`,
  `        // Reserve all non-physical VFX slots before allocating ejecta so large\n        // stellar flashes/shock sheets/afterglow cannot exceed the dynamic-body cap.\n        const collisionEffectReserve = isStellarCollision(a, b) ? 3 : 1\n        const availableSlots = Math.max(\n          0,\n          MAX_DYNAMIC_BODIES - (bodies.length - 2 + baseResultCount + collisionEffectReserve),\n        )\n`,
)

replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `      ? 0.82\n      : kind === 'stellarPlasma'\n        ? 1.55\n        : 0.9\n`,
  `      ? 0.82\n      : kind === 'stellarPlasma'\n        ? 1.55\n        : kind === 'stellarAfterglow'\n          ? 1.1\n          : 0.9\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `  if (kind === 'contactFlash') {\n    const rise = 0.58 + 0.42 * smooth01(progress / 0.055)\n    const decay = Math.pow(1 - progress, 3.2)\n`,
  `  if (kind === 'contactFlash') {\n    const stellar = body.effectVisual?.stellarCollision === true && !body.id.startsWith('preview:')\n    const rise = stellar ? 1 : 0.58 + 0.42 * smooth01(progress / 0.055)\n    const decay = Math.pow(1 - progress, stellar ? 4.1 : 3.2)\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `      baseOpacity: 0.94,\n      innerGlow: 1,\n      outerGlow: 0.3,\n      visualRadius: THREE.MathUtils.clamp(body.radius * 0.42, 0.052, 0.13),\n      anisotropicStretch: visual?.stretch ?? 3.1,\n      widthScale: visual?.widthScale ?? 0.34,\n`,
  `      baseOpacity: stellar ? 0.97 : 0.94,\n      innerGlow: 1,\n      outerGlow: stellar ? 0.38 : 0.3,\n      visualRadius: stellar\n        ? THREE.MathUtils.clamp(body.radius * 0.78, 0.11, 0.28)\n        : THREE.MathUtils.clamp(body.radius * 0.42, 0.052, 0.13),\n      anisotropicStretch: visual?.stretch ?? (stellar ? 4.8 : 3.1),\n      widthScale: visual?.widthScale ?? (stellar ? 0.28 : 0.34),\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `      brightness: visual?.brightness ?? 1.55,\n      turbulence: visual?.turbulence ?? 0.18,\n`,
  `      brightness: visual?.brightness ?? (stellar ? 2.25 : 1.55),\n      turbulence: visual?.turbulence ?? (stellar ? 0.62 : 0.18),\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `  if (kind === 'compressionShear') {\n    const rise = smooth01(progress / 0.12)\n    const decay = Math.pow(1 - progress, 1.7)\n`,
  `  if (kind === 'compressionShear') {\n    const stellar = body.effectVisual?.stellarCollision === true\n    const rise = smooth01(progress / (stellar ? 0.08 : 0.12))\n    const decay = Math.pow(1 - progress, stellar ? 1.5 : 1.7)\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `      baseOpacity: 0.7,\n      innerGlow: 0.72,\n      outerGlow: 0.18,\n      visualRadius: THREE.MathUtils.clamp(body.radius * 0.34, 0.045, 0.11),\n`,
  `      baseOpacity: stellar ? 0.8 : 0.7,\n      innerGlow: stellar ? 0.82 : 0.72,\n      outerGlow: stellar ? 0.24 : 0.18,\n      visualRadius: stellar\n        ? THREE.MathUtils.clamp(body.radius * 0.55, 0.075, 0.23)\n        : THREE.MathUtils.clamp(body.radius * 0.34, 0.045, 0.11),\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `  if (kind === 'stellarPlasma') {\n    const linger = Math.pow(1 - progress, 1.28)\n    const expansion = smooth01(progress)\n`,
  `  if (kind === 'stellarPlasma') {\n    const stellar = body.effectVisual?.stellarCollision === true\n    const linger = Math.pow(1 - progress, stellar ? 1.18 : 1.28)\n    const expansion = smooth01(progress)\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `      visualRadius: THREE.MathUtils.clamp(body.radius * 0.26, 0.021, 0.058),\n`,
  `      visualRadius: stellar\n        ? THREE.MathUtils.clamp(body.radius * 0.32, 0.024, 0.074)\n        : THREE.MathUtils.clamp(body.radius * 0.26, 0.021, 0.058),\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `      brightness: (visual?.brightness ?? 1.12) * (1 - progress * 0.18),\n`,
  `      brightness: (visual?.brightness ?? (stellar ? 1.28 : 1.12)) * (1 - progress * 0.18),\n`,
)
replaceOnce(
  'src/rendering/collisionEffectProfile.ts',
  `  const decay = Math.pow(1 - progress, 2.15)\n`,
  `  if (kind === 'stellarAfterglow') {\n    const expansion = smooth01(progress / 0.72)\n    const decay = Math.pow(1 - progress, 1.85)\n    return {\n      kind,\n      progress,\n      fadeAlpha: decay,\n      baseOpacity: 0.48,\n      innerGlow: 0.18,\n      outerGlow: 0.62,\n      visualRadius: THREE.MathUtils.clamp(body.radius * (0.72 + expansion * 0.6), 0.09, 0.32),\n      anisotropicStretch: (visual?.stretch ?? 1.28) * (0.88 + expansion * 0.4),\n      widthScale: (visual?.widthScale ?? 0.82) * (0.9 + expansion * 0.3),\n      tailLength: 0,\n      pulseStrength: visual?.pulseStrength ?? 0.02,\n      brightness: (visual?.brightness ?? 1.2) * (1 - progress * 0.25),\n      turbulence: visual?.turbulence ?? 0.78,\n      cooling: Math.pow(progress, 0.82),\n    }\n  }\n\n  const decay = Math.pow(1 - progress, 2.15)\n`,
)

replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `const PHYSICAL_EFFECT_FADE_IN_MS = 120\n`,
  `const PHYSICAL_EFFECT_FADE_IN_MS = 140\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `    } else {\n      // Small sparks remain directional so even tiny effects do not become dots.\n`,
  `    } else if (uKind < 3.5) {\n      // Stellar afterglow: hollow, broken, expanding shell with turbulent gaps.\n      float radial = length(vec2(p.x * 0.9, p.y * 1.06));\n      float shellRadius = mix(0.34, 0.84, smoothstep(0.0, 0.78, uProgress));\n      float shellWidth = mix(0.18, 0.055, smoothstep(0.08, 1.0, uProgress));\n      float shell = exp(-abs(radial - shellRadius) / max(shellWidth, 0.025));\n      float angularBreakup = 0.48 + noise * 0.62;\n      float hollow = smoothstep(0.18, shellRadius * 0.9, radial);\n      float knots = smoothstep(0.58, 0.88, noise) * shell;\n      alpha = shell * angularBreakup * hollow;\n      core = knots * 0.34;\n      body = shell * (0.45 + noise * 0.35);\n      edge = shell * (0.7 + noise * 0.3);\n    } else {\n      // Small sparks remain directional so even tiny effects do not become dots.\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `  if (kind === 'stellarPlasma') return 2\n  return 3\n`,
  `  if (kind === 'stellarPlasma') return 2\n  if (kind === 'stellarAfterglow') return 3\n  return 4\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `          secondaryColor: smaller.color,\n        },\n      })\n\n      effects.push({\n`,
  `          secondaryColor: smaller.color,\n          stellarCollision: true,\n        },\n      })\n\n      effects.push({\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `          secondaryColor: smaller.color,\n        },\n      })\n\n      const plasmaPhase = clamp((overlapRatio - 0.42) / 0.82, 0, 1)\n`,
  `          secondaryColor: smaller.color,\n          stellarCollision: true,\n        },\n      })\n\n      const plasmaPhase = clamp((overlapRatio - 0.42) / 0.82, 0, 1)\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `              secondaryColor: dominant.color,\n            },\n          })\n`,
  `              secondaryColor: dominant.color,\n              stellarCollision: true,\n            },\n          })\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `    const diameter = profile.visualRadius * 2\n    visual.mesh.scale.set(\n      diameter * profile.anisotropicStretch,\n      diameter * profile.widthScale,\n      1,\n    )\n`,
  `    const diameter = profile.visualRadius * 2\n    let scaleX = diameter * profile.anisotropicStretch\n    let scaleY = diameter * profile.widthScale\n    const maxWorldDiameter = profile.kind === 'stellarAfterglow'\n      ? 0.96\n      : body.effectVisual?.stellarCollision\n        ? 0.84\n        : 0.64\n    const largestAxis = Math.max(scaleX, scaleY)\n    if (largestAxis > maxWorldDiameter) {\n      const scaleClamp = maxWorldDiameter / largestAxis\n      scaleX *= scaleClamp\n      scaleY *= scaleClamp\n    }\n    visual.mesh.scale.set(scaleX, scaleY, 1)\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `    coreColor.copy(hotWhite).lerp(baseColor, profile.kind === 'stellarPlasma' ? 0.11 : 0.06)\n    midColor.copy(baseColor).lerp(paleBlue, profile.kind === 'contactFlash' ? 0.62 : 0.25)\n`,
  `    coreColor.copy(hotWhite).lerp(\n      baseColor,\n      profile.kind === 'stellarPlasma' ? 0.11 : profile.kind === 'stellarAfterglow' ? 0.28 : 0.06,\n    )\n    midColor.copy(baseColor).lerp(\n      paleBlue,\n      profile.kind === 'contactFlash' ? 0.68 : profile.kind === 'stellarAfterglow' ? 0.18 : 0.25,\n    )\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `    const coolingTarget = profile.kind === 'stellarPlasma' ? coolingRed : coolingAmber\n    edgeColor.lerp(coolingTarget, profile.cooling * (profile.kind === 'stellarPlasma' ? 0.34 : 0.16))\n`,
  `    const coolingTarget = profile.kind === 'stellarPlasma' ? coolingRed : coolingAmber\n    edgeColor.lerp(\n      coolingTarget,\n      profile.cooling * (profile.kind === 'stellarPlasma' ? 0.34 : profile.kind === 'stellarAfterglow' ? 0.24 : 0.16),\n    )\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `    uniforms.uOpacity.value = profile.baseOpacity * profile.fadeAlpha * clamp(opacityScale, 0, 1)\n`,
  `    uniforms.uOpacity.value = clamp(\n      profile.baseOpacity * profile.fadeAlpha * clamp(opacityScale, 0, 1),\n      0,\n      body.effectVisual?.stellarCollision ? 0.97 : 0.94,\n    )\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `    uniforms.uBrightness.value = profile.brightness\n`,
  `    uniforms.uBrightness.value = clamp(profile.brightness, 0, 2.62)\n`,
)
replaceOnce(
  'src/rendering/collisionEffectRenderer.ts',
  `        const opacity = kind === 'contactFlash' ? 1 : 0.28 + smoothFade * 0.72\n        updateVisual(ensure(body), body, camera, opacity)\n`,
  `        const opacity = kind === 'contactFlash' ? 1 : 0.22 + smoothFade * 0.78\n        // Physical collision VFX age in real time so 0.03x/0.08x observation does\n        // not stretch a 0.5-2s visual effect into many seconds of wall-clock time.\n        const visualBody = {\n          ...body,\n          age: Math.max(0, (now - introducedAt) / 1000),\n        }\n        updateVisual(ensure(body), visualBody, camera, opacity)\n`,
)

replaceOnce(
  'src/App.tsx',
  `import {\n  didCollisionWatchTargetImpact,\n  hasTargetPairCollisionResult,\n  resolveBodyDescendant,\n} from './collisionWatch'\n`,
  `import {\n  didCollisionWatchTargetImpact,\n  hasTargetPairCollisionResult,\n  resolveBodyDescendant,\n} from './collisionWatch'\nimport {\n  COLLISION_WATCH_APPROACH_SPEED,\n  COLLISION_WATCH_IMPACT_SPEED,\n  COLLISION_WATCH_POST_IMPACT_SPEED,\n  getCollisionWatchRestoreSpeed,\n  getCollisionWatchTimingProfile,\n  type CollisionWatchPhase,\n  type CollisionWatchTimingProfile,\n} from './collisionWatchTiming'\n`,
)
replaceOnce(
  'src/App.tsx',
  `const COLLISION_REPLAY_LEAD_TIME = 0.36\nconst COLLISION_WATCH_APPROACH_SPEED = 0.1\nconst COLLISION_WATCH_IMPACT_SLOW_TIME = 0.06\nconst COLLISION_WATCH_IMPACT_SPEED = 0.03\nconst COLLISION_WATCH_MUTE_MS = 6000\nconst COLLISION_WATCH_POST_IMPACT_LOCK_MS = 3000\nconst COLLISION_WATCH_INFO_POST_IMPACT_MS = 3000\n`,
  `const COLLISION_REPLAY_LEAD_TIME = 0.36\nconst COLLISION_WATCH_IMPACT_SLOW_TIME = 0.06\nconst COLLISION_WATCH_MUTE_MS = 650\n`,
)
replaceOnce(
  'src/App.tsx',
  `  const [collisionWatchEnabled, setCollisionWatchEnabled] = useState(getInitialCollisionWatchEnabled)\n  const [collisionWatchInfo, setCollisionWatchInfo] = useState<CollisionWatchDetails | null>(null)\n`,
  `  const [collisionWatchEnabled, setCollisionWatchEnabled] = useState(getInitialCollisionWatchEnabled)\n  const [collisionWatchInfo, setCollisionWatchInfo] = useState<CollisionWatchDetails | null>(null)\n  const [collisionCameraFocus, setCollisionCameraFocus] = useState<CollisionWatchDetails | null>(null)\n`,
)
replaceOnce(
  'src/App.tsx',
  `  const collisionWatchInfoRef = useRef<CollisionWatchDetails | null>(null)\n  const collisionWatchImpactSimTimeRef = useRef<number | null>(null)\n  const collisionWatchRestoreSpeedRef = useRef<number | null>(null)\n  const collisionWatchManagedSpeedRef = useRef<number | null>(null)\n`,
  `  const collisionWatchInfoRef = useRef<CollisionWatchDetails | null>(null)\n  const collisionCameraFocusRef = useRef<CollisionWatchDetails | null>(null)\n  const collisionWatchImpactSimTimeRef = useRef<number | null>(null)\n  const collisionWatchRestoreSpeedRef = useRef<number | null>(null)\n  const collisionWatchManagedSpeedRef = useRef<number | null>(null)\n  const collisionWatchRestoreStartSpeedRef = useRef<number | null>(null)\n  const collisionWatchPhaseRef = useRef<CollisionWatchPhase | null>(null)\n  const collisionWatchPhaseStartedAtRef = useRef(0)\n  const collisionWatchTimingProfileRef = useRef<{\n    pairKey: string\n    profile: CollisionWatchTimingProfile\n  } | null>(null)\n  const collisionWatchSpeedOverriddenRef = useRef(false)\n`,
)
replaceOnce(
  'src/App.tsx',
  `  const applyCollisionWatchSpeed = useCallback((nextSpeed: number) => {\n    collisionWatchManagedSpeedRef.current = nextSpeed\n    speedRef.current = nextSpeed\n    setSpeed(nextSpeed)\n  }, [])\n\n  const restoreCollisionWatchSpeed = useCallback(() => {\n    const restoreSpeed = collisionWatchRestoreSpeedRef.current\n    const managedSpeed = collisionWatchManagedSpeedRef.current\n    if (\n      restoreSpeed !== null &&\n      managedSpeed !== null &&\n      Math.abs(speedRef.current - managedSpeed) <= 1e-9\n    ) {\n      speedRef.current = restoreSpeed\n      setSpeed(restoreSpeed)\n    }\n    collisionWatchRestoreSpeedRef.current = null\n    collisionWatchManagedSpeedRef.current = null\n  }, [])\n`,
  `  const applyCollisionWatchSpeed = useCallback((nextSpeed: number) => {\n    if (collisionWatchSpeedOverriddenRef.current) return\n    collisionWatchManagedSpeedRef.current = nextSpeed\n    speedRef.current = nextSpeed\n    setSpeed(nextSpeed)\n  }, [])\n\n  const restoreCollisionWatchSpeed = useCallback(() => {\n    const restoreSpeed = collisionWatchRestoreSpeedRef.current\n    const managedSpeed = collisionWatchManagedSpeedRef.current\n    if (\n      !collisionWatchSpeedOverriddenRef.current &&\n      restoreSpeed !== null &&\n      managedSpeed !== null &&\n      Math.abs(speedRef.current - managedSpeed) <= 1e-9\n    ) {\n      speedRef.current = restoreSpeed\n      setSpeed(restoreSpeed)\n    }\n    collisionWatchRestoreSpeedRef.current = null\n    collisionWatchManagedSpeedRef.current = null\n    collisionWatchRestoreStartSpeedRef.current = null\n    collisionWatchPhaseRef.current = null\n    collisionWatchTimingProfileRef.current = null\n    collisionWatchSpeedOverriddenRef.current = false\n  }, [])\n`,
)
replaceOnce(
  'src/App.tsx',
  `  const changeSpeed = useCallback((nextSpeed: number) => {\n    if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) return\n    speedRef.current = nextSpeed\n    setSpeed(nextSpeed)\n  }, [])\n`,
  `  const changeSpeed = useCallback((nextSpeed: number) => {\n    if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) return\n    if (collisionWatchPhaseRef.current !== null || collisionCameraFocusRef.current !== null) {\n      collisionWatchSpeedOverriddenRef.current = true\n      collisionWatchRestoreSpeedRef.current = null\n      collisionWatchManagedSpeedRef.current = null\n      collisionWatchRestoreStartSpeedRef.current = null\n    }\n    speedRef.current = nextSpeed\n    setSpeed(nextSpeed)\n  }, [])\n`,
)

replaceOnce(
  'src/App.tsx',
  `  useEffect(() => {\n    const activeInfo = collisionWatchInfo\n    if (!activeInfo || activeInfo.impactObservedAt === null) return\n\n    const impactObservedAt = activeInfo.impactObservedAt\n    const pairKey = activeInfo.pairKey\n    const remaining = Math.max(\n      0,\n      COLLISION_WATCH_INFO_POST_IMPACT_MS - (performance.now() - impactObservedAt),\n    )\n    const timer = window.setTimeout(() => {\n      if (collisionWatchInfoRef.current?.pairKey !== pairKey) return\n      collisionWatchInfoRef.current = null\n      collisionWatchImpactSimTimeRef.current = null\n      if (autoCollisionWatchPairRef.current === pairKey) autoCollisionWatchPairRef.current = null\n      nextCollisionCheckAtRef.current = 0\n      restoreCollisionWatchSpeed()\n      setCollisionWatchInfo(null)\n    }, remaining)\n\n    return () => window.clearTimeout(timer)\n  }, [collisionWatchInfo, restoreCollisionWatchSpeed])\n`,
  `  useEffect(() => {\n    const activeInfo = collisionWatchInfo\n    if (!activeInfo || activeInfo.impactObservedAt === null) return\n\n    const pairKey = activeInfo.pairKey\n    const timingEntry = collisionWatchTimingProfileRef.current\n    const profile = timingEntry?.pairKey === pairKey\n      ? timingEntry.profile\n      : getCollisionWatchTimingProfile(activeInfo.bodyA.type, activeInfo.bodyB.type)\n    const remaining = Math.max(\n      0,\n      profile.infoHoldMs - (performance.now() - activeInfo.impactObservedAt),\n    )\n    const timer = window.setTimeout(() => {\n      if (collisionWatchInfoRef.current?.pairKey !== pairKey) return\n      collisionWatchInfoRef.current = null\n      setCollisionWatchInfo(null)\n    }, remaining)\n\n    return () => window.clearTimeout(timer)\n  }, [collisionWatchInfo])\n\n  useEffect(() => {\n    const activeFocus = collisionCameraFocus\n    if (!activeFocus || activeFocus.impactObservedAt === null) return\n\n    const pairKey = activeFocus.pairKey\n    const timingEntry = collisionWatchTimingProfileRef.current\n    const profile = timingEntry?.pairKey === pairKey\n      ? timingEntry.profile\n      : getCollisionWatchTimingProfile(activeFocus.bodyA.type, activeFocus.bodyB.type)\n    const remaining = Math.max(\n      0,\n      profile.cameraHoldMs - (performance.now() - activeFocus.impactObservedAt),\n    )\n    const timer = window.setTimeout(() => {\n      if (collisionCameraFocusRef.current?.pairKey !== pairKey) return\n      collisionCameraFocusRef.current = null\n      collisionWatchImpactSimTimeRef.current = null\n      if (autoCollisionWatchPairRef.current === pairKey) autoCollisionWatchPairRef.current = null\n      nextCollisionCheckAtRef.current = 0\n      setCollisionCameraFocus(null)\n    }, remaining)\n\n    return () => window.clearTimeout(timer)\n  }, [collisionCameraFocus])\n`,
)
replaceOnce(
  'src/App.tsx',
  `    collisionWatchInfoRef.current = null\n    collisionWatchImpactSimTimeRef.current = null\n    setCollisionPrediction(null)\n    setCollisionReplayReady(false)\n    setCollisionWatchInfo(null)\n`,
  `    collisionWatchInfoRef.current = null\n    collisionCameraFocusRef.current = null\n    collisionWatchImpactSimTimeRef.current = null\n    setCollisionPrediction(null)\n    setCollisionReplayReady(false)\n    setCollisionWatchInfo(null)\n    setCollisionCameraFocus(null)\n`,
)
replaceOnce(
  'src/App.tsx',
  `  const beginCollisionWatchInfo = useCallback((prediction: CollisionPrediction, sourceBodies: BodyState[]) => {\n    if (collisionWatchRestoreSpeedRef.current === null) {\n      collisionWatchRestoreSpeedRef.current = speedRef.current\n      collisionWatchManagedSpeedRef.current = null\n    }\n\n    const details: CollisionWatchDetails = {\n`,
  `  const beginCollisionWatchInfo = useCallback((prediction: CollisionPrediction, sourceBodies: BodyState[]) => {\n    if (collisionWatchRestoreSpeedRef.current === null) {\n      collisionWatchRestoreSpeedRef.current = speedRef.current\n      collisionWatchManagedSpeedRef.current = null\n    }\n\n    collisionWatchSpeedOverriddenRef.current = false\n    collisionWatchRestoreStartSpeedRef.current = null\n    collisionWatchPhaseRef.current = 'approach'\n    collisionWatchPhaseStartedAtRef.current = performance.now()\n    collisionWatchTimingProfileRef.current = {\n      pairKey: prediction.pairKey,\n      profile: getCollisionWatchTimingProfile(prediction.bodyAType, prediction.bodyBType),\n    }\n\n    const details: CollisionWatchDetails = {\n`,
)
replaceOnce(
  'src/App.tsx',
  `    collisionWatchImpactSimTimeRef.current = simulationTimeRef.current + Math.max(prediction.timeToImpact, 0)\n    collisionWatchInfoRef.current = details\n    setCollisionWatchInfo(details)\n  }, [])\n`,
  `    collisionWatchImpactSimTimeRef.current = simulationTimeRef.current + Math.max(prediction.timeToImpact, 0)\n    collisionWatchInfoRef.current = details\n    collisionCameraFocusRef.current = details\n    setCollisionWatchInfo(details)\n    setCollisionCameraFocus(details)\n  }, [])\n`,
)

replaceOnce(
  'src/App.tsx',
  `      const activeCollisionWatch = collisionWatchInfoRef.current\n      const collisionWatchLocked = Boolean(\n        activeCollisionWatch && (\n          activeCollisionWatch.impactObservedAt === null ||\n          now - activeCollisionWatch.impactObservedAt < COLLISION_WATCH_POST_IMPACT_LOCK_MS\n        ),\n      )\n\n      if (activeCollisionWatch && activeCollisionWatch.impactObservedAt === null) {\n`,
  `      const activeCollisionWatch = collisionWatchInfoRef.current\n      const activeCollisionCamera = collisionCameraFocusRef.current\n      const collisionWatchLocked = activeCollisionCamera !== null\n\n      const timingEntry = collisionWatchTimingProfileRef.current\n      const activePhase = collisionWatchPhaseRef.current\n      if (timingEntry && activePhase && activePhase !== 'approach') {\n        const elapsedMs = now - collisionWatchPhaseStartedAtRef.current\n        const { profile } = timingEntry\n\n        if (activePhase === 'impact' && elapsedMs >= profile.impactHoldMs) {\n          collisionWatchPhaseRef.current = 'postImpact'\n          collisionWatchPhaseStartedAtRef.current = now\n          applyCollisionWatchSpeed(COLLISION_WATCH_POST_IMPACT_SPEED)\n        } else if (activePhase === 'postImpact' && elapsedMs >= profile.postImpactHoldMs) {\n          collisionWatchPhaseRef.current = 'restoring'\n          collisionWatchPhaseStartedAtRef.current = now\n          collisionWatchRestoreStartSpeedRef.current = speedRef.current\n        } else if (activePhase === 'restoring') {\n          const restoreTarget = collisionWatchRestoreSpeedRef.current\n          const restoreStart = collisionWatchRestoreStartSpeedRef.current ?? speedRef.current\n          if (collisionWatchSpeedOverriddenRef.current || restoreTarget === null) {\n            collisionWatchPhaseRef.current = null\n            collisionWatchRestoreStartSpeedRef.current = null\n            collisionWatchTimingProfileRef.current = null\n          } else {\n            const rampSpeed = getCollisionWatchRestoreSpeed(\n              restoreStart,\n              restoreTarget,\n              elapsedMs,\n              profile.restoreRampMs,\n            )\n            applyCollisionWatchSpeed(rampSpeed)\n            if (elapsedMs >= profile.restoreRampMs) {\n              speedRef.current = restoreTarget\n              setSpeed(restoreTarget)\n              collisionWatchRestoreSpeedRef.current = null\n              collisionWatchManagedSpeedRef.current = null\n              collisionWatchRestoreStartSpeedRef.current = null\n              collisionWatchPhaseRef.current = null\n              collisionWatchTimingProfileRef.current = null\n            }\n          }\n        }\n      }\n\n      if (\n        activeCollisionWatch &&\n        activeCollisionWatch.impactObservedAt === null &&\n        collisionWatchPhaseRef.current === 'approach'\n      ) {\n`,
)
replaceOnce(
  'src/App.tsx',
  `            const impactedWatch = { ...refreshedWatch, impactObservedAt: now }\n            collisionWatchInfoRef.current = impactedWatch\n            collisionWatchImpactSimTimeRef.current = null\n`,
  `            const impactedWatch = { ...refreshedWatch, impactObservedAt: now }\n            collisionWatchInfoRef.current = impactedWatch\n            collisionCameraFocusRef.current = impactedWatch\n            collisionWatchPhaseRef.current = 'impact'\n            collisionWatchPhaseStartedAtRef.current = now\n            collisionWatchRestoreStartSpeedRef.current = null\n            collisionWatchImpactSimTimeRef.current = null\n`,
)
replaceOnce(
  'src/App.tsx',
  `            setCollisionWatchInfo(impactedWatch)\n            setCollisionPrediction(null)\n`,
  `            setCollisionWatchInfo(impactedWatch)\n            setCollisionCameraFocus(impactedWatch)\n            setCollisionPrediction(null)\n`,
)
replaceOnce(
  'src/App.tsx',
  `          collisionCameraFocus={collisionWatchInfo ? {\n            pairKey: collisionWatchInfo.pairKey,\n            bodyAId: collisionWatchInfo.bodyA.sourceId,\n            bodyBId: collisionWatchInfo.bodyB.sourceId,\n`,
  `          collisionCameraFocus={collisionCameraFocus ? {\n            pairKey: collisionCameraFocus.pairKey,\n            bodyAId: collisionCameraFocus.bodyA.sourceId,\n            bodyBId: collisionCameraFocus.bodyB.sourceId,\n`,
)
replaceOnce(
  'src/App.tsx',
  `        {collisionPrediction && !collisionWatchInfo && (\n`,
  `        {collisionPrediction && !collisionCameraFocus && (\n`,
)

replaceOnce(
  'package.json',
  `  "version": "0.17.23",\n`,
  `  "version": "0.17.24",\n`,
)

replaceOnce(
  'CHANGELOG.md',
  `## [0.17.23] - 2026-08-26\n`,
  `## [0.17.24] - 2026-08-26\n\n### Added\n- 충돌 관찰 속도를 \`approach → impact → postImpact → restoring\` 실시간 phase 상태 머신으로 분리하고, 충돌 종류별 hold/ramp 값을 순수 계산 모듈과 회귀 체크로 분리했습니다.\n- 항성↔항성 실제 충돌에 강한 white-hot 비등방 섬광, 난류 압축 충격면, 방향성 플라즈마 강화, 속이 비고 가장자리가 끊기는 팽창 afterglow/halo를 추가했습니다.\n\n### Changed\n- 충돌 후 3초 동안 0.03x를 고정하던 정책을 제거하고, 항성 충돌은 약 0.85초 impact 0.03x → 약 1.65초 post-impact 0.08x → 약 0.7초 smooth restore로 변경했습니다. 소형체와 비항성 충돌은 더 짧은 프로파일을 사용합니다.\n- 카메라 유지 시간, 충돌 정보 UI 수명, 속도 제어 수명을 서로 독립시켰으며 restoring 도중 새 충돌이 감지되면 새 collision phase가 우선하도록 했습니다. 사용자가 관찰 중 속도를 직접 바꾸면 이후 자동 속도 복원보다 사용자 입력을 우선합니다.\n- 항성 합체의 display-only 중첩 구간을 짧게 줄여 0.03x에서 수 초간 topology 해석을 지연시키던 흐름을 제거했습니다.\n- physical collision VFX의 시각 age를 real-time으로 계산해 저속 관찰 중 flash/plasma 수명이 과도하게 늘어나지 않도록 했습니다.\n- synthetic stellar overlap retire 260ms와 physical shear/plasma fade-in 140ms의 cross-fade를 유지하며 contact flash는 즉시 표시합니다.\n- 대형 항성 VFX는 opacity/brightness와 world-space 최대 직경을 clamp하고, 기존 동적 천체 상한 안에서 flash/shock/afterglow 슬롯을 먼저 예약하도록 했습니다.\n- collision camera framing은 기존 physical body/remnant 기준을 유지하며 VFX radius는 auto framing에 포함하지 않습니다.\n\n### Fixed\n- 충돌 정보 UI 종료가 곧바로 극저속 해제와 카메라 종료까지 발생시키던 결합을 제거했습니다.\n- 연속 충돌에서 이전 restore ramp가 다음 충돌의 0.03x/0.08x phase를 덮어쓸 수 있는 경로를 차단했습니다.\n- v0.17.23의 일반 tracking/충돌 camera continuity 규칙은 그대로 유지해 merge frame 줌 점프와 합체 후손 자동 일반 추적이 재발하지 않도록 했습니다.\n\n## [0.17.23] - 2026-08-26\n`,
)

console.log('collision watch + stellar VFX upgrade applied')
