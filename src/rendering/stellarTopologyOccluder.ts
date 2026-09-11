import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import type { BodyState, Vec3 } from '../types'

const MAX_ACTIVE_PAIRS = 2
const RETIRE_MS = 520
const MIN_OVERLAP_RATIO = 0.002

export type StellarTopologyOcclusionPair = {
  key: string
  position: Vec3
  normal: Vec3
  minRadius: number
  longitudinalSpan: number
  transverseSpan: number
  overlapRatio: number
  impactBuild: number
  maskBuild: number
  plasmaBuild: number
}

type ActivePair = {
  pair: StellarTopologyOcclusionPair
  retiringAt: number | null
}

type PairVisual = {
  veil: THREE.Sprite
  veilMaterial: THREE.SpriteMaterial
  shock: THREE.Sprite
  shockMaterial: THREE.SpriteMaterial
  plasmaA: THREE.Sprite
  plasmaAMaterial: THREE.SpriteMaterial
  plasmaB: THREE.Sprite
  plasmaBMaterial: THREE.SpriteMaterial
}

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

function createTexture(
  width: number,
  height: number,
  sample: (x: number, y: number) => { r: number; g: number; b: number; a: number },
) {
  const data = new Uint8Array(width * height * 4)
  let offset = 0
  for (let py = 0; py < height; py += 1) {
    const y = (py / Math.max(height - 1, 1)) * 2 - 1
    for (let px = 0; px < width; px += 1) {
      const x = (px / Math.max(width - 1, 1)) * 2 - 1
      const pixel = sample(x, y)
      data[offset] = Math.round(clamp(pixel.r, 0, 1) * 255)
      data[offset + 1] = Math.round(clamp(pixel.g, 0, 1) * 255)
      data[offset + 2] = Math.round(clamp(pixel.b, 0, 1) * 255)
      data[offset + 3] = Math.round(clamp(pixel.a, 0, 1) * 255)
      offset += 4
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createVeilTexture() {
  return createTexture(192, 96, (x, y) => {
    const lens = Math.sqrt(x * x + y * y * 0.88)
    const outer = 1 - smooth01((lens - 0.68) / 0.32)
    const core = 1 - smooth01((Math.sqrt(x * x * 0.66 + y * y * 1.35) - 0.18) / 0.66)
    const ridge = Math.exp(-Math.abs(y) * 7.5) * (1 - smooth01((Math.abs(x) - 0.38) / 0.54))
    const alpha = clamp(outer * (0.56 + core * 0.32) + ridge * 0.18, 0, 1)
    const warmth = 1 - smooth01((Math.abs(x) - 0.2) / 0.8)
    return {
      r: 1,
      g: 0.97 + warmth * 0.03,
      b: 0.92 + warmth * 0.08,
      a: alpha,
    }
  })
}

function createShockTexture() {
  return createTexture(192, 48, (x, y) => {
    const envelope = 1 - smooth01((Math.abs(x) - 0.62) / 0.38)
    const ridge = Math.exp(-Math.abs(y) * 11)
    const halo = Math.exp(-Math.abs(y) * 4.2) * 0.46
    const alpha = clamp(envelope * (ridge + halo), 0, 1)
    return { r: 0.92, g: 0.98, b: 1, a: alpha }
  })
}

function createPlasmaTexture() {
  return createTexture(128, 64, (x, y) => {
    const shiftedX = x - 0.28
    const head = 1 - smooth01((Math.sqrt(shiftedX * shiftedX * 1.2 + y * y * 1.7) - 0.08) / 0.58)
    const tailProgress = clamp((0.3 - x) / 1.3, 0, 1)
    const tailWidth = 0.12 + (1 - tailProgress) * 0.22
    const tail = (1 - smooth01((Math.abs(y) - tailWidth * 0.35) / Math.max(tailWidth * 0.65, 1e-6))) *
      smooth01((x + 1) / 0.3) *
      (1 - smooth01((x - 0.18) / 0.35))
    const filament = Math.exp(-Math.abs(y) * 13) * tailProgress * 0.22
    const alpha = clamp(Math.max(head * 0.9, tail * 0.78) + filament, 0, 1)
    return { r: 0.94, g: 0.98, b: 1, a: alpha }
  })
}

export function getStellarTopologyOcclusionPairs(bodies: BodyState[]) {
  const stars = bodies.filter((body) => getEffectiveBodyType(body) === 'star')
  const pairs: StellarTopologyOcclusionPair[] = []

  for (let i = 0; i < stars.length && pairs.length < MAX_ACTIVE_PAIRS; i += 1) {
    for (let j = i + 1; j < stars.length && pairs.length < MAX_ACTIVE_PAIRS; j += 1) {
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

      pairs.push({
        key: [a.id, b.id].sort().join('~'),
        position: {
          x: (pointA.x + pointB.x) * 0.5,
          y: (pointA.y + pointB.y) * 0.5,
          z: (pointA.z + pointB.z) * 0.5,
        },
        normal,
        minRadius,
        longitudinalSpan: distance + a.radius + b.radius,
        transverseSpan: Math.max(a.radius, b.radius) * 2,
        overlapRatio,
        impactBuild: smooth01(overlapRatio / 0.18),
        maskBuild: smooth01((overlapRatio - 0.035) / 0.19),
        plasmaBuild: smooth01((overlapRatio - 0.025) / 0.16),
      })
    }
  }

  return pairs
}

export function createStellarTopologyOcclusionLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'stellar-topology-occluder'
  scene.add(group)

  const veilTexture = createVeilTexture()
  const shockTexture = createShockTexture()
  const plasmaTexture = createPlasmaTexture()

  const activePairs = new Map<string, ActivePair>()
  const visuals = new Map<string, PairVisual>()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const tangent = new THREE.Vector3()

  const createSprite = (
    name: string,
    texture: THREE.Texture,
    blending: THREE.Blending,
    renderOrder: number,
  ) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.name = name
    sprite.frustumCulled = false
    sprite.renderOrder = renderOrder
    group.add(sprite)
    return { sprite, material }
  }

  const ensure = (pairKey: string) => {
    const existing = visuals.get(pairKey)
    if (existing) return existing

    const veil = createSprite(
      `topology-occluder:${pairKey}:veil`,
      veilTexture,
      THREE.NormalBlending,
      60,
    )
    const shock = createSprite(
      `topology-occluder:${pairKey}:shock`,
      shockTexture,
      THREE.AdditiveBlending,
      61,
    )
    const plasmaA = createSprite(
      `topology-occluder:${pairKey}:plasmaA`,
      plasmaTexture,
      THREE.AdditiveBlending,
      62,
    )
    const plasmaB = createSprite(
      `topology-occluder:${pairKey}:plasmaB`,
      plasmaTexture,
      THREE.AdditiveBlending,
      62,
    )

    const visual: PairVisual = {
      veil: veil.sprite,
      veilMaterial: veil.material,
      shock: shock.sprite,
      shockMaterial: shock.material,
      plasmaA: plasmaA.sprite,
      plasmaAMaterial: plasmaA.material,
      plasmaB: plasmaB.sprite,
      plasmaBMaterial: plasmaB.material,
    }
    visuals.set(pairKey, visual)
    return visual
  }

  const removeVisual = (pairKey: string) => {
    const visual = visuals.get(pairKey)
    if (!visual) return
    group.remove(visual.veil, visual.shock, visual.plasmaA, visual.plasmaB)
    visual.veilMaterial.dispose()
    visual.shockMaterial.dispose()
    visual.plasmaAMaterial.dispose()
    visual.plasmaBMaterial.dispose()
    visuals.delete(pairKey)
  }

  const updateVisual = (
    visual: PairVisual,
    pair: StellarTopologyOcclusionPair,
    camera: THREE.Camera,
    opacityScale: number,
  ) => {
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    normal.set(pair.normal.x, pair.normal.y, pair.normal.z).normalize()

    const normalAngle = Math.atan2(normal.dot(up), normal.dot(right))
    const tangentAngle = normalAngle + Math.PI * 0.5
    tangent
      .copy(right)
      .multiplyScalar(Math.cos(tangentAngle))
      .addScaledVector(up, Math.sin(tangentAngle))
      .normalize()

    visual.veil.position.set(pair.position.x, pair.position.y, pair.position.z)
    visual.veilMaterial.rotation = normalAngle
    visual.veil.scale.set(
      pair.longitudinalSpan * (1.08 + pair.maskBuild * 0.12),
      pair.transverseSpan * (0.76 + pair.maskBuild * 0.42),
      1,
    )
    visual.veilMaterial.opacity = clamp(
      (0.14 + pair.impactBuild * 0.28 + pair.maskBuild * 0.56) * opacityScale,
      0,
      0.98,
    )
    visual.veil.visible = visual.veilMaterial.opacity > 0.01

    visual.shock.position.copy(visual.veil.position)
    visual.shockMaterial.rotation = tangentAngle
    visual.shock.scale.set(
      pair.transverseSpan * (2.15 + pair.impactBuild * 0.78),
      pair.minRadius * (0.22 + pair.maskBuild * 0.42),
      1,
    )
    visual.shockMaterial.opacity = clamp(
      (0.08 + pair.impactBuild * 0.48 + pair.maskBuild * 0.24) * opacityScale,
      0,
      0.82,
    )
    visual.shock.visible = visual.shockMaterial.opacity > 0.01

    const plasmaOffset = pair.minRadius * (0.55 + pair.plasmaBuild * 0.9)
    const plasmaLength = pair.minRadius * (1.9 + pair.plasmaBuild * 1.7)
    const plasmaWidth = pair.minRadius * (0.5 + pair.plasmaBuild * 0.55)

    visual.plasmaA.position.copy(visual.veil.position).addScaledVector(tangent, plasmaOffset)
    visual.plasmaAMaterial.rotation = tangentAngle
    visual.plasmaA.scale.set(plasmaLength, plasmaWidth, 1)
    visual.plasmaAMaterial.opacity = clamp(
      (0.05 + pair.plasmaBuild * 0.76) * opacityScale,
      0,
      0.82,
    )
    visual.plasmaA.visible = visual.plasmaAMaterial.opacity > 0.01

    visual.plasmaB.position.copy(visual.veil.position).addScaledVector(tangent, -plasmaOffset)
    visual.plasmaBMaterial.rotation = tangentAngle + Math.PI
    visual.plasmaB.scale.set(plasmaLength, plasmaWidth, 1)
    visual.plasmaBMaterial.opacity = visual.plasmaAMaterial.opacity
    visual.plasmaB.visible = visual.plasmaBMaterial.opacity > 0.01
  }

  return {
    update(bodies: BodyState[], camera: THREE.Camera, now = performance.now()) {
      camera.updateMatrixWorld(true)
      const currentPairs = getStellarTopologyOcclusionPairs(bodies)
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
            removeVisual(key)
            return
          }
          opacityScale = 1 - smooth01(progress)
        }

        updateVisual(ensure(key), entry.pair, camera, opacityScale)
      })
    },

    dispose() {
      activePairs.clear()
      Array.from(visuals.keys()).forEach(removeVisual)
      scene.remove(group)
      veilTexture.dispose()
      shockTexture.dispose()
      plasmaTexture.dispose()
    },
  }
}

type StellarTopologyOcclusionLayer = ReturnType<typeof createStellarTopologyOcclusionLayer>

let installed = false
let currentBodies: BodyState[] = []
const layerByScene = new WeakMap<THREE.Scene, StellarTopologyOcclusionLayer>()
const scenesByRenderer = new WeakMap<THREE.WebGLRenderer, Set<THREE.Scene>>()

export function syncStellarTopologyOcclusionState(bodies: BodyState[]) {
  currentBodies = bodies
}

export function installStellarTopologyOcclusion() {
  if (installed) return
  installed = true

  const rendererPrototype = THREE.WebGLRenderer.prototype as any
  const previousRender = rendererPrototype.render
  const previousDispose = rendererPrototype.dispose

  rendererPrototype.render = function renderWithStellarTopologyOcclusion(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ) {
    if (scene instanceof THREE.Scene) {
      let layer = layerByScene.get(scene)
      if (!layer) {
        layer = createStellarTopologyOcclusionLayer(scene)
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

  rendererPrototype.dispose = function disposeWithStellarTopologyOcclusion() {
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
