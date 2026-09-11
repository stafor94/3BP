import * as THREE from 'three'
import {
  COLLISION_FRACTURE_END_MS,
  COLLISION_HANDOFF_DURATION_MS,
  COLLISION_IMPACT_HOLD_END_MS,
  COLLISION_TRANSFER_END_MS,
  createCollisionHandoffLayer,
  findCollisionAbsorptionSources,
  findCollisionHandoffSources,
  getCollisionHandoffFractureProgress,
  getCollisionHandoffParticleProgress,
  getCollisionHandoffProgress,
  getCollisionHandoffTransferProgress,
  getCollisionTransferParticleOpacity,
} from '../src/rendering/collisionHandoffLayer'
import {
  DISRUPTION_CHUNK_MAX_COUNT,
  DISRUPTION_CHUNK_MIN_COUNT,
  createDisruptionChunkDescriptors,
  getDisruptionChunkOpacity,
  getDisruptionChunkSeparation,
} from '../src/rendering/disruptionChunkVisual'
import {
  COLLISION_REMNANT_FORMATION_START_MS,
  COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD,
  findCollisionVisualTransitions,
  getCollisionRemnantVisualLifecycle,
  getCollisionVisualLifecycle,
} from '../src/rendering/collisionVisualOutcome'
import {
  COLLISION_REMNANT_CORE_SCALE_MAX,
  MERGED_SURVIVOR_SETTLE_DURATION_MS,
  SURVIVOR_IMPACT_DURATION_MS,
  SURVIVOR_IMPACT_MAX_SURFACE_FRACTION,
  SURVIVOR_IMPACT_MIN_DOT,
  getCollisionRemnantRevealOpacity,
  getCollisionRemnantRevealScale,
  getMergedSurvivorRevealScale,
  getSurvivorImpactEnvelope,
} from '../src/rendering/liveCollisionVfxBridge'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function body(
  id: string,
  bodyType: BodyState['bodyType'] = 'planet',
  mass = bodyType === 'effect' ? 0 : 1,
  x = 0,
): BodyState {
  return {
    id,
    name: id,
    color: '#88aaff',
    mass,
    radius: mass < 0.2 ? 0.08 : 0.2,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function makeDisruptionFixture() {
  const alpha = body('Alpha', 'planet', 1, -0.2)
  const beta = body('Beta', 'planet', 1, 0.2)
  const remnant = body('Alpha+Beta', 'planet', 1.18, 0)
  const fragmentA = body('Alpha+Beta+frag1-0', 'fragment', 0.45, -0.05)
  const fragmentB = body('Alpha+Beta+frag1-1', 'fragment', 0.37, 0.06)
  const previous = [alpha, beta]
  const current = [remnant, fragmentA, fragmentB]
  const transition = findCollisionVisualTransitions(previous, current)
    .find((candidate) => candidate.source.id === alpha.id)
  assert(transition?.outcome === 'disrupted', 'fixture must classify Alpha as disrupted')
  return { alpha, beta, remnant, fragmentA, fragmentB, previous, current, transition }
}

function testVisualLifecycleUsesExplicitPhases() {
  assert(getCollisionVisualLifecycle(0).phase === 'IMPACT', 'collision must begin in IMPACT')
  assert(
    getCollisionVisualLifecycle(COLLISION_IMPACT_HOLD_END_MS).phase === 'FRACTURE',
    'impact boundary must enter FRACTURE',
  )
  assert(
    getCollisionVisualLifecycle(COLLISION_FRACTURE_END_MS).phase === 'TRANSFER',
    'fracture boundary must enter TRANSFER',
  )
  assert(
    getCollisionVisualLifecycle(COLLISION_TRANSFER_END_MS).phase === 'REMNANT_SETTLE',
    'transfer boundary must enter REMNANT_SETTLE',
  )
  const completed = getCollisionVisualLifecycle(COLLISION_HANDOFF_DURATION_MS)
  assert(completed.phase === 'REMNANT_SETTLE' && completed.isComplete, 'handoff must complete in remnant settle')
}

function testHandoffProgressRemainsSmoothAndBounded() {
  assert(getCollisionHandoffProgress(-100) === 0, 'handoff progress must clamp before start')
  const midpoint = getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS / 2)
  assert(midpoint > 0.45 && midpoint < 0.55, 'handoff midpoint must remain near smoothstep midpoint')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS) === 1, 'handoff must finish on time')
  assert(getCollisionHandoffProgress(COLLISION_HANDOFF_DURATION_MS * 2) === 1, 'handoff must clamp after completion')
}

