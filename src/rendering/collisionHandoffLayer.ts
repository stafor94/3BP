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

type HandoffVisual = {
  source: BodyState
  startedAt: number
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  material: THREE.ShaderMaterial
  particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  particleGeometry: THREE.BufferGeometry
  particleMaterial: THREE.ShaderMaterial
  particlePositions: Float32Array
  particleDirections: Vec3[]
  particleSpeeds: number[]
}

const handoffVertexShader = `
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vObjectNormal = normalize(normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const handoffFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFractureProgress;
  uniform float uSeed;

  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x),
        u.y
      ),
      mix(
        mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x),
        u.y
      ),
      u.z
    );
  }

  vec3 fractureOrigin(float seed) {
    vec3 direction = vec3(
      sin(seed * 0.071 + 0.8),
      cos(seed * 0.113 + 1.7),
      sin(seed * 0.157 + 2.6)
    );
    return normalize(direction + vec3(0.001, 0.002, 0.003));
  }

  void main() {
    vec3 normal = normalize(vObjectNormal);
    vec3 worldNormal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 seedOffset = vec3(uSeed * 0.017, -uSeed * 0.031, uSeed * 0.047);
    float broad = valueNoise(normal * 4.2 + seedOffset);
    float fine = valueNoise(normal * 12.5 - seedOffset * 1.7);
    float breakupNoise = broad * 0.68 + fine * 0.32;

    // Fracture begins at one deterministic contact-side patch and spreads across
    // the original silhouette. uFractureProgress remains zero during impact hold,
    // so the source surface is effectively intact for the opening phase.
    float locality = 0.5 + 0.5 * dot(normal, fractureOrigin(uSeed));
    float localizedProgress = clamp(
      uFractureProgress * 1.24 - (1.0 - locality) * 0.34,
      0.0,
      1.0
    );
    float breakupEdge = mix(-0.30, 1.18, localizedProgress);
    float survivingSurface = smoothstep(
      breakupEdge - 0.11,
      breakupEdge + 0.13,
      breakupNoise
    );
    float fractureBand = 1.0 - smoothstep(
      0.025,
      0.15,
      abs(breakupNoise - breakupEdge)
    );
    float rim = pow(1.0 - max(dot(worldNormal, viewDirection), 0.0), 2.0);
    float fractureGlow = fractureBand * smoothstep(0.02, 0.48, localizedProgress);
    float alpha = uOpacity * survivingSurface * (0.76 + rim * 0.24);
    if (alpha <= 0.004) discard;

    vec3 hot = mix(uColor, vec3(1.0, 0.91, 0.75), 0.58);
    vec3 color = mix(uColor, hot, clamp(fractureGlow * 0.96 + rim * 0.12, 0.0, 1.0));
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

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
      Math.max(1, COLLISION_BREAKUP_END_MS - COLLISION_IMPACT_HOLD_END_MS),
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
  // Stellar collisions already have a dedicated topology occlusion/remnant
  // transition. Stacking this solid-body breakup on top would damage the
  // dedicated stellar presentation, so stars remain excluded here.
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

export function createCollisionHandoffLayer(scene: THREE.Scene) {
  const sphereGeometry = new THREE.SphereGeometry(1, 32, 20)
  const active = new Map<string, HandoffVisual>()
  let previousBodies: BodyState[] | null = null

  const disposeVisual = (id: string) => {
    const visual = active.get(id)
    if (!visual) return
    scene.remove(visual.mesh, visual.particles)
    visual.material.dispose()
    visual.particleMaterial.dispose()
    visual.particleGeometry.dispose()
    active.delete(id)
  }

  const createVisual = (source: BodyState, now: number) => {
    if (active.has(source.id)) return
    if (active.size >= MAX_ACTIVE_HANDOFFS) {
      const oldest = [...active.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0]
      if (oldest) disposeVisual(oldest[0])
    }

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(source.color) },
        uOpacity: { value: 0.99 },
        uFractureProgress: { value: 0 },
        uSeed: { value: getBodySeed(source.id) * 1000 },
      },
      vertexShader: handoffVertexShader,
      fragmentShader: handoffFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(sphereGeometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 13
    mesh.position.set(source.position.x, source.position.y, source.position.z)
    mesh.scale.setScalar(Math.max(source.radius, 0.005))

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
        uColor: { value: new THREE.Color(source.color).lerp(new THREE.Color('#fff0d8'), 0.24) },
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
    particles.renderOrder = 15

    scene.add(mesh, particles)
    active.set(source.id, {
      source: cloneBody(source),
      startedAt: now,
      mesh,
      material,
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
    const overallProgress = getCollisionHandoffProgress(elapsedMs)
    const fractureProgress = getCollisionHandoffFractureProgress(elapsedMs)
    const particleProgress = getCollisionHandoffParticleProgress(elapsedMs)
    const elapsedSeconds = elapsedMs / 1000
    const source = visual.source
    const driftScale = 0.34
    const drift = {
      x: source.velocity.x * elapsedSeconds * driftScale,
      y: source.velocity.y * elapsedSeconds * driftScale,
      z: source.velocity.z * elapsedSeconds * driftScale,
    }

    visual.mesh.position.set(
      source.position.x + drift.x,
      source.position.y + drift.y,
      source.position.z + drift.z,
    )
    const impactPulseProgress = clamp01(elapsedMs / COLLISION_FRACTURE_END_MS)
    const pulse = Math.sin(impactPulseProgress * Math.PI) * 0.018 * (1 - overallProgress)
    const lateCollapse = smooth01(
      (elapsedMs - COLLISION_BREAKUP_END_MS) /
        Math.max(1, COLLISION_HANDOFF_DURATION_MS - COLLISION_BREAKUP_END_MS),
    )
    visual.mesh.scale.setScalar(
      Math.max(source.radius, 0.005) * (1 + pulse - lateCollapse * 0.035),
    )
    visual.material.uniforms.uFractureProgress.value = fractureProgress
    visual.material.uniforms.uOpacity.value = getCollisionHandoffSourceOpacity(elapsedMs)

    // Particles originate at the old surface and separate only after fracture is
    // visibly underway; particleProgress is exactly zero for the first ~19%.
    const travel = source.radius * (0.94 + particleProgress * 2.2)
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3
      const direction = visual.particleDirections[index]
      const distance = travel * visual.particleSpeeds[index]
      visual.particlePositions[offset] = source.position.x + drift.x + direction.x * distance
      visual.particlePositions[offset + 1] = source.position.y + drift.y + direction.y * distance
      visual.particlePositions[offset + 2] = source.position.z + drift.z + direction.z * distance
    }
    const position = visual.particleGeometry.getAttribute('position') as THREE.BufferAttribute
    position.needsUpdate = true
    const emissionEnvelope = particleProgress <= 0
      ? 0
      : Math.sin(particleProgress * Math.PI) * Math.pow(1 - particleProgress, 0.16)
    visual.particleMaterial.uniforms.uOpacity.value = emissionEnvelope * 0.78
    visual.particleMaterial.uniforms.uPointSize.value = 2.0 + (1 - particleProgress) * 1.25

    return elapsedMs >= COLLISION_HANDOFF_DURATION_MS
  }

  return {
    update(bodies: BodyState[], now = performance.now()) {
      if (previousBodies) {
        findCollisionHandoffSources(previousBodies, bodies).forEach((source) => createVisual(source, now))
      }
      previousBodies = bodies.map(cloneBody)

      active.forEach((visual, id) => {
        if (updateVisual(visual, now)) disposeVisual(id)
      })
    },
    dispose() {
      Array.from(active.keys()).forEach(disposeVisual)
      previousBodies = null
      sphereGeometry.dispose()
    },
  }
}
