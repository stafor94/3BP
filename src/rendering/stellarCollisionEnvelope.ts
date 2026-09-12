import * as THREE from 'three'
import type { BodyState, StellarCollisionPresentation, StellarCollisionSource } from '../types'
import {
  getStellarCollisionTimeline,
  STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
} from '../stellarCollisionTimeline'
import {
  createStellarPhotosphereMaterialValues,
  getResolvedStellarPhotosphereColor,
  getStellarPhotosphereFrame,
  updateStellarPhotosphereMaterial,
} from './stellarPhotosphereMaterial'

const AXIAL = 36
const RADIAL = 24
const VERTICES_PER_RING = RADIAL + 1
const VERTEX_COUNT = (AXIAL + 1) * VERTICES_PER_RING
const HALO_STRIDE = 2
const AXIS_EPSILON_SQUARED = 1e-18
const VOLUME_EPSILON = 1e-12
const FULL_CIRCLE = Math.PI * 2
const RADIAL_ANGLE_STEP = FULL_CIRCLE / RADIAL
export const STELLAR_SETTLE_SECONDS = STELLAR_COLLISION_SETTLE_DURATION_SECONDS
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t) }
const vector = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)
const star = (s: StellarCollisionSource): BodyState => ({ ...s, name: s.id, bodyType: 'star' })
const sphereVolume = (radius: number) => 4 * Math.PI * Math.max(0, radius) ** 3 / 3

function seed(id: string) {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return (hash >>> 0) / 4294967295 * 1000
}

function deterministicAxis(key: string) {
  const phase = seed(key) * 0.019739
  const z = Math.sin(phase * 0.73) * 0.58
  const radial = Math.sqrt(Math.max(0, 1 - z * z))
  return new THREE.Vector3(radial * Math.cos(phase), radial * Math.sin(phase), z)
}

function stablePairAxis(
  a: Pick<StellarCollisionSource, 'position' | 'velocity'>,
  b: Pick<StellarCollisionSource, 'position' | 'velocity'>,
  eventKey: string,
) {
  const delta = vector(b.position).sub(vector(a.position))
  if (delta.lengthSq() > AXIS_EPSILON_SQUARED) return delta.normalize()

  const relativeVelocity = vector(b.velocity).sub(vector(a.velocity))
  if (relativeVelocity.lengthSq() > AXIS_EPSILON_SQUARED) return relativeVelocity.normalize()
  return deterministicAxis(eventKey)
}

function envelopeColor(body: BodyState) {
  return new THREE.Color(getResolvedStellarPhotosphereColor(body))
}

export type EnvelopeShape = {
  center: THREE.Vector3
  axis: THREE.Vector3
  min: number
  max: number
  radius: (x: number, angle: number) => number
  colorMix: (x: number) => number
  colorA: THREE.Color
  colorB: THREE.Color
  body: BodyState
  /** Presentation-only target volume in world units cubed. */
  targetVolume: number
}

type StellarRenderObjects = {
  photosphere: THREE.Object3D
  corona: THREE.Object3D
  secondaryGlow: THREE.Object3D
}

type StellarRenderObjectResolver = (bodyId: string) => StellarRenderObjects | undefined

type HiddenRenderObject = {
  bodyId: string
  visible: boolean
}

type NormalTopology = {
  logicalIndexByVertex: Int32Array
  representativeByLogical: Int32Array
  accumulatedNormals: Float32Array
}

type EnvelopeSamples = {
  x: Float64Array
  radii: Float32Array
  areas: Float64Array
}

function getPresentationTimeline(state: StellarCollisionPresentation) {
  const contactDurationSeconds = state.contactDurationSeconds ?? state.duration
  const eventAgeSeconds = state.eventAgeSeconds ?? (
    state.phase === 'settle'
      ? contactDurationSeconds + state.elapsed
      : state.progress * contactDurationSeconds
  )
  return getStellarCollisionTimeline({
    eventAgeSeconds,
    contactDurationSeconds,
    settleDurationSeconds: state.settleDurationSeconds ?? STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
  })
}

function ellipsoidRadiusSquared(x: number, center: number, volumeRadius: number, axialScale: number) {
  const safeRadius = Math.max(0, volumeRadius)
  const safeAxialScale = Math.max(0.2, axialScale)
  const semiAxis = Math.max(1e-9, safeRadius * safeAxialScale)
  const transverseRadius = safeRadius / Math.sqrt(safeAxialScale)
  const u = (x - center) / semiAxis
  if (Math.abs(u) >= 1) return 0
  return transverseRadius * transverseRadius * (1 - u * u)
}