function testSourceTransferUsesFractureThenTransferData() {
  assert(getCollisionHandoffFractureProgress(COLLISION_IMPACT_HOLD_END_MS) === 0, 'fracture data starts after impact')
  assert(getCollisionHandoffFractureProgress(700) > 0, 'fracture progress must become available during FRACTURE')
  assert(getCollisionHandoffTransferProgress(COLLISION_FRACTURE_END_MS) === 0, 'transfer must wait for fracture boundary')
  assert(getCollisionHandoffTransferProgress(1500) > 0, 'transfer progress must advance after fracture')
  assert(getCollisionHandoffTransferProgress(COLLISION_TRANSFER_END_MS) === 1, 'transfer must complete at phase boundary')
  assert(getCollisionHandoffParticleProgress(COLLISION_IMPACT_HOLD_END_MS) === 0, 'particle transfer must not pre-empt impact')
  assert(getCollisionTransferParticleOpacity(700) > 0, 'fracture phase must expose transfer particles')
  assert(getCollisionTransferParticleOpacity(COLLISION_HANDOFF_DURATION_MS) === 0, 'transfer particles must dispose visually at completion')
}

function testDisruptionChunksStayContactLocalAndDeterministic() {
  const { alpha, transition } = makeDisruptionFixture()
  const chunks = createDisruptionChunkDescriptors(alpha, transition)
  const repeated = createDisruptionChunkDescriptors(alpha, transition)
  assert(
    chunks.length >= DISRUPTION_CHUNK_MIN_COUNT && chunks.length <= DISRUPTION_CHUNK_MAX_COUNT,
    'disrupted source must create a bounded medium/large chunk cluster',
  )
  assert(chunks.some((chunk) => chunk.isLarge), 'chunk cluster must include large solid debris')
  assert(chunks.some((chunk) => !chunk.isLarge), 'chunk cluster must include medium solid debris')
  assert(repeated.length === chunks.length, 'deterministic seed must preserve chunk count')

  const contactPoint = new THREE.Vector3(
    transition.contactPoint.x,
    transition.contactPoint.y,
    transition.contactPoint.z,
  )
  const contactNormal = new THREE.Vector3(
    transition.contactNormal.x,
    transition.contactNormal.y,
    transition.contactNormal.z,
  ).normalize()
  const sourceCenter = new THREE.Vector3(alpha.position.x, alpha.position.y, alpha.position.z)
  chunks.forEach((chunk, index) => {
    assert(
      chunk.initialCenter.distanceTo(contactPoint) <= alpha.radius * 0.36,
      'solid chunk must begin inside the contact-local cap instead of across the source body',
    )
    const facingDistance = chunk.initialCenter.clone().sub(sourceCenter).dot(contactNormal)
    assert(
      facingDistance >= alpha.radius * 0.72,
      'solid chunk must not originate on the opposite hemisphere',
    )
    assert(
      chunk.initialCenter.distanceTo(repeated[index].initialCenter) <= 1e-12 &&
        chunk.direction.distanceTo(repeated[index].direction) <= 1e-12,
      'solid chunk placement and direction must remain deterministic',
    )
  })
}

