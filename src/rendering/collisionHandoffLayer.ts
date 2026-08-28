import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import {
  COLLISION_REMNANT_FORMATION_START_MS,
  COLLISION_VISUAL_TIMING_MS,
  findCollisionVisualTransitions,
  getCollisionVisualLifecycle,
  isCollisionVisualDescendant,
  type CollisionVisualLifecycle,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'

export const COLLISION_HANDOFF_DURATION_MS = COLLISION_VISUAL_TIMING_MS.remnantSettleEnd
export const COLLISION_IMPACT_HOLD_END_MS = COLLISION_VISUAL_TIMING_MS.impactEnd
export const COLLISION_FRACTURE_END_MS = COLLISION_VISUAL_TIMING_MS.fractureEnd
export const COLLISION_TRANSFER_END_MS = COLLISION_VISUAL_TIMING_MS.transferEnd
export const COLLISION_PRODUCT_REVEAL_DELAY_MS = COLLISION_REMNANT_FORMATION_START_MS

const MAX_ACTIVE_TRANSFERS = 8
const DISRUPTION_PARTICLE_COUNT = 48
const ABSORPTION_PARTICLE_COUNT = 28

export type CollisionSourceVisualState = {
  sourceId: string
  resultId: string | null
  outcome: 'disrupted' | 'absorbed'
  lifecycle: CollisionVisualLifecycle
}

type SourceTransferVisual = CollisionSourceVisualState & {
  source: BodyState
  startedAt: number
  contactPoint: THREE.Vector3
  surfaceRadius: number
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
  return getCollisionVisualLifecycle(elapsedMs).progress
}

export function getCollisionHandoffFractureProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_IMPACT_HOLD_END_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_IMPACT_HOLD_END_MS) /
      Math.max(1, COLLISION_FRACTURE_END_MS - COLLISION_IMPACT_HOLD_END_MS),
  )
}

export function getCollisionHandoffTransferProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_FRACTURE_END_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_FRACTURE_END_MS) /
      Math.max(1, COLLISION_TRANSFER_END_MS - COLLISION_FRACTURE_END_MS),
  )
}

export function getCollisionHandoffParticleProgress(elapsedMs: number) {
  if (elapsedMs <= COLLISION_IMPACT_HOLD_END_MS) return 0
  return smooth01(
    (elapsedMs - COLLISION_IMPACT_HOLD_END_MS) /
      Math.max(1, COLLISION_HANDOFF_DURATION_MS - COLLISION_IMPACT_HOLD_END_MS),
  )
}

export function getCollisionTransferParticleOpacity(elapsedMs: number) {
  const lifecycle = getCollisionVisualLifecycle(elapsedMs)
  if (lifecycle.isComplete) return 0
  switch (lifecycle.phase) {
    case 'IMPACT':
      return lifecycle.phaseProgress * 0.16
    case 'FRACTURE':
      return 0.16 + lifecycle.phaseProgress * 0.44
    case 'TRANSFER':
      return 0.60 - lifecycle.phaseProgress * 0.18
    case 'REMNANT_SETTLE':
      return 0.42 * (1 - lifecycle.phaseProgress)
  }
  return 0
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

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length <= 1e-10) return { x: 1, y: 0, z: 0 }
  return { x: value.x / length, y: value.y / length, z: value.z / length }
}

