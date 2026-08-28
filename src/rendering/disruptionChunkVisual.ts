import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import type { CollisionVisualLifecycle, CollisionVisualTransition } from './collisionVisualOutcome'

export const DISRUPTION_CHUNK_MIN_COUNT = 10
export const DISRUPTION_CHUNK_MAX_COUNT = 14

export type DisruptionChunkDescriptor = {
  initialCenter: THREE.Vector3
  direction: THREE.Vector3
  scale: THREE.Vector3
  baseRotation: THREE.Quaternion
  rotationAxis: THREE.Vector3
  rotationRate: number
  releaseThreshold: number
  travelScale: number
  isLarge: boolean
}

export type DisruptionChunkVisual = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  material: THREE.MeshStandardMaterial
  descriptors: DisruptionChunkDescriptor[]
  sourceRadius: number
  contactPoint: THREE.Vector3
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
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

function normalizeVector(value: Vec3) {
  const result = new THREE.Vector3(value.x, value.y, value.z)
  if (result.lengthSq() <= 1e-12) return result.set(1, 0, 0)
  return result.normalize()
}

function makeTangentBasis(contactNormal: Vec3) {
  const normal = normalizeVector(contactNormal)
  const helper = Math.abs(normal.y) < 0.86
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0)
  const tangentA = new THREE.Vector3().crossVectors(normal, helper).normalize()
  const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize()
  return { normal, tangentA, tangentB }
}

function makeChunkDirection(
  sourceId: string,
  index: number,
  normal: THREE.Vector3,
  tangentA: THREE.Vector3,
  tangentB: THREE.Vector3,
) {
  const seed = getBodySeed(`${sourceId}:solid-chunk-direction:${index}`)
  const angle = seededValue(seed * 23.81 + index * 1.17) * Math.PI * 2
  const lateral = 0.70 + seededValue(seed * 31.19 + index * 0.73) * 0.28
  const backscatter = 0.10 + seededValue(seed * 47.03 + index * 1.91) * 0.20
  return tangentA.clone()
    .multiplyScalar(Math.cos(angle) * lateral)
    .addScaledVector(tangentB, Math.sin(angle) * lateral)
    .addScaledVector(normal, -backscatter)
    .normalize()
}

