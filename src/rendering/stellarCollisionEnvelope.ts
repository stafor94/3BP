import * as THREE from 'three'
import type { BodyState, StellarCollisionPresentation, StellarCollisionSource } from '../types'
import { getStellarDisplayColorFromBody } from '../starColors'
import {
  getStellarCollisionTimeline,
  STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
} from '../stellarCollisionTimeline'
import { createStellarPhotosphereMaterialValues, getStellarPhotosphereFrame, updateStellarPhotosphereMaterial } from './stellarPhotosphereMaterial'

const AXIAL = 36
const RADIAL = 24
const VERTICES_PER_RING = RADIAL + 1
const VERTEX_COUNT = (AXIAL + 1) * VERTICES_PER_RING
const HALO_STRIDE = 2
export const STELLAR_SETTLE_SECONDS = STELLAR_COLLISION_SETTLE_DURATION_SECONDS
const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t) }
const vector = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)
const star = (s: StellarCollisionSource): BodyState => ({ ...s, name: s.id, bodyType: 'star' })

function seed(id: string) {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return (hash >>> 0) / 4294967295 * 1000
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

/** Smooth union of cross sections, followed by volume transfer and one lopsided
 * remnant. This is an opaque 3D surface, not a screen-facing topology mask. */
export function getMergedEnvelopeShape(state: StellarCollisionPresentation, result?: BodyState): EnvelopeShape {
  const [a, b] = state.sources
  const total = a.mass + b.mass
  const axis = vector(b.position).sub(vector(a.position)).normalize()
  const distance = vector(b.position).distanceTo(vector(a.position))
  const center = vector(a.position).multiplyScalar(a.mass / total).addScaledVector(vector(b.position), b.mass / total)
  const timeline = getPresentationTimeline(state)
  const settle = state.phase === 'settle' ? timeline.settleProgress : 0
  // Preserve the existing overlapping transfer curve while sourcing its clock
  // from the event timeline shared with physics and heat decay.
  const p = timeline.transferClockProgress
  const transfer = timeline.transferProgress
  const target = state.targets[0] ?? { ...a, mass: total, radius: Math.cbrt(a.radius ** 3 + b.radius ** 3) }
  const targetRadius = THREE.MathUtils.lerp(target.radius, result?.radius ?? target.radius, settle)
  if (result && state.phase === 'settle') {
    // The solver COM and contact COM coincide for a merge. Any ejecta recoil
    // offset relaxes from the inherited surface, rather than snapping at handoff.
    center.lerp(vector(result.position), settle)
  }
  const largerA = a.mass >= b.mass
  const totalVolume = a.radius ** 3 + b.radius ** 3
  const radiusA = Math.cbrt(largerA ? a.radius ** 3 + b.radius ** 3 * transfer : a.radius ** 3 * (1 - transfer))
  const radiusB = Math.cbrt(largerA ? b.radius ** 3 * (1 - transfer) : b.radius ** 3 + a.radius ** 3 * transfer)
  const contraction = 1 - smooth(p / 0.92)
  const ca = -distance * b.mass / total * contraction
  const cb = distance * a.mass / total * contraction
  const blend = smooth((p - 0.66) / 0.34)
  const unionScale = THREE.MathUtils.lerp(1, targetRadius / Math.cbrt(totalVolume), transfer)
  const ra = radiusA * unionScale
  const rb = radiusB * unionScale
  const tidal = 0.035 * (1 - smooth(p / .2))
  const neck = Math.min(a.radius, b.radius) ** 2 * 0.30 * smooth(p / 0.30) * (1 - blend)
  const lobeMin = Math.min(ca - ra, cb - rb)
  const lobeMax = Math.max(ca + ra, cb + rb)
  const deformation = 0.10 * (1 - settle)
  const asymmetry = (a.mass - b.mass) / total
  const finalLeft = -targetRadius * (1 + deformation * (0.4 - asymmetry * 0.3))
  const finalRight = targetRadius * (1 + deformation * (0.4 + asymmetry * 0.3))
  const min = THREE.MathUtils.lerp(lobeMin, finalLeft, blend)
  const max = THREE.MathUtils.lerp(lobeMax, finalRight, blend)
  const targetColor = new THREE.Color(getStellarDisplayColorFromBody(star(target)))
  const mixColor = smooth((p - 0.35) / 0.65)
  return {
    center, axis, min, max, body: result ?? star(target),
    colorA: new THREE.Color(getStellarDisplayColorFromBody(star(a))).lerp(targetColor, mixColor),
    colorB: new THREE.Color(getStellarDisplayColorFromBody(star(b))).lerp(targetColor, mixColor),
    colorMix: (x) => smooth((x - ca + ra * 0.2) / Math.max(cb - ca + (ra + rb) * 0.2, 1e-9)),
    radius: (x, angle) => {
      const t = (x - min) / Math.max(max - min, 1e-9)
      const ux = lobeMin + t * (lobeMax - lobeMin)
      const xa = (ux - ca) / (1 + (ux > ca ? tidal * Math.min(1, b.mass / a.mass) : 0))
      const xb = (ux - cb) / (1 + (ux < cb ? tidal * Math.min(1, a.mass / b.mass) : 0))
      const qa = ra * ra - xa ** 2
      const qb = rb * rb - xb ** 2
      const h = neck > 0 ? Math.max(neck - Math.abs(qa - qb), 0) / neck : 0
      const union = Math.sqrt(Math.max(0, Math.max(qa, qb) + h * h * neck * 0.25))
      const sphere = targetRadius * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))
      const wave = 1 + deformation * Math.sin(Math.PI * t) *
        (0.35 * Math.cos(angle) + 0.20 * Math.sin(angle * 2 + state.elapsed * 18) + asymmetry * (t - 0.5))
      return THREE.MathUtils.lerp(union, sphere * wave, blend)
    },
  }
}

