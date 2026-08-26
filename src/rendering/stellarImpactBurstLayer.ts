import * as THREE from 'three'
import type { BodyState } from '../types'
import {
  getStellarTopologyOcclusionPairs,
  type StellarTopologyOcclusionPair,
} from './stellarTopologyOccluder'

const RETIRE_MS = 540

type ActivePair = {
  pair: StellarTopologyOcclusionPair
  retiringAt: number | null
}

type BurstVisual = {
  core: THREE.Sprite
  coreMaterial: THREE.SpriteMaterial
  halo: THREE.Sprite
  haloMaterial: THREE.SpriteMaterial
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

function createCoreTexture() {
  return createTexture(256, 128, (x, y) => {
    const radial = Math.sqrt(x * x * 0.72 + y * y * 1.08)
    const envelope = 1 - smooth01((radial - 0.48) / 0.52)
    const hotCore = 1 - smooth01((radial - 0.08) / 0.52)
    const horizontalBridge = Math.exp(-Math.abs(y) * 4.6) *
      (1 - smooth01((Math.abs(x) - 0.54) / 0.44))
    const alpha = clamp(envelope * (0.72 + hotCore * 0.24) + horizontalBridge * 0.14, 0, 1)
    return {
      r: 1,
      g: 0.992,
      b: 0.975 + hotCore * 0.025,
      a: alpha,
    }
  })
}

function createHaloTexture() {
  return createTexture(192, 112, (x, y) => {
    const radial = Math.sqrt(x * x * 0.64 + y * y)
    const alpha = Math.exp(-radial * radial * 2.4) *
      (1 - smooth01((radial - 0.52) / 0.48))
    return { r: 0.96, g: 0.985, b: 1, a: alpha * 0.84 }
  })
}

function createPlasmaTexture() {
  return createTexture(192, 80, (x, y) => {
    const headX = x - 0.48
    const head = 1 - smooth01((Math.sqrt(headX * headX * 1.1 + y * y * 1.7) - 0.08) / 0.52)
    const tailProgress = clamp((0.45 - x) / 1.4, 0, 1)
    const wave = Math.sin((x + 1) * 9.2) * 0.055 * tailProgress
    const width = 0.13 + (1 - tailProgress) * 0.28
    const tail = (1 - smooth01((Math.abs(y - wave) - width * 0.25) / Math.max(width * 0.75, 1e-6))) *
      smooth01((x + 1.0) / 0.32) *
      (1 - smooth01((x - 0.32) / 0.4))
    const filament = Math.exp(-Math.abs(y - wave * 0.45) * 18) * tailProgress * 0.3
    const alpha = clamp(Math.max(head * 0.94, tail * 0.78) + filament, 0, 1)
    return { r: 0.9, g: 0.965, b: 1, a: alpha }
  })
}

export function createStellarImpactBurstLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'stellar-impact-burst'
  scene.add(group)

  const coreTexture = createCoreTexture()
  const haloTexture = createHaloTexture()
  const plasmaTexture = createPlasmaTexture()
  const activePairs = new Map<string, ActivePair>()
  const visuals = new Map<string, BurstVisual>()
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

  const ensure = (key: string) => {
    const existing = visuals.get(key)
    if (existing) return existing

    const core = createSprite(`stellar-impact-burst:${key}:core`, coreTexture, THREE.NormalBlending, 70)
    const halo = createSprite(`stellar-impact-burst:${key}:halo`, haloTexture, THREE.AdditiveBlending, 71)
    const plasmaA = createSprite(`stellar-impact-burst:${key}:plasmaA`, plasmaTexture, THREE.AdditiveBlending, 72)
    const plasmaB = createSprite(`stellar-impact-burst:${key}:plasmaB`, plasmaTexture, THREE.AdditiveBlending, 72)

    const visual: BurstVisual = {
      core: core.sprite,
      coreMaterial: core.material,
      halo: halo.sprite,
      haloMaterial: halo.material,
      plasmaA: plasmaA.sprite,
      plasmaAMaterial: plasmaA.material,
      plasmaB: plasmaB.sprite,
      plasmaBMaterial: plasmaB.material,
    }
    visuals.set(key, visual)
    return visual
  }

  const removeVisual = (key: string) => {
    const visual = visuals.get(key)
    if (!visual) return
    group.remove(visual.core, visual.halo, visual.plasmaA, visual.plasmaB)
    visual.coreMaterial.dispose()
    visual.haloMaterial.dispose()
    visual.plasmaAMaterial.dispose()
    visual.plasmaBMaterial.dispose()
    visuals.delete(key)
  }

  const updateVisual = (
    visual: BurstVisual,
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

    visual.core.position.set(pair.position.x, pair.position.y, pair.position.z)
    visual.coreMaterial.rotation = normalAngle
    visual.core.scale.set(
      pair.longitudinalSpan * (1.3 + pair.maskBuild * 0.34),
      pair.transverseSpan * (1.02 + pair.maskBuild * 0.38),
      1,
    )
    visual.coreMaterial.opacity = clamp(
      (0.18 + pair.impactBuild * 0.34 + pair.maskBuild * 0.46) * opacityScale,
      0,
      0.985,
    )
    visual.core.visible = visual.coreMaterial.opacity > 0.01

    visual.halo.position.copy(visual.core.position)
    visual.haloMaterial.rotation = normalAngle
    visual.halo.scale.set(
      pair.longitudinalSpan * (1.72 + pair.impactBuild * 0.42),
      pair.transverseSpan * (1.46 + pair.impactBuild * 0.46),
      1,
    )
    visual.haloMaterial.opacity = clamp(
      (0.04 + pair.impactBuild * 0.33 + pair.maskBuild * 0.13) * opacityScale,
      0,
      0.52,
    )
    visual.halo.visible = visual.haloMaterial.opacity > 0.01

    const plasmaOffset = pair.minRadius * (0.72 + pair.plasmaBuild * 0.92)
    const plasmaLength = pair.minRadius * (3.0 + pair.plasmaBuild * 2.25)
    const plasmaWidth = pair.minRadius * (0.72 + pair.plasmaBuild * 0.72)
    const plasmaOpacity = clamp(
      (0.04 + pair.plasmaBuild * 0.72) * opacityScale,
      0,
      0.78,
    )

    visual.plasmaA.position.copy(visual.core.position).addScaledVector(tangent, plasmaOffset)
    visual.plasmaAMaterial.rotation = tangentAngle
    visual.plasmaA.scale.set(plasmaLength, plasmaWidth, 1)
    visual.plasmaAMaterial.opacity = plasmaOpacity
    visual.plasmaA.visible = plasmaOpacity > 0.01

    visual.plasmaB.position.copy(visual.core.position).addScaledVector(tangent, -plasmaOffset)
    visual.plasmaBMaterial.rotation = tangentAngle + Math.PI
    visual.plasmaB.scale.set(plasmaLength, plasmaWidth, 1)
    visual.plasmaBMaterial.opacity = plasmaOpacity
    visual.plasmaB.visible = plasmaOpacity > 0.01
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
      coreTexture.dispose()
      haloTexture.dispose()
      plasmaTexture.dispose()
    },
  }
}
