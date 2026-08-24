import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
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

type TrailLineLayer = {
  line: Line2
  geometry: LineGeometry
  material: LineMaterial
}

type VisualBody = {
  mesh: THREE.Mesh
  bodyMaterial: THREE.ShaderMaterial
  glow: THREE.Sprite
  glowMaterial: THREE.SpriteMaterial
  trailPoints: THREE.Points
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.ShaderMaterial
  trailPositions: Float32Array
  trailAlphas: Float32Array
  trailSizes: Float32Array
  trailBands: TrailLineLayer[]
  trailHead: TrailLineLayer
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
    glowScale: 4.6,
    glowOpacityMin: 0.18,
    glowOpacityMax: 0.28,
    detailMin: 0.12,
    detailMax: 0.6,
    rimMin: 0.07,
    rimMax: 0.12,
  },
  trail: {
    maxPoints: 6000,
    maxCurvePoints: 360,
    softPointSizeOld: 5.5,
    softPointSizeNew: 17.0,
    softPointAlpha: 0.105,
    headFreshness: 0.9,
    headWidth: 1.05,
    headOpacity: 0.46,
    bands: [
      { minFreshness: 0.0, maxFreshness: 0.28, width: 0.82, opacity: 0.075 },
      { minFreshness: 0.28, maxFreshness: 0.52, width: 1.08, opacity: 0.12 },
      { minFreshness: 0.52, maxFreshness: 0.76, width: 1.42, opacity: 0.19 },
      { minFreshness: 0.76, maxFreshness: 1.01, width: 1.92, opacity: 0.3 },
    ],
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

  vec3 drawBodyBase() {
    return uIdentityColor;
  }

  float drawBodySurfaceDetail(vec3 objectNormal) {
    vec3 seedOffset = vec3(uSeed * 0.071, uSeed * 0.113, uSeed * 0.157);
    float broad = valueNoise(objectNormal * 3.6 + seedOffset);
    float fine = valueNoise(objectNormal * 9.5 - seedOffset * 1.7);
    float bands = 0.5 + 0.5 * sin((objectNormal.y * 7.5 + broad * 0.9 + uSeed * 0.013) * 6.2831853);
    float craterNoise = valueNoise(objectNormal * 15.0 + seedOffset * 3.1);
    float crater = smoothstep(0.87, 0.98, craterNoise);

    float variation =
      (broad - 0.5) * 0.12 +
      (fine - 0.5) * 0.055 +
      (bands - 0.5) * 0.025 -
      crater * 0.035;

    return clamp(1.0 + variation * uDetailStrength, 0.9, 1.06);
  }

  float drawBodyShading(vec3 worldNormal, vec3 viewDirection) {
    // Stars are self-luminous. Use limb darkening as the dominant cue and keep
    // the fixed upper-left light only as a very subtle directional modulation.
    float limb = max(dot(worldNormal, viewDirection), 0.0);
    float limbDarkening = 0.72 + 0.28 * pow(limb, 0.55);
    vec3 lightDirection = normalize(vec3(-0.55, 0.68, 0.46));
    float directional = dot(worldNormal, lightDirection) * 0.5 + 0.5;
    return limbDarkening * (0.94 + 0.06 * directional);
  }

  float drawBodyRim(vec3 worldNormal, vec3 viewDirection) {
    float fresnel = 1.0 - max(dot(worldNormal, viewDirection), 0.0);
    return pow(fresnel, 2.6) * uRimStrength;
  }

  void main() {
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 baseColor = drawBodyBase();
    float surfaceDetail = drawBodySurfaceDetail(normalize(vObjectNormal));
    float shading = drawBodyShading(normalWorld, viewDirection);
    float rim = drawBodyRim(normalWorld, viewDirection);
    float centerEmission = pow(max(dot(normalWorld, viewDirection), 0.0), 0.65) * 0.13;

    vec3 color = baseColor * shading * surfaceDetail * (1.0 + centerEmission);
    color += baseColor * rim;

    // Preserve the selected stellar hue instead of whitening highlights.
    color = min(color, baseColor * 1.16);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const trailVertexShader = `
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

const trailFragmentShader = `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered) * 2.0;
    if (radius > 1.0) discard;

    float softHalo = exp(-4.8 * radius * radius);
    float edge = 1.0 - smoothstep(0.72, 1.0, radius);
    float alpha = vAlpha * softHalo * edge;

    gl_FragColor = vec4(uColor, alpha);
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
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create body glow texture')

  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.92)')
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.58)')
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.26)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.10)')
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.035)')
  gradient.addColorStop(0.9, 'rgba(255,255,255,0.01)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function createTrailLineLayer(color: string, width: number, opacity: number) {
  const geometry = new LineGeometry()
  geometry.setPositions([0, 0, 0, 0, 0, 0])
  const material = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    linewidth: width,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  })
  const line = new Line2(geometry, material)
  line.visible = false
  line.frustumCulled = false
  return { line, geometry, material }
}