function getSeparateShape(body: BodyState, partner: BodyState | undefined, state?: StellarCollisionPresentation): EnvelopeShape {
  const source = state?.sources.find((s) => s.id === body.id) ?? body
  const center = vector(body.position)
  let axis = partner ? vector(partner.position).sub(center).normalize() : new THREE.Vector3(1, 0, 0)
  let strength = 0
  let axialStretch = 0
  let radius = body.radius
  if (state) {
    const other = state.sources.find((s) => s.id !== source.id)!
    axis = vector(other.position).sub(vector(source.position)).normalize()
    const target = state.targets.find((s) => s.id === body.id) ?? body
    const timeline = getPresentationTimeline(state)
    if (state.phase === 'contact') {
      const p = timeline.contactProgress
      radius = THREE.MathUtils.lerp(source.radius, target.radius, smooth(p))
      strength = Math.sin(Math.PI * p) * (state.outcome === 'partialDisruption' ? 0.18 : 0.10)
      axialStretch = 0.035 * Math.min(1, other.mass / source.mass) * (1 - smooth(p / .2)) - strength * .4
    } else {
      const release = timeline.releaseProgress
      center.copy(vector(source.position).lerp(vector(body.position), release))
      radius = THREE.MathUtils.lerp(target.radius, body.radius, release)
    }
  } else if (partner) {
    const distance = center.distanceTo(vector(partner.position))
    const reach = body.radius + partner.radius
    strength = 0.035 * smooth((reach * 1.18 - distance) / (reach * 0.18)) * Math.min(1, partner.mass / Math.max(body.mass, 1e-9))
    axialStretch = strength
  }
  const color = new THREE.Color(getStellarDisplayColorFromBody(body))
  return { center, axis, min: -radius, max: radius * (1 + axialStretch), body, colorA: color, colorB: color, colorMix: () => 0,
    radius: (x, angle) => {
      const u = x / Math.max(radius * (x > 0 ? 1 + axialStretch : 1), 1e-9)
      // Contact-local flattening and a broad opposite-side tidal bulge; both
      // pole and equatorial displacement decay continuously on separation.
      const facing = smooth((u + 0.15) / 1.15)
      return radius * Math.sqrt(Math.max(0, 1 - u * u)) *
        (1 + strength * (0.45 - facing + 0.2 * Math.sin(angle) * (1 - u * u)))
    } }
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

  // A single back-face shell follows the actual deformed envelope. The shell
  // offset and fade use the current cross-section radius instead of inferring a
  // spherical projected radius from viewMu, which is invalid for lobes/necks.
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
    time: NaN,
    bodies: null as BodyState[] | null,
  }
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
      // A merge/reset can retire a source VisualBody while its trail data is
      // still retained. Never resurrect an object that is no longer registered
      // as the current production render object for that body id.
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
        let maxSectionRadius = 0
        for (let i = 0; i <= AXIAL; i++) {
          const t = (1 - Math.cos(Math.PI * i / AXIAL)) / 2
          const x = shape.min + (shape.max - shape.min) * t
          color.copy(shape.colorA).lerp(shape.colorB, shape.colorMix(x))
          for (let j = 0; j <= RADIAL; j++) {
            const angle = j / RADIAL * Math.PI * 2
            const r = shape.radius(x, angle), index = vertexIndex(i, j)
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
          if (!active.has(eventKey)) show(eventKey, getMergedEnvelopeShape(state, state.phase === 'settle' ? body : undefined),
            [...state.sources.map((s) => s.id), body.id])
        } else {
          const partner = stars.find((b) => b !== body && !b.stellarCollisionPresentation &&
            vector(b.position).distanceTo(vector(body.position)) < (b.radius + body.radius) * 1.18)
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
