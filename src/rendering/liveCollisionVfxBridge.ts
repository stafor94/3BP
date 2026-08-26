import * as THREE from 'three'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'
import {
  COLLISION_PRODUCT_REVEAL_DURATION_MS,
  createCollisionHandoffLayer,
  getCollisionProductRevealProgress,
} from './collisionHandoffLayer'
import {
  findCollisionVisualTransitions,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'
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

type CollisionVisualEvent = {
  startedAt: number
  transitions: CollisionVisualTransition[]
}

export const SURVIVOR_IMPACT_DURATION_MS = 700
export const SURVIVOR_IMPACT_MIN_DOT = 0.8
export const SURVIVOR_IMPACT_MAX_SURFACE_FRACTION = (1 - SURVIVOR_IMPACT_MIN_DOT) / 2
const SOURCE_FRAGMENT_OUTPUT = 'gl_FragColor = vec4(color, uOpacity);'

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

const survivorImpactFragmentCode = `
  vec3 collisionImpactNormal = normalize(vObjectNormal);
  vec3 collisionImpactDirection = normalize(
    uCollisionImpactDirection + vec3(0.000001, 0.000002, 0.000003)
  );
  float collisionImpactFacing = dot(collisionImpactNormal, collisionImpactDirection);
  float collisionImpactMask = smoothstep(
    ${SURVIVOR_IMPACT_MIN_DOT.toFixed(2)},
    0.92,
    collisionImpactFacing
  );
  float collisionImpactNoise = valueNoise(
    collisionImpactNormal * 18.0 + vec3(uSeed * 0.021, -uSeed * 0.013, uSeed * 0.017)
  );
  float collisionImpactCrack = 1.0 - smoothstep(
    0.018,
    0.07,
    abs(collisionImpactNoise - 0.52)
  );
  float collisionHeat = collisionImpactMask * uCollisionImpactHeat;
  float collisionCrack = collisionImpactCrack * collisionHeat;
  color = mix(color, vec3(1.0, 0.34, 0.12), collisionHeat * 0.34 + collisionCrack * 0.44);
  color += vec3(1.0, 0.76, 0.46) * collisionImpactMask * uCollisionImpactFlash * 0.7;
`

let installed = false
let currentBodies: BodyState[] = []
let currentBodiesBySeed = new Map<number, BodyState>()
let currentBodiesById = new Map<string, BodyState>()
let previousBodies: BodyState[] | null = null
let previousBodyIds = new Set<string>()
const collisionProductIntroducedAt = new Map<string, number>()
const collisionVisualEventsByResultId = new Map<string, CollisionVisualEvent>()
const surfaceIdentitySeedByBodyId = new Map<string, number>()
const liveLayersByScene = new WeakMap<THREE.Scene, LiveLayers>()

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

export function getSurvivorImpactEnvelope(elapsedMs: number) {
  const elapsed = Math.max(0, elapsedMs)
  const flash = elapsed < 100
    ? 1 - smooth01(elapsed / 100)
    : 0
  let heat = 0
  if (elapsed < 100) {
    heat = 0.28 + smooth01(elapsed / 100) * 0.72
  } else if (elapsed < 300) {
    heat = 1 - smooth01((elapsed - 100) / 200) * 0.28
  } else if (elapsed < 500) {
    heat = 0.72 - smooth01((elapsed - 300) / 200) * 0.56
  } else if (elapsed < SURVIVOR_IMPACT_DURATION_MS) {
    heat = 0.16 * (1 - smooth01((elapsed - 500) / 200))
  }
  return { flash, heat }
}

function getSimulationBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 1000
}

function getSeed01(id: string) {
  return getSimulationBodySeed(id) / 1000
}

function cloneBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
  }
}

function isSimulationBodyShader(values: Record<string, any> | undefined) {
  return Boolean(
    values?.uniforms?.uSeed &&
    typeof values?.fragmentShader === 'string' &&
    values.fragmentShader.includes('drawBodyEmission'),
  )
}

function getSurvivorTransition(bodyId: string) {
  return collisionVisualEventsByResultId.get(bodyId)?.transitions.find((transition) =>
    transition.outcome === 'merged-survivor' || transition.outcome === 'survivor',
  )
}

function isRevealableCollisionProduct(body: BodyState) {
  if (body.bodyType === 'effect' || body.bodyType === 'star') return false
  if (getSurvivorTransition(body.id)) return false
  return body.bodyType === 'fragment' || body.id.includes('+')
}

function resolveMaterialBody(material: THREE.ShaderMaterial) {
  const cachedId = material.userData.simulationBodyId
  if (typeof cachedId === 'string') {
    const cached = currentBodiesById.get(cachedId)
    if (cached) return cached
  }

  const seed = material.uniforms.uSeed?.value
  if (typeof seed !== 'number') return undefined
  const body = currentBodiesBySeed.get(seed)
  if (body) material.userData.simulationBodyId = body.id
  return body
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
  layers.collision.update(currentBodies, camera)
  layers.handoff.update(currentBodies, now)
  layers.topology.update(currentBodies, camera, now)
  layers.burst.update(currentBodies, camera, now)
}

