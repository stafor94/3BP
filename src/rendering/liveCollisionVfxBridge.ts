import * as THREE from 'three'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'
import { createStellarImpactBurstLayer } from './stellarImpactBurstLayer'
import { createStellarTopologyOcclusionLayer } from './stellarTopologyOccluder'

type CollisionEffectsLayer = ReturnType<typeof createCollisionEffectsLayer>
type TopologyOcclusionLayer = ReturnType<typeof createStellarTopologyOcclusionLayer>
type StellarImpactBurstLayer = ReturnType<typeof createStellarImpactBurstLayer>

type LiveLayers = {
  collision: CollisionEffectsLayer
  topology: TopologyOcclusionLayer
  burst: StellarImpactBurstLayer
}

type MaterialRenderCallback = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  object: THREE.Object3D,
  group: THREE.Group | null,
) => void

let installed = false
let currentBodies: BodyState[] = []
const liveLayersByScene = new WeakMap<THREE.Scene, LiveLayers>()

function isSimulationBodyShader(values: Record<string, any> | undefined) {
  return Boolean(
    values?.uniforms?.uSeed &&
    typeof values?.fragmentShader === 'string' &&
    values.fragmentShader.includes('drawBodyEmission'),
  )
}

function ensureLiveLayers(scene: THREE.Scene) {
  const existing = liveLayersByScene.get(scene)
  if (existing) return existing

  const created: LiveLayers = {
    collision: createCollisionEffectsLayer(scene),
    topology: createStellarTopologyOcclusionLayer(scene),
    burst: createStellarImpactBurstLayer(scene),
  }
  liveLayersByScene.set(scene, created)
  return created
}

function updateLiveLayers(scene: THREE.Scene, camera: THREE.Camera) {
  const layers = ensureLiveLayers(scene)
  const now = performance.now()
  // This callback executes from the real material draw path of the live
  // WebGLRenderer. Unlike the old WebGLRenderer.prototype.render monkeypatch,
  // it cannot be shadowed by the renderer instance's own render function.
  layers.collision.update(currentBodies, camera)
  layers.topology.update(currentBodies, camera, now)
  layers.burst.update(currentBodies, camera, now)
}

export function syncLiveCollisionVfxState(bodies: BodyState[]) {
  currentBodies = bodies
}

export function installLiveCollisionVfxBridge() {
  if (installed) return
  installed = true

  const shaderPrototype = THREE.ShaderMaterial.prototype as any
  const previousSetValues = shaderPrototype.setValues

  shaderPrototype.setValues = function setValuesWithLiveCollisionVfx(values: Record<string, any>) {
    const simulationBodyShader = isSimulationBodyShader(values)
    const result = previousSetValues.call(this, values)
    if (!simulationBodyShader) return result

    const material = this as THREE.ShaderMaterial & {
      onBeforeRender?: MaterialRenderCallback
      __liveCollisionVfxBridgeInstalled?: boolean
    }
    if (material.__liveCollisionVfxBridgeInstalled) return result
    material.__liveCollisionVfxBridgeInstalled = true

    const previousOnBeforeRender = material.onBeforeRender
    material.onBeforeRender = function liveCollisionVfxBeforeBodyRender(
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.Camera,
      geometry: THREE.BufferGeometry,
      object: THREE.Object3D,
      group: THREE.Group | null,
    ) {
      updateLiveLayers(scene, camera)
      previousOnBeforeRender?.call(
        this,
        renderer,
        scene,
        camera,
        geometry,
        object,
        group,
      )
    }

    return result
  }
}
