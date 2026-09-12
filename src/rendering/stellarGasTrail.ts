import * as THREE from 'three'
import type { BodyState } from '../types'

const CAPACITY = 40
const HISTORY_SECONDS = 0.52
const HISTORY_FADE_START_SECONDS = 0.36
const HEAD_FADE_SECONDS = 0.04
const MIN_SAMPLE_INTERVAL_SECONDS = 0.006
const TARGET_SAMPLE_INTERVAL_SECONDS = 0.014
const MIN_SAMPLE_DISTANCE_SCALE = 0.018
const MAX_SEGMENT_DISTANCE_SCALE = 0.14
const MAX_INTERPOLATED_SAMPLES_PER_UPDATE = 4
const TIME_EPSILON = 1e-9

const trailVertexShader = `
  attribute float aTrailCoord;
  attribute float aTrailAge01;
  attribute float aTrailDensity;
  attribute float aTrailEndFade;

  varying float vTrailCoord;
  varying float vTrailAge01;
  varying float vTrailDensity;
  varying float vTrailEndFade;
  varying float vTrailAcross;

  void main() {
    vTrailCoord = aTrailCoord;
    vTrailAge01 = aTrailAge01;
    vTrailDensity = aTrailDensity;
    vTrailEndFade = aTrailEndFade;
    vTrailAcross = uv.y * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const trailFragmentShader = `
  uniform vec3 uCoreColor;
  uniform vec3 uMidColor;
  uniform vec3 uEdgeColor;
  uniform float uOpacity;
  uniform float uProgress;
  uniform float uSeed;
  uniform float uKind;
  uniform float uTail;
  uniform float uTurbulence;
  uniform float uBrightness;
  uniform float uInnerGlow;
  uniform float uOuterGlow;
  uniform float uPulse;
  uniform float uSynthetic;
  uniform float uStellar;

  varying float vTrailCoord;
  varying float vTrailAge01;
  varying float vTrailDensity;
  varying float vTrailEndFade;
  varying float vTrailAcross;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
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
    float across = abs(vTrailAcross);
    float seed = uSeed * 0.013;
    float broadNoise = valueNoise(vec2(vTrailCoord * 0.22 + seed, vTrailAcross * 0.48 - seed * 0.7));
    float detailNoise = valueNoise(vec2(vTrailCoord * 0.68 - seed * 0.43, vTrailAcross * 1.15 + seed));
    float densityNoise = broadNoise * 0.72 + detailNoise * 0.28;

    float edgeBoundary = clamp(0.77 + (broadNoise - 0.5) * 0.20 * (0.55 + uTurbulence * 0.45), 0.61, 0.90);
    float lateralFade = 1.0 - smoothstep(edgeBoundary, 1.0, across);
    float porousDensity = 0.64 + densityNoise * 0.36;
    float alpha = lateralFade * porousDensity * vTrailDensity * vTrailEndFade * uOpacity;
    if (alpha <= 0.002) discard;

    float cooling = smoothstep(0.18, 1.0, vTrailAge01);
    vec3 color = mix(uMidColor, uEdgeColor, cooling * 0.62);
    color = mix(color, uEdgeColor, smoothstep(0.58, 1.0, across) * 0.18);
    color *= uBrightness * (0.90 + broadNoise * 0.10);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`

type Sample = {
  id: number
  simulatedAt: number
  distance: number
  position: THREE.Vector3
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function makeTrailMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoreColor: { value: new THREE.Color('#f7fbff') },
      uMidColor: { value: new THREE.Color('#dcecff') },
      uEdgeColor: { value: new THREE.Color('#9fb8d4') },
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uSeed: { value: 0 },
      uKind: { value: 2 },
      uTail: { value: 0 },
      uTurbulence: { value: 0 },
      uBrightness: { value: 1 },
      uInnerGlow: { value: 0 },
      uOuterGlow: { value: 0 },
      uPulse: { value: 0 },
      uSynthetic: { value: 0 },
      uStellar: { value: 1 },
    },
    vertexShader: trailVertexShader,
    fragmentShader: trailFragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
}

function resetTrail(trail: ReturnType<typeof createStellarGasTrail>, eventKey: string, simulationTime: number, bodyAge: number) {
  trail.samples.length = 0
  trail.eventKey = eventKey
  trail.launchSimulationTime = simulationTime - bodyAge
  trail.lastSimulationTime = simulationTime
  trail.lastBodyAge = bodyAge
  trail.nextSampleId = 0
  trail.geometry.setDrawRange(0, 0)
}

function appendSample(
  trail: ReturnType<typeof createStellarGasTrail>,
  simulatedAt: number,
  position: THREE.Vector3,
) {
  const previous = trail.samples[trail.samples.length - 1]
  const distance = previous
    ? previous.distance + previous.position.distanceTo(position)
    : 0
  trail.samples.push({
    id: trail.nextSampleId++,
    simulatedAt,
    distance,
    position: position.clone(),
  })
}

function compactToCapacity(trail: ReturnType<typeof createStellarGasTrail>, sourceRadius: number) {
  const samples = trail.samples
  while (samples.length > CAPACITY) {
    let removeIndex = 1
    let bestCost = Number.POSITIVE_INFINITY
    for (let i = 1; i < samples.length - 1; i += 1) {
      const spanDistance = samples[i + 1].distance - samples[i - 1].distance
      const spanTime = samples[i + 1].simulatedAt - samples[i - 1].simulatedAt
      const cost = spanDistance + spanTime * sourceRadius
      if (cost < bestCost) {
        bestCost = cost
        removeIndex = i
      }
    }
    samples.splice(removeIndex, 1)
  }
}

function sampleObservedPosition(
  trail: ReturnType<typeof createStellarGasTrail>,
  simulationTime: number,
  position: THREE.Vector3,
  sourceRadius: number,
) {
  const samples = trail.samples
  if (samples.length === 0) {
    appendSample(trail, simulationTime, position)
    return
  }

  const previous = samples[samples.length - 1]
  const dt = simulationTime - previous.simulatedAt
  if (dt <= TIME_EPSILON) return

  const travelled = previous.position.distanceTo(position)
  const minDistance = sourceRadius * MIN_SAMPLE_DISTANCE_SCALE
  const maxSegmentDistance = sourceRadius * MAX_SEGMENT_DISTANCE_SCALE
  const enoughTime = dt >= TARGET_SAMPLE_INTERVAL_SECONDS
  const enoughDistance = travelled >= maxSegmentDistance * 0.5
  if (dt < MIN_SAMPLE_INTERVAL_SECONDS || travelled < minDistance || (!enoughTime && !enoughDistance)) return

  const byTime = Math.ceil(dt / TARGET_SAMPLE_INTERVAL_SECONDS)
  const byDistance = Math.ceil(travelled / Math.max(maxSegmentDistance, 1e-8))
  const segmentCount = Math.min(
    MAX_INTERPOLATED_SAMPLES_PER_UPDATE + 1,
    Math.max(1, byTime, byDistance),
  )
  const startTime = previous.simulatedAt
  const startPosition = previous.position.clone()
  for (let step = 1; step <= segmentCount; step += 1) {
    const t = step / segmentCount
    appendSample(
      trail,
      THREE.MathUtils.lerp(startTime, simulationTime, t),
      startPosition.clone().lerp(position, t),
    )
  }
  compactToCapacity(trail, sourceRadius)
}

function resolveSideDirection(
  tangent: THREE.Vector3,
  samplePosition: THREE.Vector3,
  camera: THREE.Camera,
  view: THREE.Vector3,
  side: THREE.Vector3,
) {
  view.copy(camera.position).sub(samplePosition)
  if (view.lengthSq() < 1e-12) view.setFromMatrixColumn(camera.matrixWorld, 2).multiplyScalar(-1)
  view.normalize()
  side.crossVectors(tangent, view)
  if (side.lengthSq() >= 1e-10) return side.normalize()

  side.setFromMatrixColumn(camera.matrixWorld, 0)
  side.addScaledVector(tangent, -side.dot(tangent))
  if (side.lengthSq() >= 1e-10) return side.normalize()

  if (Math.abs(tangent.z) < 0.86) side.set(0, 0, 1)
  else side.set(0, 1, 0)
  side.cross(tangent)
  if (side.lengthSq() < 1e-10) side.set(1, 0, 0)
  return side.normalize()
}

/** One draw per physical parcel, independent of the number of history samples.
 * History is presentation-only and advances exclusively with simulation time. */
export function createStellarGasTrail() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 6), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(CAPACITY * 4), 2))
  geometry.setAttribute('aTrailCoord', new THREE.BufferAttribute(new Float32Array(CAPACITY * 2), 1))
  geometry.setAttribute('aTrailAge01', new THREE.BufferAttribute(new Float32Array(CAPACITY * 2), 1))
  geometry.setAttribute('aTrailDensity', new THREE.BufferAttribute(new Float32Array(CAPACITY * 2), 1))
  geometry.setAttribute('aTrailEndFade', new THREE.BufferAttribute(new Float32Array(CAPACITY * 2), 1))
  const indices: number[] = []
  for (let i = 0; i < CAPACITY - 1; i++) {
    const j = i * 2
    indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2)
  }
  geometry.setIndex(indices)
  return {
    geometry,
    material: makeTrailMaterial(),
    samples: [] as Sample[],
    eventKey: null as string | null,
    launchSimulationTime: null as number | null,
    lastSimulationTime: Number.NEGATIVE_INFINITY,
    lastBodyAge: Number.NEGATIVE_INFINITY,
    nextSampleId: 0,
  }
}

export function updateStellarGasTrail(
  trail: ReturnType<typeof createStellarGasTrail>,
  body: BodyState,
  camera: THREE.Camera,
  simulationTime?: number,
) {
  const bodyAge = Math.max(body.age ?? 0, 0)
  const currentTime = Number.isFinite(simulationTime) ? simulationTime as number : bodyAge
  const eventKey = body.stellarCollisionEventId ?? body.id
  const timeRewound = currentTime + TIME_EPSILON < trail.lastSimulationTime
  const ageRewound = bodyAge + TIME_EPSILON < trail.lastBodyAge
  const resetRequired = trail.eventKey !== eventKey || timeRewound || ageRewound
  if (resetRequired) resetTrail(trail, eventKey, currentTime, bodyAge)

  const samples = trail.samples
  const sourceRadius = Math.max(body.effectVisual?.sourceMaxRadius ?? body.radius, 1e-6)
  const repeatedSimulationTime = samples.length > 0 &&
    Math.abs(currentTime - trail.lastSimulationTime) <= TIME_EPSILON
  if (!repeatedSimulationTime) {
    sampleObservedPosition(
      trail,
      currentTime,
      new THREE.Vector3(body.position.x, body.position.y, body.position.z),
      sourceRadius,
    )
  }

  while (samples.length > 1 && currentTime - samples[0].simulatedAt > HISTORY_SECONDS) {
    samples.shift()
  }
  compactToCapacity(trail, sourceRadius)
  trail.lastSimulationTime = currentTime
  trail.lastBodyAge = bodyAge

  const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute
  const uv = trail.geometry.getAttribute('uv') as THREE.BufferAttribute
  const trailCoord = trail.geometry.getAttribute('aTrailCoord') as THREE.BufferAttribute
  const trailAge01 = trail.geometry.getAttribute('aTrailAge01') as THREE.BufferAttribute
  const trailDensity = trail.geometry.getAttribute('aTrailDensity') as THREE.BufferAttribute
  const trailEndFade = trail.geometry.getAttribute('aTrailEndFade') as THREE.BufferAttribute
  const view = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side = new THREE.Vector3()
  const previousSide = new THREE.Vector3()
  const fallbackTangent = new THREE.Vector3(body.velocity.x, body.velocity.y, body.velocity.z)
  let hasPreviousSide = false

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const before = samples[Math.max(0, i - 1)].position
    const after = samples[Math.min(samples.length - 1, i + 1)].position
    tangent.copy(after).sub(before)
    if (tangent.lengthSq() < 1e-12) tangent.copy(fallbackTangent)
    if (tangent.lengthSq() < 1e-12) tangent.setFromMatrixColumn(camera.matrixWorld, 0)
    tangent.normalize()
    resolveSideDirection(tangent, sample.position, camera, view, side)
    if (hasPreviousSide && side.dot(previousSide) < 0) side.multiplyScalar(-1)
    previousSide.copy(side)
    hasPreviousSide = true

    const localAge = Math.max(0, currentTime - sample.simulatedAt)
    const age01 = clamp01(localAge / HISTORY_SECONDS)
    const minWidth = sourceRadius * 0.085
    const width = Math.min(
      sourceRadius * 0.46,
      sourceRadius * (0.085 + Math.sqrt(age01) * 0.34),
    )
    // This is a renderer density approximation for a ribbon: widening one
    // transverse dimension reduces surface brightness inversely with width.
    const density = clamp01(minWidth / Math.max(width, 1e-8))
    const tailFade = 1 - smooth01(
      (localAge - HISTORY_FADE_START_SECONDS) /
      Math.max(HISTORY_SECONDS - HISTORY_FADE_START_SECONDS, 1e-8),
    )
    const headFade = smooth01(localAge / HEAD_FADE_SECONDS)
    const endFade = tailFade * headFade
    const stableCoord = sample.distance / sourceRadius

    for (let j = 0; j < 2; j++) {
      const vertexIndex = i * 2 + j
      const sign = j ? 1 : -1
      positions.setXYZ(
        vertexIndex,
        sample.position.x + side.x * width * sign,
        sample.position.y + side.y * width * sign,
        sample.position.z + side.z * width * sign,
      )
      uv.setXY(vertexIndex, 0, j)
      trailCoord.setX(vertexIndex, stableCoord)
      trailAge01.setX(vertexIndex, age01)
      trailDensity.setX(vertexIndex, density)
      trailEndFade.setX(vertexIndex, endFade)
    }
  }

  trail.geometry.setDrawRange(0, Math.max(0, samples.length - 1) * 6)
  positions.needsUpdate = true
  uv.needsUpdate = true
  trailCoord.needsUpdate = true
  trailAge01.needsUpdate = true
  trailDensity.needsUpdate = true
  trailEndFade.needsUpdate = true
}
