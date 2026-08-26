import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import {
  findCollisionVisualTransitions,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'

export const COLLISION_HANDOFF_DURATION_MS = 1500
export const COLLISION_IMPACT_HOLD_END_MS = 180
export const COLLISION_FRACTURE_END_MS = 650
export const COLLISION_BREAKUP_END_MS = 1100
export const COLLISION_PRODUCT_REVEAL_DELAY_MS = 240
export const COLLISION_PRODUCT_REVEAL_DURATION_MS = COLLISION_HANDOFF_DURATION_MS
export const COLLISION_ABSORPTION_DURATION_MS = 700
const COLLISION_DEBRIS_START_MS = 280
const COLLISION_SOURCE_FADE_START_MS = 1080
const MAX_ACTIVE_HANDOFFS = 8
const PARTICLE_COUNT = 72
const SOURCE_FRAGMENT_OUTPUT = 'gl_FragColor = vec4(color, uOpacity);'

type LiveBodyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>

type HandoffVisual = {
  source: BodyState
  startedAt: number
  mesh: LiveBodyMesh
  material: THREE.ShaderMaterial
  baseOpacity: number
  origin: THREE.Vector3
  surfaceRadius: number
  particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  particleGeometry: THREE.BufferGeometry
  particleMaterial: THREE.ShaderMaterial
  particlePositions: Float32Array
  particleDirections: Vec3[]
  particleSpeeds: number[]
}

type AbsorptionVisual = {
  source: BodyState
  startedAt: number
  mesh: LiveBodyMesh
  material: THREE.ShaderMaterial
  baseOpacity: number
  origin: THREE.Vector3
  baseScale: THREE.Vector3
  contactPoint: THREE.Vector3
}

const particleVertexShader = `
  uniform float uPointSize;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const particleFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered) * 2.0;
    if (radius > 1.0) discard;
    float core = exp(-4.8 * radius * radius);
    float edge = 1.0 - smoothstep(0.56, 1.0, radius);
    gl_FragColor = vec4(uColor, uOpacity * core * edge);
    #include <colorspace_fragment>
  }
`

const preservedSurfaceFractureCode = `
  vec3 handoffNormal = normalize(vObjectNormal);
  vec3 handoffSeedOffset = vec3(
    uCollisionHandoffSeed * 0.017,
    -uCollisionHandoffSeed * 0.031,
    uCollisionHandoffSeed * 0.047
  );
  float handoffBroad = valueNoise(handoffNormal * 4.2 + handoffSeedOffset);
  float handoffFine = valueNoise(handoffNormal * 12.5 - handoffSeedOffset * 1.7);
  float handoffNoise = handoffBroad * 0.68 + handoffFine * 0.32;
  vec3 handoffOrigin = normalize(
    uCollisionHandoffContactNormal + vec3(0.000001, 0.000002, 0.000003)
  );
  float handoffLocality = 0.5 + 0.5 * dot(handoffNormal, handoffOrigin);

  // Destruction begins at the real contact side. The source remains intact
  // during impact hold, then fracture reaches progressively farther from the
  // contact patch before structural breakup is allowed to remove pixels.
  float handoffLocalProgress = clamp(
    uCollisionHandoffFracture * 1.06 - (1.0 - handoffLocality) * 0.62,
    0.0,
    1.0
  );
  float handoffCrackEdge = mix(0.36, 0.66, handoffLocalProgress);
  float handoffCrack = 1.0 - smoothstep(
    0.012,
    0.072,
    abs(handoffNoise - handoffCrackEdge)
  );
  float handoffCrackStrength =
    handoffCrack * smoothstep(0.035, 0.58, handoffLocalProgress);
  color = mix(color, vec3(1.0, 0.64, 0.30), handoffCrackStrength * 0.58);

  // Geometry loss remains a late disruption-only phase. Survivor and
  // merged-survivor bodies never instantiate this material at all.
  float handoffLocalBreakup = clamp(
    uCollisionHandoffBreakup * 1.05 - (1.0 - handoffLocality) * 0.12,
    0.0,
    1.0
  );
  float handoffDissolveThreshold =
    smoothstep(0.30, 1.0, handoffLocalBreakup) * 0.48;
  if (handoffDissolveThreshold > 0.001 && handoffNoise < handoffDissolveThreshold) discard;
`

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

export function getCollisionHandoffProgress(elapsedMs: number) {
  return smooth01(elapsedMs / COLLISION_HANDOFF_DURATION_MS)
}

export function getCollisionHandoffFractureProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_IMPACT_HOLD_END_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_IMPACT_HOLD_END_MS) /
      Math.max(1, COLLISION_FRACTURE_END_MS - COLLISION_IMPACT_HOLD_END_MS),
  )
}

export function getCollisionHandoffBreakupProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_FRACTURE_END_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_FRACTURE_END_MS) /
      Math.max(1, COLLISION_BREAKUP_END_MS - COLLISION_FRACTURE_END_MS),
  )
}

export function getCollisionHandoffSourceOpacity(elapsedMs: number) {
  if (elapsedMs <= COLLISION_SOURCE_FADE_START_MS) return 0.99
  return 0.99 * (1 - smooth01(
    (elapsedMs - COLLISION_SOURCE_FADE_START_MS) /
      Math.max(1, COLLISION_HANDOFF_DURATION_MS - COLLISION_SOURCE_FADE_START_MS),
  ))
}

export function getCollisionHandoffParticleProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_DEBRIS_START_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_DEBRIS_START_MS) /
      Math.max(1, COLLISION_HANDOFF_DURATION_MS - COLLISION_DEBRIS_START_MS),
  )
}

export function getCollisionProductRevealProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_PRODUCT_REVEAL_DELAY_MS) return 0
  const activeDuration = Math.max(
    1,
    COLLISION_PRODUCT_REVEAL_DURATION_MS - COLLISION_PRODUCT_REVEAL_DELAY_MS,
  )
  return smooth01((elapsedMs - COLLISION_PRODUCT_REVEAL_DELAY_MS) / activeDuration)
}

export function getCollisionAbsorptionProgress(elapsedMs: number) {
  return smooth01(elapsedMs / COLLISION_ABSORPTION_DURATION_MS)
}

export function getCollisionAbsorptionOpacity(elapsedMs: number) {
  if (elapsedMs <= 280) return 0.99
  return 0.99 * (1 - smooth01((elapsedMs - 280) / (COLLISION_ABSORPTION_DURATION_MS - 280)))
}

function getBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function getSimulationBodySeed(id: string) {
  return getBodySeed(id) * 1000
}

function seededValue(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length <= 1e-10) return { x: 1, y: 0, z: 0 }
  return { x: value.x / length, y: value.y / length, z: value.z / length }
}

function makeDirection(sourceId: string, index: number, contactNormal: Vec3): Vec3 {
  const base = getBodySeed(`${sourceId}:handoff:${index}`)
  const z = seededValue(base * 19.17 + index * 0.37) * 2 - 1
  const theta = seededValue(base * 41.31 + index * 1.73) * Math.PI * 2
  const radial = Math.sqrt(Math.max(0, 1 - z * z))
  const randomDirection = {
    x: Math.cos(theta) * radial,
    y: Math.sin(theta) * radial,
    z,
  }
  const contact = normalizeVec3(contactNormal)
  const contactBias = 0.36 + seededValue(base * 23.41 + index * 0.91) * 0.18
  return normalizeVec3({
    x: randomDirection.x * (1 - contactBias) + contact.x * contactBias,
    y: randomDirection.y * (1 - contactBias) + contact.y * contactBias,
    z: randomDirection.z * (1 - contactBias) + contact.z * contactBias,
  })
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

function isRetirablePhysicalBody(body: BodyState) {
  return body.bodyType !== 'star' && body.bodyType !== 'effect' && body.bodyType !== 'fragment'
}

export function findCollisionHandoffSources(previous: BodyState[], current: BodyState[]) {
  return findCollisionVisualTransitions(previous, current)
    .filter((transition) => transition.outcome === 'disrupted')
    .map((transition) => transition.source)
}

export function findCollisionAbsorptionSources(previous: BodyState[], current: BodyState[]) {
  return findCollisionVisualTransitions(previous, current)
    .filter((transition) => transition.outcome === 'absorbed')
    .map((transition) => transition.source)
}

function findLiveBodyMesh(scene: THREE.Scene, bodyId: string) {
  const expectedSeed = getSimulationBodySeed(bodyId)
  let found: LiveBodyMesh | undefined

  scene.traverse((object) => {
    if (found || object.userData.collisionHandoffSnapshot || object.userData.collisionAbsorptionSnapshot) return
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) return
    const cachedBodyId = object.material.userData.simulationBodyId
    if (cachedBodyId === bodyId) {
      found = object as LiveBodyMesh
      return
    }
    const seed = object.material.uniforms.uSeed?.value
    if (typeof seed !== 'number' || Math.abs(seed - expectedSeed) > 1e-5) return
    found = object as LiveBodyMesh
  })

  return found
}

