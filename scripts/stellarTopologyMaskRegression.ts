import * as THREE from 'three'
import {
  createStellarTopologyOcclusionLayer,
  getStellarTopologyOcclusionPairs,
} from '../src/rendering/stellarTopologyOccluder'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeStar(id: string, x: number, color: string): BodyState {
  return {
    id,
    name: id,
    color,
    mass: 1,
    radius: 0.3,
    position: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
}

function angleDistance(a: number, b: number) {
  let delta = (a - b) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return Math.abs(delta)
}

function testOccluderActuallyCoversBothSourceStars() {
  const a = makeStar('topology-occlusion-a', -0.246, '#ff8b78')
  const b = makeStar('topology-occlusion-b', 0.246, '#f4f7ff')
  const pairs = getStellarTopologyOcclusionPairs([a, b])

  assert(pairs.length === 1, 'deep stellar overlap must create one occlusion pair')
  const pair = pairs[0]
  assert(pair.overlapRatio >= 0.35, 'test pair must reach the merge compression plateau')
  assert(pair.maskBuild >= 0.99, 'peak overlap must fully build the topology veil')

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)

  const layer = createStellarTopologyOcclusionLayer(scene)
  layer.update([a, b], camera, 1000)

  const group = scene.getObjectByName('stellar-topology-occluder')
  assert(group instanceof THREE.Group, 'topology occluder group must be installed')

  const veil = group.getObjectByName(`topology-occluder:${pair.key}:veil`)
  const shock = group.getObjectByName(`topology-occluder:${pair.key}:shock`)
  const plasmaA = group.getObjectByName(`topology-occluder:${pair.key}:plasmaA`)
  const plasmaB = group.getObjectByName(`topology-occluder:${pair.key}:plasmaB`)
  assert(veil instanceof THREE.Sprite, 'topology handoff must render a veil sprite')
  assert(shock instanceof THREE.Sprite, 'topology handoff must render a shock sprite')
  assert(plasmaA instanceof THREE.Sprite && plasmaB instanceof THREE.Sprite,
    'topology handoff must render bilateral plasma sprites')

  assert(
    veil.material instanceof THREE.SpriteMaterial &&
      veil.material.blending === THREE.NormalBlending,
    'the topology veil must alpha-occlude source silhouettes instead of only adding light',
  )
  assert(
    veil.scale.x >= pair.longitudinalSpan * 1.08,
    `veil must cover the full two-star span along collision normal; got ${veil.scale.x}`,
  )
  assert(
    veil.scale.y >= pair.transverseSpan * 1.1,
    `veil must cover both stellar diameters across the handoff; got ${veil.scale.y}`,
  )

  assert(veil.material instanceof THREE.SpriteMaterial, 'veil must expose sprite material state')
  assert(
    angleDistance(veil.material.rotation, 0) < 1e-6,
    `horizontal collision must orient veil long axis along collision normal; got ${veil.material.rotation}`,
  )
  assert(shock.material instanceof THREE.SpriteMaterial, 'shock must expose sprite material state')
  assert(
    angleDistance(shock.material.rotation, Math.PI * 0.5) < 1e-6,
    `shock plane must stay perpendicular to collision normal; got ${shock.material.rotation}`,
  )
  assert(
    veil.material.opacity >= 0.94,
    `peak topology veil must substantially hide source silhouettes; got ${veil.material.opacity}`,
  )
  assert(shock.visible && plasmaA.visible && plasmaB.visible,
    'shock plane and bilateral plasma must remain visible at peak')

  const remnant: BodyState = {
    ...a,
    id: `${a.id}+${b.id}`,
    name: 'Merged remnant',
    mass: 1.94,
    radius: 0.38,
    position: { x: 0, y: 0, z: 0 },
  }

  layer.update([remnant], camera, 1100)
  const retained = group.getObjectByName(`topology-occluder:${pair.key}:veil`)
  assert(retained instanceof THREE.Sprite && retained.visible,
    'merge-resolution frame must retain the pre-impact veil over the remnant')
  assert(retained.material instanceof THREE.SpriteMaterial && retained.material.opacity > 0.85,
    'early remnant reveal must remain mostly masked')

  layer.update([remnant], camera, 1380)
  const fading = group.getObjectByName(`topology-occluder:${pair.key}:veil`)
  assert(fading instanceof THREE.Sprite && fading.visible,
    'topology veil must crossfade instead of disappearing on the topology switch')

  layer.update([remnant], camera, 1700)
  assert(
    group.getObjectByName(`topology-occluder:${pair.key}:veil`) === undefined,
    'retired topology veil must eventually leave the scene',
  )

  layer.dispose()
}

testOccluderActuallyCoversBothSourceStars()
console.log('stellar topology occlusion regression: ok')