function setLinePoints(layer: TrailLineLayer, points: THREE.Vector3[]) {
  if (points.length < 2) {
    layer.line.visible = false
    return
  }

  const positions = new Array<number>(points.length * 3)
  points.forEach((point, index) => {
    const offset = index * 3
    positions[offset] = point.x
    positions[offset + 1] = point.y
    positions[offset + 2] = point.z
  })
  layer.geometry.setPositions(positions)
  layer.line.computeLineDistances()
}

function smoothCurvePoints(points: THREE.Vector3[]) {
  if (points.length < 3) return points
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const segments = Math.min(520, Math.max(points.length * 3, 24))
  return curve.getPoints(segments)
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
    if (!previous || previous.position.distanceToSquared(point.position) > 1e-10) {
      samples.push(point)
    }
  })

  if (currentPosition) {
    const previous = samples[samples.length - 1]
    if (!previous || previous.position.distanceToSquared(currentPosition) > 1e-10) {
      samples.push({ position: currentPosition, capturedAt: currentTime })
    }
  }

  return samples
}

function getFreshness(sample: TrailCurveSample, currentTime: number, duration: number) {
  const ageRatio = THREE.MathUtils.clamp((currentTime - sample.capturedAt) / duration, 0, 1)
  return 1 - ageRatio
}

function collectBandPoints(
  samples: TrailCurveSample[],
  currentTime: number,
  duration: number,
  minFreshness: number,
  maxFreshness: number,
) {
  let first = -1
  let last = -1

  samples.forEach((sample, index) => {
    const freshness = getFreshness(sample, currentTime, duration)
    if (freshness >= minFreshness && freshness < maxFreshness) {
      if (first === -1) first = index
      last = index
    }
  })

  if (first === -1 || last === -1) return []
  first = Math.max(0, first - 1)
  last = Math.min(samples.length - 1, last + 1)

  const points: THREE.Vector3[] = []
  for (let index = first; index <= last; index += 1) {
    const point = samples[index].position
    const previous = points[points.length - 1]
    if (!previous || previous.distanceToSquared(point) > 1e-10) points.push(point.clone())
  }
  return smoothCurvePoints(points)
}

