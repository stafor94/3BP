import * as THREE from 'three'
import {
  createStellarTopologyMaskLayer,
  getStellarTopologyMaskPairs,
} from '../src/rendering/stellarTopologyMask'
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

function getUniform(mesh: THREE.Mesh, name: string) {
  const material = mesh.material
  assert(material instanceof THREE.ShaderMaterial, `${mesh.name} must use a shader material`)
  return material.uniforms[name]?.value
}

function testPeakMaskOccupiesTopologyHandoffArea() {
  const a = makeStar('topology-mask-a', -0.246, '#ff8b78')
  const b = makeStar('topology-mask-b', 0.246, '#f4f7ff')
  const pairs = getStellarTopologyMaskPairs([a, b])

  assert(pairs.length === 1, 'deep stellar overlap must create one topology-mask pair')
  const pair = pairs[0]
  assert(pair.overlapRatio >= 0.35, 'test pair must reach the merge compression plateau')
  assert(pair.flashBuild >= 0.99, 'peak stellar overlap must fully build the contact flash')
  assert(pair.maskBuild >= 0.99, 'peak stellar overlap must fully build the topology mask')
  assert(pair.plasmaBuild >= 0.99, 'peak stellar overlap must fully build plasma')

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)

  const layer = createStellarTopologyMaskLayer(scene)
  layer.update([a, b], camera, 1000)

  const group = scene.getObjectByName('stellar-topology-mask')
  assert(group instanceof THREE.Group, 'topology-mask render group must be installed')

  const flash = group.getObjectByName(`topology-mask:${pair.key}:flash`)
  const sheet = group.getObjectByName(`topology-mask:${pair.key}:sheet`)
  const plasmaA = group.getObjectByName(`topology-mask:${pair.key}:plasmaA`)
  const plasmaB = group.getObjectByName(`topology-mask:${pair.key}:plasmaB`)
  assert(flash instanceof THREE.Mesh, 'peak topology mask must render a contact flash mesh')
  assert(sheet instanceof THREE.Mesh, 'peak topology mask must render a compression sheet mesh')
  assert(plasmaA instanceof THREE.Mesh && plasmaB instanceof THREE.Mesh,
    'peak topology mask must render bilateral plasma lobes')

  assert(
    flash.scale.x >= a.radius * 3.7,
    `contact flash must span the collision center, got width ${flash.scale.x}`,
  )
  assert(
    flash.scale.y >= a.radius * 1.2,
    `contact flash must be thick enough to hide the 2->1 handoff, got height ${flash.scale.y}`,
  )
  assert(
    Number(getUniform(flash, 'uOpacity')) >= 0.86,
    'peak topology-mask flash must have high additive opacity',
  )
  assert(
    Number(getUniform(flash, 'uBrightness')) >= 2.1,
    'peak topology-mask flash must reach white-hot brightness',
  )
  assert(sheet.visible, 'compression sheet must remain visible at peak')
  assert(plasmaA.visible && plasmaB.visible, 'bilateral plasma must remain visible at peak')

  const remnant: BodyState = {
    ...a,
    id: `${a.id}+${b.id}`,
    name: 'Merged remnant',
    mass: 1.94,
    radius: 0.38,
    position: { x: 0, y: 0, z: 0 },
  }

  layer.update([remnant], camera, 1100)
  assert(
    group.getObjectByName(`topology-mask:${pair.key}:flash`)?.visible === true,
    'topology change frame must retain the pre-impact flash instead of exposing the remnant first',
  )

  layer.update([remnant], camera, 1300)
  const retiringFlash = group.getObjectByName(`topology-mask:${pair.key}:flash`)
  assert(retiringFlash instanceof THREE.Mesh && retiringFlash.visible,
    'synthetic topology mask must crossfade across the remnant reveal')
  assert(
    Number(getUniform(retiringFlash, 'uOpacity')) > 0.35,
    'topology mask must still substantially cover the remnant during early crossfade',
  )

  layer.update([remnant], camera, 1600)
  assert(
    group.getObjectByName(`topology-mask:${pair.key}:flash`) === undefined,
    'retired topology mask must eventually leave the scene',
  )

  layer.dispose()
}

testPeakMaskOccupiesTopologyHandoffArea()
console.log('stellar topology mask regression: ok')
