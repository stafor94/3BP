import * as THREE from 'three'

export type SpaceStarLayer = {
  points: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  follow: number
}

type SpaceStarLayerOptions = {
  scene: THREE.Scene
  camera: THREE.Camera
  count: number
  minRadius: number
  maxRadius: number
  size: number
  opacity: number
  minBrightness: number
  maxBrightness: number
  follow: number
  seed: number
}

type SpaceBackdrop = {
  update: (cameraPosition: THREE.Vector3) => void
  dispose: () => void
}

type DistantGalaxyKind = 'spiral' | 'edgeOn' | 'elliptical'

type DistantGalaxySpec = {
  kind: DistantGalaxyKind
  direction: THREE.Vector3
  width: number
  height: number
  opacity: number
  rotation: number
  seed: number
}

const SPACE_TEXTURE_WIDTH = 512
const SPACE_TEXTURE_HEIGHT = 256
const SPACE_SKY_RADIUS = 240
const GALAXY_TEXTURE_SIZE = 64
const DISTANT_GALAXY_RADIUS = 205
const STAR_LAYOUT_SESSION_SALT = Math.floor(Math.random() * 0xffffffff) >>> 0

const GALACTIC_NORMAL = new THREE.Vector3(0.26, 0.83, 0.49).normalize()
const STAR_CLUSTER_CENTER = new THREE.Vector3(-0.44, 0.58, -0.68).normalize()
const STAR_VOID_CENTER = new THREE.Vector3(0.63, -0.18, 0.76).normalize()
const NEBULA_BLUE_CENTER = new THREE.Vector3(-0.72, 0.24, 0.65).normalize()
const NEBULA_VIOLET_CENTER = new THREE.Vector3(0.58, -0.47, -0.67).normalize()
const NEBULA_RED_CENTER = new THREE.Vector3(0.16, 0.52, -0.84).normalize()

const DISTANT_GALAXIES: readonly DistantGalaxySpec[] = [
  {
    kind: 'spiral',
    direction: new THREE.Vector3(0.34, 0.18, -0.92).normalize(),
    width: 5.8,
    height: 3.3,
    opacity: 0.34,
    rotation: -0.28,
    seed: 17,
  },
  {
    kind: 'edgeOn',
    direction: new THREE.Vector3(-0.79, 0.29, -0.54).normalize(),
    width: 5.0,
    height: 1.35,
    opacity: 0.24,
    rotation: 0.22,
    seed: 43,
  },
  {
    kind: 'elliptical',
    direction: new THREE.Vector3(0.37, -0.71, 0.60).normalize(),
    width: 3.6,
    height: 2.7,
    opacity: 0.18,
    rotation: -0.12,
    seed: 71,
  },
] as const

const STAR_TEMPERATURES = [
  { color: new THREE.Color('#c7d9ff'), weight: 0.14 },
  { color: new THREE.Color('#f2f4ef'), weight: 0.60 },
  { color: new THREE.Color('#eadfca'), weight: 0.21 },
  { color: new THREE.Color('#c8bdb9'), weight: 0.05 },
] as const

function createSeededRandom(seed: number) {
  let state = (seed ^ STAR_LAYOUT_SESSION_SALT) >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function smooth01(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function sampleStarDirection(random: () => number, target: THREE.Vector3) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const theta = random() * Math.PI * 2
    const y = random() * 2 - 1
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y))
    target.set(horizontal * Math.cos(theta), y, horizontal * Math.sin(theta))

    const bandProximity = 1 - Math.abs(target.dot(GALACTIC_NORMAL))
    const bandDensity = Math.pow(bandProximity, 4.5)
    const broadPatch = 0.5 + 0.5 * Math.sin(theta * 2.3 + y * 4.7 + 1.2)
    const cluster = smooth01((target.dot(STAR_CLUSTER_CENTER) - 0.56) / 0.44)
    const voidStrength = smooth01((target.dot(STAR_VOID_CENTER) - 0.48) / 0.52)
    const acceptance = THREE.MathUtils.clamp(
      0.44 + bandDensity * 0.32 + broadPatch * 0.18 + cluster * 0.12 - voidStrength * 0.14,
      0.18,
      0.96,
    )
    if (random() <= acceptance) return target
  }

  return target
}

