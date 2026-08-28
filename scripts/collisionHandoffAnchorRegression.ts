import * as THREE from 'three'
import {
  COLLISION_HANDOFF_DURATION_MS,
  createCollisionHandoffLayer,
} from '../src/rendering/collisionHandoffLayer'
import { findCollisionVisualTransitions } from '../src/rendering/collisionVisualOutcome'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function near(actual: number, expected: number, tolerance: number, message: string) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`)
}

function body(
  id: string,
  bodyType: BodyState['bodyType'],
  mass: number,
  radius: number,
  x: number,
  y = 0,
): BodyState {
  return {
    id,
    name: id,
    color: '#88aaff',
    mass,
    radius,
    position: { x, y, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function transferPoints(scene: THREE.Scene) {
  const points: THREE.Points[] = []
  scene.traverse((object) => {
    if (object instanceof THREE.Points && object.userData.collisionVisualTransfer) points.push(object)
  })
  return points
}

function transferFor(scene: THREE.Scene, sourceId: string) {
  return transferPoints(scene).find((points) => points.userData.collisionVisualSourceId === sourceId)
}

function fullBodyHandoffMeshes(scene: THREE.Scene) {
  const meshes: THREE.Mesh[] = []
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (
      object.userData.collisionHandoffSnapshot ||
      object.userData.collisionAbsorptionSnapshot ||
      object.userData.collisionVisualTransfer
    ) meshes.push(object)
  })
  return meshes
}

function testDisruptedSourcesShareRetainedResultAssociation() {
  const alpha = body('Alpha', 'planet', 1, 0.2, -0.4)
  const beta = body('Beta', 'planet', 1, 0.2, 0.4)
  const result = body('Alpha+Beta', 'planet', 1.2, 0.24, 0.1)
  const transitions = findCollisionVisualTransitions([alpha, beta], [result])
    .filter((transition) => transition.outcome === 'disrupted')

  assert(transitions.length === 2, 'retained-result disruption must classify both missing sources')
  assert(
    transitions.every((transition) => transition.resultId === result.id),
    'all disrupted sources from one collision must share the retained resultId',
  )
}

function testPureFragmentationKeepsExplicitNullResult() {
  const alpha = body('Alpha', 'planet', 1, 0.2, 0)
  const beta = body('Beta', 'moon', 0.2, 0.1, 0.35)
  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment', 0.3, 0.08, 0.1)
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment', 0.2, 0.07, 0.2)
  const transition = findCollisionVisualTransitions([alpha, beta], [beta, fragmentA, fragmentB])
    .find((candidate) => candidate.source.id === alpha.id)

  assert(transition?.outcome === 'disrupted', 'fragment-only destruction must remain a disruption')
  assert(transition.resultId === null, 'pure fragmentation must keep resultId=null')
}

function testRetainedResultUsesParticleTransferWithoutSphereSnapshot() {
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  const alpha = body('Alpha', 'planet', 1, 0.2, -0.4)
  const beta = body('Beta', 'planet', 1, 0.2, 0.4)
  layer.update([alpha, beta], 0)

  const result = body('Alpha+Beta', 'planet', 1.2, 0.24, 0.1)
  layer.update([result], 10)

  const alphaTransfer = transferFor(scene, alpha.id)
  const betaTransfer = transferFor(scene, beta.id)
  assert(alphaTransfer && betaTransfer, 'disruption must create transfer data for both sources')
  assert(fullBodyHandoffMeshes(scene).length === 0, 'handoff layer must never create full-body mesh snapshots')
  assert(layer.getState(alpha.id)?.lifecycle.phase === 'IMPACT', 'source transfer state must start in IMPACT')

  const movedResult = { ...result, position: { x: 1.25, y: -0.12, z: 0 } }
  layer.update([movedResult], 720)
  near(
    alphaTransfer.position.x,
    movedResult.position.x - result.position.x,
    1e-9,
    'particle transfer anchor x must follow retained result translation',
  )
  near(
    alphaTransfer.position.y,
    movedResult.position.y - result.position.y,
    1e-9,
    'particle transfer anchor y must follow retained result translation',
  )
  assert(layer.getState(alpha.id)?.lifecycle.phase === 'FRACTURE', '720ms transfer must expose explicit FRACTURE state')

  layer.update([movedResult], 10 + COLLISION_HANDOFF_DURATION_MS)
  assert(transferPoints(scene).length === 0, 'source transfer particles must dispose at lifecycle completion')
  layer.dispose()
}

function testPureFragmentationUsesMovingFragmentCentroid() {
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  const alpha = body('Alpha', 'planet', 1, 0.2, 0)
  const beta = body('Beta', 'moon', 0.2, 0.1, 0.35)
  layer.update([alpha, beta], 0)

  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment', 0.3, 0.08, 0.1)
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment', 0.2, 0.07, 0.2)
  layer.update([beta, fragmentA, fragmentB], 10)
  const transfer = transferFor(scene, alpha.id)
  assert(transfer, 'pure fragmentation must create source transfer particles')
  assert(fullBodyHandoffMeshes(scene).length === 0, 'pure fragmentation must not preserve a source sphere')

  const translation = { x: 1.2, y: -0.55 }
  const movedFragmentA = {
    ...fragmentA,
    position: { x: fragmentA.position.x + translation.x, y: fragmentA.position.y + translation.y, z: 0 },
  }
  const movedFragmentB = {
    ...fragmentB,
    position: { x: fragmentB.position.x + translation.x, y: fragmentB.position.y + translation.y, z: 0 },
  }
  layer.update([beta, movedFragmentA, movedFragmentB], 710)

  near(transfer.position.x, translation.x, 1e-9, 'fragment centroid x translation must carry transfer data')
  near(transfer.position.y, translation.y, 1e-9, 'fragment centroid y translation must carry transfer data')
  layer.dispose()
}

function testAbsorptionAlsoAvoidsFullBodyClone() {
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  const primary = body('Primary', 'planet', 1, 0.22, 0)
  const impactor = body('Impactor', 'moon', 0.08, 0.08, 0.3)
  layer.update([primary, impactor], 0)
  const result = body('Primary+Impactor', 'planet', 1.04, 0.23, 0.02)
  layer.update([result], 10)

  const transfer = transferFor(scene, impactor.id)
  assert(transfer, 'absorbed source must use transfer particles instead of a cloned sphere')
  assert(transfer.userData.collisionVisualOutcome === 'absorbed', 'absorption transfer must keep outcome identity')
  assert(fullBodyHandoffMeshes(scene).length === 0, 'absorption path must not reintroduce a renamed full-body clone')
  layer.dispose()
}

const tests = [
  testDisruptedSourcesShareRetainedResultAssociation,
  testPureFragmentationKeepsExplicitNullResult,
  testRetainedResultUsesParticleTransferWithoutSphereSnapshot,
  testPureFragmentationUsesMovingFragmentCentroid,
  testAbsorptionAlsoAvoidsFullBodyClone,
]

for (const test of tests) test()
console.log(`collision handoff anchor regression checks passed (${tests.length})`)
