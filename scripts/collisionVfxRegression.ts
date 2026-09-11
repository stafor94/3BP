import { getCollisionEffectProfile } from '../src/rendering/collisionEffectProfile'
import { getSyntheticStellarEffects } from '../src/rendering/collisionEffectRenderer'
import {
  getStellarImpactBurstPresentation,
} from '../src/rendering/stellarImpactBurstLayer'
import { getStellarTopologyOcclusionPairs } from '../src/rendering/stellarTopologyOccluder'
import type { BodyState, EffectVisualKind, StellarCollisionOutcome, Vec3 } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  position: Vec3,
  velocity: Vec3,
  color: string,
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position,
    velocity,
    bodyType: 'star',
  }
}

function makeEffect(
  kind: EffectVisualKind,
  outcome: StellarCollisionOutcome,
  age: number,
  lifetime: number,
  overrides: Partial<NonNullable<BodyState['effectVisual']>> = {},
): BodyState {
  return {
    id: `regression:${kind}:${outcome}`,
    name: kind,
    color: '#ffd36b',
    mass: 0,
    radius: 0.22,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age,
    lifetime,
    effectVisual: {
      kind,
      direction: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      stellarCollision: true,
      stellarOutcome: outcome,
      secondaryColor: '#7ea7ff',
      ...overrides,
    },
  }
}

function makeSolidEffect(
  kind: Extract<EffectVisualKind, 'contactFlash' | 'collisionSpark'>,
  overrides: Partial<NonNullable<BodyState['effectVisual']>> = {},
): BodyState {
  return {
    id: `regression:solid:${kind}`,
    name: kind === 'contactFlash' ? 'Collision flash' : 'Collision spark',
    color: '#9b8d7f',
    mass: 0,
    radius: kind === 'contactFlash' ? 0.13 : 0.035,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age: 0.08,
    lifetime: 0.72,
    effectVisual: {
      kind,
      direction: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      stellarCollision: false,
      ...overrides,
    },
  }
}

function presentationFor(bodies: BodyState[]) {
  const pair = getStellarTopologyOcclusionPairs(bodies)[0]
  assert(pair, 'stellar overlap should produce a topology pair')
  const presentation = getStellarImpactBurstPresentation(pair, bodies)
  assert(presentation, 'stellar overlap should produce burst presentation data')
  return presentation
}

function testProfilesAvoidLensFlareAndBeamShapes() {
  const flash = getCollisionEffectProfile(makeEffect(
    'contactFlash',
    'merge',
    0.08,
    0.68,
    { stretch: 6.1, widthScale: 0.22, brightness: 2.8, pulseStrength: 0.12 },
  ))
  assert(flash.anisotropicStretch <= 3.05, 'stellar flash must not retain a long flare-like spike')
  assert(flash.widthScale >= 0.38, 'stellar flash must keep enough thickness to read as contact compression')
  assert(flash.outerGlow <= 0.22, 'stellar flash outer glow must remain subordinate to the impact surface')
  assert(flash.pulseStrength <= 0.075, 'stellar flash must not pulse like a lens-flare animation')

  const solidFlash = getCollisionEffectProfile(makeSolidEffect('contactFlash', {
    stretch: 3.8,
    widthScale: 0.25,
    brightness: 2.05,
    pulseStrength: 0.26,
  }))
  assert(solidFlash.anisotropicStretch <= 1.95,
    'solid-body contact flash must stay local instead of drawing a white beam through the body')
  assert(solidFlash.widthScale >= 0.58,
    'solid-body contact flash must remain broad enough to read as a burst')
  assert(solidFlash.visualRadius <= 0.082,
    'solid-body contact flash must stay bounded around the contact point')
  assert(solidFlash.pulseStrength <= 0.08 && solidFlash.brightness <= 1.5,
    'solid-body contact flash must avoid an overexposed flare pulse')

  const solidSpark = getCollisionEffectProfile(makeSolidEffect('collisionSpark', {
    stretch: 2.8,
    widthScale: 0.35,
    tailLength: 0.8,
    pulseStrength: 0.12,
    brightness: 1.4,
  }))
  assert(solidSpark.anisotropicStretch <= 1.55,
    'solid collision sparks must stay compact instead of becoming long streaks')
  assert(solidSpark.widthScale >= 0.6,
    'solid collision sparks must retain fragment-like thickness')
  assert(solidSpark.tailLength <= 0.22 && solidSpark.pulseStrength <= 0.045,
    'solid collision sparks must use short subdued tails')

  const shear = getCollisionEffectProfile(makeEffect(
    'compressionShear',
    'hitAndRun',
    0.18,
    1.05,
    { stretch: 7.1, widthScale: 0.22, tailLength: 0.7 },
  ))
  assert(shear.anisotropicStretch <= 3.35, 'compression sheet must not become a blade across the screen')
  assert(shear.widthScale >= 0.4, 'compression sheet must retain a plasma-sheet thickness')
  assert(shear.tailLength <= 0.46, 'compression sheet must not grow a propulsion-like tail')

  const mergePlasma = getCollisionEffectProfile(makeEffect(
    'stellarPlasma',
    'merge',
    0.45,
    1.8,
    { stretch: 6.8, widthScale: 0.42, tailLength: 1.9 },
  ))
  const partialPlasma = getCollisionEffectProfile(makeEffect(
    'stellarPlasma',
    'partialDisruption',
    0.45,
    1.8,
    { stretch: 6.8, widthScale: 0.42, tailLength: 1.9 },
  ))
  const hitRunPlasma = getCollisionEffectProfile(makeEffect(
    'stellarPlasma',
    'hitAndRun',
    0.45,
    1.8,
    { stretch: 6.8, widthScale: 0.42, tailLength: 1.9 },
  ))
  assert(mergePlasma.anisotropicStretch <= 2.9, 'merge plasma must remain cloud/plume-like instead of beam-like')
  assert(partialPlasma.anisotropicStretch <= 3.25, 'partial stripping plasma must remain bounded')
  assert(hitRunPlasma.anisotropicStretch <= 3.5, 'grazing plasma may be longer but must remain bounded')
  assert(mergePlasma.widthScale >= 0.58 && hitRunPlasma.widthScale >= 0.58,
    'stellar plasma must remain visibly broad')
  assert(mergePlasma.tailLength <= 0.82, 'merge ejecta tail must be compact')
  assert(
    mergePlasma.tailLength < partialPlasma.tailLength && partialPlasma.tailLength < hitRunPlasma.tailLength,
    'merge, partial stripping, and hit-and-run must keep distinct plume-length profiles',
  )
  assert(hitRunPlasma.tailLength <= 1.02,
    'hit-and-run must keep a longer tangential plume without reverting to a beam')

  const shell = getCollisionEffectProfile(makeEffect(
    'stellarAfterglow',
    'merge',
    0.45,
    1.55,
    { stretch: 1.8, widthScale: 0.72, brightness: 1.38 },
  ))
  assert(shell.anisotropicStretch <= 1.18, 'shock shell must stay close to circular')
  assert(shell.widthScale >= 0.9 && shell.widthScale <= 1.08, 'shock shell must not collapse into an ellipse')
  assert(shell.outerGlow <= 0.25, 'shock shell edge must remain distinguishable from bloom')
}

