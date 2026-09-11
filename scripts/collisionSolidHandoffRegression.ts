import { bodyCarriesCollisionLineage } from '../src/collisionIdentity'
import { resolveBodyDescendant } from '../src/collisionWatch'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import { getCelestialBodyRenderBodies } from '../src/rendering/collisionEffectRouting'
import {
  getCollisionAbsorbedSolidProgress,
  resetCollisionSolidHandoffState,
} from '../src/rendering/collisionSolidHandoff'
import { findCollisionVisualTransitions } from '../src/rendering/collisionVisualOutcome'
import type { BodyState } from '../src/types'

const DT = 0.0015
const SOURCE_A_ID = 'solid-handoff-a'
const SOURCE_B_ID = 'solid-handoff-b'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeInitialBodies(): BodyState[] {
  const radiusA = 0.024
  const radiusB = 0.022
  const separation = radiusA + radiusB - 1e-6
  return [
    {
      id: SOURCE_A_ID,
      name: 'Aster',
      color: '#9a765d',
      mass: 0.02,
      radius: radiusA,
      position: { x: -separation * 0.5, y: 0, z: 0 },
      velocity: { x: 0.1, y: 0, z: 0 },
      bodyType: 'moon',
    },
    {
      id: SOURCE_B_ID,
      name: 'Beryl',
      color: '#6f91a5',
      mass: 0.02,
      radius: radiusB,
      position: { x: separation * 0.5, y: 0, z: 0 },
      velocity: { x: -0.1, y: 0, z: 0 },
      bodyType: 'moon',
    },
  ]
}

function separation(a: BodyState, b: BodyState) {
  return Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
}

function distance(a: BodyState['position'], b: BodyState['position']) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function findRemnant(bodies: BodyState[]) {
  return bodies.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    bodyCarriesCollisionLineage(body, SOURCE_A_ID) &&
    bodyCarriesCollisionLineage(body, SOURCE_B_ID),
  )
}

function testSequentialAbsorbedSolidBreakup() {
  const initial = getCollisionAbsorbedSolidProgress(0)
  const early = getCollisionAbsorbedSolidProgress(0.25)
  const middle = getCollisionAbsorbedSolidProgress(0.55)
  const late = getCollisionAbsorbedSolidProgress(0.85)
  const retired = getCollisionAbsorbedSolidProgress(0.98)

  assert(initial.erosionProgress === 0, 'absorbed solid must begin with an intact contact face')
  assert(initial.radiusScale === 1, 'absorbed solid must begin at its existing presentation size')
  assert(initial.opacity === 1, 'absorbed solid must begin fully opaque')
  assert(
    early.erosionProgress > 0.1 && early.collapseProgress === 0,
    'contact-side breakup must begin before whole-body collapse',
  )
  assert(
    early.contactAxisScale < early.lateralScaleB && early.lateralScaleB < early.lateralScaleA,
    'early breakup must deform the contact axis more strongly than the lateral silhouette',
  )
  assert(
    middle.erosionProgress > 0.5 && middle.radiusScale > 0.75 && middle.opacity === 1,
    'mid handoff must show substantial contact-side damage before global shrink/fade dominates',
  )
  assert(
    late.erosionProgress > 0.9 && late.radiusScale < 0.18 && late.opacity > 0,
    'late handoff must leave only a heavily deformed collapsing remainder before retirement',
  )
  assert(
    retired.opacity <= 1e-9 && retired.radiusScale < 0.01,
    'the final presentation must become effectively invisible before the handoff object is deleted',
  )
  const stages = [initial, early, middle, late, retired]
  for (let index = 0; index < stages.length - 1; index += 1) {
    assert(
      stages[index + 1].erosionProgress + 1e-9 >= stages[index].erosionProgress,
      'contact-side breakup progress must be monotonic',
    )
    assert(
      stages[index + 1].radiusScale <= stages[index].radiusScale + 1e-9,
      'absorbed remainder scale must collapse monotonically',
    )
    assert(
      stages[index + 1].opacity <= stages[index].opacity + 1e-9,
      'absorbed remainder opacity must not recover during retirement',
    )
  }
}

