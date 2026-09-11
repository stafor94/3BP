import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import type { BodyState, Vec3 } from '../types'
import {
  getStellarTopologyOcclusionPairs,
  type StellarTopologyOcclusionPair,
} from './stellarTopologyOccluder'

const RETIRE_MS = 680

export type StellarImpactBurstPresentation = {
  tangent: Vec3
  primaryDirection: Vec3
  secondaryDirection: Vec3
  relativeSpeed: number
  speed01: number
  headOn: number
  grazing: number
  massRatio: number
  massAsymmetry: number
  primaryLengthScale: number
  secondaryLengthScale: number
  plumeWidthScale: number
  secondaryOpacityScale: number
  colorA: string
  colorB: string
  primaryColor: string
  secondaryColor: string
}

type ActivePair = {
  pair: StellarTopologyOcclusionPair
  presentation: StellarImpactBurstPresentation
  retiringAt: number | null
}

type BurstVisual = {
  compression: THREE.Sprite
  compressionMaterial: THREE.SpriteMaterial
  plumePrimary: THREE.Sprite
  plumePrimaryMaterial: THREE.SpriteMaterial
  plumeSecondary: THREE.Sprite
  plumeSecondaryMaterial: THREE.SpriteMaterial
  shell: THREE.Sprite
  shellMaterial: THREE.SpriteMaterial
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function smooth01(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: Vec3, scalar: number): Vec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function magnitude(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function normalize(value: Vec3, fallback: Vec3 = { x: 1, y: 0, z: 0 }): Vec3 {
  const length = magnitude(value)
  if (length > 1e-10) return scale(value, 1 / length)
  const fallbackLength = magnitude(fallback)
  return fallbackLength > 1e-10 ? scale(fallback, 1 / fallbackLength) : { x: 1, y: 0, z: 0 }
}

function pairKey(a: BodyState, b: BodyState) {
  return [a.id, b.id].sort().join('~')
}

function hashScalar(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function findPairBodies(pair: StellarTopologyOcclusionPair, bodies: BodyState[]) {
  const stars = bodies.filter((body) => getEffectiveBodyType(body) === 'star')
  for (let i = 0; i < stars.length; i += 1) {
    for (let j = i + 1; j < stars.length; j += 1) {
      if (pairKey(stars[i], stars[j]) === pair.key) return [stars[i], stars[j]] as const
    }
  }
  return null
}

export function getStellarImpactBurstPresentation(
  pair: StellarTopologyOcclusionPair,
  bodies: BodyState[],
): StellarImpactBurstPresentation | null {
  const pairBodies = findPairBodies(pair, bodies)
  if (!pairBodies) return null
  const [a, b] = pairBodies
  const normal = normalize(pair.normal)
  const relativeVelocity = sub(b.velocity, a.velocity)
  const relativeSpeed = magnitude(relativeVelocity)
  const normalVelocity = scale(normal, dot(relativeVelocity, normal))
  const tangentialVelocity = sub(relativeVelocity, normalVelocity)
  const referenceAxis: Vec3 = Math.abs(normal.z) < 0.86
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 }
  const tangent = normalize(tangentialVelocity, cross(referenceAxis, normal))
  const headOn = relativeSpeed > 1e-9
    ? clamp(Math.abs(dot(relativeVelocity, normal)) / relativeSpeed, 0, 1)
    : 1
  const grazing = Math.sqrt(Math.max(0, 1 - headOn * headOn))
  const smaller = a.mass <= b.mass ? a : b
  const larger = smaller === a ? b : a
  const massRatio = Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, 1e-9)
  const massAsymmetry = 1 - massRatio
  const relativeDirection = normalize(relativeVelocity, tangent)
  const strippedDirection = smaller === a ? scale(relativeDirection, -1) : relativeDirection
  const seed = hashScalar(pair.key)
  const signedSkew = (seed * 2 - 1) * (0.1 + grazing * 0.06 + massAsymmetry * 0.05)

  const primaryDirection = normalize(
    add(
      scale(tangent, 0.68 + grazing * 0.2),
      add(
        scale(strippedDirection, 0.1 + massAsymmetry * 0.2),
        scale(normal, signedSkew),
      ),
    ),
    tangent,
  )
  const secondaryDirection = normalize(
    add(
      scale(tangent, -(0.48 - grazing * 0.08)),
      add(
        scale(strippedDirection, 0.05 + massAsymmetry * 0.09),
        scale(normal, -signedSkew * 0.62 + 0.035),
      ),
    ),
    scale(tangent, -1),
  )
  const speed01 = clamp(relativeSpeed / 3, 0, 1)

  return {
    tangent,
    primaryDirection,
    secondaryDirection,
    relativeSpeed,
    speed01,
    headOn,
    grazing,
    massRatio,
    massAsymmetry,
    primaryLengthScale: 0.9 + grazing * 0.46 + speed01 * 0.15 + massAsymmetry * 0.18,
    secondaryLengthScale: clamp(0.58 + massRatio * 0.16 + headOn * 0.1 - grazing * 0.06, 0.5, 0.82),
    plumeWidthScale: clamp(0.98 + headOn * 0.36 - grazing * 0.08, 0.9, 1.38),
    secondaryOpacityScale: clamp(0.32 + massRatio * 0.28 + headOn * 0.12 - grazing * 0.05, 0.28, 0.67),
    colorA: a.color,
    colorB: b.color,
    primaryColor: smaller.color,
    secondaryColor: larger.color,
  }
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

function createCompressionTexture() {
  return createTexture(192, 128, (x, y) => {
    const bend = Math.sin(x * 5.4) * 0.055
    const localY = y - bend
    const compact = 1 - smooth01((Math.sqrt(x * x * 1.45 + localY * localY * 3.1) - 0.08) / 0.84)
    const contactBand = Math.exp(-Math.abs(localY) * 8.8) *
      (1 - smooth01((Math.abs(x) - 0.42) / 0.48))
    const knotA = 1 - smooth01((Math.hypot((x + 0.2) * 1.6, localY * 2.8) - 0.05) / 0.38)
    const knotB = 1 - smooth01((Math.hypot((x - 0.26) * 1.8, (localY + 0.04) * 2.6) - 0.05) / 0.34)
    const alpha = clamp(compact * 0.62 + contactBand * 0.32 + Math.max(knotA, knotB) * 0.18, 0, 1)
    return { r: 1, g: 0.985, b: 0.96, a: alpha }
  })
}

function createPlumeTexture() {
  return createTexture(192, 128, (x, y) => {
    const headX = x - 0.36
    const head = 1 - smooth01((Math.sqrt(headX * headX * 1.25 + y * y * 1.55) - 0.08) / 0.5)
    const travel = clamp((0.32 - x) / 1.28, 0, 1)
    const curve = Math.sin((x + 0.72) * 3.1) * 0.12 * travel + 0.08 * travel * travel
    const width = 0.16 + travel * 0.24
    const plume = (1 - smooth01((Math.abs(y - curve) - width * 0.28) / Math.max(width * 0.72, 1e-6))) *
      smooth01((x + 1) / 0.28) *
      (1 - smooth01((x - 0.24) / 0.34))
    const cloudA = 1 - smooth01((Math.hypot((x + 0.08) * 1.35, (y - curve - 0.04) * 2.0) - 0.08) / 0.42)
    const cloudB = 1 - smooth01((Math.hypot((x + 0.48) * 1.45, (y - curve + 0.06) * 2.15) - 0.08) / 0.4)
    const filament = Math.exp(-Math.abs(y - curve * 0.62) * 12.5) * travel * 0.16
    const alpha = clamp(Math.max(head * 0.88, plume * 0.72, cloudA * 0.48, cloudB * 0.38) + filament, 0, 1)
    return { r: 0.92, g: 0.97, b: 1, a: alpha }
  })
}

function createShellTexture() {
  return createTexture(160, 160, (x, y) => {
    const radial = Math.hypot(x, y)
    const shell = Math.exp(-Math.abs(radial - 0.69) / 0.048)
    const innerEcho = Math.exp(-Math.abs(radial - 0.59) / 0.085) * 0.18
    const breakup = 0.82 + 0.18 * Math.sin(Math.atan2(y, x) * 7 + radial * 8)
    const alpha = clamp((shell * breakup + innerEcho) * (1 - smooth01((radial - 0.86) / 0.13)), 0, 1)
    return { r: 0.9, g: 0.97, b: 1, a: alpha }
  })
}

export function createStellarImpactBurstLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'stellar-impact-burst'
  scene.add(group)

  const compressionTexture = createCompressionTexture()
  const plumeTexture = createPlumeTexture()
  const shellTexture = createShellTexture()
  const activePairs = new Map<string, ActivePair>()
  const visuals = new Map<string, BurstVisual>()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const worldDirection = new THREE.Vector3()
  const impactColor = new THREE.Color()
  const secondaryImpactColor = new THREE.Color()
  const colorA = new THREE.Color()
  const colorB = new THREE.Color()
  const white = new THREE.Color('#fffaf2')

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

    const compression = createSprite(
      `stellar-impact-burst:${key}:compression`,
      compressionTexture,
      THREE.NormalBlending,
      70,
    )
    const plumePrimary = createSprite(
      `stellar-impact-burst:${key}:plume-primary`,
      plumeTexture,
      THREE.AdditiveBlending,
      71,
    )
    const plumeSecondary = createSprite(
      `stellar-impact-burst:${key}:plume-secondary`,
      plumeTexture,
      THREE.AdditiveBlending,
      71,
    )
    const shell = createSprite(
      `stellar-impact-burst:${key}:shock-shell`,
      shellTexture,
      THREE.AdditiveBlending,
      72,
    )

    const visual: BurstVisual = {
      compression: compression.sprite,
      compressionMaterial: compression.material,
      plumePrimary: plumePrimary.sprite,
      plumePrimaryMaterial: plumePrimary.material,
      plumeSecondary: plumeSecondary.sprite,
      plumeSecondaryMaterial: plumeSecondary.material,
      shell: shell.sprite,
      shellMaterial: shell.material,
    }
    visuals.set(key, visual)
    return visual
  }

  const removeVisual = (key: string) => {
    const visual = visuals.get(key)
    if (!visual) return
    group.remove(visual.compression, visual.plumePrimary, visual.plumeSecondary, visual.shell)
    visual.compressionMaterial.dispose()
    visual.plumePrimaryMaterial.dispose()
    visual.plumeSecondaryMaterial.dispose()
    visual.shellMaterial.dispose()
    visuals.delete(key)
  }

  const screenAngle = (value: Vec3) => {
    worldDirection.set(value.x, value.y, value.z).normalize()
    return Math.atan2(worldDirection.dot(up), worldDirection.dot(right))
  }

  const setOffsetPosition = (
    sprite: THREE.Sprite,
    pair: StellarTopologyOcclusionPair,
    direction: Vec3,
    distance: number,
  ) => {
    sprite.position.set(
      pair.position.x + direction.x * distance,
      pair.position.y + direction.y * distance,
      pair.position.z + direction.z * distance,
    )
  }

  const updateVisual = (
    visual: BurstVisual,
    pair: StellarTopologyOcclusionPair,
    presentation: StellarImpactBurstPresentation,
    camera: THREE.Camera,
    retireProgress: number | null,
  ) => {
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()

    const retiring = retireProgress !== null
    const retire = retireProgress ?? 0
    const coreFade = retiring ? 1 - smooth01(retire / 0.54) : 1
    const plumeFade = retiring ? 1 - smooth01(retire / 0.82) : 1
    const shellFade = retiring ? Math.pow(1 - retire, 1.15) : 1
    const build = pair.plasmaBuild
    const impactBuild = pair.impactBuild

    colorA.set(presentation.colorA)
    colorB.set(presentation.colorB)
    impactColor.copy(colorA).lerp(colorB, 0.5).lerp(white, 0.58)
    secondaryImpactColor.set(presentation.secondaryColor).lerp(white, 0.34)

    visual.compression.position.set(pair.position.x, pair.position.y, pair.position.z)
    visual.compressionMaterial.rotation = screenAngle(presentation.tangent)
    visual.compression.scale.set(
      pair.minRadius * (1.28 + impactBuild * 0.55),
      pair.minRadius * (0.56 + pair.maskBuild * 0.22 + presentation.headOn * 0.08),
      1,
    )
    visual.compressionMaterial.color.copy(impactColor)
    visual.compressionMaterial.opacity = clamp(
      (0.12 + impactBuild * 0.38 + pair.maskBuild * 0.18) * coreFade,
      0,
      0.72,
    )
    visual.compression.visible = visual.compressionMaterial.opacity > 0.01

    const retireTravel = pair.minRadius * retire * (1.1 + presentation.speed01 * 1.2)
    const primaryOffset = pair.minRadius * (0.14 + build * 0.34) + retireTravel
    const secondaryOffset = pair.minRadius * (0.1 + build * 0.22) + retireTravel * 0.72
    const basePlumeLength = pair.minRadius * (1.12 + build * 0.72)
    const basePlumeWidth = pair.minRadius * (0.6 + build * 0.3) * presentation.plumeWidthScale
    const primaryOpacity = clamp(
      build * (0.28 + presentation.grazing * 0.16 + presentation.speed01 * 0.06) * plumeFade,
      0,
      0.56,
    )
    const secondaryOpacity = clamp(
      primaryOpacity * presentation.secondaryOpacityScale,
      0,
      0.32,
    )

    setOffsetPosition(visual.plumePrimary, pair, presentation.primaryDirection, primaryOffset)
    visual.plumePrimaryMaterial.rotation = screenAngle(presentation.primaryDirection)
    visual.plumePrimary.scale.set(
      basePlumeLength * presentation.primaryLengthScale,
      basePlumeWidth,
      1,
    )
    visual.plumePrimaryMaterial.color.set(presentation.primaryColor).lerp(white, 0.38)
    visual.plumePrimaryMaterial.opacity = primaryOpacity
    visual.plumePrimary.visible = primaryOpacity > 0.01

    setOffsetPosition(visual.plumeSecondary, pair, presentation.secondaryDirection, secondaryOffset)
    visual.plumeSecondaryMaterial.rotation = screenAngle(presentation.secondaryDirection)
    visual.plumeSecondary.scale.set(
      basePlumeLength * presentation.secondaryLengthScale,
      basePlumeWidth * (0.8 + presentation.massRatio * 0.12),
      1,
    )
    visual.plumeSecondaryMaterial.color.copy(secondaryImpactColor)
    visual.plumeSecondaryMaterial.opacity = secondaryOpacity
    visual.plumeSecondary.visible = secondaryOpacity > 0.01

    visual.shell.position.set(pair.position.x, pair.position.y, pair.position.z)
    const activeShellBuild = smooth01((impactBuild - 0.7) / 0.3)
    const desiredShellDiameter = pair.minRadius * (
      2.05 + activeShellBuild * 0.65 + retire * 4.8 * (1 + presentation.speed01 * 0.28)
    )
    const shellDiameter = Math.min(desiredShellDiameter, pair.longitudinalSpan * 1.7)
    visual.shell.scale.set(shellDiameter, shellDiameter, 1)
    visual.shellMaterial.color.copy(impactColor).lerp(white, 0.18)
    visual.shellMaterial.opacity = clamp(
      retiring
        ? (0.1 + 0.26 * shellFade) * (0.78 + impactBuild * 0.22)
        : activeShellBuild * 0.1,
      0,
      0.36,
    )
    visual.shell.visible = visual.shellMaterial.opacity > 0.01
  }

  return {
    update(bodies: BodyState[], camera: THREE.Camera, now = performance.now()) {
      camera.updateMatrixWorld(true)
      const currentPairs = getStellarTopologyOcclusionPairs(bodies)
      const currentKeys = new Set<string>()

      currentPairs.forEach((pair) => {
        const presentation = getStellarImpactBurstPresentation(pair, bodies)
        if (!presentation) return
        currentKeys.add(pair.key)
        activePairs.set(pair.key, { pair, presentation, retiringAt: null })
      })

      activePairs.forEach((entry, key) => {
        if (currentKeys.has(key)) return
        if (entry.retiringAt === null) entry.retiringAt = now
      })

      activePairs.forEach((entry, key) => {
        let retireProgress: number | null = null
        if (entry.retiringAt !== null) {
          retireProgress = clamp((now - entry.retiringAt) / RETIRE_MS, 0, 1)
          if (retireProgress >= 1) {
            activePairs.delete(key)
            removeVisual(key)
            return
          }
        }
        updateVisual(ensure(key), entry.pair, entry.presentation, camera, retireProgress)
      })
    },

    dispose() {
      activePairs.clear()
      Array.from(visuals.keys()).forEach(removeVisual)
      scene.remove(group)
      compressionTexture.dispose()
      plumeTexture.dispose()
      shellTexture.dispose()
    },
  }
}