function testBurstVariationTracksCollisionGeometry() {
  const headOnBodies = [
    makeStar('head-a', 1, 0.3, { x: -0.27, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }, '#ffd36b'),
    makeStar('head-b', 1, 0.3, { x: 0.27, y: 0, z: 0 }, { x: -0.9, y: 0, z: 0 }, '#7ea7ff'),
  ]
  const grazingBodies = [
    makeStar('graze-a', 1, 0.3, { x: -0.27, y: 0, z: 0 }, { x: 0.15, y: -1.35, z: 0 }, '#ffd36b'),
    makeStar('graze-b', 1, 0.3, { x: 0.27, y: 0, z: 0 }, { x: -0.15, y: 1.35, z: 0 }, '#7ea7ff'),
  ]

  const headOn = presentationFor(headOnBodies)
  const grazing = presentationFor(grazingBodies)
  assert(headOn.headOn > 0.95 && headOn.grazing < 0.1, 'head-on presentation must classify the geometry as radial')
  assert(grazing.grazing > 0.9 && grazing.headOn < 0.2, 'grazing presentation must classify the geometry as tangential')
  assert(grazing.primaryLengthScale > headOn.primaryLengthScale,
    'grazing impact must produce the longer primary tangential plume')
  assert(grazing.plumeWidthScale < headOn.plumeWidthScale,
    'head-on impact must remain broader than a grazing spray')
  assert(dot(grazing.primaryDirection, grazing.secondaryDirection) > -0.995,
    'primary and secondary plumes must not form a perfectly symmetric two-tail axis')
}

function testImpactSpeedChangesBurstEnergy() {
  const lowSpeedBodies = [
    makeStar('speed-low-a', 1, 0.3, { x: -0.27, y: 0, z: 0 }, { x: 0.15, y: 0, z: 0 }, '#ffd36b'),
    makeStar('speed-low-b', 1, 0.3, { x: 0.27, y: 0, z: 0 }, { x: -0.15, y: 0, z: 0 }, '#7ea7ff'),
  ]
  const highSpeedBodies = [
    makeStar('speed-high-a', 1, 0.3, { x: -0.27, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }, '#ffd36b'),
    makeStar('speed-high-b', 1, 0.3, { x: 0.27, y: 0, z: 0 }, { x: -1.5, y: 0, z: 0 }, '#7ea7ff'),
  ]

  const lowSpeed = presentationFor(lowSpeedBodies)
  const highSpeed = presentationFor(highSpeedBodies)
  assert(highSpeed.speed01 > lowSpeed.speed01, 'higher relative speed must raise the collision VFX energy factor')
  assert(highSpeed.primaryLengthScale > lowSpeed.primaryLengthScale,
    'higher relative speed must increase ejecta travel/scale without changing collision physics')
}

