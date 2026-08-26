import {
  COLLISION_HANDOFF_DURATION_MS,
  COLLISION_PRODUCT_REVEAL_DELAY_MS,
  COLLISION_PRODUCT_REVEAL_DURATION_MS,
  findCollisionHandoffSources,
  getCollisionHandoffParticleProgress,
  getCollisionHandoffProgress,
  getCollisionProductRevealProgress,
} from '../src/rendering/collisionHandoffLayer'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function body(id: string, bodyType: BodyState['bodyType'] = 'planet'): BodyState {
  return {
    id,
    name: id,
    color: '#88aaff',
    mass: bodyType === 'effect' ? 0 : 1,
    radius: 0.2,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function testHandoffProgressIsSmoothAndBounded() {
  assert(getCollisionHandoffProgress(-100) === 0, 'handoff progress must clamp before start')
  const midpoint = getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS / 2)
  assert(midpoint > 0.45 && midpoint < 0.55, 'handoff midpoint must remain near the smoothstep midpoint')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS) === 1, 'handoff must finish at its configured duration')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS * 2) === 1, 'handoff progress must clamp after completion')
}

function testDebrisEmissionWaitsForSurfaceFracture() {
  assert(getCollisionHandoffParticleProgress(0) === 0, 'debris must not burst before the outgoing surface starts fracturing')
  const middle = getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS * 0.6)
  assert(middle > 0 && middle < 1, 'debris emission must progress smoothly through the handoff')
  assert(
    getCollisionHandoffParticleProgress(COLLISION_HANDOFF_DURATION_MS) === 1,
    'debris emission must finish with the outgoing surface handoff',
  )
}

function testCollisionProductRevealIsDelayedAndProgressive() {
  assert(
    getCollisionProductRevealProgress(COLLISION_PRODUCT_REVEAL_DELAY_MS) === 0,
    'new collision products must remain hidden during the initial fracture delay',
  )
  const midpoint = getCollisionProductRevealProgress(
    (COLLISION_PRODUCT_REVEAL_DELAY_MS + COLLISION_PRODUCT_REVEAL_DURATION_MS) / 2,
  )
  assert(midpoint > 0.45 && midpoint < 0.55, 'collision products must crossfade through a smooth midpoint')
  assert(
    getCollisionProductRevealProgress(COLLISION_PRODUCT_REVEAL_DURATION_MS) === 1,
    'new collision products must be fully revealed by the configured handoff end',
  )
}

function testMergeRetiresBothOriginalBodies() {
  const alpha = body('Alpha')
  const beta = body('Beta', 'moon')
  const remnant = body('Alpha+Beta')
  const retired = findCollisionHandoffSources([alpha, beta], [remnant])
  assert(retired.length === 2, 'a merge must create a visual handoff for both disappearing originals')
  assert(retired.some((candidate) => candidate.id === 'Alpha'), 'Alpha must participate in the merge handoff')
  assert(retired.some((candidate) => candidate.id === 'Beta'), 'Beta must participate in the merge handoff')
}

function testDestructionIntoFragmentsCreatesHandoff() {
  const alpha = body('Alpha')
  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment')
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment')
  const retired = findCollisionHandoffSources([alpha], [fragmentA, fragmentB])
  assert(retired.length === 1 && retired[0].id === 'Alpha', 'fragment descendants must keep a dissolving source body during destruction')
}

function testStellarMergeStaysOnDedicatedTopologyPath() {
  const alpha = body('Alpha', 'star')
  const beta = body('Beta', 'star')
  const remnant = body('Alpha+Beta', 'star')
  assert(
    findCollisionHandoffSources([alpha, beta], [remnant]).length === 0,
    'stellar mergers must use the dedicated topology mask instead of the generic solid-body handoff',
  )
}

function testUnrelatedPresetReplacementDoesNotCreateHandoff() {
  const alpha = body('Alpha')
  const gamma = body('Gamma')
  assert(
    findCollisionHandoffSources([alpha], [gamma]).length === 0,
    'unrelated setup changes must not be mistaken for collision destruction',
  )
}

function testTransientBodiesDoNotRetireAsCelestialGhosts() {
  const fragment = body('Alpha+Beta+fragment-0', 'fragment')
  const effect = body('Alpha+Beta+flash', 'effect')
  const descendant = body('Alpha+Beta+fragment-0+Gamma', 'fragment')
  assert(
    findCollisionHandoffSources([fragment, effect], [descendant]).length === 0,
    'fragment expiry and effect cleanup must not spawn full-body handoff ghosts',
  )
}

const tests = [
  testHandoffProgressIsSmoothAndBounded,
  testDebrisEmissionWaitsForSurfaceFracture,
  testCollisionProductRevealIsDelayedAndProgressive,
  testMergeRetiresBothOriginalBodies,
  testDestructionIntoFragmentsCreatesHandoff,
  testStellarMergeStaysOnDedicatedTopologyPath,
  testUnrelatedPresetReplacementDoesNotCreateHandoff,
  testTransientBodiesDoNotRetireAsCelestialGhosts,
]

for (const test of tests) test()
console.log(`collision handoff regression checks passed (${tests.length})`)