function localFacingFactor(localU: number, facingPositive: boolean, strength: number) {
  const facingU = facingPositive ? localU : -localU
  const facing = smooth((facingU + 0.12) / 1.12)
  const equator = Math.max(0, 1 - localU * localU)
  return Math.max(0.72, 1 + strength * (0.34 * equator - 0.58 * facing))
}

/**
 * Presentation-only connected stellar envelope. The existing event timings stay
 * unchanged; contact, transfer and settle progress only drive continuous shape
 * parameters. This is a profile approximation, not a fluid solver.
 */
export function getMergedEnvelopeShape(state: StellarCollisionPresentation, result?: BodyState): EnvelopeShape {
  const [a, b] = state.sources
  const eventKey = state.eventId ?? state.key
  const totalMass = Math.max(a.mass + b.mass, 1e-9)
  const axis = stablePairAxis(a, b, eventKey)
  const sourceDistance = vector(b.position).distanceTo(vector(a.position))
  const sourceCenter = vector(a.position)
    .multiplyScalar(a.mass / totalMass)
    .addScaledVector(vector(b.position), b.mass / totalMass)
  const timeline = getPresentationTimeline(state)
  const contact = timeline.contactProgress
  const transfer = timeline.transferProgress
  const settle = state.phase === 'settle' ? timeline.settleProgress : 0
  const target = state.targets[0] ?? {
    ...a,
    mass: a.mass + b.mass,
    radius: Math.cbrt(a.radius ** 3 + b.radius ** 3),
  }
  const resultBody = result ?? star(target)
  const resultRadius = result?.radius ?? target.radius

  // Follow the actual remnant motion immediately after solver handoff. The only
  // thing that relaxes is the local contact-frame offset inherited at the handoff.
  const center = sourceCenter.clone()
  if (result && state.phase === 'settle') {
    const handoffOffset = sourceCenter.clone().sub(vector(target.position))
    center.copy(vector(result.position).addScaledVector(handoffOffset, 1 - settle))
  }

  const sourceVolumeA = a.radius ** 3
  const sourceVolumeB = b.radius ** 3
  const smallerIsA = a.mass < b.mass || (a.mass === b.mass && a.radius <= b.radius)
  const volumeA = smallerIsA
    ? sourceVolumeA * (1 - transfer)
    : sourceVolumeA + sourceVolumeB * transfer
  const volumeB = smallerIsA
    ? sourceVolumeB + sourceVolumeA * transfer
    : sourceVolumeB * (1 - transfer)
  const radiusA = Math.cbrt(Math.max(0, volumeA))
  const radiusB = Math.cbrt(Math.max(0, volumeB))
  const minSourceRadius = Math.max(1e-6, Math.min(a.radius, b.radius))

  // Do not collapse the two centers early. Contact compression contributes only
  // a small part of center convergence; transferred volume owns the rest.
  const centerConvergence = smooth(contact * 0.12 + transfer * 0.88)
  let ca = -sourceDistance * b.mass / totalMass * (1 - centerConvergence)
  let cb = sourceDistance * a.mass / totalMass * (1 - centerConvergence)

  // The donor becomes an axially elongated lobe while losing volume rather than
  // shrinking as a uniformly scaled sphere. Its center also drifts toward the
  // receiver so its tip and section radius vanish together.
  const donorElongation = (0.06 * contact + 0.28 * transfer) * (1 - settle)
  const receiverElongation = 0.045 * contact * (1 - transfer) * (1 - settle)
  const approachA = 0.035 * Math.min(1, b.mass / Math.max(a.mass, 1e-9))
  const approachB = 0.035 * Math.min(1, a.mass / Math.max(b.mass, 1e-9))
  const axialScaleA = 1 + approachA * (1 - transfer) + (smallerIsA ? donorElongation : receiverElongation)
  const axialScaleB = 1 + approachB * (1 - transfer) + (smallerIsA ? receiverElongation : donorElongation)
  const donorShift = minSourceRadius * 0.18 * transfer * (1 - settle)
  if (smallerIsA) ca += donorShift
  else cb -= donorShift

  const remnantBlend = smooth(clamp01(transfer * 0.66 + settle * 0.46))
  const lobeMin = Math.min(ca - radiusA * axialScaleA, cb - radiusB * axialScaleB)
  const lobeMax = Math.max(ca + radiusA * axialScaleA, cb + radiusB * axialScaleB)
  const contactCompression = 0.035 + 0.105 * smooth(contact)
  const neckProgress = smooth(Math.max(contact, transfer)) * (1 - remnantBlend)
  const neckRadius = minSourceRadius * 0.40 * neckProgress
  const neckCenter = (ca + cb) * 0.5
  const neckHalfSpan = Math.max(
    minSourceRadius * 0.38,
    Math.abs(cb - ca) * 0.55 + minSourceRadius * 0.12,
  )

  const massAsymmetry = (a.mass - b.mass) / totalMass
  const remnantDeformation = 0.095 * (1 - settle) * smooth(clamp01(0.2 + transfer * 0.8))
  const finalLeft = -resultRadius * (1 + remnantDeformation * (0.34 - massAsymmetry * 0.22))
  const finalRight = resultRadius * (1 + remnantDeformation * (0.34 + massAsymmetry * 0.22))
  const min = THREE.MathUtils.lerp(lobeMin, finalLeft, remnantBlend)
  const max = THREE.MathUtils.lerp(lobeMax, finalRight, remnantBlend)

  const targetColor = envelopeColor(resultBody)
  const colorConvergence = smooth(clamp01(transfer * 0.68 + settle * 0.52))
  const colorA = envelopeColor(star(a)).lerp(targetColor, colorConvergence)
  const colorB = envelopeColor(star(b)).lerp(targetColor, colorConvergence)
  const colorCenter = (ca + cb) * 0.5
  const colorHalfWidth = minSourceRadius * (0.06 + transfer * 0.72 + settle * 0.22)
  const sourceDisplayVolume = sphereVolume(a.radius) + sphereVolume(b.radius)
  const resultDisplayVolume = sphereVolume(resultRadius)
  const targetVolume = THREE.MathUtils.lerp(sourceDisplayVolume, resultDisplayVolume, settle)

  return {
    center,
    axis,
    min,
    max,
    body: resultBody,
    targetVolume,
    colorA,
    colorB,
    colorMix: (x) => smooth(
      (x - (colorCenter - colorHalfWidth)) / Math.max(colorHalfWidth * 2, 1e-9),
    ),
    radius: (x, angle) => {
      const t = (x - min) / Math.max(max - min, 1e-9)
      const ux = THREE.MathUtils.lerp(lobeMin, lobeMax, t)
      const localA = (ux - ca) / Math.max(radiusA * axialScaleA, 1e-9)
      const localB = (ux - cb) / Math.max(radiusB * axialScaleB, 1e-9)
      let qa = ellipsoidRadiusSquared(ux, ca, radiusA, axialScaleA)
      let qb = ellipsoidRadiusSquared(ux, cb, radiusB, axialScaleB)
      qa *= localFacingFactor(localA, true, contactCompression * (1 - transfer)) ** 2
      qb *= localFacingFactor(localB, false, contactCompression * (1 - transfer)) ** 2

      const neckDistance = Math.abs(ux - neckCenter) / Math.max(neckHalfSpan, 1e-9)
      const neckWindow = smooth(1 - neckDistance)
      const neckSq = neckRadius * neckRadius * neckWindow * neckWindow
      const connectedUnion = Math.sqrt(Math.max(0, qa, qb, neckSq))

      // Once the union becomes a remnant, keep only a fixed asymmetric memory of
      // the impact axis. No time-phase oscillation or random wobble is introduced.
      const sphere = resultRadius * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))
      const angularAsymmetry = 0.30 * Math.cos(angle) + 0.12 * Math.cos(angle * 2)
      const remnantWave = 1 + remnantDeformation * Math.sin(Math.PI * t) *
        (angularAsymmetry + massAsymmetry * (t - 0.5))
      return THREE.MathUtils.lerp(connectedUnion, sphere * remnantWave, remnantBlend)
    },
  }
}

