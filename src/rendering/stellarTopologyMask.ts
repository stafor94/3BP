import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import type { BodyState, Vec3 } from '../types'

const MAX_MASK_PAIRS = 2
const RETIRE_MS = 460
const MIN_OVERLAP_RATIO = 0.002

type MaskKind = 'flash' | 'sheet' | 'plasmaA' | 'plasmaB'

export type StellarTopologyMaskPair = {
  key: string
  position: Vec3
  normal: Vec3
  minRadius: number
  overlapRatio: number
  flashBuild: number
  maskBuild: number
  plasmaBuild: number
  primaryColor: string
  secondaryColor: string
}

type MaskVisual = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  material: THREE.ShaderMaterial
  kind: MaskKind
}

type ActiveMaskPair = {
  pair: StellarTopologyMaskPair
  retiringAt: number | null
}

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform float uOpacity;
  uniform float uBuild;
  uniform float uMaskBuild;
  uniform float uKind;
  uniform float uSeed;
  uniform float uBrightness;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float broadNoise = noise21(p * 3.1 + uSeed * 0.013);
    float fineNoise = noise21(p * 8.7 - uSeed * 0.021);
    float turbulent = broadNoise * 0.68 + fineNoise * 0.32;
    float alpha = 0.0;
    float core = 0.0;
    float body = 0.0;

    if (uKind < 0.5) {
      // Broad topology mask with a preserved white-hot ridge. At peak compression
      // the band deliberately occupies a meaningful fraction of both stellar discs.
      float warp = (turbulent - 0.5) * mix(0.06, 0.15, uBuild);
      float y = p.y + warp;
      float halfBand = mix(0.11, 0.43, uMaskBuild);
      float band = 1.0 - smoothstep(halfBand * 0.48, halfBand, abs(y));
      float ridge = exp(-abs(y) * mix(24.0, 13.0, uMaskBuild)) *
        (1.0 - smoothstep(0.42, 0.96, abs(p.x)));
      float lens = 1.0 - smoothstep(
        0.42,
        1.0,
        length(vec2(p.x * 0.72, y / mix(0.42, 0.72, uMaskBuild)))
      );
      float tornEdge = mix(0.72, 1.08, turbulent);
      alpha = max(band * (0.72 + 0.18 * turbulent), lens * 0.58) * tornEdge;
      alpha += ridge * 0.42;
      core = ridge + band * (0.28 + uMaskBuild * 0.30);
      body = max(band * 0.78, lens * 0.48);
    } else if (uKind < 1.5) {
      // Long compression plane, intentionally thinner than the flash mask.
      float wave = sin((p.x * 6.2 + uSeed * 0.017) + turbulent * 4.2) *
        mix(0.035, 0.11, uBuild);
      float distanceToSheet = abs(p.y - wave);
      float envelope = 1.0 - smoothstep(0.72, 1.0, abs(p.x));
      float sheet = exp(-distanceToSheet * mix(11.0, 6.2, uMaskBuild)) * envelope;
      float filament = exp(-distanceToSheet * 24.0) * envelope;
      float knots = smoothstep(0.56, 0.9, turbulent) * sheet;
      alpha = sheet * (0.62 + turbulent * 0.36) + filament * 0.22;
      core = filament * 0.62 + knots * 0.46;
      body = sheet;
    } else {
      // Directional plasma lobe with a hot head and irregular torn tail.
      float headDistance = length(vec2((p.x - 0.34) * 1.02, p.y * 1.2));
      float head = 1.0 - smoothstep(0.15, 0.72, headDistance);
      float tailT = clamp((0.36 - p.x) / 1.42, 0.0, 1.0);
      float center = sin((p.x * 8.0 + uSeed * 0.011) + turbulent * 4.5) *
        (0.035 + tailT * 0.16);
      float width = mix(0.38, 0.075, pow(tailT, 0.68)) *
        mix(0.78, 1.2, turbulent);
      float tail = (1.0 - smoothstep(width * 0.42, width, abs(p.y - center))) *
        smoothstep(-1.02, -0.72, p.x) *
        (1.0 - smoothstep(0.18, 0.48, p.x));
      float filament = exp(-abs(p.y - center * 0.52) * 19.0) * tailT;
      alpha = max(head * mix(0.78, 1.08, turbulent), tail * (0.6 + turbulent * 0.34));
      alpha += filament * 0.16 * uBuild;
      core = (1.0 - smoothstep(0.0, 0.36, headDistance)) + filament * 0.25;
      body = max(head * 0.76, tail * 0.72);
    }

    float feather = 1.0 - smoothstep(0.82, 1.0, max(abs(p.x), abs(p.y)));
    alpha *= feather * uOpacity;
    if (alpha <= 0.002) discard;

    vec3 hotWhite = vec3(0.98, 0.995, 1.0);
    vec3 mid = mix(uPrimaryColor, uSecondaryColor, uKind < 1.5 ? 0.22 : 0.38);
    vec3 color = mix(mid, hotWhite, clamp(core, 0.0, 1.0));
    color += mid * body * 0.12;
    color *= uBrightness;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function smooth01(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function magnitude(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function normalize(value: Vec3): Vec3 {
  const length = magnitude(value)
  if (length <= 1e-10) return { x: 1, y: 0, z: 0 }
  return { x: value.x / length, y: value.y / length, z: value.z / length }
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

export function getStellarTopologyMaskPairs(bodies: BodyState[]) {
  const stars = bodies.filter((body) => getEffectiveBodyType(body) === 'star')
  const pairs: StellarTopologyMaskPair[] = []

  for (let i = 0; i < stars.length && pairs.length < MAX_MASK_PAIRS; i += 1) {
    for (let j = i + 1; j < stars.length && pairs.length < MAX_MASK_PAIRS; j += 1) {
      const a = stars[i]
      const b = stars[j]
      const delta = {
        x: b.position.x - a.position.x,
        y: b.position.y - a.position.y,
        z: b.position.z - a.position.z,
      }
      const distance = magnitude(delta)
      const minRadius = Math.max(Math.min(a.radius, b.radius), 1e-6)
      const overlap = a.radius + b.radius - distance
      const overlapRatio = overlap / minRadius
      if (overlapRatio <= MIN_OVERLAP_RATIO) continue

      const normal = normalize(delta)
      const pointA = {
        x: a.position.x + normal.x * a.radius,
        y: a.position.y + normal.y * a.radius,
        z: a.position.z + normal.z * a.radius,
      }
      const pointB = {
        x: b.position.x - normal.x * b.radius,
        y: b.position.y - normal.y * b.radius,
        z: b.position.z - normal.z * b.radius,
      }
      const dominant = a.mass >= b.mass ? a : b
      const secondary = dominant === a ? b : a
      const flashBuild = smooth01(overlapRatio / 0.22)
      const maskBuild = smooth01((overlapRatio - 0.055) / 0.20)
      const plasmaBuild = smooth01((overlapRatio - 0.04) / 0.16)

      pairs.push({
        key: [a.id, b.id].sort().join('~'),
        position: {
          x: (pointA.x + pointB.x) * 0.5,
          y: (pointA.y + pointB.y) * 0.5,
          z: (pointA.z + pointB.z) * 0.5,
        },
        normal,
        minRadius,
        overlapRatio,
        flashBuild,
        maskBuild,
        plasmaBuild,
        primaryColor: dominant.color,
        secondaryColor: secondary.color,
      })
    }
  }

  return pairs
}

function createMaterial(kind: MaskKind) {
  const kindValue = kind === 'flash' ? 0 : kind === 'sheet' ? 1 : 2
  return new THREE.ShaderMaterial({
    uniforms: {
      uPrimaryColor: { value: new THREE.Color('#f6fbff') },
      uSecondaryColor: { value: new THREE.Color('#d9ebff') },
      uOpacity: { value: 0 },
      uBuild: { value: 0 },
      uMaskBuild: { value: 0 },
      uKind: { value: kindValue },
      uSeed: { value: 0 },
      uBrightness: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
}

export function createStellarTopologyMaskLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'stellar-topology-mask'
  group.renderOrder = 32
  scene.add(group)

  const geometry = new THREE.PlaneGeometry(1, 1)
  const visuals = new Map<string, MaskVisual>()
  const activePairs = new Map<string, ActiveMaskPair>()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const screenTangent = new THREE.Vector3()

  const removePairVisuals = (pairKey: string) => {
    ;(['flash', 'sheet', 'plasmaA', 'plasmaB'] as MaskKind[]).forEach((kind) => {
      const id = `${pairKey}:${kind}`
      const visual = visuals.get(id)
      if (!visual) return
      group.remove(visual.mesh)
      visual.material.dispose()
      visuals.delete(id)
    })
  }

  const ensure = (pairKey: string, kind: MaskKind) => {
    const id = `${pairKey}:${kind}`
    const existing = visuals.get(id)
    if (existing) return existing

    const material = createMaterial(kind)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `topology-mask:${id}`
    mesh.frustumCulled = false
    mesh.renderOrder = kind === 'flash' ? 35 : kind === 'sheet' ? 34 : 33
    group.add(mesh)
    const created = { mesh, material, kind }
    visuals.set(id, created)
    return created
  }

  const updateVisual = (
    visual: MaskVisual,
    pair: StellarTopologyMaskPair,
    camera: THREE.Camera,
    opacityScale: number,
  ) => {
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    normal.set(pair.normal.x, pair.normal.y, pair.normal.z).normalize()

    const normalAngle = Math.atan2(normal.dot(up), normal.dot(right))
    const tangentAngle = normalAngle + Math.PI * 0.5
    screenTangent
      .copy(right)
      .multiplyScalar(Math.cos(tangentAngle))
      .addScaledVector(up, Math.sin(tangentAngle))
      .normalize()

    const plasmaSign = visual.kind === 'plasmaB' ? -1 : 1
    const plasmaOffset = pair.minRadius * (0.42 + pair.plasmaBuild * 0.62) * plasmaSign
    visual.mesh.position.set(pair.position.x, pair.position.y, pair.position.z)
    if (visual.kind === 'plasmaA' || visual.kind === 'plasmaB') {
      visual.mesh.position.addScaledVector(screenTangent, plasmaOffset)
    }
    visual.mesh.quaternion.copy(camera.quaternion)
    visual.mesh.rotateZ(
      visual.kind === 'plasmaB'
        ? tangentAngle + Math.PI
        : tangentAngle,
    )

    if (visual.kind === 'flash') {
      visual.mesh.scale.set(
        pair.minRadius * (3.05 + pair.maskBuild * 0.78),
        pair.minRadius * (0.72 + pair.maskBuild * 0.55),
        1,
      )
    } else if (visual.kind === 'sheet') {
      visual.mesh.scale.set(
        pair.minRadius * (4.0 + pair.flashBuild * 0.85),
        pair.minRadius * (0.34 + pair.maskBuild * 0.27),
        1,
      )
    } else {
      visual.mesh.scale.set(
        pair.minRadius * (1.85 + pair.plasmaBuild * 1.18),
        pair.minRadius * (0.58 + pair.plasmaBuild * 0.30),
        1,
      )
    }

    const uniforms = visual.material.uniforms
    ;(uniforms.uPrimaryColor.value as THREE.Color).set(pair.primaryColor)
    ;(uniforms.uSecondaryColor.value as THREE.Color).set(pair.secondaryColor)
    uniforms.uBuild.value = pair.flashBuild
    uniforms.uMaskBuild.value = pair.maskBuild
    uniforms.uSeed.value = hashSeed(`${pair.key}:${visual.kind}`) * 1000

    if (visual.kind === 'flash') {
      uniforms.uOpacity.value = clamp(
        (0.18 + pair.flashBuild * 0.62 + pair.maskBuild * 0.10) * opacityScale,
        0,
        0.92,
      )
      uniforms.uBrightness.value = 1.38 + pair.flashBuild * 0.54 + pair.maskBuild * 0.30
    } else if (visual.kind === 'sheet') {
      uniforms.uOpacity.value = clamp(
        (0.08 + pair.flashBuild * 0.38 + pair.maskBuild * 0.15) * opacityScale,
        0,
        0.68,
      )
      uniforms.uBrightness.value = 1.12 + pair.flashBuild * 0.36 + pair.maskBuild * 0.16
    } else {
      uniforms.uOpacity.value = clamp(
        (0.06 + pair.plasmaBuild * 0.62) * opacityScale,
        0,
        0.72,
      )
      uniforms.uBrightness.value = 1.18 + pair.plasmaBuild * 0.52
    }

    visual.mesh.visible = uniforms.uOpacity.value > 0.01
  }

  return {
    update(bodies: BodyState[], camera: THREE.Camera, now = performance.now()) {
      camera.updateMatrixWorld(true)
      const currentPairs = getStellarTopologyMaskPairs(bodies)
      const currentKeys = new Set(currentPairs.map((pair) => pair.key))

      currentPairs.forEach((pair) => {
        activePairs.set(pair.key, { pair, retiringAt: null })
      })

      activePairs.forEach((entry, key) => {
        if (currentKeys.has(key)) return
        if (entry.retiringAt === null) entry.retiringAt = now
      })

      activePairs.forEach((entry, key) => {
        let opacityScale = 1
        if (entry.retiringAt !== null) {
          const progress = clamp((now - entry.retiringAt) / RETIRE_MS, 0, 1)
          if (progress >= 1) {
            activePairs.delete(key)
            removePairVisuals(key)
            return
          }
          opacityScale = 1 - smooth01(progress)
        }

        const flash = ensure(key, 'flash')
        const sheet = ensure(key, 'sheet')
        const plasmaA = ensure(key, 'plasmaA')
        const plasmaB = ensure(key, 'plasmaB')

        updateVisual(flash, entry.pair, camera, opacityScale)
        updateVisual(sheet, entry.pair, camera, opacityScale)
        updateVisual(plasmaA, entry.pair, camera, opacityScale)
        updateVisual(plasmaB, entry.pair, camera, opacityScale)
      })
    },

    dispose() {
      activePairs.clear()
      Array.from(visuals.keys()).forEach((id) => {
        const visual = visuals.get(id)
        if (!visual) return
        group.remove(visual.mesh)
        visual.material.dispose()
      })
      visuals.clear()
      scene.remove(group)
      geometry.dispose()
    },
  }
}

type StellarTopologyMaskLayer = ReturnType<typeof createStellarTopologyMaskLayer>

let installed = false
let currentBodies: BodyState[] = []
const layerByScene = new WeakMap<THREE.Scene, StellarTopologyMaskLayer>()
const scenesByRenderer = new WeakMap<THREE.WebGLRenderer, Set<THREE.Scene>>()

export function syncStellarTopologyMaskState(bodies: BodyState[]) {
  currentBodies = bodies
}

export function installStellarTopologyMask() {
  if (installed) return
  installed = true

  const rendererPrototype = THREE.WebGLRenderer.prototype as any
  const previousRender = rendererPrototype.render
  const previousDispose = rendererPrototype.dispose

  rendererPrototype.render = function renderWithStellarTopologyMask(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ) {
    if (scene instanceof THREE.Scene) {
      let layer = layerByScene.get(scene)
      if (!layer) {
        layer = createStellarTopologyMaskLayer(scene)
        layerByScene.set(scene, layer)
      }

      let scenes = scenesByRenderer.get(this as THREE.WebGLRenderer)
      if (!scenes) {
        scenes = new Set<THREE.Scene>()
        scenesByRenderer.set(this as THREE.WebGLRenderer, scenes)
      }
      scenes.add(scene)
      layer.update(currentBodies, camera)
    }

    return previousRender.call(this, scene, camera)
  }

  rendererPrototype.dispose = function disposeWithStellarTopologyMask() {
    const renderer = this as THREE.WebGLRenderer
    const scenes = scenesByRenderer.get(renderer)
    scenes?.forEach((scene) => {
      layerByScene.get(scene)?.dispose()
      layerByScene.delete(scene)
    })
    scenesByRenderer.delete(renderer)
    return previousDispose.call(this)
  }
}
