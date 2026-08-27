import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import { findTrackingCandidate } from '../src/trackingSelection'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function makeBody(
  id: string,
  bodyType: 'star' | 'planet' | 'moon',
  mass: number,
  radius: number,
  x: number,
  velocityX: number,
  color: string,
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { x: velocityX, y: 0, z: 0 },
    bodyType,
  }
}

function totalMass(bodies: BodyState[]) {
  // Ejecta effects can carry real escaped collision mass even though they are
  // intentionally non-gravitating. Immediate result accounting must include it.
  return bodies.reduce((sum, body) => sum + body.mass, 0)
}

function testPlanetCollisionRemainsSolidAndMassConserving() {
  const a = makeBody('planet-a', 'planet', 0.2, 0.12, -0.119999, 0.2, '#4f7896')
  const b = makeBody('planet-b', 'planet', 0.2, 0.12, 0.119999, -0.2, '#a46d4d')
  const initialMass = a.mass + b.mass
  const resolved = stepCoreBodies([a, b], 1e-8)

  assert(
    !resolved.some((body) => body.name === 'Stellar plasma'),
    'planet-planet collisions must never create stellar-plasma ejecta',
  )
  assert(
    resolved.some((body) => body.bodyType === 'fragment' || body.name === 'Collision spark'),
    'planet-planet collisions should expose solid debris or impact sparks',
  )
  assert(
    resolved.every((body) => body.bodyType === 'effect' || body.bodyType === 'planet' || body.bodyType === 'fragment'),
    'planet-planet collisions must not promote a result to a star or moon',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'planet collision immediate result mass must be conserved',
  )
  assert(resolved.length <= 28, 'planet collision result must stay under the dynamic-body cap')
}

function testMoonDisruptionDoesNotBecomeStellar() {
  const a = makeBody('moon-a', 'moon', 0.02, 0.05, -0.049999, 1.5, '#9a958d')
  const b = makeBody('moon-b', 'moon', 0.02, 0.05, 0.049999, -1.5, '#77736f')
  const initialMass = a.mass + b.mass
  const resolved = stepCoreBodies([a, b], 1e-8)

  assert(
    !resolved.some((body) => body.name === 'Stellar plasma'),
    'moon disruption must use solid debris instead of stellar plasma',
  )
  assert(
    resolved.some((body) => body.bodyType === 'fragment'),
    'high-speed moon collision should produce persistent or temporary solid fragments',
  )
  assert(
    !resolved.some((body) => body.bodyType === 'star'),
    'moon collision remnants must never be classified as stars',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'moon collision immediate result mass must be conserved',
  )
  assert(resolved.length <= 28, 'moon collision result must stay under the dynamic-body cap')
}

function testStellarImpactStillUsesPlasmaLanguage() {
  const star = makeBody('star-a', 'star', 1, 0.2, -0.139999, 0.35, '#ffd36b')
  const planet = makeBody('planet-c', 'planet', 0.1, 0.08, 0.139999, -0.35, '#557d91')
  const initialMass = star.mass + planet.mass
  const resolved = stepCoreBodies([star, planet], 1e-8)
  const plasmaMass = resolved
    .filter((body) => body.name === 'Stellar plasma')
    .reduce((sum, body) => sum + body.mass, 0)

  assert(
    resolved.some((body) => body.name === 'Stellar plasma'),
    'star-involved collision should keep the dedicated stellar-plasma ejecta path',
  )
  assert(plasmaMass > 0, 'stellar plasma ejecta should carry the collision mass removed from the remnant')
  assert(
    !resolved.some((body) => body.bodyType === 'fragment'),
    'star-involved collision must not expose asteroid-like solid fragments',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'stellar impact immediate result mass must remain conserved across plasma ejecta',
  )
  assert(resolved.length <= 28, 'stellar collision result must stay under the dynamic-body cap')
}