function testDisruptionChunkSeparationGrowsFromFractureIntoTransfer() {
  const { alpha, transition } = makeDisruptionFixture()
  const chunks = createDisruptionChunkDescriptors(alpha, transition)
  const meanSeparationAt = (elapsedMs: number) => {
    const lifecycle = getCollisionVisualLifecycle(elapsedMs)
    const fractureProgress = getCollisionHandoffFractureProgress(elapsedMs)
    const transferProgress = getCollisionHandoffTransferProgress(elapsedMs)
    const settleProgress = lifecycle.phase === 'REMNANT_SETTLE' ? lifecycle.phaseProgress : 0
    return chunks.reduce((sum, chunk) => sum + getDisruptionChunkSeparation(
      chunk,
      alpha.radius,
      fractureProgress,
      transferProgress,
      settleProgress,
    ), 0) / chunks.length
  }

  const earlyFracture = meanSeparationAt(360)
  const lateFracture = meanSeparationAt(880)
  const transfer = meanSeparationAt(1500)
  assert(lateFracture > earlyFracture + alpha.radius * 0.02, 'chunk separation must grow through FRACTURE')
  assert(transfer > lateFracture + alpha.radius * 0.02, 'chunk separation must keep growing through TRANSFER')

  const impactOpacity = getDisruptionChunkOpacity(getCollisionVisualLifecycle(120))
  const fractureOpacity = getDisruptionChunkOpacity(getCollisionVisualLifecycle(700))
  const settleOpacity = getDisruptionChunkOpacity(getCollisionVisualLifecycle(2350))
  assert(impactOpacity > 0 && fractureOpacity > impactOpacity, 'solid mass must remain visible as fracture begins')
  assert(settleOpacity < fractureOpacity, 'synthetic chunks must hand visual ownership off during settle')
  assert(
    getDisruptionChunkOpacity(getCollisionVisualLifecycle(COLLISION_HANDOFF_DURATION_MS)) === 0,
    'solid chunks must be fully invisible at handoff completion',
  )
}

function testRuntimeChunkLayerUsesInstancingAnchorAndCleanup() {
  const { alpha, previous, current } = makeDisruptionFixture()
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  layer.update(previous, 100)
  layer.update(current, 101)

  const chunkMesh = scene.children.find((child) =>
    child instanceof THREE.InstancedMesh &&
    child.userData.collisionVisualSolidChunks === true &&
    child.userData.collisionVisualSourceId === alpha.id,
  ) as THREE.InstancedMesh | undefined
  assert(chunkMesh instanceof THREE.InstancedMesh, 'FRACTURE handoff must own a solid InstancedMesh chunk layer')
  assert(
    chunkMesh.count >= DISRUPTION_CHUNK_MIN_COUNT && chunkMesh.count <= DISRUPTION_CHUNK_MAX_COUNT,
    'runtime chunk layer must retain the bounded deterministic instance count',
  )
  assert(
    scene.children.some((child) =>
      child instanceof THREE.Points &&
      child.userData.collisionVisualSourceId === alpha.id,
    ),
    'solid chunks must coexist with the existing fine particle transfer',
  )
  assert(
    chunkMesh.geometry.type === 'IcosahedronGeometry',
    'solid breakup must use local low-poly chunks rather than a cloned source sphere',
  )

  const moved = current.map((candidate) => ({
    ...candidate,
    position: {
      ...candidate.position,
      y: candidate.position.y + 0.6,
    },
  }))
  layer.update(moved, 1501)
  assert(chunkMesh.userData.collisionVisualPhase === 'TRANSFER', 'solid chunk layer must follow the shared visual lifecycle')
  assert(
    Math.abs(chunkMesh.position.y - 0.6) <= 1e-9,
    'moving disrupted chunks must reuse result-anchor delta instead of staying at impact coordinates',
  )

  layer.dispose()
  assert(
    !scene.children.some((child) => child.userData.collisionVisualSolidChunks === true),
    'disposing the handoff layer must remove all solid chunk instances from the scene',
  )
}

function testAbsorptionDoesNotCreateSolidDisruptionChunks() {
  const primary = body('Primary', 'planet', 1, 0)
  const impactor = body('Impactor', 'moon', 0.08, 0.28)
  const remnant = body('Primary+Impactor', 'planet', 1.04, 0.01)
  const debris = body('Primary+Impactor+frag1-0', 'fragment', 0.04, 0.25)
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  layer.update([primary, impactor], 100)
  layer.update([remnant, debris], 101)
  assert(
    !scene.children.some((child) => child.userData.collisionVisualSolidChunks === true),
    'absorbed sources must keep the existing particle-only sink/transfer path',
  )
  layer.dispose()
}

