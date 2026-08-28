import * as THREE from 'three'
import {
  createCollisionHandoffLayer,
  findCollisionAbsorptionSources,
  findCollisionHandoffSources,
} from '../src/rendering/collisionHandoffLayer'
import { findCollisionVisualTransitions } from '../src/rendering/collisionVisualOutcome'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function body(
  id: string,
  bodyType: BodyState['bodyType'] = 'planet',
  mass = bodyType === 'effect' ? 0 : 1,
  x = 0,
  radius = mass < 0.2 ? 0.08 : 0.2,
): BodyState {
  return {
    id,
    name: id,
    color: '#88aaff',
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function collisionResult(
  id: string,
  sourceIds: string[],
  mass: number,
  x = 0,
): BodyState {
  return {
    ...body(id, 'planet', mass, x),
    collisionLineageIds: [...sourceIds],
    trackingContinuationIds: [...sourceIds],
  }
}

function transitionForSource(
  previous: BodyState[],
  current: BodyState[],
  sourceId: string,
) {
  return findCollisionVisualTransitions(previous, current)
    .find((transition) => transition.source.id === sourceId)
}

function testPreservedIdNormalMergeUsesPhysicsIdentity() {
  // Equal mass/radius is deliberate. Core physics selectCollisionPrimary(a, b)
  // preserves the first source when both values tie. Visual ownership must obey
  // the actual result id instead of introducing its own lexical tie-break.
  const preservedPrimary = body('Zulu', 'planet', 1, -0.2, 0.2)
  const secondary = body('Alpha', 'planet', 1, 0.2, 0.2)
  const remnant = collisionResult(preservedPrimary.id, [preservedPrimary.id, secondary.id], 1.9)
  const previous = [preservedPrimary, secondary]
  const current = [remnant]
  const transitions = findCollisionVisualTransitions(previous, current)

  assert(transitions.length === 2, 'preserved-id merge must create one transition for each source')
  const survivor = transitions.find((transition) => transition.source.id === preservedPrimary.id)
  const absorbed = transitions.find((transition) => transition.source.id === secondary.id)
  assert(survivor?.outcome === 'merged-survivor', 'physics-preserved id must own merged-survivor')
  assert(absorbed?.outcome === 'absorbed', 'missing secondary must be absorbed')
  assert(survivor.resultId === remnant.id, 'survivor must target the preserved result id')
  assert(absorbed.resultId === remnant.id, 'absorbed source must target the same preserved result id')
  assert(
    transitions.every((transition) => transition.outcome !== 'disrupted'),
    'normal preserved-id merge must not be classified as disruption',
  )
}

function testPreservedIdMergeWithMassBearingEjectaPrefersSurvivingResult() {
  const primary = body('Luna', 'planet', 1, -0.18)
  const secondary = body('Nereid', 'moon', 0.2, 0.18, 0.1)
  const remnant = collisionResult(primary.id, [primary.id, secondary.id], 1.12)
  const ejecta: BodyState = {
    ...body('Luna+Nereid+fx1-0', 'effect', 0.05, 0.08, 0.04),
    collisionLineageIds: [primary.id, secondary.id],
  }
  const previous = [primary, secondary]
  const current = [remnant, ejecta]
  const secondaryTransition = transitionForSource(previous, current, secondary.id)

  assert(secondaryTransition?.outcome === 'absorbed', 'surviving merge result must outrank ejecta disruption fallback')
  assert(secondaryTransition.resultId === remnant.id, 'secondary must associate with preserved merged result')
  assert(
    findCollisionHandoffSources(previous, current).length === 0,
    'mass-bearing ejecta must not make a normal preserved-id merge a disruption handoff',
  )
  assert(
    findCollisionAbsorptionSources(previous, current).map((candidate) => candidate.id).join(',') === secondary.id,
    'only the absorbed secondary may enter the absorption transfer path',
  )

  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  layer.update(previous, 100)
  layer.update(current, 101)
  assert(
    !scene.children.some((child) => child.userData.collisionVisualSolidChunks === true),
    'preserved-id merge must not create disruption solid chunks',
  )
  layer.dispose()
}

function testPureDisruptionStillFallsBackToFragments() {
  const alpha = body('Alpha', 'planet', 1, -0.2)
  const beta = body('Beta', 'planet', 1, 0.2)
  const fragmentA: BodyState = {
    ...body('Alpha+Beta+frag1-0', 'fragment', 0.5, -0.05, 0.12),
    collisionLineageIds: [alpha.id, beta.id],
  }
  const fragmentB: BodyState = {
    ...body('Alpha+Beta+frag1-1', 'fragment', 0.4, 0.06, 0.11),
    collisionLineageIds: [alpha.id, beta.id],
  }
  const previous = [alpha, beta]
  const current = [fragmentA, fragmentB]
  const transitions = findCollisionVisualTransitions(previous, current)

  assert(transitions.length === 2, 'pure fragmentation must still transition both missing sources')
  assert(
    transitions.every((transition) => transition.outcome === 'disrupted' && transition.resultId === null),
    'pure fragmentation without surviving result must remain disrupted',
  )
  assert(
    findCollisionHandoffSources(previous, current).length === 2,
    'real disruption must still feed both sources into disruption handoff',
  )
}

function testOrdinaryUnchangedBodiesDoNotCreateCollisionTransitions() {
  const alpha = body('Alpha', 'planet', 1, -0.3)
  const beta = body('Beta', 'moon', 0.2, 0.3, 0.1)
  const current = [
    { ...alpha, position: { x: -0.29, y: 0, z: 0 } },
    { ...beta, position: { x: 0.29, y: 0, z: 0 } },
  ]

  assert(
    findCollisionVisualTransitions([alpha, beta], current).length === 0,
    'same-id ordinary survivors must not be mistaken for preserved-id merges',
  )
}

function testNewIdMergeRemainsSupported() {
  const primary = body('Primary', 'planet', 1, -0.2)
  const secondary = body('Impactor', 'moon', 0.2, 0.2, 0.1)
  const remnant = collisionResult('Primary+Impactor', [primary.id, secondary.id], 1.12)
  const previous = [primary, secondary]
  const current = [remnant]
  const transitions = findCollisionVisualTransitions(previous, current)
  const survivor = transitions.find((transition) => transition.source.id === primary.id)
  const absorbed = transitions.find((transition) => transition.source.id === secondary.id)

  assert(survivor?.outcome === 'merged-survivor', 'new-id merge must retain merged-survivor behavior')
  assert(absorbed?.outcome === 'absorbed', 'new-id merge must retain absorbed behavior')
  assert(survivor.resultId === remnant.id && absorbed.resultId === remnant.id, 'new-id sources must share result ownership')
}

const tests = [
  testPreservedIdNormalMergeUsesPhysicsIdentity,
  testPreservedIdMergeWithMassBearingEjectaPrefersSurvivingResult,
  testPureDisruptionStillFallsBackToFragments,
  testOrdinaryUnchangedBodiesDoNotCreateCollisionTransitions,
  testNewIdMergeRemainsSupported,
]

for (const test of tests) test()
console.log(`collision visual ownership regression checks passed (${tests.length})`)
