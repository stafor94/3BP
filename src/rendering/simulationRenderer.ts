import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getNearestStellarColor } from '../starColors'
import type { BodyState, TrailSampleBatch } from '../types'

export type SimulationRenderState = {
  bodies: BodyState[]
  simulationTime: number
  trailVersion: number
  trailEnabled: boolean
  trailDuration: number
  trailSampleBatch: TrailSampleBatch
  trackedBodyId: string | null
}

type TrailPoint = {
  position: THREE.Vector3
  capturedAt: number
}

type TrailRibbon = {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
  positions: Float32Array
  previous: Float32Array
  next: Float32Array
  widths: Float32Array
  alphas: Float32Array
}

type VisualBody = {
  mesh: THREE.Mesh
  bodyMaterial: THREE.ShaderMaterial
  glowInner: THREE.Sprite
  glowInnerMaterial: THREE.SpriteMaterial
  glowOuter: THREE.Sprite
  glowOuterMaterial: THREE.SpriteMaterial
  trailPoints: THREE.Points
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.ShaderMaterial
  trailPositions: Float32Array
  trailAlphas: Float32Array
  trailSizes: Float32Array
  trailRibbon: TrailRibbon
  points: TrailPoint[]
}

type StarLayer = {
  points: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  follow: number
}

type TrailCurveSample = TrailPoint

const RENDER_TUNING = {
  body: {
    sphereWidthSegments: 36,
    sphereHeightSegments: 24,
    minRenderRadius: 0.025,
    innerGlowScale: 5.4,
    outerGlowScale: 12.0,
    innerGlowOpacityMin: 0.55,
    innerGlowOpacityMax: 0.78,
    outerGlowOpacityMin: 0.20,
    outerGlowOpacityMax: 0.34,
    detailMin: 0.1,
    detailMax: 0.46,
    rimMin: 0.08,
    rimMax: 0.14,
  },
  trail: {
    maxPoints: 6000,
    maxCurvePoints: 360,
    maxRibbonSamples: 521,
    softPointSizeOld: 2.4,
    softPointSizeNew: 7.5,
    softPointAlpha: 0.055,
    lineWidthOld: 0.72,
    lineWidthNew: 1.88,
    lineOpacity: 0.32,
  },
} as const

const bodyVertexShader = `
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vObjectNormal = normalize(normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const bodyFragmentShader = `
  uniform vec3 uIdentityColor;
  uniform float uSeed;
  uniform float uDetailStrength;
  uniform float uRimStrength;

  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(
        mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x),
        u.y
      ),
      mix(
        mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x),
        u.y
      ),
      u.z
    );
  }

  float drawBodySurfaceDetail(vec3 objectNormal) {
    vec3 seedOffset = vec3(uSeed * 0.071, uSeed * 0.113, uSeed * 0.157);
    float broad = valueNoise(objectNormal * 3.4 + seedOffset);
    float fine = valueNoise(objectNormal * 8.2 - seedOffset * 1.5);
    float bands = 0.5 + 0.5 * sin((objectNormal.y * 6.8 + broad * 0.75 + uSeed * 0.013) * 6.2831853);

    float variation =
      (broad - 0.5) * 0.095 +
      (fine - 0.5) * 0.04 +
      (bands - 0.5) * 0.018;

    return clamp(1.0 + variation * uDetailStrength, 0.94, 1.05);
  }

  float drawBodyEmission(vec3 worldNormal, vec3 viewDirection) {
    float limb = max(dot(worldNormal, viewDirection), 0.0);
    float limbDarkening = 0.82 + 0.18 * pow(limb, 0.55);
    float centerEmission = 1.10 + 0.24 * pow(limb, 0.72);
    return limbDarkening * centerEmission;
  }

  float drawBodyRim(vec3 worldNormal, vec3 viewDirection) {
    float fresnel = 1.0 - max(dot(worldNormal, viewDirection), 0.0);
    return pow(fresnel, 2.45) * uRimStrength;
  }

  void main() {
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float surfaceDetail = drawBodySurfaceDetail(normalize(vObjectNormal));
    float emission = drawBodyEmission(normalWorld, viewDirection);
    float rim = drawBodyRim(normalWorld, viewDirection);

    float intensity = min(emission * surfaceDetail + rim, 1.42);
    vec3 color = uIdentityColor * intensity;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const trailPointVertexShader = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const trailPointFragmentShader = `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered) * 2.0;
    if (radius > 1.0) discard;

    float feather = exp(-5.8 * radius * radius);
    float edge = 1.0 - smoothstep(0.68, 1.0, radius);
    float alpha = vAlpha * feather * edge;

    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

const trailRibbonVertexShader = `
  attribute vec3 aPrevious;
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aWidth;
  attribute float aAlpha;

  uniform vec2 uResolution;

  varying float vAlpha;

  void main() {
    vec4 clipCurrent = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 clipPrevious = projectionMatrix * modelViewMatrix * vec4(aPrevious, 1.0);
    vec4 clipNext = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);

    vec2 currentScreen = (clipCurrent.xy / clipCurrent.w) * uResolution * 0.5;
    vec2 previousScreen = (clipPrevious.xy / clipPrevious.w) * uResolution * 0.5;
    vec2 nextScreen = (clipNext.xy / clipNext.w) * uResolution * 0.5;

    vec2 direction = nextScreen - previousScreen;
    float directionLength = length(direction);
    if (directionLength < 0.0001) {
      direction = currentScreen - previousScreen;
      directionLength = length(direction);
    }
    if (directionLength < 0.0001) {
      direction = nextScreen - currentScreen;
      directionLength = length(direction);
    }
    if (directionLength < 0.0001) {
      direction = vec2(1.0, 0.0);
    } else {
      direction /= directionLength;
    }

    vec2 normal = vec2(-direction.y, direction.x);
    vec2 offsetScreen = normal * aSide * aWidth * 0.5;
    vec2 offsetNdc = offsetScreen * 2.0 / max(uResolution, vec2(1.0));
    clipCurrent.xy += offsetNdc * clipCurrent.w;

    vAlpha = aAlpha;
    gl_Position = clipCurrent;
  }
