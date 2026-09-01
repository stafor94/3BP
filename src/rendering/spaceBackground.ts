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

const SPACE_TEXTURE_WIDTH = 512
const SPACE_TEXTURE_HEIGHT = 256
const SPACE_SKY_RADIUS = 240
const STAR_LAYOUT_SESSION_SALT = Math.floor(Math.random() * 0xffffffff) >>> 0

const GALACTIC_NORMAL = new THREE.Vector3(0.26, 0.83, 0.49).normalize()
const NEBULA_BLUE_CENTER = new THREE.Vector3(-0.72, 0.24, 0.65).normalize()
const NEBULA_VIOLET_CENTER = new THREE.Vector3(0.58, -0.47, -0.67).normalize()
const NEBULA_RED_CENTER = new THREE.Vector3(0.16, 0.52, -0.84).normalize()

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
    const acceptance = 0.46 + bandDensity * 0.34 + broadPatch * 0.20
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
      const bandStrength = broadBand * (0.28 + bandMottle * 0.42) + innerBand * fineMottle * 0.25

      const dustWarp = (directionField(direction, 4.7) - 0.5) * 0.045
      const dustLane = Math.exp(-Math.pow((signedPlaneDistance + dustWarp) / 0.040, 2)) *
        (0.38 + directionField(direction, 6.1) * 0.62)

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

  return {
    update(cameraPosition) {
      mesh.position.copy(cameraPosition)
    },
    dispose() {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
