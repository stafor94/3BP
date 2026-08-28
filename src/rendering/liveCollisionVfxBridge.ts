import * as THREE from 'three'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'
import { createCollisionHandoffLayer } from './collisionHandoffLayer'
import {
  COLLISION_REMNANT_SETTLE_END_MS,
  findCollisionVisualTransitions,
  getCollisionRemnantVisualLifecycle,
  getCollisionVisualLifecycle,
  type CollisionRemnantVisualLifecycle,
  type CollisionVisualLifecycle,
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
  lifecycle: CollisionVisualLifecycle
}

type CollisionProductVisual = {
  startedAt: number
  role: 'remnant' | 'fragment'
  lifecycle: CollisionRemnantVisualLifecycle
}

export const SURVIVOR_IMPACT_DURATION_MS = 1500
export const MERGED_SURVIVOR_SETTLE_DURATION_MS = 1700
export const SURVIVOR_IMPACT_MIN_DOT = 0.8
export const SURVIVOR_IMPACT_MAX_SURFACE_FRACTION = (1 - SURVIVOR_IMPACT_MIN_DOT) / 2
export const COLLISION_REMNANT_CORE_SCALE_MIN = 0.18
export const COLLISION_REMNANT_CORE_SCALE_MAX = 0.24
export const COLLISION_REMNANT_FORMATION_TARGET_SCALE = 0.88
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
const collisionProductVisuals = new Map<string, CollisionProductVisual>()
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
  const flash = elapsed < 120
    ? 1 - smooth01(elapsed / 120)
    : 0
  let heat = 0
  if (elapsed < 120) {
    heat = 0.28 + smooth01(elapsed / 120) * 0.72
  } else if (elapsed < 520) {
    heat = 1 - smooth01((elapsed - 120) / 400) * 0.28
  } else if (elapsed < 1050) {
    heat = 0.72 - smooth01((elapsed - 520) / 530) * 0.48
  } else if (elapsed < SURVIVOR_IMPACT_DURATION_MS) {
    heat = 0.24 * (1 - smooth01(
      (elapsed - 1050) / Math.max(1, SURVIVOR_IMPACT_DURATION_MS - 1050),
    ))
  }
  return { flash, heat }
}

export function getMergedSurvivorRevealScale(
  elapsedMs: number,
  sourceRadius: number,
  resultRadius: number,
) {
  const safeResultRadius = Math.max(Math.abs(resultRadius), 1e-9)
  const inheritedScale = clamp01(Math.abs(sourceRadius) / safeResultRadius)
  const initialScale = Math.min(1, Math.max(0.72, inheritedScale))
  const progress = smooth01(Math.max(0, elapsedMs) / MERGED_SURVIVOR_SETTLE_DURATION_MS)
  const easeOut = 1 - Math.pow(1 - progress, 3)
  return THREE.MathUtils.lerp(initialScale, 1, easeOut)
}

export function getCollisionRemnantRevealScale(elapsedMs: number, seed01 = 0.5) {
  const lifecycle = getCollisionRemnantVisualLifecycle(elapsedMs)
  const seeded = clamp01(seed01)
  const coreScale = THREE.MathUtils.lerp(
    COLLISION_REMNANT_CORE_SCALE_MIN,
    COLLISION_REMNANT_CORE_SCALE_MAX,
    seeded,
  )
  if (lifecycle.phase === 'FORMING') {
    return THREE.MathUtils.lerp(
      coreScale,
      COLLISION_REMNANT_FORMATION_TARGET_SCALE,
      lifecycle.formationProgress,
    )
  }
  if (lifecycle.phase === 'SETTLING') {
    return THREE.MathUtils.lerp(
      COLLISION_REMNANT_FORMATION_TARGET_SCALE,
      1,
      lifecycle.settleProgress,
    )
  }
  return 1
}