`

const trailRibbonFragmentShader = `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
    #include <colorspace_fragment>
  }
`

function isBodyDescendedFrom(bodyId: string, trackedBodyId: string) {
  const bodyParts = new Set(bodyId.split('+'))
  return trackedBodyId.split('+').every((part) => bodyParts.has(part))
}

function getBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 1000
}

function createBodyMaterial(id: string, color: string) {
  const stellarColor = getNearestStellarColor(color).hex
  return new THREE.ShaderMaterial({
    uniforms: {
      uIdentityColor: { value: new THREE.Color(stellarColor) },
      uSeed: { value: getBodySeed(id) },
      uDetailStrength: { value: RENDER_TUNING.body.detailMin },
      uRimStrength: { value: RENDER_TUNING.body.rimMax },
    },
    vertexShader: bodyVertexShader,
    fragmentShader: bodyFragmentShader,
    toneMapped: false,
  })
}

function createBodyGlowTexture() {
  const size = 160
  const center = size / 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create body glow texture')

  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0.0, 'rgba(255,255,255,1.00)')
  gradient.addColorStop(0.08, 'rgba(255,255,255,1.00)')
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.72)')
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.32)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.10)')
  gradient.addColorStop(1.0, 'rgba(255,255,255,0.00)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function createGlowMaterial(texture: THREE.Texture, color: string, opacity: number) {
  return new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function buildCurveSamples(
  points: TrailPoint[],
  currentPosition: THREE.Vector3 | undefined,
  currentTime: number,
): TrailCurveSample[] {
  if (points.length === 0 && currentPosition === undefined) return []

  const samples: TrailCurveSample[] = []
  const step = Math.max(1, Math.ceil(points.length / Math.max(RENDER_TUNING.trail.maxCurvePoints - 1, 1)))

  points.forEach((point, index) => {
    if (index !== 0 && index !== points.length - 1 && index % step !== 0) return
    const previous = samples[samples.length - 1]
    if (!previous || previous.position.distanceToSquared(point.position) > 1e-10) samples.push(point)
  })

  if (currentPosition) {
    const previous = samples[samples.length - 1]
    if (!previous || previous.position.distanceToSquared(currentPosition) > 1e-10) {
      samples.push({ position: currentPosition.clone(), capturedAt: currentTime })
    } else if (previous.capturedAt < currentTime) {
      samples[samples.length - 1] = { position: currentPosition.clone(), capturedAt: currentTime }
    }
  }

  return samples
}

function smoothCurveSamples(samples: TrailCurveSample[]) {
  if (samples.length < 3) return samples.map((sample) => ({
    position: sample.position.clone(),
    capturedAt: sample.capturedAt,
  }))

  const curve = new THREE.CatmullRomCurve3(
    samples.map((sample) => sample.position),
    false,
    'centripetal',
  )
  const segments = Math.min(
    RENDER_TUNING.trail.maxRibbonSamples - 1,
    Math.max(samples.length * 3, 24),
  )
  const curvePoints = curve.getPoints(segments)
  const sourceSpan = samples.length - 1

  return curvePoints.map((position, index) => {
    const sourcePosition = (index / segments) * sourceSpan
    const leftIndex = Math.floor(sourcePosition)
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1)
    const localT = sourcePosition - leftIndex
    return {
      position,
      capturedAt: THREE.MathUtils.lerp(
        samples[leftIndex].capturedAt,
        samples[rightIndex].capturedAt,
        localT,
      ),
    }
  })
}

function getFreshness(sample: TrailCurveSample, currentTime: number, duration: number) {
  const ageRatio = THREE.MathUtils.clamp((currentTime - sample.capturedAt) / duration, 0, 1)
  return 1 - ageRatio
}

function smooth01(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function createTrailRibbon(color: string): TrailRibbon {
  const maxSamples = RENDER_TUNING.trail.maxRibbonSamples
  const vertexCount = maxSamples * 2
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(vertexCount * 3)
  const previous = new Float32Array(vertexCount * 3)
  const next = new Float32Array(vertexCount * 3)
  const sides = new Float32Array(vertexCount)
  const widths = new Float32Array(vertexCount)
  const alphas = new Float32Array(vertexCount)
  const indices = new Uint16Array((maxSamples - 1) * 6)

  for (let sampleIndex = 0; sampleIndex < maxSamples; sampleIndex += 1) {
    const vertexIndex = sampleIndex * 2
    sides[vertexIndex] = -1
    sides[vertexIndex + 1] = 1

    if (sampleIndex >= maxSamples - 1) continue
    const indexOffset = sampleIndex * 6
    const left = vertexIndex
    const right = vertexIndex + 1
    const nextLeft = vertexIndex + 2
    const nextRight = vertexIndex + 3
    indices[indexOffset] = left
    indices[indexOffset + 1] = right
    indices[indexOffset + 2] = nextLeft
    indices[indexOffset + 3] = right
    indices[indexOffset + 4] = nextRight
    indices[indexOffset + 5] = nextLeft
  }

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setAttribute(
    'aPrevious',
    new THREE.BufferAttribute(previous, 3).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setAttribute(
    'aNext',
    new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
  geometry.setAttribute(
    'aWidth',
    new THREE.BufferAttribute(widths, 1).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setAttribute(
    'aAlpha',
    new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.setDrawRange(0, 0)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: trailRibbonVertexShader,
    fragmentShader: trailRibbonFragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.renderOrder = 20

  return { mesh, geometry, material, positions, previous, next, widths, alphas }
}

function updateTrailRibbon(
  ribbon: TrailRibbon,
  samples: TrailCurveSample[],
  currentTime: number,
  duration: number,
) {
  const count = Math.min(samples.length, RENDER_TUNING.trail.maxRibbonSamples)
  if (count < 2) {
    ribbon.geometry.setDrawRange(0, 0)
    ribbon.mesh.visible = false
    return
  }

  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const sample = samples[sampleIndex]
    const previousSample = samples[Math.max(0, sampleIndex - 1)]
    const nextSample = samples[Math.min(count - 1, sampleIndex + 1)]
    const freshness = getFreshness(sample, currentTime, duration)
    const alphaProgress = smooth01(freshness)
    const widthProgress = Math.pow(freshness, 0.85)
    const width = THREE.MathUtils.lerp(
      RENDER_TUNING.trail.lineWidthOld,
      RENDER_TUNING.trail.lineWidthNew,
      widthProgress,
    )
    const alpha = RENDER_TUNING.trail.lineOpacity * alphaProgress

    for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
      const vertexIndex = sampleIndex * 2 + sideIndex
      const offset = vertexIndex * 3

      ribbon.positions[offset] = sample.position.x
      ribbon.positions[offset + 1] = sample.position.y
      ribbon.positions[offset + 2] = sample.position.z

      ribbon.previous[offset] = previousSample.position.x
      ribbon.previous[offset + 1] = previousSample.position.y
      ribbon.previous[offset + 2] = previousSample.position.z

      ribbon.next[offset] = nextSample.position.x
      ribbon.next[offset + 1] = nextSample.position.y
      ribbon.next[offset + 2] = nextSample.position.z

      ribbon.widths[vertexIndex] = width
      ribbon.alphas[vertexIndex] = alpha
    }
  }

  ;(ribbon.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  ;(ribbon.geometry.getAttribute('aPrevious') as THREE.BufferAttribute).needsUpdate = true
  ;(ribbon.geometry.getAttribute('aNext') as THREE.BufferAttribute).needsUpdate = true
  ;(ribbon.geometry.getAttribute('aWidth') as THREE.BufferAttribute).needsUpdate = true
  ;(ribbon.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true
  ribbon.geometry.setDrawRange(0, (count - 1) * 6)
  ribbon.mesh.visible = true
}

function updateBodyAppearance(visual: VisualBody, body: BodyState) {
  const renderRadius = Math.max(body.radius, RENDER_TUNING.body.minRenderRadius)
  const stellarColor = getNearestStellarColor(body.color).hex
  visual.mesh.position.set(body.position.x, body.position.y, body.position.z)
  visual.mesh.scale.setScalar(renderRadius)

  visual.glowInner.position.copy(visual.mesh.position)
  visual.glowOuter.position.copy(visual.mesh.position)
  visual.glowInner.scale.setScalar(renderRadius * RENDER_TUNING.body.innerGlowScale)
  visual.glowOuter.scale.setScalar(renderRadius * RENDER_TUNING.body.outerGlowScale)

  const identityColor = visual.bodyMaterial.uniforms.uIdentityColor.value as THREE.Color
  identityColor.set(stellarColor)

  const radiusFactor = THREE.MathUtils.clamp((renderRadius - 0.045) / 0.42, 0, 1)
  visual.bodyMaterial.uniforms.uDetailStrength.value = THREE.MathUtils.lerp(
    RENDER_TUNING.body.detailMin,
    RENDER_TUNING.body.detailMax,
    radiusFactor,
  )
  visual.bodyMaterial.uniforms.uRimStrength.value = THREE.MathUtils.lerp(
    RENDER_TUNING.body.rimMax,
    RENDER_TUNING.body.rimMin,
    radiusFactor,
  )

  visual.glowInnerMaterial.color.set(stellarColor)
  visual.glowOuterMaterial.color.set(stellarColor)
  const luminance = identityColor.r * 0.2126 + identityColor.g * 0.7152 + identityColor.b * 0.0722
  const glowProminence = THREE.MathUtils.clamp(luminance * 0.7 + radiusFactor * 0.3, 0, 1)
  visual.glowInnerMaterial.opacity = THREE.MathUtils.lerp(
    RENDER_TUNING.body.innerGlowOpacityMin,
    RENDER_TUNING.body.innerGlowOpacityMax,
    glowProminence,
  )
  visual.glowOuterMaterial.opacity = THREE.MathUtils.lerp(
    RENDER_TUNING.body.outerGlowOpacityMin,
    RENDER_TUNING.body.outerGlowOpacityMax,
    glowProminence,
  )

  ;(visual.trailMaterial.uniforms.uColor.value as THREE.Color).set(stellarColor)
  ;(visual.trailRibbon.material.uniforms.uColor.value as THREE.Color).set(stellarColor)
}

export function createSimulationRenderer(host: HTMLDivElement, getState: () => SimulationRenderState) {
  const initialState = getState()
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#03050a')
  scene.fog = new THREE.FogExp2('#03050a', 0.018)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 500)
  camera.position.set(0, 2.8, 5.4)

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  host.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.minDistance = 1.2
  controls.maxDistance = 30

  const sharedBodyGeometry = new THREE.SphereGeometry(
    1,
    RENDER_TUNING.body.sphereWidthSegments,
    RENDER_TUNING.body.sphereHeightSegments,
  )
  const sharedGlowTexture = createBodyGlowTexture()

  const createStarLayer = (
    count: number,
    minRadius: number,
    maxRadius: number,
    size: number,
    opacity: number,
    minBrightness: number,
    maxBrightness: number,
    follow: number,
  ): StarLayer => {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const white = new THREE.Color('#f8fbff')
    const paleBlue = new THREE.Color('#b9d5ff')
    const starColor = new THREE.Color()

    for (let index = 0; index < positions.length; index += 3) {
      const radius = minRadius + Math.random() * (maxRadius - minRadius)
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[index] = radius * Math.sin(phi) * Math.cos(theta)
      positions[index + 1] = radius * Math.sin(phi) * Math.sin(theta)
      positions[index + 2] = radius * Math.cos(phi)

      const colorMix = Math.random()
      const brightness = minBrightness + Math.random() * (maxBrightness - minBrightness)
      starColor.copy(white).lerp(paleBlue, colorMix).multiplyScalar(brightness)
      colors[index] = starColor.r
      colors[index + 1] = starColor.g
      colors[index + 2] = starColor.b
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

  const starLayers = [
    createStarLayer(600, 62, 180, 1.575, 1.0, 0.78, 0.96, 0.05),
    createStarLayer(300, 38, 108, 2.025, 1.0, 0.86, 1.0, 0.08),
    createStarLayer(100, 22, 64, 2.625, 1.0, 0.92, 1.0, 0.12),
  ]

  const visuals = new Map<string, VisualBody>()
  let observedTrailVersion = initialState.trailVersion
  let observedTrailEnabled = initialState.trailEnabled
  let observedTrailSampleSequence = initialState.trailSampleBatch.sequence
  let observedTrackedBodyId = initialState.trackedBodyId
  let wasTrackingBody = false

  const clearTrail = (visual: VisualBody) => {
    visual.points = []
    visual.trailGeometry.setDrawRange(0, 0)
    visual.trailPoints.visible = false
    visual.trailRibbon.geometry.setDrawRange(0, 0)
    visual.trailRibbon.mesh.visible = false
  }

  const removeVisual = (id: string) => {
    const visual = visuals.get(id)
    if (!visual) return

    scene.remove(
      visual.mesh,
      visual.glowInner,
      visual.glowOuter,
      visual.trailPoints,
      visual.trailRibbon.mesh,
    )

    visual.bodyMaterial.dispose()
    visual.glowInnerMaterial.dispose()
    visual.glowOuterMaterial.dispose()
    visual.trailGeometry.dispose()
    visual.trailMaterial.dispose()
    visual.trailRibbon.geometry.dispose()
    visual.trailRibbon.material.dispose()
    visuals.delete(id)
  }

  const ensureVisual = (body: Pick<BodyState, 'id' | 'color'>) => {
    const existing = visuals.get(body.id)
    if (existing) return existing

    const stellarColor = getNearestStellarColor(body.color).hex
    const bodyMaterial = createBodyMaterial(body.id, stellarColor)
    const mesh = new THREE.Mesh(sharedBodyGeometry, bodyMaterial)
    mesh.visible = false

    const glowInnerMaterial = createGlowMaterial(
      sharedGlowTexture,
      stellarColor,
      RENDER_TUNING.body.innerGlowOpacityMin,
    )
    const glowOuterMaterial = createGlowMaterial(
      sharedGlowTexture,
      stellarColor,
      RENDER_TUNING.body.outerGlowOpacityMin,
    )
    const glowInner = new THREE.Sprite(glowInnerMaterial)
    const glowOuter = new THREE.Sprite(glowOuterMaterial)
    glowInner.visible = false
    glowOuter.visible = false
    glowInner.renderOrder = 11
    glowOuter.renderOrder = 10

    const trailPositions = new Float32Array(RENDER_TUNING.trail.maxPoints * 3)
    const trailAlphas = new Float32Array(RENDER_TUNING.trail.maxPoints)
    const trailSizes = new Float32Array(RENDER_TUNING.trail.maxPoints)
    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage),
    )
    trailGeometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(trailAlphas, 1).setUsage(THREE.DynamicDrawUsage),
    )
    trailGeometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(trailSizes, 1).setUsage(THREE.DynamicDrawUsage),
    )
    trailGeometry.setDrawRange(0, 0)

    const trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(stellarColor) },
      },
      vertexShader: trailPointVertexShader,
      fragmentShader: trailPointFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    })
    const trailPoints = new THREE.Points(trailGeometry, trailMaterial)
    trailPoints.visible = false
    trailPoints.frustumCulled = false
    trailPoints.renderOrder = 21

    const trailRibbon = createTrailRibbon(stellarColor)
    ;(trailRibbon.material.uniforms.uResolution.value as THREE.Vector2).set(
      Math.max(host.clientWidth, 1),
      Math.max(host.clientHeight, 1),
    )

    scene.add(trailRibbon.mesh, trailPoints, glowOuter, glowInner, mesh)

    const created: VisualBody = {
      mesh,
      bodyMaterial,
      glowInner,
      glowInnerMaterial,
      glowOuter,
      glowOuterMaterial,
      trailPoints,
      trailGeometry,
      trailMaterial,
      trailPositions,
      trailAlphas,
      trailSizes,
      trailRibbon,
      points: [],
    }
    visuals.set(body.id, created)
    return created
  }

  const updateTrailVisual = (
    visual: VisualBody,
    currentTime: number,
    duration: number,
    enabled: boolean,
    currentBodyPosition?: THREE.Vector3,
  ) => {
    const count = visual.points.length
    if (!enabled || count === 0) {
      visual.trailGeometry.setDrawRange(0, 0)
      visual.trailPoints.visible = false
      visual.trailRibbon.geometry.setDrawRange(0, 0)
      visual.trailRibbon.mesh.visible = false
      return
    }

    const positionAttribute = visual.trailGeometry.getAttribute('position') as THREE.BufferAttribute
    const alphaAttribute = visual.trailGeometry.getAttribute('aAlpha') as THREE.BufferAttribute
    const sizeAttribute = visual.trailGeometry.getAttribute('aSize') as THREE.BufferAttribute

    for (let index = 0; index < count; index += 1) {
      const point = visual.points[index]
      const offset = index * 3
      visual.trailPositions[offset] = point.position.x
      visual.trailPositions[offset + 1] = point.position.y
      visual.trailPositions[offset + 2] = point.position.z

      const freshness = getFreshness(point, currentTime, duration)
      const featherProgress = smooth01(freshness)
      visual.trailAlphas[index] = RENDER_TUNING.trail.softPointAlpha * featherProgress
      visual.trailSizes[index] = THREE.MathUtils.lerp(
        RENDER_TUNING.trail.softPointSizeOld,
        RENDER_TUNING.trail.softPointSizeNew,
        Math.pow(freshness, 0.9),
      )
    }

    positionAttribute.needsUpdate = true
    alphaAttribute.needsUpdate = true
    sizeAttribute.needsUpdate = true
    visual.trailGeometry.setDrawRange(0, count)
    visual.trailPoints.visible = true

    const curveSamples = buildCurveSamples(visual.points, currentBodyPosition, currentTime)
    const smoothSamples = smoothCurveSamples(curveSamples)
    updateTrailRibbon(visual.trailRibbon, smoothSamples, currentTime, duration)
  }

  const compositionOffset = new THREE.Vector3()
  const cameraShift = new THREE.Vector3()
  const targetScratch = new THREE.Vector3()

  const moveCameraTargetTo = (target: THREE.Vector3) => {
    cameraShift.copy(target).sub(controls.target)
    if (cameraShift.lengthSq() <= 1e-12) return

    camera.position.add(cameraShift)
    controls.target.copy(target)
    starLayers.forEach((layer) => layer.points.position.addScaledVector(cameraShift, layer.follow))
  }

  const getTrackedBody = (current: BodyState[], trackedBodyId: string | null) => {
    if (!trackedBodyId) return undefined
    return (
      current.find((body) => body.id === trackedBodyId) ??
      current.find((body) => isBodyDescendedFrom(body.id, trackedBodyId))
    )
  }

  let compositionMode: 'mobile' | 'desktop' | null = null
  const applyComposition = () => {
    const state = getState()
    const nextMode = host.clientWidth <= 760 ? 'mobile' : 'desktop'
    if (nextMode === compositionMode) return

    compositionOffset.set(0, nextMode === 'mobile' ? -1 : 0, 0)
    const trackedBody = getTrackedBody(state.bodies, state.trackedBodyId)
    if (trackedBody) {
      targetScratch
        .set(trackedBody.position.x, trackedBody.position.y, trackedBody.position.z)
        .add(compositionOffset)
      moveCameraTargetTo(targetScratch)
      wasTrackingBody = true
    } else {
      moveCameraTargetTo(compositionOffset)
      wasTrackingBody = false
    }

    controls.update()
    compositionMode = nextMode
  }

  const resize = () => {
    const width = Math.max(host.clientWidth, 1)
    const height = Math.max(host.clientHeight, 1)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    visuals.forEach((visual) => {
      ;(visual.trailRibbon.material.uniforms.uResolution.value as THREE.Vector2).set(width, height)
    })
    applyComposition()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  let frame = 0
  const animate = () => {
    frame = requestAnimationFrame(animate)
    const state = getState()
    const current = state.bodies
    const currentIds = new Set(current.map((body) => body.id))
    const trailEnabledNow = state.trailEnabled
    const simulationTimeNow = state.simulationTime
    const trailDurationNow = Math.max(1, state.trailDuration)
    const cutoff = simulationTimeNow - trailDurationNow
    const trackedBody = getTrackedBody(current, state.trackedBodyId)
    const trackingSelectionChanged = observedTrackedBodyId !== state.trackedBodyId

    if (trackedBody) {
      targetScratch
        .set(trackedBody.position.x, trackedBody.position.y, trackedBody.position.z)
        .add(compositionOffset)
      moveCameraTargetTo(targetScratch)
      wasTrackingBody = true
    } else if (wasTrackingBody || trackingSelectionChanged) {
      moveCameraTargetTo(compositionOffset)
      wasTrackingBody = false
    }
    observedTrackedBodyId = state.trackedBodyId

    if (observedTrailVersion !== state.trailVersion) {
      Array.from(visuals.keys()).forEach(removeVisual)
      observedTrailVersion = state.trailVersion
      observedTrailSampleSequence = state.trailSampleBatch.sequence
    }

    if (observedTrailEnabled !== trailEnabledNow) {
      visuals.forEach(clearTrail)
      observedTrailEnabled = trailEnabledNow
      observedTrailSampleSequence = state.trailSampleBatch.sequence
    }

    const sampleBatch = state.trailSampleBatch
    if (observedTrailSampleSequence !== sampleBatch.sequence) {
      if (trailEnabledNow) {
        sampleBatch.samples.forEach((sample) => {
          const visual = visuals.get(sample.bodyId) ?? ensureVisual({ id: sample.bodyId, color: sample.color })
          visual.points.push({
            position: new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z),
            capturedAt: sample.simulatedAt,
          })
          if (visual.points.length > RENDER_TUNING.trail.maxPoints) visual.points.shift()
        })
      }
      observedTrailSampleSequence = sampleBatch.sequence
    }

    Array.from(visuals.entries()).forEach(([id]) => {
      if (currentIds.has(id)) return
      removeVisual(id)
    })

    current.forEach((body) => {
      const visual = ensureVisual(body)
      visual.mesh.visible = true
      visual.glowInner.visible = true
      visual.glowOuter.visible = true
      updateBodyAppearance(visual, body)

      if (!trailEnabledNow) {
        visual.trailPoints.visible = false
        visual.trailRibbon.mesh.visible = false
        return
      }

      while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) visual.points.shift()
      updateTrailVisual(
        visual,
        simulationTimeNow,
        trailDurationNow,
        trailEnabledNow,
        visual.mesh.position,
      )
    })

    controls.update()
    renderer.render(scene, camera)
  }

  frame = requestAnimationFrame(animate)

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    controls.dispose()
    Array.from(visuals.keys()).forEach(removeVisual)
    starLayers.forEach((layer) => {
      scene.remove(layer.points)
      layer.geometry.dispose()
      layer.material.dispose()
    })
    sharedBodyGeometry.dispose()
    sharedGlowTexture.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
}
