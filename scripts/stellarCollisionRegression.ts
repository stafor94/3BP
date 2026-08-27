import {
  getEquilibriumStellarDisplayColor,
  getStellarTemperatureKelvin,
} from '../src/starColors'
import { didCollisionWatchTargetImpact } from '../src/collisionWatch'
import { bodyCarriesCollisionLineage } from '../src/collisionIdentity'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import { getCollisionEffectProfile } from '../src/rendering/collisionEffectProfile'
import { getSyntheticStellarEffects } from '../src/rendering/collisionEffectRenderer'
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

function findMergedStar(bodies: BodyState[], a: BodyState, b: BodyState) {
  return bodies.find((body) =>
    body.bodyType === 'star' &&
    bodyCarriesCollisionLineage(body, a.id) &&
    bodyCarriesCollisionLineage(body, b.id),
  )
}

function getCompressionRatio(a: BodyState, b: BodyState) {
  const distance = Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
  const contactDistance = a.radius + b.radius
  return Math.max(0, contactDistance - distance) / Math.max(Math.min(a.radius, b.radius), 1e-9)
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
    Boolean(findMergedStar(result, a, b)),
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
  const remnant = findMergedStar(result, a, b)
  assert(remnant, 'head-on low-speed stellar collision should merge')
  assert(remnant.id === a.id, 'equal primary stellar merge must preserve the collision primary id')
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
  for (let index = 0; index < 18; index += 1) {
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

function testExactContactStillUsesImpactEnvelope() {
  const a = makeStar(
    'stellar-envelope-a',
    1,
    0.3,
    -0.3,
    '#ffd36b',
    { x: 0.3, y: 0, z: 0 },
  )
  const b = makeStar(
    'stellar-envelope-b',
    1,
    0.3,
    0.3,
    '#f5f7ff',
    { x: -0.3, y: 0, z: 0 },
  )

  let frame = stepFragmentAwareBodies([a, b], 0.0015)
  let bridgeFrames = 0
  for (let index = 0; index < 24; index += 1) {
    const bodyA = frame.find((body) => body.id === a.id)
    const bodyB = frame.find((body) => body.id === b.id)
    if (!bodyA || !bodyB) break
    bridgeFrames += 1
    frame = stepFragmentAwareBodies(frame, 0.0015)
  }

  assert(
    bridgeFrames >= 14 && bridgeFrames <= 18,
    `exact-contact stellar merge should preserve both silhouettes for 14-18 physics frames, got ${bridgeFrames}`,
  )
  assert(
    Boolean(findMergedStar(frame, a, b)),
    'impact envelope must eventually reveal the merged stellar remnant',
  )
}

function testMergeImpactPrecedesTopologyReveal() {
  const stepDt = 0.0015
  const a = makeStar(
    'stellar-order-a',
    1,
    0.3,
    -0.3,
    '#7ea7ff',
    { x: 0.3, y: 0, z: 0 },
  )
  const b = makeStar(
    'stellar-order-b',
    1,
    0.3,
    0.3,
    '#ffaf5f',
    { x: -0.3, y: 0, z: 0 },
  )

  let frame: BodyState[] = [a, b]
  let impactStep: number | null = null
  let resolveStep: number | null = null
  let sourceFrames = 0
  let lastBridgeFrame: BodyState[] | null = null

  for (let step = 1; step <= 24; step += 1) {
    const previous = frame
    const next = stepFragmentAwareBodies(previous, stepDt)
    const impactDetected = didCollisionWatchTargetImpact(
      previous,
      next,
      a.id,
      b.id,
      stepDt,
    )
    const sourceA = next.find((body) => body.id === a.id)
    const sourceB = next.find((body) => body.id === b.id)
    const remnant = findMergedStar(next, a, b)

    if (sourceA && sourceB) {
      sourceFrames += 1
      lastBridgeFrame = next
    }

    if (impactDetected && impactStep === null) {
      impactStep = step
      assert(sourceA && sourceB, 'impact must be detected while both source stars still exist')
      assert(!remnant, 'merged remnant must not exist on the impact-detection frame')
    }

    if (remnant) {
      resolveStep = step
      assert(impactStep !== null, 'stellar merge topology must not resolve before impact is observed')
      assert(
        step - impactStep >= 7,
        `both source stars must survive for at least 7 additional steps after impact detection, got ${step - impactStep}`,
      )
      assert(lastBridgeFrame, 'merge resolve must have a preceding two-source topology-mask frame')

      const lastA = lastBridgeFrame.find((body) => body.id === a.id)
      const lastB = lastBridgeFrame.find((body) => body.id === b.id)
      assert(lastA && lastB, 'topology-mask frame must still contain both source stars')
      assert(
        getCompressionRatio(lastA, lastB) >= 0.34,
        'topology resolve must be preceded by the plateaued near-maximum stellar compression state',
      )

      const synthetic = getSyntheticStellarEffects(lastBridgeFrame)
      const syntheticFlash = synthetic.find((body) => body.effectVisual?.kind === 'contactFlash')
      assert(syntheticFlash, 'topology resolve must be preceded by a synthetic contact flash')
      assert(
        getCollisionEffectProfile(syntheticFlash).fadeAlpha >= 0.9,
        'synthetic contact flash must be at peak strength immediately before topology resolve',
      )
      assert(
        synthetic.some((body) => body.effectVisual?.kind === 'compressionShear'),
        'topology-mask frame must contain compression shear',
      )
      assert(
        synthetic.some((body) => body.effectVisual?.kind === 'stellarPlasma'),
        'topology-mask frame must contain stellar plasma',
      )
      assert(
        next.some((body) =>
          body.bodyType === 'effect' &&
          body.name === 'Collision flash' &&
          body.effectVisual?.stellarCollision === true,
        ),
        'physical contact flash must exist on the first resolved-remnant frame',
      )
      frame = next
      break
    }

    frame = next
  }

  assert(impactStep !== null, 'stellar merge must detect impact during the two-source bridge')
  assert(resolveStep !== null, 'stellar merge must eventually resolve topology')
  assert(
    sourceFrames >= 14 && sourceFrames <= 18,
    `stellar merge source silhouettes should survive 14-18 physics frames, got ${sourceFrames}`,
  )
  assert(impactStep < resolveStep, 'impactObserved ordering must strictly precede topologyResolved')
}

function testSyntheticImpactBuildsTowardContact() {
  const makePair = (halfSeparation: number) => [
    makeStar(
      'preview-build-a',
      1,
      0.3,
      -halfSeparation,
      '#7ea7ff',
      { x: 0.25, y: -0.15, z: 0 },
    ),
    makeStar(
      'preview-build-b',
      1,
      0.3,
      halfSeparation,
      '#ffaf5f',
      { x: -0.25, y: 0.15, z: 0 },
    ),
  ] as BodyState[]

  const shallowEffects = getSyntheticStellarEffects(makePair(0.297))
  const deepEffects = getSyntheticStellarEffects(makePair(0.273))
  const shallowFlash = shallowEffects.find((body) => body.effectVisual?.kind === 'contactFlash')
  const deepFlash = deepEffects.find((body) => body.effectVisual?.kind === 'contactFlash')
  assert(shallowFlash && deepFlash, 'staged stellar overlap should synthesize a contact flash')

  const shallowProfile = getCollisionEffectProfile(shallowFlash)
  const deepProfile = getCollisionEffectProfile(deepFlash)
  assert(
    deepProfile.fadeAlpha > shallowProfile.fadeAlpha + 0.2,
    'synthetic contact flash must build with compression instead of decaying toward impact',
  )
  assert(
    deepEffects.some((body) => body.effectVisual?.kind === 'stellarPlasma'),
    'normal staged stellar overlap must enter synthetic plasma buildup before topology reveal',
  )
}

testMassTemperatureModel()
testGrazingHitAndRunHasConsequences()
testSubEscapeGrazingContactCapturesInsteadOfBouncing()
testDeepOverlapCannotBecomeHitAndRun()
testHeadOnMergeUsesRemnantMassColor()
testPartialDisruptionStripsSmallerStar()
testImpactBridgeDoesNotRewriteStellarHue()
testExactContactStillUsesImpactEnvelope()
testMergeImpactPrecedesTopologyReveal()
testSyntheticImpactBuildsTowardContact()

console.log('stellar collision regression checks passed')