function getSeparateShape(
  body: BodyState,
  partner: BodyState | undefined,
  state?: StellarCollisionPresentation,
): EnvelopeShape {
  const source = state?.sources.find((candidate) => candidate.id === body.id) ?? body
  const center = vector(body.position)
  let axis = partner
    ? stablePairAxis(body, partner, `${body.id}:${partner.id}:approach`)
    : deterministicAxis(body.id)
  let strength = 0
  let axialStretch = 0
  let radius = body.radius
  let displayColor = envelopeColor(body)
  let targetVolume = sphereVolume(body.radius)

  if (state) {
    const eventKey = state.eventId ?? state.key
    const other = state.sources.find((candidate) => candidate.id !== source.id) ?? state.sources[0]
    axis = stablePairAxis(source, other, eventKey)
    const target = state.targets.find((candidate) => candidate.id === body.id) ?? body
    const timeline = getPresentationTimeline(state)
    const massRatio = Math.min(1, other.mass / Math.max(source.mass, 1e-9))
    const approachStrength = 0.035 * massRatio
    const radiusDamage = clamp01(Math.abs(target.radius - source.radius) / Math.max(source.radius, 1e-9) * 2)
    const terminalStrength = state.outcome === 'partialDisruption'
      ? 0.14 + radiusDamage * 0.08
      : 0.09
    const terminalStretch = state.outcome === 'partialDisruption'
      ? 0.11 + radiusDamage * 0.09
      : 0.07

    if (state.phase === 'contact') {
      const contact = smooth(timeline.contactProgress)
      strength = THREE.MathUtils.lerp(approachStrength, terminalStrength, contact)
      axialStretch = THREE.MathUtils.lerp(approachStrength, terminalStretch, contact)
      radius = source.radius
      displayColor = envelopeColor(star(source))
      targetVolume = sphereVolume(source.radius)
    } else {
      const settle = timeline.settleProgress
      const release = timeline.releaseProgress
      const handoffOffset = vector(source.position).sub(vector(target.position))
      center.copy(vector(body.position).addScaledVector(handoffOffset, 1 - release))
      strength = terminalStrength * (1 - settle)
      axialStretch = terminalStretch * (1 - settle)
      radius = THREE.MathUtils.lerp(source.radius, body.radius, settle)
      displayColor = envelopeColor(star(source)).lerp(envelopeColor(body), settle)
      targetVolume = sphereVolume(radius)
    }
  } else if (partner) {
    const distance = center.distanceTo(vector(partner.position))
    const reach = body.radius + partner.radius
    const approach = smooth((reach * 1.18 - distance) / Math.max(reach * 0.18, 1e-9))
    const massRatio = Math.min(1, partner.mass / Math.max(body.mass, 1e-9))
    strength = 0.035 * approach * massRatio
    axialStretch = strength
  }

  const backStretch = axialStretch * 0.28
  const facingStretch = axialStretch * 0.78
  const min = -radius * (1 + backStretch)
  const max = radius * (1 + facingStretch)

  return {
    center,
    axis,
    min,
    max,
    body,
    targetVolume,
    colorA: displayColor,
    colorB: displayColor.clone(),
    colorMix: () => 0,
    radius: (x, angle) => {
      const axialExtent = radius * (x >= 0 ? 1 + facingStretch : 1 + backStretch)
      const u = x / Math.max(axialExtent, 1e-9)
      const base = radius * Math.sqrt(Math.max(0, 1 - u * u))
      const facing = smooth((u + 0.10) / 1.10)
      const equator = Math.max(0, 1 - u * u)
      const deterministicAsymmetry = Math.cos(angle) * 0.16 * equator
      const profile = Math.max(
        0.72,
        1 + strength * (0.30 * equator - 0.58 * facing + deterministicAsymmetry),
      )
      return base * profile
    },
  }
}

