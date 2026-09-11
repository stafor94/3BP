import * as THREE from 'three'
import {
  COLLISION_HANDOFF_DURATION_MS,
  createCollisionHandoffLayer,
  getCollisionHandoffFractureProgress,
  getCollisionHandoffTransferProgress,
} from '../src/rendering/collisionHandoffLayer'
import {
  DISRUPTION_CHUNK_MAX_COUNT,
  DISRUPTION_CHUNK_MIN_COUNT,
  createDisruptionChunkDescriptors,
  getDisruptionChunkSeparation,
} from '../src/rendering/disruptionChunkVisual'
import {
  findCollisionVisualTransitions,
  getCollisionRemnantVisualLifecycle,
} from '../src/rendering/collisionVisualOutcome'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Disposable = { dispose: () => void }

type ScaleFixtureOptions = {
  label: string
  sourceMass: number
  sourceRadius: number
  partnerMass: number
  partnerRadius: number
  resultMass: number
  resultRadius: number
  fragmentCount: number
  speed?: number
}

function body(
  id: string,
  bodyType: BodyState['bodyType'],
  mass: number,
  radius: number,
  x: number,
  velocityX = 0,
): BodyState {
  return {
    id,
    name: id,
    color: bodyType === 'fragment' ? '#9b7a68' : '#88aaff',
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { x: velocityX, y: 0, z: 0 },
    bodyType,
  }
}

function makeScaleFixture(options: ScaleFixtureOptions) {
  const source = body(
    `${options.label}-source`,
    'planet',
    options.sourceMass,
    options.sourceRadius,
    0,
    options.speed ?? 0,
  )
  const partner = body(
    `${options.label}-partner`,
    'planet',
    options.partnerMass,
    options.partnerRadius,
    options.sourceRadius + options.partnerRadius,
    -(options.speed ?? 0),
  )
  const resultId = `${source.id}+${partner.id}`
  const result = body(
    resultId,
    'planet',
    options.resultMass,
    options.resultRadius,
    options.sourceRadius * 0.15,
    (options.speed ?? 0) * 0.08,
  )
  const fragments = Array.from({ length: options.fragmentCount }, (_, index) => {
    const side = index % 2 === 0 ? 1 : -1
    return body(
      `${resultId}+fragment-${index}`,
      'fragment',
      Math.max(0.01, (options.sourceMass + options.partnerMass - options.resultMass) / options.fragmentCount),
      Math.max(0.008, Math.min(options.sourceRadius, options.partnerRadius) * (0.22 - (index % 3) * 0.035)),
      result.position.x + side * (0.025 + index * 0.009),
      side * (0.12 + index * 0.03),
    )
  })
  const previous = [source, partner]
  const current = [result, ...fragments]
  const transitions = findCollisionVisualTransitions(previous, current)
  const disrupted = transitions.filter((transition) => transition.outcome === 'disrupted')
  assert(disrupted.length === 2, `${options.label}: both solid sources must classify as disrupted`)
  return { source, partner, result, fragments, previous, current, disrupted }
}

function presentationChildren(scene: THREE.Scene) {
  return scene.children.filter((child) =>
    child.userData.collisionVisualTransfer === true ||
    child.userData.collisionVisualSolidChunks === true,
  )
}

function trackDisposal(resource: Disposable) {
  const original = resource.dispose.bind(resource)
  let count = 0
  resource.dispose = () => {
    count += 1
    original()
  }
  return () => count
}