testSequentialAbsorbedSolidBreakup()
resetCollisionSolidHandoffState()
let physical = makeInitialBodies()
let previousRendered = getCelestialBodyRenderBodies(physical)
let previousSeparation = separation(physical[0], physical[1])
let resolved = false

for (let step = 1; step <= 24; step += 1) {
  const previous = physical
  const renderedBeforeStep = previousRendered
  physical = stepBodies(physical, DT)
  const sourceA = physical.find((body) => body.id === SOURCE_A_ID)
  const sourceB = physical.find((body) => body.id === SOURCE_B_ID)

  if (sourceA && sourceB) {
    const currentSeparation = separation(sourceA, sourceB)
    assert(
      currentSeparation <= previousSeparation + 1e-10,
      `staging separation rewound outward at step ${step}: ${previousSeparation} -> ${currentSeparation}`,
    )
    previousSeparation = currentSeparation
    previousRendered = getCelestialBodyRenderBodies(physical)
    continue
  }

  const remnant = findRemnant(physical)
  if (!remnant) {
    previousRendered = getCelestialBodyRenderBodies(physical)
    continue
  }

  const physicalSnapshot = JSON.stringify(physical)
  const transitions = findCollisionVisualTransitions(previous, physical)
  const survivor = transitions.find((transition) => transition.outcome === 'merged-survivor')?.source
  const absorbed = transitions.find((transition) => transition.outcome === 'absorbed')?.source
  assert(survivor && absorbed, 'merge result must classify one survivor and one absorbed source')
  const renderedSurvivorBeforeHandoff = renderedBeforeStep.find((body) => body.id === survivor.id)
  assert(
    renderedSurvivorBeforeHandoff,
    'last pre-handoff rendered frame must contain the surviving source solid',
  )

  const rendered = getCelestialBodyRenderBodies(physical)
  assert(JSON.stringify(physical) === physicalSnapshot, 'presentation routing must not mutate physical bodies')

  const renderedRemnant = rendered.find((body) => body.id === remnant.id)
  const renderedAbsorbed = rendered.find((body) => body.id === absorbed.id)
  assert(renderedRemnant, 'physical remnant must remain present in renderer state')
  assert(renderedAbsorbed, 'absorbed source solid silhouette must survive the first post-solver render state')
  assert(
    renderedAbsorbed.bodyType === 'effect',
    'presentation-only absorbed source must be excluded from physical descendant/tracking eligibility',
  )
  assert(
    distance(renderedRemnant.position, renderedSurvivorBeforeHandoff.position) < 1e-9,
    'first remnant presentation position must inherit the last rendered survivor staging position',
  )
  assert(
    distance(renderedRemnant.position, remnant.position) <=
      distance(renderedSurvivorBeforeHandoff.position, remnant.position) + 1e-12,
    'remnant presentation must move toward, never beyond, the actual physical remnant',
  )
  assert(
    resolveBodyDescendant(rendered, absorbed.id)?.id === remnant.id,
    'tracking/descendant resolution must ignore the presentation ghost and resolve to the physical remnant',
  )

  const physicalSolids = physical.filter((body) => body.bodyType !== 'effect' && body.bodyType !== 'fragment')
  assert(physicalSolids.length === 1, `fixture must physically resolve 2->1, got ${physicalSolids.length} solid bodies`)
  assert(
    Math.abs(remnant.mass - physicalSolids[0].mass) <= 1e-12 &&
      Math.abs(remnant.radius - physicalSolids[0].radius) <= 1e-12 &&
      Math.abs(remnant.velocity.x - physicalSolids[0].velocity.x) <= 1e-12 &&
      Math.abs(remnant.velocity.y - physicalSolids[0].velocity.y) <= 1e-12 &&
      Math.abs(remnant.velocity.z - physicalSolids[0].velocity.z) <= 1e-12,
    'solid handoff must leave final physical mass/radius/velocity untouched',
  )

  resolved = true
  break
}

assert(resolved, 'small head-on fixture did not resolve to a remnant within 24 staged steps')
console.log('collision solid handoff regression checks passed')