export function createDisruptionChunkDescriptors(
  source: BodyState,
  transition: CollisionVisualTransition,
): DisruptionChunkDescriptor[] {
  const sourceRadius = Math.max(Math.abs(source.radius), 0.005)
  const countSeed = seededValue(getBodySeed(`${source.id}:solid-chunk-count`) * 71.13)
  const count = DISRUPTION_CHUNK_MIN_COUNT + Math.floor(
    countSeed * (DISRUPTION_CHUNK_MAX_COUNT - DISRUPTION_CHUNK_MIN_COUNT + 1),
  )
  const { normal, tangentA, tangentB } = makeTangentBasis(transition.contactNormal)
  const contactPoint = new THREE.Vector3(
    transition.contactPoint.x,
    transition.contactPoint.y,
    transition.contactPoint.z,
  )

  return Array.from({ length: count }, (_, index) => {
    const seed = getBodySeed(`${source.id}:solid-chunk:${index}`)
    const angle = seededValue(seed * 17.73 + index * 0.61) * Math.PI * 2
    const radial01 = Math.sqrt(seededValue(seed * 29.37 + index * 1.43))
    const capRadius = sourceRadius * (0.035 + radial01 * 0.29)
    const inwardDepth = sourceRadius * (0.012 + radial01 * radial01 * 0.045)
    const initialCenter = contactPoint.clone()
      .addScaledVector(tangentA, Math.cos(angle) * capRadius)
      .addScaledVector(tangentB, Math.sin(angle) * capRadius)
      .addScaledVector(normal, -inwardDepth)

    const largeSeed = seededValue(seed * 37.91 + index * 2.11)
    const isLarge = index % 4 === 0 || largeSeed > 0.78
    const baseSize = sourceRadius * (
      isLarge
        ? 0.115 + seededValue(seed * 43.17 + index * 0.87) * 0.055
        : 0.065 + seededValue(seed * 41.63 + index * 1.31) * 0.050
    )
    const scale = new THREE.Vector3(
      baseSize * (0.82 + seededValue(seed * 53.29 + index * 0.43) * 0.36),
      baseSize * (0.76 + seededValue(seed * 59.71 + index * 0.97) * 0.42),
      baseSize * (0.80 + seededValue(seed * 61.13 + index * 1.59) * 0.38),
    )

    const rotationAxis = new THREE.Vector3(
      seededValue(seed * 67.17 + index * 0.31) * 2 - 1,
      seededValue(seed * 71.89 + index * 0.83) * 2 - 1,
      seededValue(seed * 73.47 + index * 1.27) * 2 - 1,
    )
    if (rotationAxis.lengthSq() <= 1e-8) rotationAxis.set(0, 1, 0)
    rotationAxis.normalize()

    const baseRotationAxis = new THREE.Vector3(
      seededValue(seed * 79.37 + index * 0.29) * 2 - 1,
      seededValue(seed * 83.11 + index * 0.71) * 2 - 1,
      seededValue(seed * 89.03 + index * 1.09) * 2 - 1,
    )
    if (baseRotationAxis.lengthSq() <= 1e-8) baseRotationAxis.set(1, 0, 0)
    baseRotationAxis.normalize()
    const baseRotation = new THREE.Quaternion().setFromAxisAngle(
      baseRotationAxis,
      seededValue(seed * 97.31 + index * 1.77) * Math.PI * 2,
    )

    return {
      initialCenter,
      direction: makeChunkDirection(source.id, index, normal, tangentA, tangentB),
      scale,
      baseRotation,
      rotationAxis,
      rotationRate: (isLarge ? 0.28 : 0.48) + seededValue(seed * 101.93 + index * 0.57) * (isLarge ? 0.34 : 0.62),
      releaseThreshold: seededValue(seed * 103.57 + index * 1.37) * 0.42,
      travelScale: isLarge
        ? 0.34 + seededValue(seed * 107.11 + index * 0.67) * 0.24
        : 0.52 + seededValue(seed * 109.79 + index * 1.13) * 0.34,
      isLarge,
    }
  })
}

export function getDisruptionChunkSeparation(
  descriptor: DisruptionChunkDescriptor,
  sourceRadius: number,
  fractureProgress: number,
  transferProgress: number,
  remnantSettleProgress = 0,
) {
  const releaseProgress = smooth01(
    (fractureProgress - descriptor.releaseThreshold) /
      Math.max(0.001, 1 - descriptor.releaseThreshold),
  )
  const fractureDistance = sourceRadius * descriptor.travelScale * 0.52 * releaseProgress
  const transferDistance = sourceRadius * descriptor.travelScale * 0.78 * transferProgress
  const settleDistance = sourceRadius * descriptor.travelScale * 0.12 * remnantSettleProgress
  return fractureDistance + transferDistance + settleDistance
}

export function getDisruptionChunkOpacity(lifecycle: CollisionVisualLifecycle) {
  if (lifecycle.isComplete) return 0
  switch (lifecycle.phase) {
    case 'IMPACT':
      return 0.46 + lifecycle.phaseProgress * 0.24
    case 'FRACTURE':
      return 0.70 + lifecycle.phaseProgress * 0.12
    case 'TRANSFER':
      return 0.82 - lifecycle.phaseProgress * 0.28
    case 'REMNANT_SETTLE':
      return 0.54 * Math.pow(1 - lifecycle.phaseProgress, 1.35)
  }
}