function pickStarColor(random: () => number, target: THREE.Color) {
  const sample = random()
  let accumulated = 0
  for (const temperature of STAR_TEMPERATURES) {
    accumulated += temperature.weight
    if (sample <= accumulated) return target.copy(temperature.color)
  }
  return target.copy(STAR_TEMPERATURES[STAR_TEMPERATURES.length - 1].color)
}

export function createSpaceStarLayer(options: SpaceStarLayerOptions): SpaceStarLayer {
  const {
    scene,
    camera,
    count,
    minRadius,
    maxRadius,
    size,
    opacity,
    minBrightness,
    maxBrightness,
    follow,
    seed,
  } = options
  const random = createSeededRandom(seed)
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const direction = new THREE.Vector3()
  const starColor = new THREE.Color()

  for (let starIndex = 0; starIndex < count; starIndex += 1) {
    const offset = starIndex * 3
    const radius = minRadius + random() * (maxRadius - minRadius)
    sampleStarDirection(random, direction).multiplyScalar(radius)
    positions[offset] = direction.x
    positions[offset + 1] = direction.y
    positions[offset + 2] = direction.z

    const brightnessProgress = Math.pow(random(), 2.35)
    const brightness = THREE.MathUtils.lerp(minBrightness, maxBrightness, brightnessProgress)
    pickStarColor(random, starColor).multiplyScalar(brightness)
    colors[offset] = starColor.r
    colors[offset + 1] = starColor.g
    colors[offset + 2] = starColor.b
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const points = new THREE.Points(geometry, material)
  points.position.copy(camera.position)
  points.frustumCulled = false
  scene.add(points)

  return { points, geometry, material, follow }
}

function directionField(direction: THREE.Vector3, phase: number) {
  const first = Math.sin(
    direction.x * 11.7 + direction.y * 7.3 - direction.z * 9.1 + phase,
  )
  const second = Math.sin(
    direction.x * 23.1 - direction.y * 17.3 + direction.z * 13.9 - phase * 1.7,
  )
  const third = Math.sin(
    direction.x * 41.3 + direction.y * 29.7 + direction.z * 31.9 + phase * 0.63,
  )
  return THREE.MathUtils.clamp(0.5 + first * 0.24 + second * 0.16 + third * 0.10, 0, 1)
}

function localizedCloud(direction: THREE.Vector3, center: THREE.Vector3, threshold: number) {
  const angular = smooth01((direction.dot(center) - threshold) / (1 - threshold))
  return angular * angular
}

function createSpaceTexture() {
  const data = new Uint8Array(SPACE_TEXTURE_WIDTH * SPACE_TEXTURE_HEIGHT * 4)
  const direction = new THREE.Vector3()

  for (let y = 0; y < SPACE_TEXTURE_HEIGHT; y += 1) {
    const v = (y + 0.5) / SPACE_TEXTURE_HEIGHT
    const latitude = (0.5 - v) * Math.PI
    const cosLatitude = Math.cos(latitude)

    for (let x = 0; x < SPACE_TEXTURE_WIDTH; x += 1) {
      const u = (x + 0.5) / SPACE_TEXTURE_WIDTH
      const longitude = (u - 0.5) * Math.PI * 2
      direction.set(
        cosLatitude * Math.cos(longitude),
        Math.sin(latitude),
        cosLatitude * Math.sin(longitude),
      )

      const signedPlaneDistance = direction.dot(GALACTIC_NORMAL)
      const planeDistance = Math.abs(signedPlaneDistance)
      const broadBand = Math.exp(-Math.pow(planeDistance / 0.205, 2))
      const innerBand = Math.exp(-Math.pow(planeDistance / 0.092, 2))
      const bandMottle = directionField(direction, 0.8)
      const fineMottle = directionField(direction, 2.4)
      const longitudinalVariation = 0.82 + directionField(direction, 7.7) * 0.34
      const bandStrength = (
        broadBand * (0.25 + bandMottle * 0.40) * longitudinalVariation +
        innerBand * fineMottle * 0.23
      )

      const dustWarp = (directionField(direction, 4.7) - 0.5) * 0.052
      const dustWidth = 0.033 + directionField(direction, 8.9) * 0.016
      const dustLane = Math.exp(-Math.pow((signedPlaneDistance + dustWarp) / dustWidth, 2)) *
        (0.31 + directionField(direction, 6.1) * 0.69)

      const blueCloud = localizedCloud(direction, NEBULA_BLUE_CENTER, 0.84) *
        (0.28 + directionField(direction, 1.9) * 0.72)
      const violetCloud = localizedCloud(direction, NEBULA_VIOLET_CENTER, 0.87) *
        (0.25 + directionField(direction, 3.6) * 0.75)
      const redCloud = localizedCloud(direction, NEBULA_RED_CENTER, 0.90) *
        (0.20 + directionField(direction, 5.2) * 0.80)

      let red = 2.0 + bandStrength * 8.0
      let green = 3.0 + bandStrength * 9.0
      let blue = 7.0 + bandStrength * 13.0

      red += blueCloud * 2.2 + violetCloud * 4.0 + redCloud * 7.0
      green += blueCloud * 4.2 + violetCloud * 2.0 + redCloud * 2.6
      blue += blueCloud * 8.0 + violetCloud * 7.0 + redCloud * 3.3

      const dustSuppression = dustLane * innerBand
      red -= dustSuppression * 5.8
      green -= dustSuppression * 6.2
      blue -= dustSuppression * 7.5

      const offset = (y * SPACE_TEXTURE_WIDTH + x) * 4
      data[offset] = Math.round(THREE.MathUtils.clamp(red, 1, 28))
      data[offset + 1] = Math.round(THREE.MathUtils.clamp(green, 2, 28))
      data[offset + 2] = Math.round(THREE.MathUtils.clamp(blue, 4, 34))
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(
    data,
    SPACE_TEXTURE_WIDTH,
    SPACE_TEXTURE_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

function galaxyPixelNoise(x: number, y: number, seed: number) {
  const value = Math.sin((x + seed * 0.37) * 12.9898 + (y - seed * 0.19) * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function createDistantGalaxyTexture(kind: DistantGalaxyKind, seed: number) {
  const data = new Uint8Array(GALAXY_TEXTURE_SIZE * GALAXY_TEXTURE_SIZE * 4)

  for (let y = 0; y < GALAXY_TEXTURE_SIZE; y += 1) {
    const ny = ((y + 0.5) / GALAXY_TEXTURE_SIZE) * 2 - 1

    for (let x = 0; x < GALAXY_TEXTURE_SIZE; x += 1) {
      const nx = ((x + 0.5) / GALAXY_TEXTURE_SIZE) * 2 - 1
      const noise = galaxyPixelNoise(x, y, seed)
      let intensity = 0
      let red = 0
      let green = 0
      let blue = 0

      if (kind === 'spiral') {
        const flattenedY = ny / 0.68
        const radius = Math.sqrt(nx * nx + flattenedY * flattenedY)
        const angle = Math.atan2(flattenedY, nx)
        const diskEdge = smooth01((1.06 - radius) / 0.30)
        const disk = Math.exp(-radius * 2.75) * diskEdge
        const armWave = 0.5 + 0.5 * Math.sin(angle * 2 - radius * 8.2 + noise * 0.42)
        const arms = Math.pow(armWave, 3.0) * disk
        const core = Math.exp(-(
          Math.pow(nx / 0.17, 2) + Math.pow(ny / 0.115, 2)
        ) * 1.7)
        intensity = (disk * (0.22 + arms * 0.95) + core * 0.78) * (0.84 + noise * 0.16)
        const coolLift = THREE.MathUtils.clamp(core * 0.72 + arms * 0.28, 0, 1)
        red = 108 + coolLift * 55
        green = 132 + coolLift * 62
        blue = 172 + coolLift * 50
      } else if (kind === 'edgeOn') {
        const disk = Math.exp(-Math.abs(nx) * 2.25 - Math.abs(ny) * 12.8) *
          smooth01((1.02 - Math.abs(nx)) / 0.22)
        const bulge = Math.exp(-(
          Math.pow(nx / 0.24, 2) + Math.pow(ny / 0.19, 2)
        ) * 1.6)
        const dustLane = Math.exp(-Math.pow(ny / 0.030, 2)) * Math.exp(-Math.abs(nx) * 1.8)
        intensity = Math.max(0, disk * 0.90 + bulge * 0.52 - dustLane * 0.30) *
          (0.88 + noise * 0.12)
        red = 118 + bulge * 24
        green = 137 + bulge * 28
        blue = 166 + bulge * 30
      } else {
        const radius = Math.sqrt(Math.pow(nx / 0.78, 2) + Math.pow(ny / 0.62, 2))
        const edge = smooth01((1.02 - radius) / 0.34)
        const core = Math.exp(-radius * 3.35) * edge
        intensity = core * (0.88 + noise * 0.12)
        red = 132 + core * 25
        green = 145 + core * 25
        blue = 166 + core * 22
      }

      const alphaScale = kind === 'spiral' ? 142 : kind === 'edgeOn' ? 118 : 104
      const offset = (y * GALAXY_TEXTURE_SIZE + x) * 4
      data[offset] = Math.round(THREE.MathUtils.clamp(red, 0, 190))
      data[offset + 1] = Math.round(THREE.MathUtils.clamp(green, 0, 205))
      data[offset + 2] = Math.round(THREE.MathUtils.clamp(blue, 0, 224))
      data[offset + 3] = Math.round(THREE.MathUtils.clamp(intensity * alphaScale, 0, 168))
    }
  }

  const texture = new THREE.DataTexture(
    data,
    GALAXY_TEXTURE_SIZE,
    GALAXY_TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

export function createSpaceBackdrop(scene: THREE.Scene, camera: THREE.Camera): SpaceBackdrop {
  const texture = createSpaceTexture()
  const geometry = new THREE.SphereGeometry(SPACE_SKY_RADIUS, 32, 16)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(camera.position)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  scene.add(mesh)

  const galaxyGroup = new THREE.Group()
  const galaxyTextures: THREE.DataTexture[] = []
  const galaxyMaterials: THREE.SpriteMaterial[] = []
  galaxyGroup.position.copy(camera.position)
  galaxyGroup.frustumCulled = false

  for (const spec of DISTANT_GALAXIES) {
    const galaxyTexture = createDistantGalaxyTexture(spec.kind, spec.seed)
    const galaxyMaterial = new THREE.SpriteMaterial({
      map: galaxyTexture,
      color: 0xffffff,
      transparent: true,
      opacity: spec.opacity,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      rotation: spec.rotation,
    })
    const sprite = new THREE.Sprite(galaxyMaterial)
    sprite.position.copy(spec.direction).multiplyScalar(DISTANT_GALAXY_RADIUS)
    sprite.scale.set(spec.width, spec.height, 1)
    sprite.frustumCulled = false
    sprite.renderOrder = -900
    galaxyTextures.push(galaxyTexture)
    galaxyMaterials.push(galaxyMaterial)
    galaxyGroup.add(sprite)
  }
  scene.add(galaxyGroup)

  return {
    update(cameraPosition) {
      mesh.position.copy(cameraPosition)
      galaxyGroup.position.copy(cameraPosition)
    },
    dispose() {
      scene.remove(mesh)
      scene.remove(galaxyGroup)
      geometry.dispose()
      material.dispose()
      texture.dispose()
      for (const galaxyMaterial of galaxyMaterials) galaxyMaterial.dispose()
      for (const galaxyTexture of galaxyTextures) galaxyTexture.dispose()
    },
  }
}