export function getCollisionRemnantRevealOpacity(elapsedMs: number) {
  const lifecycle = getCollisionRemnantVisualLifecycle(elapsedMs)
  if (lifecycle.phase === 'FORMING') return Math.pow(lifecycle.formationProgress, 1.08)
  return 1
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

function updateCollisionEventLifecycle(event: CollisionVisualEvent, now: number) {
  event.lifecycle = getCollisionVisualLifecycle(Math.max(0, now - event.startedAt))
  return event.lifecycle
}

function applySurvivorImpact(material: THREE.ShaderMaterial, object: THREE.Object3D, now: number) {
  const body = resolveMaterialBody(material)
  if (!body) return
  const transition = getSurvivorTransition(body.id)
  if (!transition) return

  const event = collisionVisualEventsByResultId.get(body.id)
  if (!event) return
  const lifecycle = updateCollisionEventLifecycle(event, now)
  const elapsedMs = lifecycle.elapsedMs
  const identitySeed = surfaceIdentitySeedByBodyId.get(body.id) ?? getSimulationBodySeed(transition.source.id)
  surfaceIdentitySeedByBodyId.set(body.id, identitySeed)
  if (material.uniforms.uSurfaceSeed) material.uniforms.uSurfaceSeed.value = identitySeed
  if (material.uniforms.uCollisionRevealScale) {
    material.uniforms.uCollisionRevealScale.value = transition.outcome === 'merged-survivor'
      ? getMergedSurvivorRevealScale(elapsedMs, transition.source.radius, body.radius)
      : 1
  }

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
  const { flash, heat } = getSurvivorImpactEnvelope(elapsedMs)
  if (material.uniforms.uCollisionImpactFlash) material.uniforms.uCollisionImpactFlash.value = flash
  if (material.uniforms.uCollisionImpactHeat) material.uniforms.uCollisionImpactHeat.value = heat
}

function readBaseOpacity(material: THREE.ShaderMaterial) {
  const cached = material.userData.collisionVisualBaseOpacity
  if (typeof cached === 'number' && Number.isFinite(cached)) return cached
  const value = Number(material.uniforms.uOpacity?.value)
  const baseOpacity = Number.isFinite(value) ? value : 1
  material.userData.collisionVisualBaseOpacity = baseOpacity
  return baseOpacity
}

function applyCollisionProductLifecycle(
  material: THREE.ShaderMaterial,
  now: number,
) {
  const body = resolveMaterialBody(material)
  if (!body || getSurvivorTransition(body.id)) return

  const product = collisionProductVisuals.get(body.id)
  if (!product) return

  const seed01 = getSeed01(body.id)
  const staggerMs = product.role === 'fragment'
    ? 20 + seed01 * 100
    : seed01 * 30
  const elapsedMs = Math.max(0, now - product.startedAt - staggerMs)
  product.lifecycle = getCollisionRemnantVisualLifecycle(elapsedMs)

  const scaleUniform = material.uniforms.uCollisionRevealScale
  if (!scaleUniform) return
  if (product.role === 'remnant') {
    scaleUniform.value = getCollisionRemnantRevealScale(elapsedMs, seed01)
  } else {
    const initialScale = THREE.MathUtils.lerp(0.18, 0.32, seed01)
    const formationTarget = 0.92
    scaleUniform.value = product.lifecycle.phase === 'FORMING'
      ? THREE.MathUtils.lerp(initialScale, formationTarget, product.lifecycle.formationProgress)
      : product.lifecycle.phase === 'SETTLING'
        ? THREE.MathUtils.lerp(formationTarget, 1, product.lifecycle.settleProgress)
        : 1
  }

  const opacityUniform = material.uniforms.uOpacity
  if (opacityUniform) {
    const baseOpacity = readBaseOpacity(material)
    const revealOpacity = product.role === 'remnant'
      ? getCollisionRemnantRevealOpacity(elapsedMs)
      : product.lifecycle.phase === 'FORMING'
        ? Math.pow(product.lifecycle.formationProgress, 1.32)
        : 1
    opacityUniform.value = baseOpacity * revealOpacity
  }

  if (!material.transparent) {
    material.transparent = true
    material.needsUpdate = true
  }
  material.depthWrite = false

  if (product.lifecycle.isComplete || elapsedMs >= COLLISION_REMNANT_SETTLE_END_MS) {
    scaleUniform.value = 1
    if (opacityUniform) opacityUniform.value = readBaseOpacity(material)
    collisionProductVisuals.delete(body.id)
  }
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
      collisionVisualEventsByResultId.set(resultId, {
        startedAt: now,
        transitions: resultTransitions,
        lifecycle: getCollisionVisualLifecycle(0),
      })
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
      !collisionProductVisuals.has(body.id)
    ) {
      const event = collisionVisualEventsByResultId.get(body.id)
      collisionProductVisuals.set(body.id, {
        startedAt: event?.startedAt ?? now,
        role: body.bodyType === 'fragment' ? 'fragment' : 'remnant',
        lifecycle: getCollisionRemnantVisualLifecycle(0),
      })
    }
    if (!surfaceIdentitySeedByBodyId.has(body.id)) {
      surfaceIdentitySeedByBodyId.set(body.id, getSimulationBodySeed(body.id))
    }
  })

  collisionProductVisuals.forEach((_visual, bodyId) => {
    if (!nextIds.has(bodyId)) collisionProductVisuals.delete(bodyId)
  })
  collisionVisualEventsByResultId.forEach((_event, bodyId) => {
    if (!nextIds.has(bodyId)) collisionVisualEventsByResultId.delete(bodyId)
  })
  surfaceIdentitySeedByBodyId.forEach((_seed, bodyId) => {
    if (!nextIds.has(bodyId) && !previousBodyIds.has(bodyId)) surfaceIdentitySeedByBodyId.delete(bodyId)
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
      applyCollisionProductLifecycle(material, now)
    }

    return result
  }
}