function makeDirection(sourceId: string, index: number, contactNormal: Vec3): Vec3 {
  const base = getBodySeed(`${sourceId}:transfer:${index}`)
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

function findResultAnchor(resultId: string, bodies: BodyState[]) {
  const resultBody = bodies.find((body) => body.id === resultId)
  return resultBody ? bodyPosition(resultBody) : null
}

function resolveAnchor(visual: SourceTransferVisual, bodies: BodyState[], now: number) {
  const resolved = visual.resultId
    ? findResultAnchor(visual.resultId, bodies)
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

function createParticleMaterial(source: BodyState) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: {
        value: new THREE.Color(source.color).lerp(new THREE.Color('#fff0d8'), 0.18),
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
}

export function createCollisionHandoffLayer(scene: THREE.Scene) {
  const active = new Map<string, SourceTransferVisual>()
  let previousBodies: BodyState[] | null = null

  const disposeVisual = (id: string) => {
    const visual = active.get(id)
    if (!visual) return
    scene.remove(visual.particles)
    visual.particleMaterial.dispose()
    visual.particleGeometry.dispose()
    active.delete(id)
  }

  const enforceActiveLimit = () => {
    if (active.size < MAX_ACTIVE_TRANSFERS) return
    const oldest = [...active.entries()]
      .sort((a, b) => a[1].startedAt - b[1].startedAt)[0]
    if (oldest) disposeVisual(oldest[0])
  }

  const createVisual = (
    transition: CollisionVisualTransition,
    bodies: BodyState[],
    now: number,
  ) => {
    if (transition.outcome !== 'disrupted' && transition.outcome !== 'absorbed') return
    const source = transition.source
    if (active.has(source.id)) return
    enforceActiveLimit()

    const particleCount = transition.outcome === 'disrupted'
      ? DISRUPTION_PARTICLE_COUNT
      : ABSORPTION_PARTICLE_COUNT
    const particlePositions = new Float32Array(particleCount * 3)
    const particleDirections = Array.from({ length: particleCount }, (_, index) =>
      makeDirection(source.id, index, transition.contactNormal),
    )
    const particleSpeeds = Array.from({ length: particleCount }, (_, index) =>
      0.86 + seededValue(getBodySeed(`${source.id}:speed:${index}`) * 31.7) * 0.46,
    )
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage),
    )
    const particleMaterial = createParticleMaterial(source)
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    particles.frustumCulled = false
    particles.renderOrder = 16
    particles.userData.collisionVisualTransfer = true
    particles.userData.collisionVisualSourceId = source.id
    particles.userData.collisionVisualResultId = transition.resultId
    particles.userData.collisionVisualOutcome = transition.outcome
    particles.userData.collisionVisualPhase = 'IMPACT'

    const initialAnchor = transition.resultId
      ? findResultAnchor(transition.resultId, bodies)
      : findFragmentSystemAnchor(source.id, bodies)

    scene.add(particles)
    active.set(source.id, {
      sourceId: source.id,
      resultId: transition.resultId,
      outcome: transition.outcome,
      lifecycle: getCollisionVisualLifecycle(0),
      source: cloneBody(source),
      startedAt: now,
      contactPoint: new THREE.Vector3(
        transition.contactPoint.x,
        transition.contactPoint.y,
        transition.contactPoint.z,
      ),
      surfaceRadius: Math.max(Math.abs(source.radius), 0.005),
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

  const updateDisruptionParticles = (
    visual: SourceTransferVisual,
    anchorDelta: THREE.Vector3,
  ) => {
    const particleProgress = getCollisionHandoffParticleProgress(visual.lifecycle.elapsedMs)
    const fractureProgress = getCollisionHandoffFractureProgress(visual.lifecycle.elapsedMs)
    const transferProgress = getCollisionHandoffTransferProgress(visual.lifecycle.elapsedMs)
    const travel = visual.surfaceRadius * (
      fractureProgress * 0.34 +
      transferProgress * 1.55 +
      (visual.lifecycle.phase === 'REMNANT_SETTLE' ? visual.lifecycle.phaseProgress * 0.38 : 0)
    )

    visual.particles.position.copy(anchorDelta)
    for (let index = 0; index < visual.particleDirections.length; index += 1) {
      const offset = index * 3
      const direction = visual.particleDirections[index]
      const distance = travel * visual.particleSpeeds[index]
      visual.particlePositions[offset] = visual.contactPoint.x + direction.x * distance
      visual.particlePositions[offset + 1] = visual.contactPoint.y + direction.y * distance
      visual.particlePositions[offset + 2] = visual.contactPoint.z + direction.z * distance
    }
    visual.particleMaterial.uniforms.uPointSize.value = 1.7 + (1 - particleProgress) * 0.8
  }

  const updateAbsorptionParticles = (
    visual: SourceTransferVisual,
    anchorDelta: THREE.Vector3,
  ) => {
    const lifecycle = visual.lifecycle
    let transferProgress = 0
    if (lifecycle.phase === 'FRACTURE') transferProgress = lifecycle.phaseProgress * 0.16
    else if (lifecycle.phase === 'TRANSFER') transferProgress = 0.16 + lifecycle.phaseProgress * 0.72
    else if (lifecycle.phase === 'REMNANT_SETTLE') {
      transferProgress = 0.88 + lifecycle.phaseProgress * 0.12
    }

    const target = visual.anchorOrigin ?? visual.contactPoint
    const pathCenter = visual.contactPoint.clone().lerp(target, transferProgress)
    const curlEnvelope = Math.sin(clamp01(transferProgress) * Math.PI)
    const spread = visual.surfaceRadius * (0.16 * (1 - transferProgress) + 0.035)

    visual.particles.position.copy(anchorDelta)
    for (let index = 0; index < visual.particleDirections.length; index += 1) {
      const offset = index * 3
      const direction = visual.particleDirections[index]
      const distance = spread * visual.particleSpeeds[index] * (0.45 + curlEnvelope * 0.55)
      visual.particlePositions[offset] = pathCenter.x + direction.x * distance
      visual.particlePositions[offset + 1] = pathCenter.y + direction.y * distance
      visual.particlePositions[offset + 2] = pathCenter.z + direction.z * distance
    }
    visual.particleMaterial.uniforms.uPointSize.value = 1.55 + (1 - transferProgress) * 0.55
  }

  const updateVisual = (visual: SourceTransferVisual, bodies: BodyState[], now: number) => {
    const elapsedMs = Math.max(0, now - visual.startedAt)
    visual.lifecycle = getCollisionVisualLifecycle(elapsedMs)
    visual.particles.userData.collisionVisualPhase = visual.lifecycle.phase

    const currentAnchor = resolveAnchor(visual, bodies, now)
    const anchorDelta = currentAnchor && visual.anchorOrigin
      ? currentAnchor.clone().sub(visual.anchorOrigin)
      : new THREE.Vector3()

    if (visual.outcome === 'disrupted') updateDisruptionParticles(visual, anchorDelta)
    else updateAbsorptionParticles(visual, anchorDelta)

    const position = visual.particleGeometry.getAttribute('position') as THREE.BufferAttribute
    position.needsUpdate = true
    visual.particleMaterial.uniforms.uOpacity.value = getCollisionTransferParticleOpacity(elapsedMs)
    return visual.lifecycle.isComplete
  }

  return {
    update(bodies: BodyState[], now = performance.now()) {
      if (previousBodies) {
        findCollisionVisualTransitions(previousBodies, bodies).forEach((transition) => {
          createVisual(transition, bodies, now)
        })
      }

      active.forEach((visual, id) => {
        if (updateVisual(visual, bodies, now)) disposeVisual(id)
      })
      previousBodies = bodies.map(cloneBody)
    },
    getState(sourceId: string): CollisionSourceVisualState | null {
      const visual = active.get(sourceId)
      if (!visual) return null
      return {
        sourceId: visual.sourceId,
        resultId: visual.resultId,
        outcome: visual.outcome,
        lifecycle: { ...visual.lifecycle },
      }
    },
    dispose() {
      Array.from(active.keys()).forEach(disposeVisual)
      previousBodies = null
    },
  }
}