function testRemnantLifecycleIsIndependentAndGradual() {
  const hidden = getCollisionRemnantVisualLifecycle(COLLISION_REMNANT_FORMATION_START_MS)
  assert(hidden.phase === 'FORMING' && hidden.formationProgress === 0, 'remnant formation must have an explicit pre-reveal state')
  const forming = getCollisionRemnantVisualLifecycle(1200)
  assert(forming.phase === 'FORMING' && forming.formationProgress > 0 && forming.formationProgress < 1, 'remnant must expose a formation phase')
  const settling = getCollisionRemnantVisualLifecycle(COLLISION_TRANSFER_END_MS + 200)
  assert(settling.phase === 'SETTLING' && settling.settleProgress > 0, 'remnant must expose a settle phase')
  assert(getCollisionRemnantVisualLifecycle(COLLISION_HANDOFF_DURATION_MS).phase === 'STABLE', 'remnant lifecycle must end stable')

  const startScale = getCollisionRemnantRevealScale(COLLISION_REMNANT_FORMATION_START_MS, 0.5)
  const middleScale = getCollisionRemnantRevealScale(1500, 0.5)
  const endScale = getCollisionRemnantRevealScale(COLLISION_HANDOFF_DURATION_MS, 0.5)
  assert(startScale <= COLLISION_REMNANT_CORE_SCALE_MAX, 'new remnant must begin as a core instead of a near-full sphere')
  assert(middleScale > startScale && middleScale < 1, 'remnant must grow during formation')
  assert(endScale === 1, 'remnant must reach final visual scale only after settling')
  assert(getCollisionRemnantRevealOpacity(COLLISION_REMNANT_FORMATION_START_MS) === 0, 'remnant must not be opaque before formation begins')
}

function testSurvivorAbsorptionClassificationIsUnchanged() {
  const primary = body('Primary', 'planet', 1, 0)
  const impactor = body('Impactor', 'moon', 0.08, 0.28)
  const remnant = body('Primary+Impactor', 'planet', 1.04, 0.01)
  const debris = body('Primary+Impactor+frag1-0', 'fragment', 0.04, 0.25)
  const previous = [primary, impactor]
  const current = [remnant, debris]
  const transitions = findCollisionVisualTransitions(previous, current)

  assert(findCollisionHandoffSources(previous, current).length === 0, 'ordinary merge must not become disruption')
  const survivor = transitions.find((transition) => transition.source.id === primary.id)
  const absorbed = transitions.find((transition) => transition.source.id === impactor.id)
  assert(survivor?.outcome === 'merged-survivor', 'dominant body must remain merged-survivor')
  assert(absorbed?.outcome === 'absorbed', 'small impactor must remain absorbed')
  assert(
    findCollisionAbsorptionSources(previous, current).map((candidate) => candidate.id).join(',') === impactor.id,
    'only the small impactor may use source transfer',
  )
}

function testActualDisruptionClassificationIsUnchanged() {
  const { alpha, beta, current } = makeDisruptionFixture()
  const retired = findCollisionHandoffSources([alpha, beta], current)
  assert(retired.length === 2, 'actual disruption must still classify both originals')
}

function testLineageChangeAloneIsNotDestructionEvidence() {
  const alpha = body('Alpha', 'planet', 1, -0.2)
  const beta = body('Beta', 'moon', 0.2, 0.2)
  const remnant = body('Alpha+Beta', 'planet', 1.12, 0)
  assert(
    findCollisionHandoffSources([alpha, beta], [remnant]).length === 0,
    'lineage-only replacement must not imply destruction',
  )
}

function testOutcomeThresholdStaysInsidePhysicsClassifierGap() {
  assert(
    COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD > 0.13 &&
      COLLISION_VISUAL_DISRUPTION_MASS_LOSS_THRESHOLD < 0.22,
    'visual disruption threshold must remain inside the core classifier gap',
  )
}

