import * as THREE from 'three'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'
import {
  COLLISION_PRODUCT_REVEAL_DURATION_MS,
  createCollisionHandoffLayer,
  getCollisionProductRevealProgress,
} from './collisionHandoffLayer'
import { createStellarImpactBurstLayer } from './stellarImpactBurstLayer'
import { createStellarTopologyOcclusionLayer } from './stellarTopologyOccluder'

type CollisionEffectsLayer = ReturnType<typeof createCollisionEffectsLayer>
type CollisionHandoffLayer = ReturnType<typeof createCollisionHandoffLayer>
type TopologyOcclusionLayer = ReturnType<typeof createStellarTopologyOcclusionLayer>
type StellarImpactBurstLayer = ReturnType<typeof createStellarImpactBurstLayer>

type LiveLayers = {
  collision: CollisionEffectsLayer
  handoff: CollisionHandoffLayer
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

const collisionRevealVertexShader = `
  uniform float uCollisionRevealScale;

  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vObjectNormal = normalize(normal);
    vec3 revealPosition = position * uCollisionRevealScale;
    vec4 worldPosition = modelMatrix * vec4(revealPosition, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

let installed = false
let currentBodies: BodyState[] = []
let currentBodiesBySeed = new Map<number, BodyState>()
let previousBodyIds = new Set<string>()
const collisionProductIntroducedAt = new Map<string, number>()
const liveLayersByScene = new WeakMap<THREE.Scene, LiveLayers>()

function getSimulationBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 1000
}

function isSimulationBodyShader(values: Record<string, any> | undefined) {
  return Boolean(
    values?.uniforms?.uSeed &&
    typeof values?.fragmentShader === 'string' &&
    values.fragmentShader.includes('drawBodyEmission'),
  )
}

function isRevealableCollisionProduct(body: BodyState) {
  if (body.bodyType === 'effect' || body.bodyType === 'star') return false
  return body.bodyType === 'fragment' || body.id.includes('+')
}

function ensureLiveLayers(scene: THREE.Scene) {
  const existing = liveLayersByScene.get(scene)
  if (existing) return existing

  const created: LiveLayers = {
    collision: createCollisionEffectsLayer(scene),
    handoff: createCollisionHandoffLayer(scene),
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
  layers.handoff.update(currentBodies, now)
  layers.topology.update(currentBodies, camera, now)
  layers.burst.update(currentBodies, camera, now)
}

function applyCollisionProductReveal(
  material: THREE.ShaderMaterial,
  now: number,
) {
  const seed = material.uniforms.uSeed?.value
  if (typeof seed !== 'number') return

  const body = currentBodiesBySeed.get(seed)
  if (!body) return

  const introducedAt = collisionProductIntroducedAt.get(body.id)
  if (introducedAt === undefined) return

  const elapsedMs = Math.max(0, now - introducedAt)
  const progress = getCollisionProductRevealProgress(elapsedMs)
  const scaleUniform = material.uniforms.uCollisionRevealScale
  if (!scaleUniform) return

  if (elapsedMs >= COLLISION_PRODUCT_REVEAL_DURATION_MS) {
    scaleUniform.value = 1
    collisionProductIntroducedAt.delete(body.id)
    return
  }

  const easedScale = 1 - Math.pow(1 - progress, 2)
  const initialScale = body.bodyType === 'fragment' ? 0.3 : 0.86
  scaleUniform.value = THREE.MathUtils.lerp(initialScale, 1, easedScale)

  const opacityUniform = material.uniforms.uOpacity
  if (opacityUniform) {
    const baseOpacity = Number(opacityUniform.value)
    const revealOpacity = body.bodyType === 'fragment'
      ? Math.pow(progress, 1.12)
      : progress
    opacityUniform.value = (Number.isFinite(baseOpacity) ? baseOpacity : 1) * revealOpacity
  }

  if (!material.transparent) {
    material.transparent = true
    material.needsUpdate = true
  }
  material.depthWrite = false
}

export function syncLiveCollisionVfxState(bodies: BodyState[]) {
  const now = performance.now()
  const nextIds = new Set(bodies.map((body) => body.id))

  bodies.forEach((body) => {
    if (
      isRevealableCollisionProduct(body) &&
      !previousBodyIds.has(body.id) &&
      !collisionProductIntroducedAt.has(body.id)
    ) {
      collisionProductIntroducedAt.set(body.id, now)
    }
  })

  collisionProductIntroducedAt.forEach((_startedAt, bodyId) => {
    if (!nextIds.has(bodyId)) collisionProductIntroducedAt.delete(bodyId)
  })

  currentBodies = bodies
  currentBodiesBySeed = new Map(
    bodies.map((body) => [getSimulationBodySeed(body.id), body]),
  )
  previousBodyIds = nextIds
}

export function installLiveCollisionVfxBridge() {
  if (installed) return
  installed = true

  const shaderPrototype = THREE.ShaderMaterial.prototype as any
  const previousSetValues = shaderPrototype.setValues

  shaderPrototype.setValues = function setValuesWithLiveCollisionVfx(values: Record<string, any>) {
    const simulationBodyShader = isSimulationBodyShader(values)
    const nextValues = simulationBodyShader
      ? {
          ...values,
          vertexShader: collisionRevealVertexShader,
          uniforms: {
            ...values.uniforms,
            uCollisionRevealScale: { value: 1 },
          },
        }
      : values
    const result = previousSetValues.call(this, nextValues)
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
      applyCollisionProductReveal(material, performance.now())
    }

    return result
  }
}