function testRepeatedCollisionCleanupDoesNotAccumulateStateOrResources() {
  const scene = new THREE.Scene()
  const layer = createCollisionHandoffLayer(scene)
  let stableBodies: BodyState[] = []
  let sharedGeometry: THREE.BufferGeometry | null = null
  let sharedGeometryDisposeCount = 0
  const completedSourceIds: string[] = []

  for (let cycle = 0; cycle < 4; cycle += 1) {
    const fixture = makeScaleFixture({
      label: `repeat-${cycle}`,
      sourceMass: 1 + cycle * 0.15,
      sourceRadius: 0.22 + cycle * 0.025,
      partnerMass: 0.9 + cycle * 0.1,
      partnerRadius: 0.20 + cycle * 0.02,
      resultMass: 1.12 + cycle * 0.12,
      resultRadius: 0.24 + cycle * 0.02,
      fragmentCount: 3 + cycle,
      speed: 0.5 + cycle * 0.4,
    })
    const before = [...stableBodies, ...fixture.previous]
    const after = [...stableBodies, ...fixture.current]
    const startedAt = cycle * (COLLISION_HANDOFF_DURATION_MS + 5000)

    layer.update(before, startedAt)
    layer.update(after, startedAt + 1)

    const sourceIds = new Set(fixture.previous.map((candidate) => candidate.id))
    const children = presentationChildren(scene)
    const points = children.filter((child) => child instanceof THREE.Points)
    const chunks = children.filter((child) => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh[]

    assert(points.length === 2, `cycle ${cycle}: Points transfer layers must not accumulate`)
    assert(chunks.length === 2, `cycle ${cycle}: solid chunk InstancedMesh layers must not accumulate`)
    assert(
      children.every((child) => sourceIds.has(String(child.userData.collisionVisualSourceId))),
      `cycle ${cycle}: stale source id leaked into the next collision`,
    )
    assert(
      children.every((child) => child.userData.collisionVisualResultId === fixture.result.id),
      `cycle ${cycle}: stale result id leaked into the next collision`,
    )
    assert(
      fixture.previous.every((candidate) => layer.getState(candidate.id)?.lifecycle.phase === 'IMPACT'),
      `cycle ${cycle}: previous collision phase state affected the new collision`,
    )

    const cycleGeometry = chunks[0]?.geometry
    assert(cycleGeometry, `cycle ${cycle}: chunk geometry is missing`)
    assert(
      chunks.every((chunk) => chunk.geometry === cycleGeometry),
      `cycle ${cycle}: solid chunks must share one geometry`,
    )
    if (!sharedGeometry) {
      sharedGeometry = cycleGeometry
      const originalDispose = sharedGeometry.dispose.bind(sharedGeometry)
      sharedGeometry.dispose = () => {
        sharedGeometryDisposeCount += 1
        originalDispose()
      }
    } else {
      assert(cycleGeometry === sharedGeometry, 'repeated collisions must reuse the layer shared chunk geometry')
    }
    assert(sharedGeometryDisposeCount === 0, 'shared chunk geometry must stay alive between collisions')

    const disposalCounts = children.flatMap((child) => {
      if (child instanceof THREE.Points) {
        const material = child.material as THREE.ShaderMaterial
        return [trackDisposal(child.geometry), trackDisposal(material)]
      }
      if (child instanceof THREE.InstancedMesh) {
        const material = child.material as THREE.MeshStandardMaterial
        return [trackDisposal(material)]
      }
      return []
    })

    layer.update(after, startedAt + 1 + COLLISION_HANDOFF_DURATION_MS)
    assert(presentationChildren(scene).length === 0, `cycle ${cycle}: completed presentation objects must be zero`)
    fixture.previous.forEach((candidate) => {
      assert(layer.getState(candidate.id) === null, `cycle ${cycle}: completed active visual entry must be removed`)
      completedSourceIds.push(candidate.id)
    })
    disposalCounts.forEach((getCount) => {
      assert(getCount() === 1, `cycle ${cycle}: per-collision geometry/material must dispose exactly once`)
    })
    assert(sharedGeometryDisposeCount === 0, 'shared chunk geometry must not dispose during per-collision cleanup')

    layer.update(after, startedAt + 1 + COLLISION_HANDOFF_DURATION_MS + 50)
    assert(
      presentationChildren(scene).every((child) => !completedSourceIds.includes(String(child.userData.collisionVisualSourceId))),
      `cycle ${cycle}: completed source visual reappeared`,
    )
    stableBodies = after
  }

  layer.dispose()
  assert(presentationChildren(scene).length === 0, 'dispose must leave zero collision presentation objects')
  assert(sharedGeometryDisposeCount === 1, 'shared chunk geometry must dispose exactly once with the layer')
}

function testDisruptionScaleDiversityRemainsWorldSpaceAndBounded() {
  const cases = [
    makeScaleFixture({
      label: 'similar-planets',
      sourceMass: 1.0,
      sourceRadius: 0.28,
      partnerMass: 0.95,
      partnerRadius: 0.26,
      resultMass: 1.2,
      resultRadius: 0.30,
      fragmentCount: 3,
      speed: 0.8,
    }),
    makeScaleFixture({
      label: 'unequal-solids',
      sourceMass: 4.0,
      sourceRadius: 0.62,
      partnerMass: 0.30,
      partnerRadius: 0.045,
      resultMass: 2.75,
      resultRadius: 0.48,
      fragmentCount: 4,
      speed: 1.4,
    }),
    makeScaleFixture({
      label: 'small-remnant-many-fragments',
      sourceMass: 0.72,
      sourceRadius: 0.14,
      partnerMass: 0.64,
      partnerRadius: 0.11,
      resultMass: 0.30,
      resultRadius: 0.052,
      fragmentCount: 8,
      speed: 2.2,
    }),
    makeScaleFixture({
      label: 'high-energy',
      sourceMass: 1.4,
      sourceRadius: 0.34,
      partnerMass: 1.1,
      partnerRadius: 0.31,
      resultMass: 1.0,
      resultRadius: 0.24,
      fragmentCount: 6,
      speed: 8.0,
    }),
  ]

  for (const fixture of cases) {
    for (const transition of fixture.disrupted) {
      const source = transition.source
      const sourceRadius = Math.max(Math.abs(source.radius), 0.005)
      const descriptors = createDisruptionChunkDescriptors(source, transition)
      assert(
        descriptors.length >= DISRUPTION_CHUNK_MIN_COUNT && descriptors.length <= DISRUPTION_CHUNK_MAX_COUNT,
        `${fixture.result.id}: chunk count must stay bounded`,
      )

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
      const sourceCenter = new THREE.Vector3(source.position.x, source.position.y, source.position.z)
      const normalizedSizes: number[] = []

      descriptors.forEach((descriptor) => {
        const facingDistance = descriptor.initialCenter.clone().sub(sourceCenter).dot(contactNormal)
        assert(
          descriptor.initialCenter.distanceTo(contactPoint) <= sourceRadius * 0.36,
          `${source.id}: chunks must remain inside the contact-local cap`,
        )
        assert(
          facingDistance >= sourceRadius * 0.72,
          `${source.id}: chunks must remain on the contact-facing hemisphere`,
        )
        const maxAxis = Math.max(descriptor.scale.x, descriptor.scale.y, descriptor.scale.z)
        const minAxis = Math.min(descriptor.scale.x, descriptor.scale.y, descriptor.scale.z)
        assert(maxAxis <= sourceRadius * 0.23, `${source.id}: tiny bodies must not receive oversized chunks`)
        assert(minAxis >= sourceRadius * 0.045, `${source.id}: large-body chunks must not collapse into point-sized debris`)
        normalizedSizes.push(descriptor.scale.length() / sourceRadius)

        const transferSeparation = getDisruptionChunkSeparation(
          descriptor,
          sourceRadius,
          getCollisionHandoffFractureProgress(1500),
          getCollisionHandoffTransferProgress(1500),
        )
        assert(
          transferSeparation <= sourceRadius * 1.5,
          `${source.id}: high-energy input must not make presentation scale explode`,
        )
      })

      const meanNormalizedSize = normalizedSizes.reduce((sum, value) => sum + value, 0) / normalizedSizes.length
      assert(
        meanNormalizedSize >= 0.09 && meanNormalizedSize <= 0.30,
        `${source.id}: chunk size must stay proportional to source radius`,
      )
    }

    const scene = new THREE.Scene()
    const layer = createCollisionHandoffLayer(scene)
    layer.update(fixture.previous, 100)
    layer.update(fixture.current, 101)
    assert(
      !presentationChildren(scene).some((child) =>
        child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh),
      ),
      `${fixture.result.id}: multi-scale disruption must not reintroduce a full-body source mesh`,
    )
    layer.update(fixture.current, 101 + COLLISION_HANDOFF_DURATION_MS)
    assert(presentationChildren(scene).length === 0, `${fixture.result.id}: lifecycle must complete cleanly`)
    layer.dispose()
  }

  assert(getCollisionRemnantVisualLifecycle(1200).phase === 'FORMING', 'remnant must still form during transfer')
  assert(getCollisionRemnantVisualLifecycle(2200).phase === 'SETTLING', 'remnant must still settle after transfer')
  assert(getCollisionRemnantVisualLifecycle(COLLISION_HANDOFF_DURATION_MS).phase === 'STABLE', 'remnant must return to stable')
}