function testTinySubEscapeMoonGrazeUsesImpactorScaledMassLoss() {
  // Reproduce the observed Janus/Luna scale: a 0.0019 moon grazing a 0.35
  // planet at relative speed 2.412, about 0.85x their mutual escape speed.
  const janus: BodyState = {
    id: 'janus',
    name: 'Janus',
    color: '#647f95',
    mass: 0.35,
    radius: 0.0688,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }
  const luna: BodyState = {
    id: 'luna',
    name: 'Luna',
    color: '#aaa49a',
    mass: 0.0019,
    radius: 0.0187,
    position: { x: janus.radius + 0.0187 - 1e-6, y: 0, z: 0 },
    velocity: { x: -0.21708, y: 2.4022115380623745, z: 0 },
    bodyType: 'moon',
  }
  const initialMass = janus.mass + luna.mass
  const initialDelta = {
    x: luna.position.x - janus.position.x,
    y: luna.position.y - janus.position.y,
    z: luna.position.z - janus.position.z,
  }
  const initialDistance = Math.hypot(initialDelta.x, initialDelta.y, initialDelta.z)
  const initialNormal = {
    x: initialDelta.x / initialDistance,
    y: initialDelta.y / initialDistance,
    z: initialDelta.z / initialDistance,
  }
  const contactPoint = {
    x: (
      janus.position.x + initialNormal.x * janus.radius +
      luna.position.x - initialNormal.x * luna.radius
    ) * 0.5,
    y: (
      janus.position.y + initialNormal.y * janus.radius +
      luna.position.y - initialNormal.y * luna.radius
    ) * 0.5,
    z: (
      janus.position.z + initialNormal.z * janus.radius +
      luna.position.z - initialNormal.z * luna.radius
    ) * 0.5,
  }

  let resolved: BodyState[] = [janus, luna]
  let observedAbsorptionShrink = false
  let firstResolvedFrame: BodyState[] | null = null
  for (let step = 0; step < 24; step += 1) {
    resolved = stepFragmentAwareBodies(resolved, 0.0015)
    const liveImpactor = resolved.find((body) => body.id === luna.id)
    if (liveImpactor && liveImpactor.radius <= luna.radius * 0.82) {
      observedAbsorptionShrink = true
    }
    const remnantNow = resolved.find((body) =>
      body.bodyType === 'planet' &&
      body.id === janus.id &&
      body.trackingContinuationIds?.includes(luna.id),
    )
    if (remnantNow && !firstResolvedFrame) {
      firstResolvedFrame = resolved.map((body) => ({
        ...body,
        position: { ...body.position },
        velocity: { ...body.velocity },
        collisionLineageIds: body.collisionLineageIds ? [...body.collisionLineageIds] : undefined,
        trackingContinuationIds: body.trackingContinuationIds ? [...body.trackingContinuationIds] : undefined,
        effectVisual: body.effectVisual
          ? {
              ...body.effectVisual,
              direction: { ...body.effectVisual.direction },
              normal: body.effectVisual.normal ? { ...body.effectVisual.normal } : undefined,
            }
          : undefined,
      }))
    }
  }
  const remnant = resolved.find((body) =>
    body.bodyType === 'planet' &&
    body.id === janus.id &&
    body.trackingContinuationIds?.includes(luna.id),
  )

  assert(
    observedAbsorptionShrink,
    'tiny absorbed impactor should visibly shrink before the physical replacement frame',
  )
  assert(remnant, 'tiny sub-escape moon graze should resolve to the original Janus identity')
  assert(firstResolvedFrame, 'tiny absorption regression must capture the first physical result frame')
  const firstRemnant = firstResolvedFrame.find((body) =>
    body.bodyType === 'planet' &&
    body.id === janus.id &&
    body.trackingContinuationIds?.includes(luna.id),
  )
  assert(firstRemnant, 'first physical absorption frame must contain stable-id Janus remnant')
  assert(
    firstRemnant.collisionLineageIds?.includes(janus.id) === true &&
      firstRemnant.collisionLineageIds?.includes(luna.id) === true,
    'stable-id absorption remnant must separately preserve both collision source lineages',
  )
  const absorptionEjecta = firstResolvedFrame.filter((body) =>
    body !== firstRemnant &&
    body.mass > 0 &&
    body.id.includes(janus.id) &&
    body.id.includes(luna.id),
  )
  assert(absorptionEjecta.length > 0, 'tiny absorption should retain represented ejecta mass')
  absorptionEjecta.forEach((body) => {
    assert(
      body.bodyType === 'effect' && body.name === 'Collision spark',
      'tiny absorption ejecta must be transient compact effects instead of detached solid fragments',
    )
    assert(
      (body.lifetime ?? Number.POSITIVE_INFINITY) <= 0.56,
      'tiny absorption ejecta must fade quickly instead of lingering as late collision streaks',
    )
    assert(
      (body.effectVisual?.stretch ?? Number.POSITIVE_INFINITY) <= 1.11 &&
        (body.effectVisual?.tailLength ?? Number.POSITIVE_INFINITY) <= 0.081,
      'tiny absorption ejecta must remain compact instead of rendering as long directional streaks',
    )
    const spawnDistance = Math.hypot(
      body.position.x - contactPoint.x,
      body.position.y - contactPoint.y,
      body.position.z - contactPoint.z,
    )
    assert(
      spawnDistance <= Math.max(janus.radius, luna.radius) * 0.22,
      'tiny absorption ejecta must originate at the contact patch instead of popping in away from the body',
    )
  })

  const escapedMass = initialMass - remnant.mass
  assert(
    escapedMass <= luna.mass * 0.35 + 1e-10,
    'tiny sub-escape graze must cap escaped mass to a fraction of the impactor mass',
  )
  assert(
    remnant.mass > janus.mass,
    'the primary should gain mass after absorbing most of a tiny sub-escape moon',
  )
  assertClose(
    totalMass(resolved),
    initialMass,
    1e-10,
    'corrected tiny-impact absorption must conserve total represented mass',
  )
  assert(
    findTrackingCandidate(resolved, janus.id)?.id === janus.id,
    'the larger absorber should keep ordinary tracking on its stable identity',
  )
  assert(
    findTrackingCandidate(resolved, luna.id)?.id === janus.id,
    'tracking the absorbed moon should transfer onto the surviving primary identity',
  )
}

const tests = [
  testPlanetCollisionRemainsSolidAndMassConserving,
  testMoonDisruptionDoesNotBecomeStellar,
  testStellarImpactStillUsesPlasmaLanguage,
  testTinySubEscapeMoonGrazeUsesImpactorScaledMassLoss,
]

for (const test of tests) test()
console.log(`non-stellar regression checks passed (${tests.length})`)