function vertexIndex(i: number, j: number) {
  return i * VERTICES_PER_RING + j
}

function createSurfaceIndices() {
  const indices: number[] = []
  const startPole = vertexIndex(0, 0)
  const endPole = vertexIndex(AXIAL, 0)

  for (let j = 0; j < RADIAL; j++) {
    indices.push(startPole, vertexIndex(1, j + 1), vertexIndex(1, j))
  }
  for (let i = 1; i < AXIAL - 1; i++) for (let j = 0; j < RADIAL; j++) {
    const a = vertexIndex(i, j)
    const b = vertexIndex(i + 1, j)
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  for (let j = 0; j < RADIAL; j++) {
    indices.push(vertexIndex(AXIAL - 1, j), vertexIndex(AXIAL - 1, j + 1), endPole)
  }
  return indices
}

function createHaloIndices() {
  const indices: number[] = []
  const startPole = vertexIndex(0, 0)
  const endPole = vertexIndex(AXIAL, 0)

  for (let j = 0; j < RADIAL; j += HALO_STRIDE) {
    indices.push(startPole, vertexIndex(HALO_STRIDE, j + HALO_STRIDE), vertexIndex(HALO_STRIDE, j))
  }
  for (let i = HALO_STRIDE; i < AXIAL - HALO_STRIDE; i += HALO_STRIDE) {
    for (let j = 0; j < RADIAL; j += HALO_STRIDE) {
      const a = vertexIndex(i, j)
      const b = vertexIndex(i + HALO_STRIDE, j)
      indices.push(a, a + HALO_STRIDE, b, a + HALO_STRIDE, b + HALO_STRIDE, b)
    }
  }
  for (let j = 0; j < RADIAL; j += HALO_STRIDE) {
    indices.push(
      vertexIndex(AXIAL - HALO_STRIDE, j),
      vertexIndex(AXIAL - HALO_STRIDE, j + HALO_STRIDE),
      endPole,
    )
  }
  return indices
}

function createNormalTopology(): NormalTopology {
  const logicalIndexByVertex = new Int32Array(VERTEX_COUNT)
  const logicalCount = 2 + (AXIAL - 1) * RADIAL
  const representativeByLogical = new Int32Array(logicalCount)
  representativeByLogical.fill(-1)

  for (let i = 0; i <= AXIAL; i++) for (let j = 0; j <= RADIAL; j++) {
    const physical = vertexIndex(i, j)
    const logical = i === 0
      ? 0
      : i === AXIAL
        ? 1
        : 2 + (i - 1) * RADIAL + (j % RADIAL)
    logicalIndexByVertex[physical] = logical
    if (representativeByLogical[logical] < 0) representativeByLogical[logical] = physical
  }

  return {
    logicalIndexByVertex,
    representativeByLogical,
    accumulatedNormals: new Float32Array(logicalCount * 3),
  }
}

function addFaceNormal(accumulated: Float32Array, logical: number, nx: number, ny: number, nz: number) {
  const offset = logical * 3
  accumulated[offset] += nx
  accumulated[offset + 1] += ny
  accumulated[offset + 2] += nz
}

function updateEnvelopeNormals(
  geometry: THREE.BufferGeometry,
  indices: number[],
  topology: NormalTopology,
  minX: number,
  maxX: number,
) {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute
  const positionArray = positions.array as Float32Array
  const normalArray = normals.array as Float32Array
  const accumulated = topology.accumulatedNormals
  accumulated.fill(0)

  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset]
    const ib = indices[offset + 1]
    const ic = indices[offset + 2]
    const a = ia * 3, b = ib * 3, c = ic * 3
    const abx = positionArray[b] - positionArray[a]
    const aby = positionArray[b + 1] - positionArray[a + 1]
    const abz = positionArray[b + 2] - positionArray[a + 2]
    const acx = positionArray[c] - positionArray[a]
    const acy = positionArray[c + 1] - positionArray[a + 1]
    const acz = positionArray[c + 2] - positionArray[a + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    if (nx * nx + ny * ny + nz * nz <= 1e-20) continue

    const la = topology.logicalIndexByVertex[ia]
    const lb = topology.logicalIndexByVertex[ib]
    const lc = topology.logicalIndexByVertex[ic]
    addFaceNormal(accumulated, la, nx, ny, nz)
    if (lb !== la) addFaceNormal(accumulated, lb, nx, ny, nz)
    if (lc !== la && lc !== lb) addFaceNormal(accumulated, lc, nx, ny, nz)
  }

  const midpoint = (minX + maxX) * 0.5
  for (let logical = 0; logical < topology.representativeByLogical.length; logical++) {
    const normalOffset = logical * 3
    let nx = accumulated[normalOffset]
    let ny = accumulated[normalOffset + 1]
    let nz = accumulated[normalOffset + 2]
    let lengthSq = nx * nx + ny * ny + nz * nz

    if (lengthSq <= 1e-20) {
      const representative = topology.representativeByLogical[logical] * 3
      const x = positionArray[representative]
      const y = positionArray[representative + 1]
      const z = positionArray[representative + 2]
      const radialSq = y * y + z * z
      if (radialSq > 1e-20) {
        nx = 0
        ny = y
        nz = z
        lengthSq = radialSq
      } else {
        nx = x <= midpoint ? -1 : 1
        ny = 0
        nz = 0
        lengthSq = 1
      }
    }

    const inverseLength = 1 / Math.sqrt(lengthSq)
    accumulated[normalOffset] = nx * inverseLength
    accumulated[normalOffset + 1] = ny * inverseLength
    accumulated[normalOffset + 2] = nz * inverseLength
  }

  for (let physical = 0; physical < VERTEX_COUNT; physical++) {
    const logicalOffset = topology.logicalIndexByVertex[physical] * 3
    const physicalOffset = physical * 3
    normalArray[physicalOffset] = accumulated[logicalOffset]
    normalArray[physicalOffset + 1] = accumulated[logicalOffset + 1]
    normalArray[physicalOffset + 2] = accumulated[logicalOffset + 2]
  }
  normals.needsUpdate = true
}

