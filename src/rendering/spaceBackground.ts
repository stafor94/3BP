import * as THREE from 'three'

export type SpaceStarLayer = {
  points: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  follow: number
  depthResponse: number
  cameraAnchor: THREE.Vector3
  cameraOffset: THREE.Vector3
  maxParallaxOffset: number
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

type SpaceBackdropState = {
  starPointTexture: THREE.DataTexture
  starLayers: SpaceStarLayer[]
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

type StarClusterSpec = {
  center: THREE.Vector3
  threshold: number
  strength: number
}

const SPACE_TEXTURE_WIDTH = 512
const SPACE_TEXTURE_HEIGHT = 256
const SPACE_SKY_RADIUS = 240
const STAR_POINT_TEXTURE_SIZE = 24
const STAR_BRIGHTNESS_EXPONENT = 2.60
const STAR_PARALLAX_SCALE = 0.05
const STAR_PARALLAX_MAX_ANGLE_DEGREES = 0.24
const DEEP_FIELD_STAR_COUNT = 1600
const MID_FAINT_STAR_COUNT = 250
const SPACE_BASE_RED = 3.0
const SPACE_BASE_GREEN = 4.0
const SPACE_BASE_BLUE = 8.0
const GALAXY_TEXTURE_SIZE = 64
const DISTANT_GALAXY_RADIUS = 205
const STAR_LAYOUT_SESSION_SALT = Math.floor(Math.random() * 0xffffffff) >>> 0

const SPACE_BACKDROP_STATES = new WeakMap<THREE.Camera, SpaceBackdropState>()

const GALACTIC_NORMAL = new THREE.Vector3(0.26, 0.83, 0.49).normalize()
const STAR_VOID_CENTER = new THREE.Vector3(0.63, -0.18, 0.76).normalize()
const STAR_RICH_REGION_CENTER = new THREE.Vector3(-0.35, -0.41, 0.84).normalize()
const DUST_BRANCH_CENTER_A = new THREE.Vector3(-0.82, 0.48, -0.22).normalize()
const DUST_BRANCH_CENTER_B = new THREE.Vector3(0.57, -0.46, 0.68).normalize()
const NEBULA_BLUE_CENTER = new THREE.Vector3(-0.72, 0.24, 0.65).normalize()
const NEBULA_VIOLET_CENTER = new THREE.Vector3(0.58, -0.47, -0.67).normalize()
const NEBULA_RED_CENTER = new THREE.Vector3(0.16, 0.52, -0.84).normalize()
const NEBULA_CYAN_HAZE_CENTER = new THREE.Vector3(-0.28, -0.63, 0.72).normalize()
const NEBULA_MAGENTA_HAZE_CENTER = new THREE.Vector3(0.77, 0.27, -0.58).normalize()
const NEBULA_NEUTRAL_HAZE_CENTER = new THREE.Vector3(-0.66, -0.18, -0.73).normalize()

const STAR_CLUSTERS: readonly StarClusterSpec[] = [
  {
    center: new THREE.Vector3(-0.44, 0.58, -0.68).normalize(),
    threshold: 0.56,
    strength: 0.13,
  },
  {
    center: new THREE.Vector3(-0.84, 0.49, -0.23).normalize(),
    threshold: 0.68,
    strength: 0.10,
  },
  {
    center: new THREE.Vector3(0.57, -0.46, 0.68).normalize(),
    threshold: 0.72,
    strength: 0.08,
  },
  {
    center: new THREE.Vector3(-0.35, -0.41, 0.84).normalize(),
    threshold: 0.77,
    strength: 0.06,
  },
] as const

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
  {
    kind: 'spiral',
    direction: new THREE.Vector3(-0.19, 0.83, -0.52).normalize(),
    width: 2.7,
    height: 1.45,
    opacity: 0.14,
    rotation: 0.48,
    seed: 101,
  },
  {
    kind: 'edgeOn',
    direction: new THREE.Vector3(0.74, 0.52, 0.42).normalize(),
    width: 2.8,
    height: 0.64,
    opacity: 0.12,
    rotation: -0.58,
    seed: 137,
  },
  {
    kind: 'elliptical',
    direction: new THREE.Vector3(-0.59, -0.73, 0.35).normalize(),
    width: 2.25,
    height: 1.65,
    opacity: 0.11,
    rotation: 0.16,
    seed: 173,
  },
  {
    kind: 'spiral',
    direction: new THREE.Vector3(0.86, -0.31, -0.41).normalize(),
    width: 1.95,
    height: 1.02,
    opacity: 0.09,
    rotation: 0.76,
    seed: 211,
  },
  {
    kind: 'edgeOn',
    direction: new THREE.Vector3(-0.28, -0.46, -0.84).normalize(),
    width: 1.7,
    height: 0.44,
    opacity: 0.08,
    rotation: -0.34,
    seed: 257,
  },
] as const

const STAR_TEMPERATURES = [
  { color: new THREE.Color('#d7e2f4'), weight: 0.10 },
  { color: new THREE.Color('#f1f2ee'), weight: 0.68 },
  { color: new THREE.Color('#e8dfd0'), weight: 0.18 },
  { color: new THREE.Color('#d6ccc7'), weight: 0.04 },
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

function createStarPointTexture() {
  const data = new Uint8Array(STAR_POINT_TEXTURE_SIZE * STAR_POINT_TEXTURE_SIZE * 4)

  for (let y = 0; y < STAR_POINT_TEXTURE_SIZE; y += 1) {
    const ny = ((y + 0.5) / STAR_POINT_TEXTURE_SIZE) * 2 - 1
    for (let x = 0; x < STAR_POINT_TEXTURE_SIZE; x += 1) {
      const nx = ((x + 0.5) / STAR_POINT_TEXTURE_SIZE) * 2 - 1
      const radiusSquared = nx * nx + ny * ny
      const radius = Math.sqrt(radiusSquared)
      const compactCore = Math.exp(-radiusSquared * 7.2)
      const softShoulder = Math.exp(-radiusSquared * 2.5) * 0.45
      const edge = 1 - smooth01((radius - 0.72) / 0.28)
      const alpha = THREE.MathUtils.clamp((compactCore + softShoulder) * edge, 0, 1)
      const offset = (y * STAR_POINT_TEXTURE_SIZE + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(alpha * 255)
    }
  }

  const texture = new THREE.DataTexture(
    data,
    STAR_POINT_TEXTURE_SIZE,
    STAR_POINT_TEXTURE_SIZE,
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

function sampleStarDirection(random: () => number, target: THREE.Vector3) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const theta = random() * Math.PI * 2
    const y = random() * 2 - 1
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y))
    target.set(horizontal * Math.cos(theta), y, horizontal * Math.sin(theta))

    const bandProximity = 1 - Math.abs(target.dot(GALACTIC_NORMAL))
    const bandDensity = Math.pow(bandProximity, 4.5)
    const broadPatch = 0.5 + 0.5 * Math.sin(theta * 2.3 + y * 4.7 + 1.2)
    let clusterDensity = 0
    for (const cluster of STAR_CLUSTERS) {
      clusterDensity += smooth01(
        (target.dot(cluster.center) - cluster.threshold) / (1 - cluster.threshold),
      ) * cluster.strength
    }
    const richRegion = smooth01((target.dot(STAR_RICH_REGION_CENTER) - 0.08) / 0.92)
    const voidStrength = smooth01((target.dot(STAR_VOID_CENTER) - 0.48) / 0.52)
    const acceptance = THREE.MathUtils.clamp(
      0.48 +
        bandDensity * 0.30 +
        broadPatch * 0.15 +
        clusterDensity +
        richRegion * 0.07 -
        voidStrength * 0.11,
      0.30,
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
  const backdropState = SPACE_BACKDROP_STATES.get(camera)
  if (!backdropState) {
    throw new Error('createSpaceBackdrop must be created before space star layers')
  }

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

    const brightnessProgress = Math.pow(random(), STAR_BRIGHTNESS_EXPONENT)
    const brightness = THREE.MathUtils.lerp(minBrightness, maxBrightness, brightnessProgress)
    pickStarColor(random, starColor).multiplyScalar(brightness)
    colors[offset] = starColor.r
    colors[offset + 1] = starColor.g
    colors[offset + 2] = starColor.b
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    map: backdropState.starPointTexture,
    size,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity,
    alphaTest: 0.01,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const points = new THREE.Points(geometry, material)
  points.position.copy(camera.position)
  points.frustumCulled = false
  scene.add(points)

  const depthResponse = follow * STAR_PARALLAX_SCALE
  const cameraAnchor = camera.position.clone()
  const cameraOffset = new THREE.Vector3()
  const maxParallaxOffset = minRadius * Math.tan(
    THREE.MathUtils.degToRad(STAR_PARALLAX_MAX_ANGLE_DEGREES),
  )
  const layer: SpaceStarLayer = {
    points,
    geometry,
    material,
    // Legacy camera-target helpers still read this field. Zero keeps target-only changes from moving stars.
    follow: 0,
    depthResponse,
    cameraAnchor,
    cameraOffset,
    maxParallaxOffset,
  }
  backdropState.starLayers.push(layer)
  return layer
}

function updateSpaceStarLayer(layer: SpaceStarLayer, cameraPosition: THREE.Vector3) {
  layer.cameraOffset.copy(layer.cameraAnchor).sub(cameraPosition).multiplyScalar(layer.depthResponse)
  if (layer.cameraOffset.lengthSq() > layer.maxParallaxOffset * layer.maxParallaxOffset) {
    layer.cameraOffset.setLength(layer.maxParallaxOffset)
  }
  layer.points.position.copy(cameraPosition).add(layer.cameraOffset)
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

function fineDirectionField(direction: THREE.Vector3, phase: number) {
  const first = Math.sin(
    direction.x * 67.1 - direction.y * 53.7 + direction.z * 71.9 + phase,
  )
  const second = Math.sin(
    direction.x * 109.3 + direction.y * 83.9 - direction.z * 97.7 - phase * 1.43,
  )
  const third = Math.sin(
    direction.x * 149.9 - direction.y * 127.1 - direction.z * 137.3 + phase * 0.71,
  )
  return THREE.MathUtils.clamp(0.5 + first * 0.22 + second * 0.17 + third * 0.11, 0, 1)
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
      const stellarGrain = fineDirectionField(direction, 5.9)
      const microClouds = fineDirectionField(direction, 10.7)
      const longitudinalVariation = 0.77 + directionField(direction, 7.7) * 0.41
      const richSide = localizedCloud(direction, STAR_RICH_REGION_CENTER, 0.02)
      const bandStrength = (
        broadBand * (0.23 + bandMottle * 0.40) * longitudinalVariation +
        innerBand * fineMottle * 0.20 +
        innerBand * stellarGrain * (0.075 + microClouds * 0.105) +
        broadBand * richSide * 0.050
      )

      const dustWarp = (directionField(direction, 4.7) - 0.5) * 0.058
      const dustWidth = 0.026 + directionField(direction, 8.9) * 0.025
      const dustContinuity = 0.22 + smooth01((directionField(direction, 12.8) - 0.18) / 0.72) * 0.78
      const primaryDustLane = Math.exp(-Math.pow((signedPlaneDistance + dustWarp) / dustWidth, 2)) *
        dustContinuity * (0.27 + directionField(direction, 6.1) * 0.73)
      const branchWarpA = (directionField(direction, 15.1) - 0.5) * 0.032
      const branchWarpB = (directionField(direction, 18.3) - 0.5) * 0.027
      const dustBranchA = Math.exp(-Math.pow(
        (signedPlaneDistance + 0.057 + branchWarpA) / 0.024,
        2,
      )) * localizedCloud(direction, DUST_BRANCH_CENTER_A, 0.52) * 0.54
      const dustBranchB = Math.exp(-Math.pow(
        (signedPlaneDistance - 0.049 + branchWarpB) / 0.021,
        2,
      )) * localizedCloud(direction, DUST_BRANCH_CENTER_B, 0.58) * 0.45
      const dustLane = THREE.MathUtils.clamp(primaryDustLane + dustBranchA + dustBranchB, 0, 1)

      const blueCloud = localizedCloud(direction, NEBULA_BLUE_CENTER, 0.84) *
        (0.28 + directionField(direction, 1.9) * 0.72)
      const violetCloud = localizedCloud(direction, NEBULA_VIOLET_CENTER, 0.87) *
        (0.25 + directionField(direction, 3.6) * 0.75)
      const redCloud = localizedCloud(direction, NEBULA_RED_CENTER, 0.90) *
        (0.20 + directionField(direction, 5.2) * 0.80)
      const cyanHaze = localizedCloud(direction, NEBULA_CYAN_HAZE_CENTER, 0.58) *
        (0.38 + directionField(direction, 9.5) * 0.62)
      const magentaHaze = localizedCloud(direction, NEBULA_MAGENTA_HAZE_CENTER, 0.63) *
        (0.42 + directionField(direction, 11.1) * 0.58)
      const neutralHaze = localizedCloud(direction, NEBULA_NEUTRAL_HAZE_CENTER, 0.54) *
        (0.40 + directionField(direction, 13.7) * 0.60)

      const midScaleVariation = (directionField(direction, 21.7) - 0.5) * 1.15
      const fineVariation = (fineDirectionField(direction, 24.3) - 0.5) * 0.55
      const darkRegion = localizedCloud(direction, STAR_VOID_CENTER, 0.34)
      const regionalLift = richSide * 0.50 - darkRegion * 0.20

      let red = SPACE_BASE_RED + bandStrength * 8.3 + midScaleVariation * 0.62 + fineVariation * 0.25 + regionalLift * 0.42
      let green = SPACE_BASE_GREEN + bandStrength * 9.4 + midScaleVariation * 0.70 + fineVariation * 0.28 + regionalLift * 0.48
      let blue = SPACE_BASE_BLUE + bandStrength * 13.7 + midScaleVariation * 0.86 + fineVariation * 0.34 + regionalLift * 0.64

      red += blueCloud * 2.2 + violetCloud * 4.0 + redCloud * 7.0
      green += blueCloud * 4.2 + violetCloud * 2.0 + redCloud * 2.6
      blue += blueCloud * 8.0 + violetCloud * 7.0 + redCloud * 3.3

      red += cyanHaze * 0.85 + magentaHaze * 1.55 + neutralHaze * 0.85
      green += cyanHaze * 1.30 + magentaHaze * 0.78 + neutralHaze * 0.95
      blue += cyanHaze * 1.95 + magentaHaze * 1.65 + neutralHaze * 1.05

      const dustSuppression = dustLane * (0.30 + innerBand * 0.55)
      red -= dustSuppression * 5.3
      green -= dustSuppression * 5.7
      blue -= dustSuppression * 6.9

      const offset = (y * SPACE_TEXTURE_WIDTH + x) * 4
      data[offset] = Math.round(THREE.MathUtils.clamp(red, 2, 28))
      data[offset + 1] = Math.round(THREE.MathUtils.clamp(green, 3, 28))
      data[offset + 2] = Math.round(THREE.MathUtils.clamp(blue, 5, 34))
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
  const seedUnit = ((seed * 0.61803398875) % 1 + 1) % 1

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
        const flattening = 0.60 + seedUnit * 0.16
        const flattenedY = ny / flattening
        const radius = Math.sqrt(nx * nx + flattenedY * flattenedY)
        const angle = Math.atan2(flattenedY, nx)
        const diskEdge = smooth01((1.06 - radius) / 0.30)
        const disk = Math.exp(-radius * (2.55 + seedUnit * 0.42)) * diskEdge
        const armCount = seed % 3 === 0 ? 3 : 2
        const winding = 7.4 + seedUnit * 1.9
        const armWave = 0.5 + 0.5 * Math.sin(
          angle * armCount - radius * winding + seedUnit * Math.PI * 2 + noise * 0.42,
        )
        const arms = Math.pow(armWave, 3.0) * disk
        const coreWidth = 0.15 + seedUnit * 0.035
        const core = Math.exp(-(
          Math.pow(nx / coreWidth, 2) + Math.pow(ny / (coreWidth * 0.68), 2)
        ) * 1.7)
        intensity = (disk * (0.22 + arms * 0.95) + core * 0.78) * (0.84 + noise * 0.16)
        const coolLift = THREE.MathUtils.clamp(core * 0.72 + arms * 0.28, 0, 1)
        red = 108 + coolLift * 55
        green = 132 + coolLift * 62
        blue = 172 + coolLift * 50
      } else if (kind === 'edgeOn') {
        const verticalFalloff = 11.8 + seedUnit * 3.0
        const disk = Math.exp(-Math.abs(nx) * (2.05 + seedUnit * 0.45) - Math.abs(ny) * verticalFalloff) *
          smooth01((1.02 - Math.abs(nx)) / 0.22)
        const bulgeWidth = 0.21 + seedUnit * 0.055
        const bulge = Math.exp(-(
          Math.pow(nx / bulgeWidth, 2) + Math.pow(ny / (0.17 + seedUnit * 0.045), 2)
        ) * 1.6)
        const dustThickness = 0.025 + seedUnit * 0.012
        const dustLane = Math.exp(-Math.pow(ny / dustThickness, 2)) * Math.exp(-Math.abs(nx) * 1.8)
        intensity = Math.max(0, disk * 0.90 + bulge * 0.52 - dustLane * 0.30) *
          (0.88 + noise * 0.12)
        red = 118 + bulge * 24
        green = 137 + bulge * 28
        blue = 166 + bulge * 30
      } else {
        const radiusX = 0.70 + seedUnit * 0.14
        const radiusY = 0.55 + (1 - seedUnit) * 0.12
        const radius = Math.sqrt(Math.pow(nx / radiusX, 2) + Math.pow(ny / radiusY, 2))
        const edge = smooth01((1.02 - radius) / 0.34)
        const core = Math.exp(-radius * (3.05 + seedUnit * 0.60)) * edge
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
  const starPointTexture = createStarPointTexture()
  const backdropState: SpaceBackdropState = { starPointTexture, starLayers: [] }
  SPACE_BACKDROP_STATES.set(camera, backdropState)

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

  const deepFieldLayer = createSpaceStarLayer({
    scene,
    camera,
    count: DEEP_FIELD_STAR_COUNT,
    minRadius: 118,
    maxRadius: 218,
    size: 1.00,
    opacity: 0.68,
    minBrightness: 0.16,
    maxBrightness: 0.50,
    follow: 0.012,
    seed: 0x51f29a3,
  })
  deepFieldLayer.points.renderOrder = -950

  const midFaintLayer = createSpaceStarLayer({
    scene,
    camera,
    count: MID_FAINT_STAR_COUNT,
    minRadius: 92,
    maxRadius: 190,
    size: 1.12,
    opacity: 0.70,
    minBrightness: 0.20,
    maxBrightness: 0.56,
    follow: 0.016,
    seed: 0x7ac42d1,
  })
  midFaintLayer.points.renderOrder = -940

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
      for (const starLayer of backdropState.starLayers) {
        updateSpaceStarLayer(starLayer, cameraPosition)
      }
    },
    dispose() {
      scene.remove(mesh)
      scene.remove(galaxyGroup)
      scene.remove(deepFieldLayer.points)
      scene.remove(midFaintLayer.points)
      geometry.dispose()
      material.dispose()
      texture.dispose()
      deepFieldLayer.geometry.dispose()
      deepFieldLayer.material.dispose()
      midFaintLayer.geometry.dispose()
      midFaintLayer.material.dispose()
      starPointTexture.dispose()
      for (const galaxyMaterial of galaxyMaterials) galaxyMaterial.dispose()
      for (const galaxyTexture of galaxyTextures) galaxyTexture.dispose()
      if (SPACE_BACKDROP_STATES.get(camera) === backdropState) {
        SPACE_BACKDROP_STATES.delete(camera)
      }
    },
  }
}