function testFragmentOnlyDisruptionStillCreatesTransition() {
  const alpha = body('Alpha', 'planet', 1, 0)
  const beta = body('Beta', 'moon', 0.2, 0.25)
  const fragmentA = body('Alpha+Beta+fragment-0', 'fragment', 0.21, 0.04)
  const fragmentB = body('Alpha+Beta+fragment-1', 'fragment', 0.13, -0.06)
  const retired = findCollisionHandoffSources([alpha, beta], [beta, fragmentA, fragmentB])
  assert(retired.length === 1 && retired[0].id === alpha.id, 'fragment-only destruction must still retire the missing source')
}

function testStellarAndTransientBodiesStayOffGenericSourceTransfer() {
  const starA = body('Alpha', 'star', 1, -0.2)
  const starB = body('Beta', 'star', 1, 0.2)
  const stellarRemnant = body('Alpha+Beta', 'star', 1.9, 0)
  assert(findCollisionHandoffSources([starA, starB], [stellarRemnant]).length === 0, 'stellar merges stay on dedicated path')

  const fragment = body('Alpha+Beta+fragment-0', 'fragment')
  const effect = body('Alpha+Beta+flash', 'effect')
  const descendant = body('Alpha+Beta+fragment-0+Gamma', 'fragment')
  assert(findCollisionHandoffSources([fragment, effect], [descendant]).length === 0, 'transient cleanup must not become celestial handoff')
}

function testMergedSurvivorStillSettlesFromInheritedSilhouette() {
  assert(SURVIVOR_IMPACT_DURATION_MS === 1500, 'survivor impact envelope must remain unchanged')
  assert(MERGED_SURVIVOR_SETTLE_DURATION_MS === 1700, 'merged survivor settle window must remain unchanged')
  assert(SURVIVOR_IMPACT_MIN_DOT >= 0.76, 'impact cap must remain local')
  assert(SURVIVOR_IMPACT_MAX_SURFACE_FRACTION >= 0.05 && SURVIVOR_IMPACT_MAX_SURFACE_FRACTION <= 0.12, 'impact cap surface fraction must remain bounded')
  assert(getSurvivorImpactEnvelope(1500).heat === 0, 'survivor impact heat must settle')

  const startScale = getMergedSurvivorRevealScale(0, 0.2, 0.25)
  const middleScale = getMergedSurvivorRevealScale(MERGED_SURVIVOR_SETTLE_DURATION_MS / 2, 0.2, 0.25)
  const endScale = getMergedSurvivorRevealScale(MERGED_SURVIVOR_SETTLE_DURATION_MS, 0.2, 0.25)
  assert(Math.abs(startScale - 0.8) < 1e-12, 'merged survivor must inherit dominant silhouette')
  assert(middleScale > startScale && middleScale < 1, 'merged survivor must settle gradually')
  assert(endScale === 1, 'merged survivor must reach final scale at settle end')
}

const tests = [
  testVisualLifecycleUsesExplicitPhases,
  testHandoffProgressRemainsSmoothAndBounded,
  testSourceTransferUsesFractureThenTransferData,
  testDisruptionChunksStayContactLocalAndDeterministic,
  testDisruptionChunkSeparationGrowsFromFractureIntoTransfer,
  testRuntimeChunkLayerUsesInstancingAnchorAndCleanup,
  testAbsorptionDoesNotCreateSolidDisruptionChunks,
  testRemnantLifecycleIsIndependentAndGradual,
  testSurvivorAbsorptionClassificationIsUnchanged,
  testActualDisruptionClassificationIsUnchanged,
  testLineageChangeAloneIsNotDestructionEvidence,
  testOutcomeThresholdStaysInsidePhysicsClassifierGap,
  testFragmentOnlyDisruptionStillCreatesTransition,
  testStellarAndTransientBodiesStayOffGenericSourceTransfer,
  testMergedSurvivorStillSettlesFromInheritedSilhouette,
]

for (const test of tests) test()
console.log(`collision handoff regression checks passed (${tests.length})`)
