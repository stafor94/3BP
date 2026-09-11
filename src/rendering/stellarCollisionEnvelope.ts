import * as THREE from 'three'
import type { BodyState, StellarCollisionPresentation, StellarCollisionSource } from '../types'
import { getStellarDisplayColorFromBody } from '../starColors'
import { createStellarPhotosphereMaterialValues, getStellarPhotosphereFrame, updateStellarPhotosphereMaterial } from './stellarPhotosphereMaterial'

const AXIAL = 80
const RADIAL = 32
export const STELLAR_SETTLE_SECONDS = 0.16
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

/** Smooth union of cross sections, followed by volume transfer and one lopsided
 * remnant. This is an opaque 3D surface, not a screen-facing topology mask. */
export function getMergedEnvelopeShape(state: StellarCollisionPresentation, result?: BodyState): EnvelopeShape {
  const [a, b] = state.sources
  const total = a.mass + b.mass
  const axis = vector(b.position).sub(vector(a.position)).normalize()
  const distance = vector(b.position).distanceTo(vector(a.position))
  const center = vector(a.position).multiplyScalar(a.mass / total).addScaledVector(vector(b.position), b.mass / total)
  const settle = state.phase === 'settle' ? smooth(state.elapsed / STELLAR_SETTLE_SECONDS) : 0
  // The solver contact lasts only ~24 ms at 1x. Continue the visible volume
  // transfer through the shared settling clock instead of losing the small
  // lobe in the very first result frame. Physical resolution is unchanged.
  const transferDuration = state.duration + STELLAR_SETTLE_SECONDS * .75
  const contactElapsed = state.phase === 'settle' ? state.duration + state.elapsed : state.progress * state.duration
  const p = Math.min(1, contactElapsed / transferDuration)
  const transfer = smooth((p - 0.14) / 0.78)
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
    if (state.phase === 'contact') {
      const p = state.progress
      radius = THREE.MathUtils.lerp(source.radius, target.radius, smooth(p))
      strength = Math.sin(Math.PI * p) * (state.outcome === 'partialDisruption' ? 0.18 : 0.10)
      axialStretch = 0.035 * Math.min(1, other.mass / source.mass) * (1 - smooth(p / .2)) - strength * .4
    } else {
      const release = smooth(state.elapsed / 0.045)
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

function createEnvelope() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((AXIAL + 1) * (RADIAL + 1) * 3), 3))
  geometry.setAttribute('collisionColor', new THREE.BufferAttribute(new Float32Array((AXIAL + 1) * (RADIAL + 1) * 3), 3))
  const indices: number[] = []
  for (let i = 0; i < AXIAL; i++) for (let j = 0; j < RADIAL; j++) {
    const a = i * (RADIAL + 1) + j, b = a + RADIAL + 1
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  geometry.setIndex(indices)
  const values = createStellarPhotosphereMaterialValues({ vertexShader, uniforms: {
    uSeed: { value: 0 }, uIdentityColor: { value: new THREE.Color() }, uOpacity: { value: 1 },
    uDetailStrength: { value: 1 }, uRimStrength: { value: 0.045 },
  } })
  values.fragmentShader = values.fragmentShader.replace('uniform vec3 uIdentityColor;', 'varying vec3 vCollisionColor;').replaceAll('uIdentityColor', 'vCollisionColor')
  const material = new THREE.ShaderMaterial(values)
  const surface = new THREE.Mesh(geometry, material)
  const group = new THREE.Group()
  group.add(surface)
  // One expanded back-face surface carries the diffuse column density. Reusing
  // the photosphere geometry keeps shape coherent without six extra draw calls.
  const haloMaterial = new THREE.ShaderMaterial({ vertexShader, transparent: true, depthWrite: false,
    // Back faces are behind the opaque photosphere wherever their projections
    // overlap. Depth testing removes interior light instead of bleaching color.
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending, uniforms: { uOpacity: { value: 0.22 } },
    fragmentShader: `varying vec3 vCollisionColor; varying vec3 vWorldNormal; varying vec3 vWorldPosition;
      uniform float uOpacity;
      void main() { float mu = abs(dot(normalize(vWorldNormal), normalize(cameraPosition-vWorldPosition)));
        float projectedRadius = 2.4 * sqrt(max(0.0, 1.0-mu*mu));
        float distanceOutside = max(0.0, projectedRadius-1.0);
        float column = 0.8 * exp(-pow(distanceOutside/.4, 2.0)) + 0.2 * exp(-distanceOutside/.65);
        gl_FragColor=vec4(vCollisionColor, uOpacity * column * smoothstep(0.0, 0.15, mu));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const halo = new THREE.Mesh(geometry, haloMaterial)
  halo.scale.setScalar(2.4)
  halo.renderOrder = 1
  group.add(halo)
  group.traverse((o) => { o.frustumCulled = false })
  return { group, geometry, material, haloMaterial, time: NaN, bodies: null as BodyState[] | null }
}

export function createStellarCollisionEnvelopeLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'stellar-collision-envelopes'
  scene.add(group)
  const visuals = new Map<string, ReturnType<typeof createEnvelope>>()
  const hidden = new Map<THREE.Object3D, boolean>()
  const localAxis = new THREE.Vector3(1, 0, 0)
  const color = new THREE.Color()
  const remove = (id: string) => {
    const v = visuals.get(id)!
    group.remove(v.group); v.geometry.dispose(); v.material.dispose(); v.haloMaterial.dispose(); visuals.delete(id)
  }
  return {
    update(bodies: BodyState[], simulationTime: number) {
      hidden.forEach((visible, object) => { object.visible = visible }); hidden.clear()
      const stars = bodies.filter((b) => b.bodyType === 'star')
      const active = new Set<string>(), suppressed = new Set<number>()
      const show = (key: string, shape: EnvelopeShape, ids: string[]) => {
        active.add(key); ids.forEach((id) => suppressed.add(seed(id)))
        let v = visuals.get(key)
        if (!v) { v = createEnvelope(); visuals.set(key, v); group.add(v.group) }
        v.group.position.copy(shape.center)
        v.group.quaternion.setFromUnitVectors(localAxis, shape.axis)
        if (v.time === simulationTime && v.bodies === bodies) return
        v.time = simulationTime; v.bodies = bodies
        const positions = v.geometry.getAttribute('position') as THREE.BufferAttribute
        const colors = v.geometry.getAttribute('collisionColor') as THREE.BufferAttribute
        for (let i = 0; i <= AXIAL; i++) {
          const t = (1 - Math.cos(Math.PI * i / AXIAL)) / 2
          const x = shape.min + (shape.max - shape.min) * t
          color.copy(shape.colorA).lerp(shape.colorB, shape.colorMix(x))
          for (let j = 0; j <= RADIAL; j++) {
            const angle = j / RADIAL * Math.PI * 2
            const r = shape.radius(x, angle), index = i * (RADIAL + 1) + j
            positions.setXYZ(index, x, r * Math.cos(angle), r * Math.sin(angle))
            colors.setXYZ(index, color.r, color.g, color.b)
          }
        }
        positions.needsUpdate = true; colors.needsUpdate = true
        v.geometry.computeVertexNormals()
        updateStellarPhotosphereMaterial(v.material, getStellarPhotosphereFrame(shape.body, simulationTime))
        v.material.uniforms.uSurfaceSeed.value = seed(shape.body.id)
      }
      for (const body of stars) {
        const state = body.stellarCollisionPresentation
        if (state?.outcome === 'merge') {
          if (!active.has(state.key)) show(state.key, getMergedEnvelopeShape(state, state.phase === 'settle' ? body : undefined),
            [...state.sources.map((s) => s.id), body.id])
        } else {
          const partner = stars.find((b) => b !== body && !b.stellarCollisionPresentation &&
            vector(b.position).distanceTo(vector(body.position)) < (b.radius + body.radius) * 1.18)
          if (state || partner) show(body.id, getSeparateShape(body, partner, state), [body.id])
        }
      }
      for (const key of visuals.keys()) if (!active.has(key)) remove(key)
      // Match the production body by its stable seed; never put envelope proxies
      // in the N-body array or interfere with camera/tracking lineage.
      scene.children.forEach((object, i) => {
        if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) return
        if (!suppressed.has(object.material.uniforms.uSeed?.value)) return
        for (const item of [object, scene.children[i - 1], scene.children[i - 2]]) {
          if (!item || (item !== object && !(item instanceof THREE.Sprite))) continue
          hidden.set(item, item.visible); item.visible = false
        }
      })
    },
    dispose() {
      hidden.forEach((visible, object) => { object.visible = visible }); hidden.clear()
      for (const id of visuals.keys()) remove(id)
      scene.remove(group)
    },
  }
}
