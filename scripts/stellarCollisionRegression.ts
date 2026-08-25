import {
  getEquilibriumStellarDisplayColor,
  getStellarTemperatureKelvin,
} from '../src/starColors'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  x: number,
  color: string,
  velocity: BodyState['velocity'],
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity,
    bodyType: 'star',
  }
}

function testMassTemperatureModel() {
  const cool = getStellarTemperatureKelvin(0.45)
  const solar = getStellarTemperatureKelvin(1)
  const hot = getStellarTemperatureKelvin(2)
  assert(cool < solar, 'lower-mass main-sequence stars should be cooler')
  assert(hot > solar, 'higher-mass main-sequence stars should be hotter')
  assert(
    getEquilibriumStellarDisplayColor(0.45) !== getEquilibriumStellarDisplayColor(2),
    'mass-based equilibrium display color should vary with stellar mass',
  )
}

function testGrazingHitAndRunHasConsequences() {
  const a = makeStar(
    'stellar-graze-a',
    1,
    0.3,
    -0.2999995,
    '#ffd36b',
    { x: 0.15, y: -1.65, z: 0 },
  )
  const b = makeStar(
    'stellar-graze-b',
    1,
    0.3,
    0.2999995,
    '#ffaf5f',
    { x: -0.15, y: 1.65, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const survivorA = result.find((body) => body.id === a.id)
  const survivorB = result.find((body) => body.id === b.id)
  assert(survivorA && survivorB, 'grazing stellar collision should preserve both hit-and-run survivors')
  assert(
    survivorA.stellarCollisionOutcome === 'hitAndRun' && survivorB.stellarCollisionOutcome === 'hitAndRun',
    'grazing stellar survivors should record hitAndRun outcome',
  )
  assert(
    Math.abs(survivorA.mass - a.mass) > 1e-5 && Math.abs(survivorB.mass - b.mass) > 1e-5,
    'hit-and-run must change both stellar masses instead of acting as a no-op',
  )
  assert(
    Math.abs(survivorA.radius - a.radius) > 1e-6 && Math.abs(survivorB.radius - b.radius) > 1e-6,
    'hit-and-run stellar radius must follow changed mass',
  )
  assert(
    survivorA.color === getEquilibriumStellarDisplayColor(survivorA.mass) &&
      survivorB.color === getEquilibriumStellarDisplayColor(survivorB.mass),
    'hit-and-run survivor color should be recalculated from new mass',
  )
  assert((survivorA.transientHeat01 ?? 0) > 0 && (survivorB.transientHeat01 ?? 0) > 0,
    'hit-and-run survivors should carry transient shock heat')
  assert(
    result.some((body) => body.bodyType === 'effect' && body.effectVisual?.stellarOutcome === 'hitAndRun'),
    'hit-and-run VFX should carry its outcome profile',
  )
}

function testSubEscapeGrazingContactCapturesInsteadOfBouncing() {
  const a = makeStar(
    'stellar-bound-graze-a',
    1,
    0.3,
    -0.2999995,
    '#ff6b5e',
    { x: 0.15, y: -1, z: 0 },
  )
  const b = makeStar(
    'stellar-bound-graze-b',
    1,
    0.3,
    0.2999995,
    '#f5f7ff',
    { x: -0.15, y: 1, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const survivorA = result.find((body) => body.id === a.id)
  const survivorB = result.find((body) => body.id === b.id)
  assert(
    !(survivorA?.stellarCollisionOutcome === 'hitAndRun' && survivorB?.stellarCollisionOutcome === 'hitAndRun'),
    'sub-escape stellar contact must not be resolved as an elastic-looking hit-and-run',
  )
  assert(
    result.some((body) => body.bodyType === 'star' && body.id.includes(a.id) && body.id.includes(b.id)),
    'sub-escape grazing stellar contact should be captured into a merged remnant',
  )
}

function testDeepOverlapCannotBecomeHitAndRun() {
  const a = makeStar(
    'stellar-deep-a',
    1,
    0.3,
    -0.22,
    '#ff6b5e',
    { x: 0.1, y: -1.65, z: 0 },
  )
  const b = makeStar(
    'stellar-deep-b',
    1,
    0.3,
    0.22,
    '#f5f7ff',
    { x: -0.1, y: 1.65, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const survivorA = result.find((body) => body.id === a.id)
  const survivorB = result.find((body) => body.id === b.id)
  assert(
    !(survivorA?.stellarCollisionOutcome === 'hitAndRun' && survivorB?.stellarCollisionOutcome === 'hitAndRun'),
    'deep stellar overlap must be merge/stripping, never a teleport-apart hit-and-run',
  )
}

function testHeadOnMergeUsesRemnantMassColor() {
  const a = makeStar(
    'stellar-merge-a2',
    1,
    0.3,
    -0.2999995,
    '#ffd36b',
    { x: 0.3, y: 0, z: 0 },
  )
  const b = makeStar(
    'stellar-merge-b2',
    1,
    0.3,
    0.2999995,
    '#ff6b5e',
    { x: -0.3, y: 0, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const remnant = result.find((body) => body.bodyType === 'star' && body.id.includes(a.id) && body.id.includes(b.id))
  assert(remnant, 'head-on low-speed stellar collision should merge')
  assert(remnant.stellarCollisionOutcome === 'merge', 'merged remnant should record merge outcome')
  assert(remnant.mass > 1.8, 'merged remnant should retain most of both stellar masses')
  assert(
    remnant.color === getEquilibriumStellarDisplayColor(remnant.mass),
    'merged remnant color should be based on remnant mass',
  )
  assert(
    (remnant.stellarTemperatureK ?? 0) > getStellarTemperatureKelvin(1),
    'more massive merged remnant should trend hotter than a solar-mass source star',
  )
  assert((remnant.transientHeat01 ?? 0) >= 0.8, 'stellar merge should receive the strongest transient heat')
}

function testPartialDisruptionStripsSmallerStar() {
  const smaller = makeStar(
    'stellar-partial-small',
    0.6,
    0.24,
    -0.2799995,
    '#ffaf5f',
    { x: 1.05, y: -1.2, z: 0 },
  )
  const larger = makeStar(
    'stellar-partial-large',
    1.3,
    0.32,
    0.2799995,
    '#fff4e8',
    { x: -1.05, y: 1.2, z: 0 },
  )

  const result = stepCoreBodies([smaller, larger], 1e-8)
  const smallSurvivor = result.find((body) => body.id === smaller.id)
  const largeSurvivor = result.find((body) => body.id === larger.id)
  assert(smallSurvivor && largeSurvivor, 'partial disruption should keep two stellar survivors')
  assert(
    smallSurvivor.stellarCollisionOutcome === 'partialDisruption' &&
      largeSurvivor.stellarCollisionOutcome === 'partialDisruption',
    'partial disruption survivors should expose explicit outcome',
  )
  const smallRelativeChange = Math.abs(smallSurvivor.mass - smaller.mass) / smaller.mass
  const largeRelativeChange = Math.abs(largeSurvivor.mass - larger.mass) / larger.mass
  assert(smallRelativeChange > largeRelativeChange,
    'partial disruption should affect the smaller star more strongly')
  assert(smallSurvivor.mass < smaller.mass, 'partial disruption should visibly strip the smaller star')
  assert(
    (smallSurvivor.collisionScarIntensity ?? 0) > (largeSurvivor.collisionScarIntensity ?? 0),
    'smaller stripped star should receive the stronger visual damage state',
  )
  assert(
    result.some((body) => body.bodyType === 'effect' && body.effectVisual?.stellarOutcome === 'partialDisruption'),
    'partial disruption should produce outcome-tagged plasma/VFX',
  )
}

function testImpactBridgeDoesNotRewriteStellarHue() {
  const a = makeStar(
    'stellar-color-bridge-a',
    1,
    0.3,
    -0.30025,
    '#7ea7ff',
    { x: 0.2, y: 0, z: 0 },
  )
  const b = makeStar(
    'stellar-color-bridge-b',
    1,
    0.3,
    0.30025,
    '#ff6b5e',
    { x: -0.2, y: 0, z: 0 },
  )

  let frame = stepFragmentAwareBodies([a, b], 0.0015)
  let sawBridge = false
  for (let index = 0; index < 8; index += 1) {
    const bodyA = frame.find((body) => body.id === a.id)
    const bodyB = frame.find((body) => body.id === b.id)
    if (bodyA && bodyB) {
      sawBridge = true
      assert(bodyA.color === a.color, 'display-only overlap must not rewrite star A base hue')
      assert(bodyB.color === b.color, 'display-only overlap must not rewrite star B base hue')
      frame = stepFragmentAwareBodies(frame, 0.0015)
      continue
    }
    break
  }
  assert(sawBridge, 'stellar collision should expose at least one staged impact bridge frame')
}

testMassTemperatureModel()
testGrazingHitAndRunHasConsequences()
testSubEscapeGrazingContactCapturesInsteadOfBouncing()
testDeepOverlapCannotBecomeHitAndRun()
testHeadOnMergeUsesRemnantMassColor()
testPartialDisruptionStripsSmallerStar()
testImpactBridgeDoesNotRewriteStellarHue()

console.log('stellar collision regression checks passed')