function applySurvivorImpact(material: THREE.ShaderMaterial, object: THREE.Object3D, now: number) {
  const body = resolveMaterialBody(material)
  if (!body) return
  const transition = getSurvivorTransition(body.id)
  if (!transition) return

  const event = collisionVisualEventsByResultId.get(body.id)
  if (!event) return
  const identitySeed = surfaceIdentitySeedByBodyId.get(body.id) ?? getSimulationBodySeed(transition.source.id)
  surfaceIdentitySeedByBodyId.set(body.id, identitySeed)
  if (material.uniforms.uSurfaceSeed) material.uniforms.uSurfaceSeed.value = identitySeed
  if (material.uniforms.uCollisionRevealScale) material.uniforms.uCollisionRevealScale.value = 1

  const direction = material.uniforms.uCollisionImpactDirection?.value
  if (direction instanceof THREE.Vector3) {
    const worldQuaternion = new THREE.Quaternion()
    object.getWorldQuaternion(worldQuaternion)
    direction.set(
      transition.contactNormal.x,
      transition.contactNormal.y,
      transition.contactNormal.z,
    ).applyQuaternion(worldQuaternion.invert()).normalize()
  }
  const { flash, heat } = getSurvivorImpactEnvelope(now - event.startedAt)
  if (material.uniforms.uCollisionImpactFlash) material.uniforms.uCollisionImpactFlash.value = flash
  if (material.uniforms.uCollisionImpactHeat) material.uniforms.uCollisionImpactHeat.value = heat
}

function applyCollisionProductReveal(
  material: THREE.ShaderMaterial,
  now: number,
) {
  const body = resolveMaterialBody(material)
  if (!body || getSurvivorTransition(body.id)) return

  const introducedAt = collisionProductIntroducedAt.get(body.id)
  if (introducedAt === undefined) return

  const seed01 = getSeed01(body.id)
  const staggerMs = body.bodyType === 'fragment'
    ? 20 + seed01 * 100
    : seed01 * 30
  const elapsedMs = Math.max(0, now - introducedAt - staggerMs)
  const progress = getCollisionProductRevealProgress(elapsedMs)
  const scaleUniform = material.uniforms.uCollisionRevealScale
  if (!scaleUniform) return

  if (elapsedMs >= COLLISION_PRODUCT_REVEAL_DURATION_MS) {
    scaleUniform.value = 1
    collisionProductIntroducedAt.delete(body.id)
    return
  }

  const easeOut = 1 - Math.pow(1 - progress, 3)
  const initialScale = body.bodyType === 'fragment'
    ? THREE.MathUtils.lerp(0.18, 0.32, seed01)
    : THREE.MathUtils.lerp(0.80, 0.88, seed01)
  scaleUniform.value = THREE.MathUtils.lerp(initialScale, 1, easeOut)

  const opacityUniform = material.uniforms.uOpacity
  if (opacityUniform) {
    const baseOpacity = Number(opacityUniform.value)
    const revealOpacity = body.bodyType === 'fragment'
      ? Math.pow(progress, 1.32)
      : Math.pow(progress, 1.08)
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
  const transitions = previousBodies
    ? findCollisionVisualTransitions(previousBodies, bodies)
    : []
  const resultIds = Array.from(new Set(
    transitions
      .map((transition) => transition.resultId)
      .filter((resultId): resultId is string => Boolean(resultId)),
  ))

  for (const resultId of resultIds) {
    const resultTransitions = transitions.filter((transition) => transition.resultId === resultId)
    if (!collisionVisualEventsByResultId.has(resultId)) {
      collisionVisualEventsByResultId.set(resultId, { startedAt: now, transitions: resultTransitions })
    }
    const survivor = resultTransitions.find((transition) =>
      transition.outcome === 'merged-survivor' || transition.outcome === 'survivor',
    )
    if (survivor) {
      const inheritedSeed = surfaceIdentitySeedByBodyId.get(survivor.source.id) ??
        getSimulationBodySeed(survivor.source.id)
      surfaceIdentitySeedByBodyId.set(resultId, inheritedSeed)
    }
  }

  bodies.forEach((body) => {
    if (
      isRevealableCollisionProduct(body) &&
      !previousBodyIds.has(body.id) &&
      !collisionProductIntroducedAt.has(body.id)
    ) {
      collisionProductIntroducedAt.set(body.id, now)
    }
    if (!surfaceIdentitySeedByBodyId.has(body.id)) {
      surfaceIdentitySeedByBodyId.set(body.id, getSimulationBodySeed(body.id))
    }
  })

  collisionProductIntroducedAt.forEach((_startedAt, bodyId) => {
    if (!nextIds.has(bodyId)) collisionProductIntroducedAt.delete(bodyId)
  })
  collisionVisualEventsByResultId.forEach((_event, bodyId) => {
    if (!nextIds.has(bodyId)) collisionVisualEventsByResultId.delete(bodyId)
  })

  currentBodies = bodies
  currentBodiesById = new Map(bodies.map((body) => [body.id, body]))
  currentBodiesBySeed = new Map(
    bodies.map((body) => [getSimulationBodySeed(body.id), body]),
  )
  previousBodies = bodies.map(cloneBody)
  previousBodyIds = nextIds
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

    material.vertexShader = collisionRevealVertexShader
    material.uniforms.uCollisionRevealScale ??= { value: 1 }
    material.uniforms.uCollisionImpactDirection ??= { value: new THREE.Vector3(1, 0, 0) }
    material.uniforms.uCollisionImpactFlash ??= { value: 0 }
    material.uniforms.uCollisionImpactHeat ??= { value: 0 }

    if (
      material.fragmentShader.includes(SOURCE_FRAGMENT_OUTPUT) &&
      !material.fragmentShader.includes('uniform vec3 uCollisionImpactDirection;')
    ) {
      material.fragmentShader = `
        uniform vec3 uCollisionImpactDirection;
        uniform float uCollisionImpactFlash;
        uniform float uCollisionImpactHeat;
      ${material.fragmentShader.replace(
        SOURCE_FRAGMENT_OUTPUT,
        `${survivorImpactFragmentCode}\n  ${SOURCE_FRAGMENT_OUTPUT}`,
      )}`
    }
    material.needsUpdate = true

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
      const now = performance.now()
      applySurvivorImpact(material, object, now)
      applyCollisionProductReveal(material, now)
    }

    return result
  }
}
