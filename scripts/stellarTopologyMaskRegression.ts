import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import { stellarCollisionFixture } from '../src/visualRegression/StellarCollisionContinuityHarness'
import { createStellarCollisionEnvelopeLayer, getMergedEnvelopeShape } from '../src/rendering/stellarCollisionEnvelope'
import type { BodyState } from '../src/types'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
for (const kind of ['oblique', 'head-on', 'partial', 'hit-run']) {
  let bodies = stellarCollisionFixture(kind)
  const initialMass = bodies.reduce((s, b) => s + b.mass, 0)
  const scene = new THREE.Scene()
  const layer = createStellarCollisionEnvelopeLayer(scene)
  let contact = false, resolved = false
  let last: ReturnType<typeof getMergedEnvelopeShape> | null = null
  let greatestStep = 0
  for (let i = 0; i < 430; i++) {
    bodies = stepBodies(bodies, 0.0005)
    layer.update(bodies, i * 0.0005)
    const stars = bodies.filter((b) => b.bodyType === 'star')
    const state = stars[0]?.stellarCollisionPresentation
    if (state?.phase === 'contact') contact = true
    if (state?.phase === 'settle') resolved = true
    if (state?.outcome === 'merge') {
      const shape = getMergedEnvelopeShape(state, state.phase === 'settle' ? stars[0] : undefined)
      if (last) {
        const size = Math.max(shape.max - shape.min, last.max - last.min)
        const step = Math.max(Math.abs(shape.min - last.min), Math.abs(shape.max - last.max)) / size
        greatestStep = Math.max(greatestStep, step)
        assert(step < 0.12, `${kind}: silhouette endpoint discontinuity ${step}`)
      }
      last = shape
    }
    const snapshot = JSON.stringify(bodies)
    const mesh = scene.getObjectByName('stellar-collision-envelopes')!
    const positions = new Map<THREE.BufferGeometry, number[]>()
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && !positions.has(o.geometry)) {
        const p = Array.from(o.geometry.attributes.position.array) as number[]
        assert(p.every(Number.isFinite), 'envelope vertices must be finite')
        assert(Array.from(o.geometry.attributes.normal.array).every(Number.isFinite), 'deformed normals must be finite')
        positions.set(o.geometry, p)
      }
    })
    layer.update(bodies, i * 0.0005)
    positions.forEach((before, geometry) => {
      const after = geometry.attributes.position.array
      assert(before.length === after.length && before.every((value, index) => value === after[index]), 'paused mesh must be byte-identical')
    })
    assert(JSON.stringify(bodies) === snapshot, 'renderer must not mutate physical state')
    if (state?.phase === 'settle' && (kind === 'partial' || kind === 'hit-run')) {
      assert(stars.length === 2, `${kind}: both survivors must remain`)
      assert(mesh.children.length === 2, `${kind}: independent external surfaces required`)
    }
  }
  assert(contact && resolved, `${kind}: production contact and resolution both exercised`)
  assert(Math.abs(bodies.reduce((s, b) => s + b.mass, 0) - initialMass) < 1e-8, 'mass conservation')
  layer.dispose()
  assert(scene.children.length === 0, 'dispose must remove every envelope')
  console.log(`${kind}: shared state, finite normals, pause, survivors, mass; maximum endpoint step=${greatestStep}`)
}
const owner = readFileSync('src/rendering/liveCollisionVfxBridge.ts', 'utf8')
assert(!owner.includes('createStellarTopologyOcclusionLayer('), 'production must not instantiate the legacy white veil')
assert(!owner.includes('createStellarImpactBurstLayer('), 'production must not instantiate bilateral shock spikes')
assert(!readFileSync('src/rendering/bodyLighting.ts', 'utf8').includes('createCollisionEffectsLayer'), 'lighting must not own a duplicate VFX layer')
console.log('stellar envelope topology regression passed')