export function createDisruptionChunkVisual(
  source: BodyState,
  transition: CollisionVisualTransition,
  sharedGeometry: THREE.BufferGeometry,
): DisruptionChunkVisual {
  const descriptors = createDisruptionChunkDescriptors(source, transition)
  const sourceColor = new THREE.Color(source.color)
  const material = new THREE.MeshStandardMaterial({
    color: sourceColor.clone().lerp(new THREE.Color('#ffd3a8'), 0.08),
    emissive: sourceColor.clone().lerp(new THREE.Color('#ff6f32'), 0.26),
    emissiveIntensity: 0.18,
    roughness: 0.86,
    metalness: 0.02,
    flatShading: true,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
  })
  const mesh = new THREE.InstancedMesh(sharedGeometry, material, descriptors.length)
  mesh.frustumCulled = false
  mesh.renderOrder = 15
  mesh.userData.collisionVisualSolidChunks = true
  mesh.userData.collisionVisualSourceId = source.id
  mesh.userData.collisionVisualResultId = transition.resultId
  mesh.userData.collisionVisualOutcome = 'disrupted'
  mesh.userData.collisionVisualPhase = 'IMPACT'
  mesh.userData.collisionVisualContactPoint = { ...transition.contactPoint }
  mesh.userData.collisionVisualContactNormal = { ...transition.contactNormal }

  return {
    mesh,
    material,
    descriptors,
    sourceRadius: Math.max(Math.abs(source.radius), 0.005),
    contactPoint: new THREE.Vector3(
      transition.contactPoint.x,
      transition.contactPoint.y,
      transition.contactPoint.z,
    ),
  }
}

export function updateDisruptionChunkVisual(
  visual: DisruptionChunkVisual,
  lifecycle: CollisionVisualLifecycle,
  fractureProgress: number,
  transferProgress: number,
  anchorDelta: THREE.Vector3,
  anchorOrigin: THREE.Vector3 | null,
) {
  visual.mesh.position.copy(anchorDelta)
  visual.mesh.userData.collisionVisualPhase = lifecycle.phase
  visual.material.opacity = getDisruptionChunkOpacity(lifecycle)
  visual.material.emissiveIntensity = lifecycle.phase === 'FRACTURE'
    ? 0.18 + (1 - lifecycle.phaseProgress) * 0.34
    : lifecycle.phase === 'IMPACT'
      ? 0.22 + lifecycle.phaseProgress * 0.14
      : lifecycle.phase === 'TRANSFER'
        ? 0.12 * (1 - lifecycle.phaseProgress)
        : 0.04 * (1 - lifecycle.phaseProgress)

  const settleProgress = lifecycle.phase === 'REMNANT_SETTLE' ? lifecycle.phaseProgress : 0
  const ownershipDrift = anchorOrigin
    ? anchorOrigin.clone().sub(visual.contactPoint).multiplyScalar(transferProgress * 0.52)
    : new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const spin = new THREE.Quaternion()

  visual.descriptors.forEach((descriptor, index) => {
    const separation = getDisruptionChunkSeparation(
      descriptor,
      visual.sourceRadius,
      fractureProgress,
      transferProgress,
      settleProgress,
    )
    const releaseProgress = smooth01(
      (fractureProgress - descriptor.releaseThreshold) /
        Math.max(0.001, 1 - descriptor.releaseThreshold),
    )
    const position = descriptor.initialCenter.clone()
      .addScaledVector(descriptor.direction, separation)
      .addScaledVector(ownershipDrift, 0.72 + (index % 3) * 0.09)

    const spinProgress = releaseProgress * 0.72 + transferProgress * 1.18 + settleProgress * 0.36
    spin.setFromAxisAngle(descriptor.rotationAxis, descriptor.rotationRate * spinProgress)
    rotation.copy(descriptor.baseRotation).multiply(spin)
    matrix.compose(position, rotation, descriptor.scale)
    visual.mesh.setMatrixAt(index, matrix)
  })
  visual.mesh.instanceMatrix.needsUpdate = true
}

export function disposeDisruptionChunkVisual(visual: DisruptionChunkVisual) {
  visual.material.dispose()
}