function createPreservedSurfaceMaterial(
  sourceMaterial: THREE.ShaderMaterial,
  sourceId: string,
  contactNormal: Vec3,
) {
  const material = sourceMaterial.clone()
  material.uniforms = THREE.UniformsUtils.clone(sourceMaterial.uniforms)
  material.uniforms.uCollisionHandoffFracture = { value: 0 }
  material.uniforms.uCollisionHandoffBreakup = { value: 0 }
  material.uniforms.uCollisionHandoffSeed = { value: getSimulationBodySeed(sourceId) }
  material.uniforms.uCollisionHandoffContactNormal = {
    value: new THREE.Vector3(contactNormal.x, contactNormal.y, contactNormal.z).normalize(),
  }
  if (material.uniforms.uCollisionImpactFlash) material.uniforms.uCollisionImpactFlash.value = 0
  if (material.uniforms.uCollisionImpactHeat) material.uniforms.uCollisionImpactHeat.value = 0
  material.transparent = true
  material.depthWrite = false

  if (material.fragmentShader.includes(SOURCE_FRAGMENT_OUTPUT)) {
    material.fragmentShader = `
      uniform float uCollisionHandoffFracture;
      uniform float uCollisionHandoffBreakup;
      uniform float uCollisionHandoffSeed;
      uniform vec3 uCollisionHandoffContactNormal;
    ${material.fragmentShader.replace(
      SOURCE_FRAGMENT_OUTPUT,
      `${preservedSurfaceFractureCode}\n  ${SOURCE_FRAGMENT_OUTPUT}`,
    )}`
    material.needsUpdate = true
  }

  return material
}

function createAbsorptionMaterial(sourceMaterial: THREE.ShaderMaterial) {
  const material = sourceMaterial.clone()
  material.uniforms = THREE.UniformsUtils.clone(sourceMaterial.uniforms)
  if (material.uniforms.uCollisionImpactFlash) material.uniforms.uCollisionImpactFlash.value = 0
  if (material.uniforms.uCollisionImpactHeat) material.uniforms.uCollisionImpactHeat.value = 0
  material.transparent = true
  material.depthWrite = false
  return material
}

function getParticleColor(material: THREE.ShaderMaterial, fallback: string) {
  const identityColor = material.uniforms.uIdentityColor?.value
  if (identityColor instanceof THREE.Color) return identityColor.clone()
  const color = material.uniforms.uColor?.value
  if (color instanceof THREE.Color) return color.clone()
  return new THREE.Color(fallback)
}

