import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import {
  findCollisionVisualTransitions,
  isCollisionVisualDescendant,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'

export const COLLISION_HANDOFF_DURATION_MS = 2600
export const COLLISION_IMPACT_HOLD_END_MS = 260
export const COLLISION_FRACTURE_END_MS = 1050
export const COLLISION_BREAKUP_END_MS = 1900
export const COLLISION_PRODUCT_REVEAL_DELAY_MS = 520
export const COLLISION_PRODUCT_REVEAL_DURATION_MS = COLLISION_HANDOFF_DURATION_MS
export const COLLISION_ABSORPTION_DURATION_MS = 1700
export const COLLISION_ABSORPTION_CONTACT_END_MS = 620
export const COLLISION_ABSORPTION_SINK_START_MS = 420
const COLLISION_DEBRIS_START_MS = 420
const COLLISION_SOURCE_FADE_START_MS = 1880
const COLLISION_ABSORPTION_FADE_START_MS = 960
const MAX_ACTIVE_HANDOFFS = 8
const PARTICLE_COUNT = 48
const SOURCE_FRAGMENT_OUTPUT = 'gl_FragColor = vec4(color, uOpacity);'
const REVEAL_VERTEX_POSITION = 'vec3 revealPosition = position * uCollisionRevealScale;'

type LiveBodyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>

type HandoffVisual = {
  source: BodyState
  startedAt: number
  mesh: LiveBodyMesh
  material: THREE.ShaderMaterial
  baseOpacity: number
  origin: THREE.Vector3
  contactPoint: THREE.Vector3
  surfaceRadius: number
  resultId: string | null
  anchorOrigin: THREE.Vector3 | null
  lastAnchorPosition: THREE.Vector3 | null
  lastAnchorObservedAt: number | null
  anchorVelocityPerMs: THREE.Vector3
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
  resultId: string | null
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

const preservedSurfaceImpactCode = `
  vec3 handoffNormal = normalize(vObjectNormal);
  vec3 handoffOrigin = normalize(
    uCollisionHandoffContactNormal + vec3(0.000001, 0.000002, 0.000003)
  );
  float handoffFacing = dot(handoffNormal, handoffOrigin);
  float handoffContactMask = smoothstep(0.72, 0.96, handoffFacing);
  float handoffShoulderMask =
    smoothstep(0.54, 0.82, handoffFacing) *
    (1.0 - smoothstep(0.88, 0.99, handoffFacing));
  vec3 handoffSeedOffset = vec3(
    uCollisionHandoffSeed * 0.017,
    -uCollisionHandoffSeed * 0.031,
    uCollisionHandoffSeed * 0.047
  );
  float handoffNoise = valueNoise(handoffNormal * 7.4 + handoffSeedOffset);

  // Keep impact damage local to the real contact cap. The old whole-surface
  // crack network and fragment discard made a disrupted planet look as though
  // its shell was peeling off. Structural loss is represented by the actual
  // result fragments/ejecta instead of cutting holes through this snapshot.
  float handoffHeatEnvelope = clamp(
    uCollisionHandoffFracture * (1.0 - uCollisionHandoffBreakup * 0.76),
    0.0,
    1.0
  );
  float handoffHeat =
    handoffContactMask * handoffHeatEnvelope * mix(0.84, 1.0, handoffNoise);
  color = mix(color, vec3(1.0, 0.43, 0.14), handoffHeat * 0.22);
  color += vec3(1.0, 0.58, 0.24) * handoffShoulderMask * handoffHeatEnvelope * 0.035;
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

export function getCollisionHandoffCompression(elapsedMs: number) {
  const fracture = getCollisionHandoffFractureProgress(elapsedMs)
  const breakup = getCollisionHandoffBreakupProgress(elapsedMs)
  const contactCompression = smooth01(Math.min(1, fracture * 2.4))
  return contactCompression * (1 - smooth01(breakup) * 0.72)
}

export function getCollisionHandoffSourceOpacity(elapsedMs: number) {
  // Preserve the original surface through the full fracture phase. Once the
  // breakup phase starts, hand visual ownership to the already-moving physical
  // result instead of leaving both source snapshots effectively opaque until
  // the late fade. The snapshot remains alive for the full 2.6s lifecycle; this
  // only prevents source + result from reading as several new full bodies.
  const breakupOwnership = 1 - getCollisionHandoffBreakupProgress(elapsedMs) * 0.88
  if (elapsedMs <= COLLISION_SOURCE_FADE_START_MS) return 0.99 * breakupOwnership
  return 0.99 * breakupOwnership * (1 - smooth01(
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

export function getCollisionAbsorptionContactProgress(elapsedMs: number) {
  return smooth01(elapsedMs / COLLISION_ABSORPTION_CONTACT_END_MS)
}

export function getCollisionAbsorptionSinkProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_ABSORPTION_SINK_START_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_ABSORPTION_SINK_START_MS) /
      Math.max(1, COLLISION_ABSORPTION_DURATION_MS - COLLISION_ABSORPTION_SINK_START_MS),
  )
}

export function getCollisionAbsorptionScale(elapsedMs: number) {
  return 1 - getCollisionAbsorptionSinkProgress(elapsedMs) * 0.94
}

export function getCollisionAbsorptionOpacity(elapsedMs: number) {
  if (elapsedMs <= COLLISION_ABSORPTION_FADE_START_MS) return 0.99
  return 0.99 * (1 - smooth01(
    (elapsedMs - COLLISION_ABSORPTION_FADE_START_MS) /
      Math.max(1, COLLISION_ABSORPTION_DURATION_MS - COLLISION_ABSORPTION_FADE_START_MS),
  ))
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
  const projection =
    randomDirection.x * contact.x +
    randomDirection.y * contact.y +
    randomDirection.z * contact.z
  let tangent = {
    x: randomDirection.x - contact.x * projection,
    y: randomDirection.y - contact.y * projection,
    z: randomDirection.z - contact.z * projection,
  }
  if (Math.hypot(tangent.x, tangent.y, tangent.z) <= 1e-8) {
    const axis = Math.abs(contact.x) < 0.8
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 1, z: 0 }
    tangent = {
      x: contact.y * axis.z - contact.z * axis.y,
      y: contact.z * axis.x - contact.x * axis.z,
      z: contact.x * axis.y - contact.y * axis.x,
    }
  }
  tangent = normalizeVec3(tangent)

  // Ejecta leaves the contact patch mostly along the impact plane with a small
  // back-scatter component. It no longer radiates from the whole source sphere.
  const lateralWeight = 0.78 + seededValue(base * 23.41 + index * 0.91) * 0.16
  const backscatter = 0.16 + seededValue(base * 29.77 + index * 1.13) * 0.20
  return normalizeVec3({
    x: tangent.x * lateralWeight - contact.x * backscatter,
    y: tangent.y * lateralWeight - contact.y * backscatter,
    z: tangent.z * lateralWeight - contact.z * backscatter,
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

function bodyPosition(body: BodyState) {
  return new THREE.Vector3(body.position.x, body.position.y, body.position.z)
}

function findFragmentSystemAnchor(sourceId: string, bodies: BodyState[]) {
  const descendants = bodies.filter((candidate) =>
    candidate.id !== sourceId &&
    (candidate.bodyType === 'fragment' || (candidate.bodyType === 'effect' && candidate.mass > 0)) &&
    isCollisionVisualDescendant(candidate.id, sourceId),
  )
  if (descendants.length === 0) return null

  const anchor = new THREE.Vector3()
  let totalWeight = 0
  descendants.forEach((candidate) => {
    const weight = Math.max(0, candidate.mass)
    if (weight <= 1e-12) return
    anchor.addScaledVector(bodyPosition(candidate), weight)
    totalWeight += weight
  })
  if (totalWeight > 1e-12) return anchor.multiplyScalar(1 / totalWeight)

  descendants.forEach((candidate) => anchor.add(bodyPosition(candidate)))
  return anchor.multiplyScalar(1 / descendants.length)
}

function findResultAnchor(scene: THREE.Scene, resultId: string, bodies: BodyState[]) {
  const resultMesh = findLiveBodyMesh(scene, resultId)
  if (resultMesh) {
    resultMesh.updateWorldMatrix(true, false)
    return resultMesh.getWorldPosition(new THREE.Vector3())
  }
  const resultBody = bodies.find((body) => body.id === resultId)
  return resultBody ? bodyPosition(resultBody) : null
}

function createPreservedSurfaceMaterial(
  sourceMaterial: THREE.ShaderMaterial,
  sourceId: string,
  localContactNormal: Vec3,
) {
  const material = sourceMaterial.clone()
  material.uniforms = THREE.UniformsUtils.clone(sourceMaterial.uniforms)
  material.uniforms.uCollisionHandoffFracture = { value: 0 }
  material.uniforms.uCollisionHandoffBreakup = { value: 0 }
  material.uniforms.uCollisionHandoffCompression = { value: 0 }
  material.uniforms.uCollisionHandoffSeed = { value: getSimulationBodySeed(sourceId) }
  material.uniforms.uCollisionHandoffContactNormal = {
    value: new THREE.Vector3(
      localContactNormal.x,
      localContactNormal.y,
      localContactNormal.z,
    ).normalize(),
  }
  if (material.uniforms.uCollisionImpactFlash) material.uniforms.uCollisionImpactFlash.value = 0
  if (material.uniforms.uCollisionImpactHeat) material.uniforms.uCollisionImpactHeat.value = 0
  material.transparent = true
  material.depthWrite = false

  if (material.vertexShader.includes(REVEAL_VERTEX_POSITION)) {
    material.vertexShader = `
      uniform float uCollisionHandoffCompression;
      uniform vec3 uCollisionHandoffContactNormal;
    ${material.vertexShader.replace(
      REVEAL_VERTEX_POSITION,
      `vec3 localCollisionNormal = normalize(
        uCollisionHandoffContactNormal + vec3(0.000001, 0.000002, 0.000003)
      );
      float localCollisionFacing = max(dot(normalize(normal), localCollisionNormal), 0.0);
      float localCollisionMask = smoothstep(0.58, 0.96, localCollisionFacing);
      vec3 revealPosition = position * uCollisionRevealScale;
      revealPosition -=
        localCollisionNormal * localCollisionMask * uCollisionHandoffCompression * 0.12;`,
    )}`
  }

  if (material.fragmentShader.includes(SOURCE_FRAGMENT_OUTPUT)) {
    material.fragmentShader = `
      uniform float uCollisionHandoffFracture;
      uniform float uCollisionHandoffBreakup;
      uniform float uCollisionHandoffSeed;
      uniform vec3 uCollisionHandoffContactNormal;
    ${material.fragmentShader.replace(
      SOURCE_FRAGMENT_OUTPUT,
      `${preservedSurfaceImpactCode}\n  ${SOURCE_FRAGMENT_OUTPUT}`,
    )}`
  }
  material.needsUpdate = true

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

  const resolveAnchor = (
    visual: Pick<
      HandoffVisual,
      | 'source'
      | 'resultId'
      | 'anchorOrigin'
      | 'lastAnchorPosition'
      | 'lastAnchorObservedAt'
      | 'anchorVelocityPerMs'
    >,
    bodies: BodyState[],
    now: number,
  ) => {
    const resolved = visual.resultId
      ? findResultAnchor(scene, visual.resultId, bodies)
      : findFragmentSystemAnchor(visual.source.id, bodies)

    if (resolved) {
      if (visual.lastAnchorPosition && visual.lastAnchorObservedAt !== null && now > visual.lastAnchorObservedAt) {
        visual.anchorVelocityPerMs
          .subVectors(resolved, visual.lastAnchorPosition)
          .multiplyScalar(1 / (now - visual.lastAnchorObservedAt))
      }
      if (!visual.anchorOrigin) visual.anchorOrigin = resolved.clone()
      visual.lastAnchorPosition = resolved.clone()
      visual.lastAnchorObservedAt = now
      return resolved
    }

    if (!visual.lastAnchorPosition) return null
    if (
      visual.resultId === null &&
      visual.lastAnchorObservedAt !== null &&
      visual.anchorVelocityPerMs.lengthSq() > 1e-16
    ) {
      return visual.lastAnchorPosition
        .clone()
        .addScaledVector(visual.anchorVelocityPerMs, Math.max(0, now - visual.lastAnchorObservedAt))
    }
    return visual.lastAnchorPosition.clone()
  }

  const createVisual = (
    transition: CollisionVisualTransition,
    bodies: BodyState[],
    now: number,
  ) => {
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

    const worldContactNormal = new THREE.Vector3(
      transition.contactNormal.x,
      transition.contactNormal.y,
      transition.contactNormal.z,
    ).normalize()
    const localContactNormal = worldContactNormal
      .clone()
      .applyQuaternion(worldQuaternion.clone().invert())
      .normalize()
    const geometry = sourceMesh.geometry.clone()
    const material = createPreservedSurfaceMaterial(
      sourceMesh.material,
      source.id,
      { x: localContactNormal.x, y: localContactNormal.y, z: localContactNormal.z },
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
    mesh.userData.collisionHandoffSourceId = source.id
    mesh.userData.collisionHandoffResultId = transition.resultId

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
            .lerp(new THREE.Color('#fff0d8'), 0.18),
        },
        uOpacity: { value: 0 },
        uPointSize: { value: 2.2 },
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

    const initialAnchor = transition.resultId
      ? findResultAnchor(scene, transition.resultId, bodies)
      : findFragmentSystemAnchor(source.id, bodies)

    scene.add(mesh, particles)
    active.set(source.id, {
      source: cloneBody(source),
      startedAt: now,
      mesh,
      material,
      baseOpacity,
      origin: worldPosition.clone(),
      contactPoint: new THREE.Vector3(
        transition.contactPoint.x,
        transition.contactPoint.y,
        transition.contactPoint.z,
      ),
      surfaceRadius,
      resultId: transition.resultId,
      anchorOrigin: initialAnchor?.clone() ?? null,
      lastAnchorPosition: initialAnchor?.clone() ?? null,
      lastAnchorObservedAt: initialAnchor ? now : null,
      anchorVelocityPerMs: new THREE.Vector3(),
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
      resultId: transition.resultId,
    })
  }

  const updateVisual = (visual: HandoffVisual, bodies: BodyState[], now: number) => {
    const elapsedMs = Math.max(0, now - visual.startedAt)
    const fractureProgress = getCollisionHandoffFractureProgress(elapsedMs)
    const breakupProgress = getCollisionHandoffBreakupProgress(elapsedMs)
    const particleProgress = getCollisionHandoffParticleProgress(elapsedMs)

    visual.material.uniforms.uCollisionHandoffFracture.value = fractureProgress
    visual.material.uniforms.uCollisionHandoffBreakup.value = breakupProgress
    visual.material.uniforms.uCollisionHandoffCompression.value =
      getCollisionHandoffCompression(elapsedMs)
    if (visual.material.uniforms.uOpacity) {
      visual.material.uniforms.uOpacity.value =
        visual.baseOpacity * getCollisionHandoffSourceOpacity(elapsedMs)
    }

    // The preserved surface is a rendering handoff, not a second physical body.
    // Keep the collision-time source/result offset, but carry the whole snapshot
    // by the live result (or fragment-system centroid) translation so it cannot
    // remain behind as a stationary full-body ghost at the impact coordinates.
    const currentAnchor = resolveAnchor(visual, bodies, now)
    const anchorDelta = currentAnchor && visual.anchorOrigin
      ? currentAnchor.clone().sub(visual.anchorOrigin)
      : new THREE.Vector3()
    visual.mesh.position.copy(visual.origin).add(anchorDelta)

    const contactX = visual.contactPoint.x + anchorDelta.x
    const contactY = visual.contactPoint.y + anchorDelta.y
    const contactZ = visual.contactPoint.z + anchorDelta.z
    const travel = visual.surfaceRadius * particleProgress * 2.15
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3
      const direction = visual.particleDirections[index]
      const distance = travel * visual.particleSpeeds[index]
      visual.particlePositions[offset] = contactX + direction.x * distance
      visual.particlePositions[offset + 1] = contactY + direction.y * distance
      visual.particlePositions[offset + 2] = contactZ + direction.z * distance
    }
    const position = visual.particleGeometry.getAttribute('position') as THREE.BufferAttribute
    position.needsUpdate = true

    const emissionEnvelope = particleProgress <= 0
      ? 0
      : Math.sin(particleProgress * Math.PI) * Math.pow(1 - particleProgress, 0.22)
    visual.particleMaterial.uniforms.uOpacity.value = emissionEnvelope * 0.56
    visual.particleMaterial.uniforms.uPointSize.value = 1.7 + (1 - particleProgress) * 0.8

    return elapsedMs >= COLLISION_HANDOFF_DURATION_MS
  }

  const updateAbsorptionVisual = (visual: AbsorptionVisual, now: number) => {
    const elapsedMs = Math.max(0, now - visual.startedAt)
    const contactProgress = getCollisionAbsorptionContactProgress(elapsedMs)
    const sinkProgress = getCollisionAbsorptionSinkProgress(elapsedMs)
    const contactPosition = visual.origin.clone().lerp(visual.contactPoint, contactProgress)
    const targetPosition = visual.contactPoint.clone()

    if (visual.resultId) {
      const resultMesh = findLiveBodyMesh(scene, visual.resultId)
      if (resultMesh) {
        resultMesh.updateWorldMatrix(true, false)
        resultMesh.getWorldPosition(targetPosition)
      }
    }

    // Preserve the incoming body's silhouette through contact, then pull it
    // continuously through the contact patch toward the moving remnant center.
    // Shrink/fade begin only after sinking starts, avoiding the old pop-out.
    visual.mesh.position.lerpVectors(contactPosition, targetPosition, sinkProgress * 0.96)
    visual.mesh.scale.copy(visual.baseScale).multiplyScalar(getCollisionAbsorptionScale(elapsedMs))
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
          if (transition.outcome === 'disrupted') createVisual(transition, bodies, now)
          else if (transition.outcome === 'absorbed') createAbsorptionVisual(transition, now)
        })
      }

      active.forEach((visual, id) => {
        if (updateVisual(visual, bodies, now)) disposeVisual(id)
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