const vertexShader = `
  attribute vec3 collisionColor;
  varying vec3 vCollisionColor;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vCollisionColor = collisionColor;
    vObjectNormal = normalize(normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const haloVertexShader = `
  attribute vec3 collisionColor;
  attribute float haloSectionRadius;
  uniform float uShellOffset;
  uniform float uProfileRadius;
  varying vec3 vCollisionColor;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying float vShellDistance;
  varying float vSectionRadius;
  void main() {
    float profile01 = clamp(haloSectionRadius / max(uProfileRadius, 0.000001), 0.0, 1.0);
    float shellDistance = uShellOffset * mix(0.38, 1.0, sqrt(profile01));
    vec3 shellPosition = position + normalize(normal) * shellDistance;
    vCollisionColor = collisionColor;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vShellDistance = shellDistance;
    vSectionRadius = haloSectionRadius;
    vec4 world = modelMatrix * vec4(shellPosition, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const haloFragmentShader = `
  uniform float uOpacity;
  uniform float uProfileRadius;
  varying vec3 vCollisionColor;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying float vShellDistance;
  varying float vSectionRadius;
  void main() {
    float profileRadius = max(uProfileRadius, 0.000001);
    float profile01 = clamp(vSectionRadius / profileRadius, 0.0, 1.0);
    float distance01 = vShellDistance / profileRadius;
    float distanceFalloff = 0.72 * exp(-distance01 * 1.35) + 0.28 * exp(-distance01 * 0.58);
    float sectionCoverage = smoothstep(0.025, 0.18, profile01);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float viewMu = abs(dot(normalize(vWorldNormal), viewDirection));
    float limbCoverage = mix(0.22, 1.0, smoothstep(0.08, 0.92, 1.0 - viewMu));
    float alpha = uOpacity * distanceFalloff * sectionCoverage * limbCoverage;
    gl_FragColor = vec4(vCollisionColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function createEnvelope() {
  const geometry = new THREE.BufferGeometry()
  const positions = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const colors = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const normals = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const haloSectionRadius = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT), 1).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', positions)
  geometry.setAttribute('collisionColor', colors)
  geometry.setAttribute('normal', normals)
  geometry.setAttribute('haloSectionRadius', haloSectionRadius)
  const surfaceIndices = createSurfaceIndices()
  geometry.setIndex(surfaceIndices)
  const normalTopology = createNormalTopology()

  const values = createStellarPhotosphereMaterialValues({ vertexShader, uniforms: {
    uSeed: { value: 0 }, uIdentityColor: { value: new THREE.Color() }, uOpacity: { value: 1 },
    uDetailStrength: { value: 1 }, uRimStrength: { value: 0.045 },
  } })
  values.fragmentShader = values.fragmentShader.replace('uniform vec3 uIdentityColor;', 'varying vec3 vCollisionColor;').replaceAll('uIdentityColor', 'vCollisionColor')
  const material = new THREE.ShaderMaterial(values)
  material.depthTest = true
  material.depthWrite = true
  const surface = new THREE.Mesh(geometry, material)
  surface.renderOrder = 0
  const group = new THREE.Group()
  group.add(surface)

  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: haloVertexShader,
    fragmentShader: haloFragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0.22 },
      uShellOffset: { value: 0 },
      uProfileRadius: { value: 1 },
    },
    toneMapped: true,
  })
  const haloGeometry = new THREE.BufferGeometry()
  haloGeometry.setAttribute('position', positions)
  haloGeometry.setAttribute('collisionColor', colors)
  haloGeometry.setAttribute('normal', normals)
  haloGeometry.setAttribute('haloSectionRadius', haloSectionRadius)
  haloGeometry.setIndex(createHaloIndices())
  const halo = new THREE.Mesh(haloGeometry, haloMaterial)
  halo.renderOrder = 1
  group.add(halo)
  group.traverse((o) => { o.frustumCulled = false })
  return {
    group,
    geometry,
    haloGeometry,
    material,
    haloMaterial,
    surfaceIndices,
    normalTopology,
    samples: {
      x: new Float64Array(AXIAL + 1),
      radii: new Float32Array(VERTEX_COUNT),
      areas: new Float64Array(AXIAL + 1),
    } satisfies EnvelopeSamples,
    time: NaN,
    bodies: null as BodyState[] | null,
  }
}

function sampleEnvelopeShape(shape: EnvelopeShape, samples: EnvelopeSamples) {
  for (let i = 0; i <= AXIAL; i++) {
    const t = (1 - Math.cos(Math.PI * i / AXIAL)) / 2
    const x = shape.min + (shape.max - shape.min) * t
    samples.x[i] = x
    let area = 0
    for (let j = 0; j <= RADIAL; j++) {
      const angle = j / RADIAL * FULL_CIRCLE
      const rawRadius = shape.radius(x, angle)
      const radius = Number.isFinite(rawRadius) ? Math.max(0, rawRadius) : 0
      samples.radii[vertexIndex(i, j)] = radius
      if (j < RADIAL) area += 0.5 * radius * radius * RADIAL_ANGLE_STEP
    }
    samples.areas[i] = area
  }

  let sampledVolume = 0
  for (let i = 0; i < AXIAL; i++) {
    const dx = samples.x[i + 1] - samples.x[i]
    if (!Number.isFinite(dx) || dx <= 0) continue
    sampledVolume += (samples.areas[i] + samples.areas[i + 1]) * 0.5 * dx
  }

  const targetVolume = Number.isFinite(shape.targetVolume) && shape.targetVolume > VOLUME_EPSILON
    ? shape.targetVolume
    : sampledVolume
  if (!Number.isFinite(sampledVolume) || sampledVolume <= VOLUME_EPSILON) return 1
  const radialScale = Math.sqrt(targetVolume / sampledVolume)
  return Number.isFinite(radialScale) && radialScale > 0 ? radialScale : 1
}

function getStellarRenderObjectResolver(scene: THREE.Scene) {
  const resolver = scene.userData.resolveStellarRenderObjects
  return typeof resolver === 'function' ? resolver as StellarRenderObjectResolver : undefined
}

function isCurrentRenderObject(
  resolver: StellarRenderObjectResolver | undefined,
  bodyId: string,
  object: THREE.Object3D,
) {
  const renderObjects = resolver?.(bodyId)
  return Boolean(renderObjects && (
    object === renderObjects.photosphere ||
    object === renderObjects.corona ||
    object === renderObjects.secondaryGlow
  ))
}

export function createStellarCollisionEnvelopeLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'stellar-collision-envelopes'
  scene.add(group)
  const visuals = new Map<string, ReturnType<typeof createEnvelope>>()
  const hidden = new Map<THREE.Object3D, HiddenRenderObject>()
  const localAxis = new THREE.Vector3(1, 0, 0)
  const color = new THREE.Color()
  const remove = (id: string) => {
    const v = visuals.get(id)!
    group.remove(v.group); v.geometry.dispose(); v.haloGeometry.dispose(); v.material.dispose(); v.haloMaterial.dispose(); visuals.delete(id)
  }
  const applySuppression = (
    objects: Map<THREE.Object3D, string>,
    resolver: StellarRenderObjectResolver | undefined,
  ) => {
    hidden.forEach((previous, object) => {
      if (objects.has(object)) return
      if (isCurrentRenderObject(resolver, previous.bodyId, object)) object.visible = previous.visible
      hidden.delete(object)
    })
    objects.forEach((bodyId, object) => {
      if (!hidden.has(object)) hidden.set(object, { bodyId, visible: object.visible })
      object.visible = false
    })
  }
  return {
    update(bodies: BodyState[], simulationTime: number) {
      const stars = bodies.filter((b) => b.bodyType === 'star')
      const active = new Set<string>(), suppressed = new Set<string>()
      const show = (key: string, shape: EnvelopeShape, ids: string[]) => {
        active.add(key); ids.forEach((id) => suppressed.add(id))
        let v = visuals.get(key)
        if (!v) { v = createEnvelope(); visuals.set(key, v); group.add(v.group) }
        v.group.position.copy(shape.center)
        v.group.quaternion.setFromUnitVectors(localAxis, shape.axis)
        if (v.time === simulationTime && v.bodies === bodies) return
        v.time = simulationTime; v.bodies = bodies
        const positions = v.geometry.getAttribute('position') as THREE.BufferAttribute
        const colors = v.geometry.getAttribute('collisionColor') as THREE.BufferAttribute
        const haloSectionRadius = v.geometry.getAttribute('haloSectionRadius') as THREE.BufferAttribute
        const radialScale = sampleEnvelopeShape(shape, v.samples)
        let maxSectionRadius = 0
        for (let i = 0; i <= AXIAL; i++) {
          const x = v.samples.x[i]
          color.copy(shape.colorA).lerp(shape.colorB, shape.colorMix(x))
          for (let j = 0; j <= RADIAL; j++) {
            const angle = j / RADIAL * FULL_CIRCLE
            const index = vertexIndex(i, j)
            const r = v.samples.radii[index] * radialScale
            positions.setXYZ(index, x, r * Math.cos(angle), r * Math.sin(angle))
            colors.setXYZ(index, color.r, color.g, color.b)
            haloSectionRadius.setX(index, r)
            maxSectionRadius = Math.max(maxSectionRadius, r)
          }
        }
        positions.needsUpdate = true
        colors.needsUpdate = true
        haloSectionRadius.needsUpdate = true
        updateEnvelopeNormals(v.geometry, v.surfaceIndices, v.normalTopology, shape.min, shape.max)
        const profileRadius = Math.max(maxSectionRadius, 1e-6)
        v.haloMaterial.uniforms.uProfileRadius.value = profileRadius
        v.haloMaterial.uniforms.uShellOffset.value = profileRadius * 0.62
        updateStellarPhotosphereMaterial(v.material, getStellarPhotosphereFrame(shape.body, simulationTime))
        v.material.uniforms.uSurfaceSeed.value = seed(shape.body.id)
      }
      for (const body of stars) {
        const state = body.stellarCollisionPresentation
        if (state?.outcome === 'merge') {
          const eventKey = state.eventId ?? state.key
          if (!active.has(eventKey)) {
            show(
              eventKey,
              getMergedEnvelopeShape(state, state.phase === 'settle' ? body : undefined),
              [...state.sources.map((source) => source.id), body.id],
            )
          }
        } else {
          const partner = stars.find((candidate) => (
            candidate !== body &&
            !candidate.stellarCollisionPresentation &&
            vector(candidate.position).distanceTo(vector(body.position)) <
              (candidate.radius + body.radius) * 1.18
          ))
          if (state || partner) {
            const visualKey = state ? `${state.eventId ?? state.key}:${body.id}` : body.id
            show(visualKey, getSeparateShape(body, partner, state), [body.id])
          }
        }
      }
      for (const key of visuals.keys()) if (!active.has(key)) remove(key)

      const resolveRenderObjects = getStellarRenderObjectResolver(scene)
      const objectsToHide = new Map<THREE.Object3D, string>()
      suppressed.forEach((bodyId) => {
        const renderObjects = resolveRenderObjects?.(bodyId)
        if (!renderObjects) return
        objectsToHide.set(renderObjects.photosphere, bodyId)
        objectsToHide.set(renderObjects.corona, bodyId)
        objectsToHide.set(renderObjects.secondaryGlow, bodyId)
      })
      applySuppression(objectsToHide, resolveRenderObjects)
    },
    dispose() {
      const resolveRenderObjects = getStellarRenderObjectResolver(scene)
      hidden.forEach((previous, object) => {
        if (isCurrentRenderObject(resolveRenderObjects, previous.bodyId, object)) {
          object.visible = previous.visible
        }
      })
      hidden.clear()
      for (const id of visuals.keys()) remove(id)
      scene.remove(group)
    },
  }
}
