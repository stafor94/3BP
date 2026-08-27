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

function createBodyMesh(bodyState: BodyState) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1 },
      uIdentityColor: { value: new THREE.Color(bodyState.color) },
    },
    vertexShader: `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(vec3(1.0), uOpacity);
      }
    `,
  })
  material.userData.simulationBodyId = bodyState.id
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(bodyState.radius, 8, 6), material)
  mesh.position.set(bodyState.position.x, bodyState.position.y, bodyState.position.z)
  return mesh
}

function handoffSnapshots(scene: THREE.Scene) {
  const snapshots: THREE.Mesh[] = []
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.collisionHandoffSnapshot) snapshots.push(object)
  })
  return snapshots
}

function snapshotFor(scene: THREE.Scene, sourceId: string) {
  return handoffSnapshots(scene).find((mesh) => mesh.userData.collisionHandoffSourceId === sourceId)
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
    'all disrupted sources from one retained-result collision must share the same resultId',
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
  assert(transition.resultId === null, 'pure fragmentation must keep resultId=null instead of inventing a remnant')
}

function testRetainedResultCarriesSnapshotByResultTranslation() {
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  const alpha = body('Alpha', 'planet', 1, 0.2, -0.4)
  const beta = body('Beta', 'planet', 1, 0.2, 0.4)
  const alphaMesh = createBodyMesh(alpha)
  const betaMesh = createBodyMesh(beta)
  scene.add(alphaMesh, betaMesh)
  layer.update([alpha, beta], 0)

  scene.remove(alphaMesh, betaMesh)
  const result = body('Alpha+Beta', 'planet', 1.2, 0.24, 0.1)

  // First result frame intentionally has no live result mesh. The BodyState anchor
  // must bridge that reveal gap without falling back to origin/camera/source data.
  layer.update([result], 10)
  const alphaSnapshot = snapshotFor(scene, alpha.id)
  const betaSnapshot = snapshotFor(scene, beta.id)
  assert(alphaSnapshot && betaSnapshot, 'retained-result disruption must create both source snapshots')
  near(alphaSnapshot.position.x, alpha.position.x, 1e-9, 'Alpha snapshot must begin at collision transform')
  near(betaSnapshot.position.x, beta.position.x, 1e-9, 'Beta snapshot must begin at collision transform')

  const bodyStateOnly = { ...result, position: { x: 0.45, y: 0.08, z: 0 } }
  layer.update([bodyStateOnly], 210)
  near(alphaSnapshot.position.x, -0.05, 1e-9, 'snapshot must follow result BodyState while live mesh is unresolved')
  near(alphaSnapshot.position.y, 0.08, 1e-9, 'snapshot must follow result BodyState y translation')

  const resultMesh = createBodyMesh(bodyStateOnly)
  scene.add(resultMesh)
  const beforeMeshResolve = alphaSnapshot.position.clone()
  layer.update([bodyStateOnly], 220)
  near(alphaSnapshot.position.distanceTo(beforeMeshResolve), 0, 1e-9, 'live result mesh resolution must not make the snapshot jump')

  const movedResult = { ...bodyStateOnly, position: { x: 1.25, y: -0.12, z: 0 } }
  resultMesh.position.set(movedResult.position.x, movedResult.position.y, 0)
  const beforeResult = bodyStateOnly.position.x
  const beforeSnapshot = alphaSnapshot.position.x
  layer.update([movedResult], 720)
  const resultStep = movedResult.position.x - beforeResult
  const snapshotStep = alphaSnapshot.position.x - beforeSnapshot
  near(snapshotStep, resultStep, 1e-9, 'snapshot gross translation must match retained result translation')

  near(
    alphaSnapshot.position.x - movedResult.position.x,
    alpha.position.x - result.position.x,
    1e-9,
    'Alpha/result collision-time spatial offset must be preserved',
  )
  near(
    betaSnapshot.position.x - movedResult.position.x,
    beta.position.x - result.position.x,
    1e-9,
    'Beta/result collision-time spatial offset must be preserved',
  )
  assert(
    alphaSnapshot.position.distanceTo(new THREE.Vector3(alpha.position.x, alpha.position.y, 0)) > alpha.radius * 4,
    'moving retained result must not leave a full source snapshot at the collision point',
  )

  layer.update([movedResult], 10 + COLLISION_HANDOFF_DURATION_MS)
  assert(handoffSnapshots(scene).length === 0, 'all retained-result handoff snapshots must be removed at lifecycle completion')
  layer.dispose()
}

function testPureFragmentationUsesMovingFragmentCentroid() {
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  const alpha = body('Alpha', 'planet', 1, 0.2, 0)
  const beta = body('Beta', 'moon', 0.2, 0.1, 0.35)
  const alphaMesh = createBodyMesh(alpha)
  const betaMesh = createBodyMesh(beta)
  scene.add(alphaMesh, betaMesh)
  layer.update([alpha, beta], 0)
  scene.remove(alphaMesh)

  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment', 0.3, 0.08, 0.1)
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment', 0.2, 0.07, 0.2)
  const initialBodies = [beta, fragmentA, fragmentB]
  layer.update(initialBodies, 10)

  const snapshot = snapshotFor(scene, alpha.id)
  assert(snapshot, 'pure fragmentation must still create the early source-surface handoff')
  const initialSnapshot = snapshot.position.clone()
  const initialCentroidX = (fragmentA.position.x * fragmentA.mass + fragmentB.position.x * fragmentB.mass) /
    (fragmentA.mass + fragmentB.mass)

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

  near(snapshot.position.x - initialSnapshot.x, translation.x, 1e-9, 'fragment centroid x translation must carry source handoff')
  near(snapshot.position.y - initialSnapshot.y, translation.y, 1e-9, 'fragment centroid y translation must carry source handoff')
  assert(
    snapshot.position.distanceTo(initialSnapshot) > alpha.radius * 4,
    'pure fragmentation handoff must fail the stationary ghost-sphere pattern at large system translation',
  )

  const movedCentroidX = (
    movedFragmentA.position.x * movedFragmentA.mass + movedFragmentB.position.x * movedFragmentB.mass
  ) / (movedFragmentA.mass + movedFragmentB.mass)
  near(
    snapshot.position.x - movedCentroidX,
    initialSnapshot.x - initialCentroidX,
    1e-9,
    'snapshot/fragment-system separation must not monotonically grow from a stationary source ghost',
  )

  layer.update([beta, movedFragmentA, movedFragmentB], 10 + COLLISION_HANDOFF_DURATION_MS)
  assert(handoffSnapshots(scene).length === 0, 'pure-fragment handoff snapshot must dispose at lifecycle completion')
  layer.dispose()
}

const tests = [
  testDisruptedSourcesShareRetainedResultAssociation,
  testPureFragmentationKeepsExplicitNullResult,
  testRetainedResultCarriesSnapshotByResultTranslation,
  testPureFragmentationUsesMovingFragmentCentroid,
]

for (const test of tests) test()
console.log(`collision handoff anchor regression checks passed (${tests.length})`)