function testUnequalMassCreatesStrongerAsymmetry() {
  const equalBodies = [
    makeStar('equal-a', 1, 0.3, { x: -0.27, y: 0, z: 0 }, { x: 0.15, y: -1.2, z: 0 }, '#ffd36b'),
    makeStar('equal-b', 1, 0.3, { x: 0.27, y: 0, z: 0 }, { x: -0.15, y: 1.2, z: 0 }, '#7ea7ff'),
  ]
  const unequalBodies = [
    makeStar('unequal-small', 0.45, 0.24, { x: -0.255, y: 0, z: 0 }, { x: 0.15, y: -1.2, z: 0 }, '#ff8b68'),
    makeStar('unequal-large', 1.5, 0.32, { x: 0.255, y: 0, z: 0 }, { x: -0.15, y: 1.2, z: 0 }, '#b8d8ff'),
  ]

  const equal = presentationFor(equalBodies)
  const unequal = presentationFor(unequalBodies)
  const equalLengthRatio = equal.primaryLengthScale / equal.secondaryLengthScale
  const unequalLengthRatio = unequal.primaryLengthScale / unequal.secondaryLengthScale
  assert(unequal.massAsymmetry > equal.massAsymmetry, 'unequal-mass test fixture must have greater mass asymmetry')
  assert(unequalLengthRatio > equalLengthRatio,
    'unequal masses must increase primary-versus-secondary plume asymmetry')
  assert(unequal.secondaryOpacityScale < equal.secondaryOpacityScale,
    'smaller-star stripping must suppress the counter-plume relative to the primary plume')
}

function testSyntheticEjectaIsDeterministicAndDimensionAware() {
  const bodies2d = [
    makeStar('preview-a', 0.7, 0.28, { x: -0.25, y: 0, z: 0 }, { x: 0.12, y: -1.4, z: 0 }, '#ff9d72'),
    makeStar('preview-b', 1.4, 0.32, { x: 0.25, y: 0, z: 0 }, { x: -0.12, y: 1.4, z: 0 }, '#c4ddff'),
  ]
  const first = getSyntheticStellarEffects(bodies2d)
  const second = getSyntheticStellarEffects(bodies2d)
  const firstPlasma = first.filter((body) => body.effectVisual?.kind === 'stellarPlasma')
  const secondPlasma = second.filter((body) => body.effectVisual?.kind === 'stellarPlasma')
  assert(firstPlasma.length >= 2, 'grazing overlap should preview multiple plasma structures')
  assert(JSON.stringify(firstPlasma) === JSON.stringify(secondPlasma),
    'collision-id-derived preview ejecta must be deterministic across replay')
  assert(firstPlasma.every((body) => Math.abs(body.effectVisual?.direction.z ?? 0) < 1e-9),
    '2D collision preview must remain in the simulation plane')

  const bodies3d = [
    makeStar('preview-3d-a', 0.8, 0.29, { x: -0.2, y: 0, z: -0.16 }, { x: 0.12, y: -1.2, z: 0.25 }, '#ff9d72'),
    makeStar('preview-3d-b', 1.3, 0.32, { x: 0.2, y: 0, z: 0.16 }, { x: -0.12, y: 1.2, z: -0.1 }, '#c4ddff'),
  ]
  const presentation3d = presentationFor(bodies3d)
  assert(
    Math.abs(presentation3d.primaryDirection.z) + Math.abs(presentation3d.secondaryDirection.z) > 0.05,
    '3D impact presentation must preserve an out-of-plane ejecta component',
  )
}

function testPreviewParticleBudgetRemainsBounded() {
  const crowded: BodyState[] = [
    makeStar('budget-a', 1, 0.3, { x: -0.12, y: 0, z: 0 }, { x: 0.1, y: -1, z: 0 }, '#ffd36b'),
    makeStar('budget-b', 1, 0.3, { x: 0.12, y: 0, z: 0 }, { x: -0.1, y: 1, z: 0 }, '#7ea7ff'),
    makeStar('budget-c', 0.8, 0.28, { x: 0, y: 0.12, z: 0 }, { x: -0.8, y: -0.1, z: 0 }, '#ff8b68'),
    makeStar('budget-d', 1.2, 0.31, { x: 0, y: -0.12, z: 0 }, { x: 0.8, y: 0.1, z: 0 }, '#c4ddff'),
  ]
  const preview = getSyntheticStellarEffects(crowded)
  assert(preview.length <= 10, `synthetic stellar VFX budget must stay bounded, got ${preview.length}`)
}

testProfilesAvoidLensFlareAndBeamShapes()
testBurstVariationTracksCollisionGeometry()
testImpactSpeedChangesBurstEnergy()
testUnequalMassCreatesStrongerAsymmetry()
testSyntheticEjectaIsDeterministicAndDimensionAware()
testPreviewParticleBudgetRemainsBounded()

console.log('collision VFX regression checks passed')
