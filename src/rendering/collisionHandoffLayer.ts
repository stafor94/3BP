import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'

export const COLLISION_HANDOFF_DURATION_MS = 1500
export const COLLISION_IMPACT_HOLD_END_MS = 180
export const COLLISION_FRACTURE_END_MS = 650
export const COLLISION_BREAKUP_END_MS = 1100
export const COLLISION_PRODUCT_REVEAL_DELAY_MS = 240
export const COLLISION_PRODUCT_REVEAL_DURATION_MS = COLLISION_HANDOFF_DURATION_MS
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
  vec3 handoffOrigin = normalize(vec3(
    sin(uCollisionHandoffSeed * 0.071 + 0.8),
    cos(uCollisionHandoffSeed * 0.113 + 1.7),
    sin(uCollisionHandoffSeed * 0.157 + 2.6)
  ) + vec3(0.001, 0.002, 0.003));
  float handoffLocality = 0.5 + 0.5 * dot(handoffNormal, handoffOrigin);

  // Fracture is presentation-only during the 180-650ms phase. It begins at a
  // small deterministic contact-side patch and spreads over the real surface,
  // but it does not remove geometry yet.
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

  // Structural loss is deliberately separate from fracture propagation. No
  // source pixels are discarded before 650ms; at 780ms most of the original
  // silhouette still survives. Only the later breakup phase opens large gaps,
  // while the opacity fade retires the remaining shell near 1.5s.
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

function makeDirection(sourceId: string, index: number): Vec3 {
  const base = getBodySeed(`${sourceId}:handoff:${index}`)
  const z = seededValue(base * 19.17 + index * 0.37) * 2 - 1
  const theta = seededValue(base * 41.31 + index * 1.73) * Math.PI * 2
  const radial = Math.sqrt(Math.max(0, 1 - z * z))
  return {
    x: Math.cos(theta) * radial,
    y: Math.sin(theta) * radial,
    z,
  }
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

function getLineageParts(bodyId: string) {
  return bodyId.split('+').map((part) => part.trim()).filter(Boolean)
}

function isDescendantId(candidateId: string, sourceId: string) {
  const candidateParts = new Set(getLineageParts(candidateId))
  const sourceParts = getLineageParts(sourceId)
  return sourceParts.length > 0 && sourceParts.every((part) => candidateParts.has(part))
}

function isRetirablePhysicalBody(body: BodyState) {
  // Stellar collisions use their dedicated topology transition. Fragments and
  // effect cleanup must never create another full celestial handoff visual.
  return body.bodyType !== 'star' && body.bodyType !== 'effect' && body.bodyType !== 'fragment'
}

export function findCollisionHandoffSources(previous: BodyState[], current: BodyState[]) {
  const currentIds = new Set(current.map((body) => body.id))
  return previous.filter((source) => {
    if (!isRetirablePhysicalBody(source) || currentIds.has(source.id)) return false
    return current.some((candidate) =>
      candidate.bodyType !== 'effect' &&
      candidate.id !== source.id &&
      isDescendantId(candidate.id, source.id),
    )
  })
}

function findLiveBodyMesh(scene: THREE.Scene, bodyId: string) {
  const expectedSeed = getSimulationBodySeed(bodyId)
  let found: LiveBodyMesh | undefined

  scene.traverse((object) => {
    if (found || object.userData.collisionHandoffSnapshot) return
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) return
    const seed = object.material.uniforms.uSeed?.value
    if (typeof seed !== 'number' || Math.abs(seed - expectedSeed) > 1e-5) return
    found = object as LiveBodyMesh
  })

  return found
}

function createPreservedSurfaceMaterial(sourceMaterial: THREE.ShaderMaterial, sourceId: string) {
  const material = sourceMaterial.clone()
  material.uniforms = THREE.UniformsUtils.clone(sourceMaterial.uniforms)
  material.uniforms.uCollisionHandoffFracture = { value: 0 }
  material.uniforms.uCollisionHandoffBreakup = { value: 0 }
  material.uniforms.uCollisionHandoffSeed = { value: getSimulationBodySeed(sourceId) }
  material.transparent = true
  material.depthWrite = false

  if (material.fragmentShader.includes(SOURCE_FRAGMENT_OUTPUT)) {
    material.fragmentShader = `
      uniform float uCollisionHandoffFracture;
      uniform float uCollisionHandoffBreakup;
      uniform float uCollisionHandoffSeed;
    ${material.fragmentShader.replace(
      SOURCE_FRAGMENT_OUTPUT,
      `${preservedSurfaceFractureCode}\n  ${SOURCE_FRAGMENT_OUTPUT}`,
    )}`
    material.needsUpdate = true
  }

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

  const createVisual = (source: BodyState, now: number) => {
    if (active.has(source.id)) return
    const sourceMesh = lastLiveMeshById.get(source.id)

    // Never fabricate a generic replacement sphere. If the real live body mesh
    // was not captured, skip the source ghost and allow the real products to
    // reveal normally rather than showing a visibly unrelated object.
    if (!sourceMesh || !(sourceMesh.material instanceof THREE.ShaderMaterial)) return

    if (active.size >= MAX_ACTIVE_HANDOFFS) {
      const oldest = [...active.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0]
      if (oldest) disposeVisual(oldest[0])
    }

    sourceMesh.updateWorldMatrix(true, false)
    const worldPosition = new THREE.Vector3()
    const worldQuaternion = new THREE.Quaternion()
    const worldScale = new THREE.Vector3()
    sourceMesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)

    const geometry = sourceMesh.geometry.clone()
    const material = createPreservedSurfaceMaterial(sourceMesh.material, source.id)
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
      makeDirection(source.id, index),
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

  const updateVisual = (visual: HandoffVisual, now: number) => {
    const elapsedMs = Math.max(0, now - visual.startedAt)
    const fractureProgress = getCollisionHandoffFractureProgress(elapsedMs)
    const breakupProgress = getCollisionHandoffBreakupProgress(elapsedMs)
    const particleProgress = getCollisionHandoffParticleProgress(elapsedMs)

    // Keep the preserved real surface locked to its exact collision transform.
    // The prior implementation applied velocity drift to a fabricated sphere,
    // which is what produced the huge flat-colored object crossing the camera.
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
      if (!nextIds.has(id) && !active.has(id)) lastLiveMeshById.delete(id)
    })
  }

  return {
    update(bodies: BodyState[], now = performance.now()) {
      if (previousBodies) {
        findCollisionHandoffSources(previousBodies, bodies).forEach((source) => createVisual(source, now))
      }

      active.forEach((visual, id) => {
        if (updateVisual(visual, now)) disposeVisual(id)
      })

      captureCurrentLiveMeshes(bodies)
      previousBodies = bodies.map(cloneBody)
    },
    dispose() {
      Array.from(active.keys()).forEach(disposeVisual)
      lastLiveMeshById.clear()
      previousBodies = null
    },
  }
}