function testChunkDimensionsScaleLinearlyWithSourceRadius() {
  const small = makeScaleFixture({
    label: 'radius-probe',
    sourceMass: 1,
    sourceRadius: 0.08,
    partnerMass: 0.9,
    partnerRadius: 0.06,
    resultMass: 1.1,
    resultRadius: 0.09,
    fragmentCount: 3,
  })
  const large = makeScaleFixture({
    label: 'radius-probe',
    sourceMass: 1,
    sourceRadius: 0.64,
    partnerMass: 0.9,
    partnerRadius: 0.48,
    resultMass: 1.1,
    resultRadius: 0.72,
    fragmentCount: 3,
  })
  const smallTransition = small.disrupted.find((transition) => transition.source.id === small.source.id)
  const largeTransition = large.disrupted.find((transition) => transition.source.id === large.source.id)
  assert(smallTransition && largeTransition, 'radius probe transitions must exist')
  const smallDescriptors = createDisruptionChunkDescriptors(smallTransition.source, smallTransition)
  const largeDescriptors = createDisruptionChunkDescriptors(largeTransition.source, largeTransition)
  const radiusRatio = large.source.radius / small.source.radius

  assert(smallDescriptors.length === largeDescriptors.length, 'same deterministic id must preserve chunk count across scale')
  smallDescriptors.forEach((descriptor, index) => {
    const largeDescriptor = largeDescriptors[index]
    const scaleRatio = largeDescriptor.scale.length() / descriptor.scale.length()
    assert(
      Math.abs(scaleRatio - radiusRatio) <= 1e-10,
      'chunk dimensions must scale linearly with source radius',
    )
  })
}

const tests = [
  testRepeatedCollisionCleanupDoesNotAccumulateStateOrResources,
  testDisruptionScaleDiversityRemainsWorldSpaceAndBounded,
  testChunkDimensionsScaleLinearlyWithSourceRadius,
]

for (const test of tests) test()
console.log(`collision VFX hardening regression checks passed (${tests.length})`)