export function createCollisionHandoffLayer(scene: THREE.Scene) {
  const active = new Map<string, HandoffVisual>()
  const absorbing = new Map<string, AbsorptionVisual>()
  const lastLiveMeshById = new Map<string, LiveBodyMesh>()
  let previousBodies: BodyState[] | null = null

  const disposeVisual = (id: string) => {
    const visual = active.get(id)
    if (!visual) return
    scene.remove(visual.mesh, visual.particles)
    visual.mesh.geometry.dispose()
    visual.material.dispose()
    visual.particleMaterial.dispose()
    visual.particleGeometry.dispose()
    active.delete(id)
  }

  const disposeAbsorption = (id: string) => {
    const visual = absorbing.get(id)
    if (!visual) return
    scene.remove(visual.mesh)
    visual.mesh.geometry.dispose()
    visual.material.dispose()
    absorbing.delete(id)
  }

  const enforceActiveLimit = () => {
    if (active.size + absorbing.size < MAX_ACTIVE_HANDOFFS) return
    const candidates = [
      ...[...active.entries()].map(([id, visual]) => ({ id, startedAt: visual.startedAt, kind: 'handoff' as const })),
      ...[...absorbing.entries()].map(([id, visual]) => ({ id, startedAt: visual.startedAt, kind: 'absorption' as const })),
    ].sort((a, b) => a.startedAt - b.startedAt)
    const oldest = candidates[0]
    if (!oldest) return
    if (oldest.kind === 'handoff') disposeVisual(oldest.id)
    else disposeAbsorption(oldest.id)
  }

  const createVisual = (transition: CollisionVisualTransition, now: number) => {
    const source = transition.source
    if (active.has(source.id) || absorbing.has(source.id)) return
    const sourceMesh = lastLiveMeshById.get(source.id)
    if (!sourceMesh || !(sourceMesh.material instanceof THREE.ShaderMaterial)) return
    enforceActiveLimit()

    sourceMesh.updateWorldMatrix(true, false)
    const worldPosition = new THREE.Vector3()
    const worldQuaternion = new THREE.Quaternion()
    const worldScale = new THREE.Vector3()
    sourceMesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)

    const geometry = sourceMesh.geometry.clone()
    const material = createPreservedSurfaceMaterial(
      sourceMesh.material,
      source.id,
      transition.contactNormal,
    )
    const baseOpacityValue = Number(material.uniforms.uOpacity?.value)
    const baseOpacity = Number.isFinite(baseOpacityValue) ? baseOpacityValue : 1
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(worldPosition)
    mesh.quaternion.copy(worldQuaternion)
    mesh.scale.copy(worldScale)
    mesh.frustumCulled = false
    mesh.renderOrder = sourceMesh.renderOrder
    mesh.userData.collisionHandoffSnapshot = true

    const surfaceRadius = Math.max(
      Math.abs(worldScale.x),
      Math.abs(worldScale.y),
      Math.abs(worldScale.z),
      0.005,
    )
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3)
    const particleDirections = Array.from({ length: PARTICLE_COUNT }, (_, index) =>
      makeDirection(source.id, index, transition.contactNormal),
    )
    const particleSpeeds = Array.from({ length: PARTICLE_COUNT }, (_, index) =>
      0.86 + seededValue(getBodySeed(`${source.id}:speed:${index}`) * 31.7) * 0.46,
    )
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage),
    )
    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: {
          value: getParticleColor(sourceMesh.material, source.color)
            .lerp(new THREE.Color('#fff0d8'), 0.22),
        },
        uOpacity: { value: 0 },
        uPointSize: { value: 2.6 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    particles.frustumCulled = false
    particles.renderOrder = Math.max(15, sourceMesh.renderOrder + 1)

    scene.add(mesh, particles)
    active.set(source.id, {
      source: cloneBody(source),
      startedAt: now,
      mesh,
      material,
      baseOpacity,
      origin: worldPosition.clone(),
      surfaceRadius,
      particles,
      particleGeometry,
      particleMaterial,
      particlePositions,
      particleDirections,
      particleSpeeds,
    })
  }

  const createAbsorptionVisual = (transition: CollisionVisualTransition, now: number) => {
    const source = transition.source
    if (active.has(source.id) || absorbing.has(source.id)) return
    const sourceMesh = lastLiveMeshById.get(source.id)
    if (!sourceMesh || !(sourceMesh.material instanceof THREE.ShaderMaterial)) return
    enforceActiveLimit()

    sourceMesh.updateWorldMatrix(true, false)
    const worldPosition = new THREE.Vector3()
    const worldQuaternion = new THREE.Quaternion()
    const worldScale = new THREE.Vector3()
    sourceMesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)

    const geometry = sourceMesh.geometry.clone()
    const material = createAbsorptionMaterial(sourceMesh.material)
    const baseOpacityValue = Number(material.uniforms.uOpacity?.value)
    const baseOpacity = Number.isFinite(baseOpacityValue) ? baseOpacityValue : 1
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(worldPosition)
    mesh.quaternion.copy(worldQuaternion)
    mesh.scale.copy(worldScale)
    mesh.frustumCulled = false
    mesh.renderOrder = sourceMesh.renderOrder + 1
    mesh.userData.collisionAbsorptionSnapshot = true
    scene.add(mesh)

    absorbing.set(source.id, {
      source: cloneBody(source),
      startedAt: now,
      mesh,
      material,
      baseOpacity,
      origin: worldPosition.clone(),
      baseScale: worldScale.clone(),
      contactPoint: new THREE.Vector3(
        transition.contactPoint.x,
        transition.contactPoint.y,
        transition.contactPoint.z,
      ),
    })
  }

  const updateVisual = (visual: HandoffVisual, now: number) => {
    const elapsedMs = Math.max(0, now - visual.startedAt)
    const fractureProgress = getCollisionHandoffFractureProgress(elapsedMs)
    const breakupProgress = getCollisionHandoffBreakupProgress(elapsedMs)
    const particleProgress = getCollisionHandoffParticleProgress(elapsedMs)

    visual.material.uniforms.uCollisionHandoffFracture.value = fractureProgress
    visual.material.uniforms.uCollisionHandoffBreakup.value = breakupProgress
    if (visual.material.uniforms.uOpacity) {
      visual.material.uniforms.uOpacity.value =
        visual.baseOpacity * getCollisionHandoffSourceOpacity(elapsedMs)
    }

    const travel = visual.surfaceRadius * (0.96 + particleProgress * 1.9)
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3
      const direction = visual.particleDirections[index]
      const distance = travel * visual.particleSpeeds[index]
      visual.particlePositions[offset] = visual.origin.x + direction.x * distance
      visual.particlePositions[offset + 1] = visual.origin.y + direction.y * distance
      visual.particlePositions[offset + 2] = visual.origin.z + direction.z * distance
    }
    const position = visual.particleGeometry.getAttribute('position') as THREE.BufferAttribute
    position.needsUpdate = true

    const emissionEnvelope = particleProgress <= 0
      ? 0
      : Math.sin(particleProgress * Math.PI) * Math.pow(1 - particleProgress, 0.16)
    visual.particleMaterial.uniforms.uOpacity.value = emissionEnvelope * 0.7
    visual.particleMaterial.uniforms.uPointSize.value = 2.0 + (1 - particleProgress) * 1.15

    return elapsedMs >= COLLISION_HANDOFF_DURATION_MS
  }

  const updateAbsorptionVisual = (visual: AbsorptionVisual, now: number) => {
    const elapsedMs = Math.max(0, now - visual.startedAt)
    const progress = getCollisionAbsorptionProgress(elapsedMs)
    const moveProgress = smooth01(Math.min(1, progress * 1.12))
    visual.mesh.position.lerpVectors(visual.origin, visual.contactPoint, moveProgress * 0.82)
    visual.mesh.scale.copy(visual.baseScale).multiplyScalar(1 - progress * 0.82)
    if (visual.material.uniforms.uOpacity) {
      visual.material.uniforms.uOpacity.value =
        visual.baseOpacity * getCollisionAbsorptionOpacity(elapsedMs)
    }
    return elapsedMs >= COLLISION_ABSORPTION_DURATION_MS
  }

  const captureCurrentLiveMeshes = (bodies: BodyState[]) => {
    const nextIds = new Set<string>()
    bodies.forEach((body) => {
      if (!isRetirablePhysicalBody(body)) return
      const mesh = findLiveBodyMesh(scene, body.id)
      if (!mesh) return
      lastLiveMeshById.set(body.id, mesh)
      nextIds.add(body.id)
    })
    Array.from(lastLiveMeshById.keys()).forEach((id) => {
      if (!nextIds.has(id) && !active.has(id) && !absorbing.has(id)) lastLiveMeshById.delete(id)
    })
  }

  return {
    update(bodies: BodyState[], now = performance.now()) {
      if (previousBodies) {
        findCollisionVisualTransitions(previousBodies, bodies).forEach((transition) => {
          if (transition.outcome === 'disrupted') createVisual(transition, now)
          else if (transition.outcome === 'absorbed') createAbsorptionVisual(transition, now)
        })
      }

      active.forEach((visual, id) => {
        if (updateVisual(visual, now)) disposeVisual(id)
      })
      absorbing.forEach((visual, id) => {
        if (updateAbsorptionVisual(visual, now)) disposeAbsorption(id)
      })

      captureCurrentLiveMeshes(bodies)
      previousBodies = bodies.map(cloneBody)
    },
    dispose() {
      Array.from(active.keys()).forEach(disposeVisual)
      Array.from(absorbing.keys()).forEach(disposeAbsorption)
      lastLiveMeshById.clear()
      previousBodies = null
    },
  }
}