function updateBodyAppearance(visual: VisualBody, body: BodyState) {
  const renderRadius = Math.max(body.radius, RENDER_TUNING.body.minRenderRadius)
  const stellarColor = getNearestStellarColor(body.color).hex
  visual.mesh.position.set(body.position.x, body.position.y, body.position.z)
  visual.mesh.scale.setScalar(renderRadius)
  visual.glow.position.copy(visual.mesh.position)
  visual.glow.scale.setScalar(renderRadius * RENDER_TUNING.body.glowScale)

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

  visual.glowMaterial.color.set(stellarColor)
  const luminance = identityColor.r * 0.2126 + identityColor.g * 0.7152 + identityColor.b * 0.0722
  visual.glowMaterial.opacity = THREE.MathUtils.lerp(
    RENDER_TUNING.body.glowOpacityMin,
    RENDER_TUNING.body.glowOpacityMax,
    THREE.MathUtils.clamp(luminance, 0, 1),
  )

  ;(visual.trailMaterial.uniforms.uColor.value as THREE.Color).set(stellarColor)
  visual.trailBands.forEach((layer) => layer.material.color.set(stellarColor))
  visual.trailHead.material.color.set(stellarColor)
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
    visual.trailBands.forEach((layer) => {
      layer.line.visible = false
    })
    visual.trailHead.line.visible = false
  }

  const removeVisual = (id: string) => {
    const visual = visuals.get(id)
    if (!visual) return

    scene.remove(visual.mesh, visual.glow, visual.trailPoints)
    visual.trailBands.forEach((layer) => {
      scene.remove(layer.line)
      layer.geometry.dispose()
      layer.material.dispose()
    })
    scene.remove(visual.trailHead.line)

    visual.bodyMaterial.dispose()
    visual.glowMaterial.dispose()
    visual.trailGeometry.dispose()
    visual.trailMaterial.dispose()
    visual.trailHead.geometry.dispose()
    visual.trailHead.material.dispose()
    visuals.delete(id)
  }

  const ensureVisual = (body: Pick<BodyState, 'id' | 'color'>) => {
    const existing = visuals.get(body.id)
    if (existing) return existing

    const stellarColor = getNearestStellarColor(body.color).hex
    const bodyMaterial = createBodyMaterial(body.id, stellarColor)
    const mesh = new THREE.Mesh(sharedBodyGeometry, bodyMaterial)
    mesh.visible = false

    const glowMaterial = new THREE.SpriteMaterial({
      map: sharedGlowTexture,
      color: stellarColor,
      transparent: true,
      opacity: RENDER_TUNING.body.glowOpacityMin,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    })
    const glow = new THREE.Sprite(glowMaterial)
    glow.visible = false
    glow.renderOrder = 10

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
      vertexShader: trailVertexShader,
      fragmentShader: trailFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    })
    const trailPoints = new THREE.Points(trailGeometry, trailMaterial)
    trailPoints.visible = false
    trailPoints.frustumCulled = false
    trailPoints.renderOrder = 20

    const trailBands = RENDER_TUNING.trail.bands.map((band, index) => {
      const layer = createTrailLineLayer(stellarColor, band.width, band.opacity)
      layer.line.renderOrder = 21 + index
      return layer
    })
    const trailHead = createTrailLineLayer(
      stellarColor,
      RENDER_TUNING.trail.headWidth,
      RENDER_TUNING.trail.headOpacity,
    )
    trailHead.line.renderOrder = 26

    scene.add(trailPoints)
    trailBands.forEach((layer) => scene.add(layer.line))
    scene.add(trailHead.line, glow, mesh)

    const created: VisualBody = {
      mesh,
      bodyMaterial,
      glow,
      glowMaterial,
      trailPoints,
      trailGeometry,
      trailMaterial,
      trailPositions,
      trailAlphas,
      trailSizes,
      trailBands,
      trailHead,
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
      visual.trailBands.forEach((layer) => {
        layer.line.visible = false
      })
      visual.trailHead.line.visible = false
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
      visual.trailAlphas[index] = RENDER_TUNING.trail.softPointAlpha * Math.pow(freshness, 1.35)
      visual.trailSizes[index] = THREE.MathUtils.lerp(
        RENDER_TUNING.trail.softPointSizeOld,
        RENDER_TUNING.trail.softPointSizeNew,
        Math.pow(freshness, 1.2),
      )
    }

    positionAttribute.needsUpdate = true
    alphaAttribute.needsUpdate = true
    sizeAttribute.needsUpdate = true
    visual.trailGeometry.setDrawRange(0, count)
    visual.trailPoints.visible = true

    const curveSamples = buildCurveSamples(visual.points, currentBodyPosition, currentTime)
    RENDER_TUNING.trail.bands.forEach((band, index) => {
      const layer = visual.trailBands[index]
      const bandPoints = collectBandPoints(
        curveSamples,
        currentTime,
        duration,
        band.minFreshness,
        band.maxFreshness,
      )
      setLinePoints(layer, bandPoints)
      layer.line.visible = bandPoints.length >= 2
    })

    const headPoints = collectBandPoints(
      curveSamples,
      currentTime,
      duration,
      RENDER_TUNING.trail.headFreshness,
      1.01,
    )
    setLinePoints(visual.trailHead, headPoints)
    visual.trailHead.line.visible = headPoints.length >= 2
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
      visual.trailBands.forEach((layer) => layer.material.resolution.set(width, height))
      visual.trailHead.material.resolution.set(width, height)
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

    Array.from(visuals.entries()).forEach(([id, visual]) => {
      if (currentIds.has(id)) return
      visual.mesh.visible = false
      visual.glow.visible = false

      if (!trailEnabledNow) {
        removeVisual(id)
        return
      }

      while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) {
        visual.points.shift()
      }
      updateTrailVisual(visual, simulationTimeNow, trailDurationNow, trailEnabledNow)
      if (visual.points.length === 0) removeVisual(id)
    })

    current.forEach((body) => {
      const visual = ensureVisual(body)
      visual.mesh.visible = true
      visual.glow.visible = true
      updateBodyAppearance(visual, body)

      if (!trailEnabledNow) {
        visual.trailPoints.visible = false
        visual.trailBands.forEach((layer) => {
          layer.line.visible = false
        })
        visual.trailHead.line.visible = false
        return
      }

      while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) {
        visual.points.shift()
      }
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
