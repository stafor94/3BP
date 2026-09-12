import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import {
  getStellarComputedProperties,
  getStellarDisplayColorFromBody,
  getStellarDisplayColorFromTemperature,
  getStellarSurfaceTemperatureFromBody,
  mixStellarDisplayColors,
} from '../starColors'
import {
  getStellarCollisionTimeline,
  STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
} from '../stellarCollisionTimeline'
import type { BodyState } from '../types'
import { getStellarRenderProfile, type StellarRenderProfile } from './stellarRenderProfile'

export const STELLAR_PHOTOSPHERE_RENDER_PATH = 'stellar-photosphere'

const stellarHeatClock = new Map<string, { token: string; startedAt: number }>()

export type StellarPhotosphereFrame = {
  displayColor: string
  luminositySolar: number
  surfaceTemperatureK: number
  displaySurfaceTemperatureK: number
  transientHeatStrength: number
  evolutionPhase01: number
  animationTimeSeconds: number
  renderProfile: StellarRenderProfile
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getTransientHeatStrength(body: BodyState) {
  const token = body.transientHeatToken
  const initialStrength = body.transientHeat01 ?? 0
  const decayMs = body.transientHeatDecayMs ?? 0
  if (!token || initialStrength <= 0 || decayMs <= 0) return 0

  if (
    body.stellarCollisionEventId &&
    body.stellarCollisionAge !== undefined &&
    body.stellarCollisionContactDurationSeconds !== undefined
  ) {
    // Production stellar collisions own one simulation-time event clock. Heat
    // keeps the existing settle-local 0.16 s decay curve, but derives that age
    // from the cumulative contact->settle timeline instead of wall time.
    stellarHeatClock.delete(body.id)
    const timeline = getStellarCollisionTimeline({
      eventAgeSeconds: body.stellarCollisionAge,
      contactDurationSeconds: body.stellarCollisionContactDurationSeconds,
    })
    const progress = timeline.settleDurationSeconds <= 0
      ? 1
      : Math.min(1, Math.max(0, timeline.settleAgeSeconds / timeline.settleDurationSeconds))
    return initialStrength * (1 - progress) ** 1.55
  }

  if (body.stellarCollisionAge !== undefined) {
    // Compatibility for snapshots/fixtures created before event metadata existed.
    const progress = Math.min(
      1,
      Math.max(0, body.stellarCollisionAge / STELLAR_COLLISION_SETTLE_DURATION_SECONDS),
    )
    return initialStrength * (1 - progress) ** 1.55
  }
  const existing = stellarHeatClock.get(body.id)
  const clock = existing?.token === token
    ? existing
    : { token, startedAt: nowMs() }
  if (existing?.token !== token) stellarHeatClock.set(body.id, clock)

  const progress = Math.min(1, Math.max(0, (nowMs() - clock.startedAt) / decayMs))
  return initialStrength * (1 - progress) ** 1.55
}

export function getResolvedStellarPhotosphereColor(body: BodyState) {
  const equilibriumColor = getStellarDisplayColorFromBody(body)
  const heatStrength = getTransientHeatStrength(body)
  if (heatStrength <= 0.001) return equilibriumColor

  const equilibriumTemperature = getStellarSurfaceTemperatureFromBody(body)
  const heatedTemperature = equilibriumTemperature + (body.shockTemperatureBiasK ?? 0) * heatStrength
  const heatedColor = getStellarDisplayColorFromTemperature(heatedTemperature)
  const globalSurfaceHeatShare = body.stellarCollisionOutcome === 'merge'
    ? 0.28
    : body.stellarCollisionOutcome === 'partialDisruption'
      ? 0.16
      : 0.08

  return mixStellarDisplayColors(
    equilibriumColor,
    heatedColor,
    heatStrength * globalSurfaceHeatShare,
  )
}

export function getStellarPhotosphereFrame(
  body: BodyState,
  animationTimeSeconds: number,
): StellarPhotosphereFrame {
  const properties = getStellarComputedProperties(body)
  const transientHeatStrength = getTransientHeatStrength(body)
  const displaySurfaceTemperatureK = properties.surfaceTemperatureK +
    (body.shockTemperatureBiasK ?? 0) * transientHeatStrength

  return {
    displayColor: getResolvedStellarPhotosphereColor(body),
    luminositySolar: properties.luminositySolar,
    surfaceTemperatureK: properties.surfaceTemperatureK,
    displaySurfaceTemperatureK,
    transientHeatStrength,
    evolutionPhase01: body.stellarEvolutionPhase01 ?? 0.5,
    animationTimeSeconds,
    renderProfile: getStellarRenderProfile(
      properties.luminositySolar,
      properties.surfaceTemperatureK,
    ),
  }
}

export const stellarPhotosphereFragmentShader = `
  uniform vec3 uIdentityColor;
  uniform float uSeed;
  uniform float uSurfaceSeed;
  uniform float uTime;
  uniform float uDetailStrength;
  uniform float uRimStrength;
  uniform float uOpacity;
  uniform float uEmissionStrength;
  uniform float uSurfaceVariant;

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

  float drawStellarSurfaceVariation(vec3 objectNormal) {
    // Restore restrained object-space surface structure instead of relying on a
    // nearly uniform disk. Each octave fades out as its projected footprint can
    // no longer resolve it, so small stars do not acquire noisy pixels or shimmer.
    float footprint = max(length(fwidth(objectNormal)), 0.000001);
    float broadResolved = 1.0 - smoothstep(0.020, 0.070, footprint);
    float mediumResolved = 1.0 - smoothstep(0.010, 0.032, footprint);
    vec3 offset = vec3(uSurfaceSeed * 0.051, uSurfaceSeed * 0.089, uSurfaceVariant);
    float broad = valueNoise(objectNormal * 2.7 + offset);
    float medium = valueNoise(objectNormal * 5.4 - offset * 1.37);
    float variation =
      (broad - 0.5) * 0.105 * broadResolved +
      (medium - 0.5) * 0.045 * mediumResolved;
    return clamp(1.0 + variation * uDetailStrength, 0.92, 1.07);
  }

  float drawStellarEmission(float viewMu) {
    // A broad continuous center-to-limb gradient supplies spherical depth while
    // keeping the whole disk emissive. There is deliberately no white center term
    // and no dark rim multiplier; the temperature identity scales every radius.
    return 0.68 + 0.32 * smoothstep(0.0, 0.94, viewMu);
  }

  float getStellarEdgeCoverage(float viewMu) {
    // Feather inside the silhouette where the immediate glow already overlaps.
    // Derivatives supply a pixel-scale floor for small projected disks.
    float feather = max(0.34, fwidth(viewMu) * 1.25);
    return smoothstep(0.0, feather, viewMu);
  }

  void main() {
    if (uOpacity <= 0.001) discard;

    vec3 objectNormal = normalize(vObjectNormal);
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float viewMu = max(dot(normalWorld, viewDirection), 0.0);
    float surfaceDetail = drawStellarSurfaceVariation(objectNormal);
    float edgeCoverage = getStellarEdgeCoverage(viewMu);
    float linearIntensity = drawStellarEmission(viewMu) * uEmissionStrength * surfaceDetail;

    // Keep one temperature-colored emission path across the full photosphere.
    // Surface structure and radial depth modulate intensity, never hue toward white.
    vec3 coloredEmission = uIdentityColor * linearIntensity;

    gl_FragColor = vec4(coloredEmission, uOpacity * edgeCoverage);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const genericOnlyUniforms = [
  'uSecondaryColor',
  'uPolarColor',
  'uBodyKind',
  'uSpecularStrength',
  'uSpecularPower',
  'uAmbientStrength',
  'uTerminatorPower',
  'uAtmosphereStrength',
  'uBandStrength',
  'uCraterStrength',
  'uCloudStrength',
  'uLightCount',
  'uLightPositions',
  'uLightColors',
  'uLightStrengths',
] as const

function createStellarUniforms(uniforms: Record<string, any>) {
  const nextUniforms = { ...uniforms }
  genericOnlyUniforms.forEach((name) => delete nextUniforms[name])
  const seed = typeof uniforms.uSeed?.value === 'number' ? uniforms.uSeed.value : 0

  nextUniforms.uSurfaceSeed ??= { value: seed }
  nextUniforms.uTime ??= { value: 0 }
  nextUniforms.uEmissionStrength ??= { value: 1 }
  nextUniforms.uSurfaceVariant ??= { value: 0.5 }
  return nextUniforms
}

export function createStellarPhotosphereMaterialValues(values: Record<string, any>) {
  return {
    ...values,
    fragmentShader: stellarPhotosphereFragmentShader,
    uniforms: createStellarUniforms(values.uniforms ?? {}),
    alphaToCoverage: true,
    toneMapped: true,
  }
}

export function configureStellarPhotosphereMaterial(material: THREE.ShaderMaterial) {
  material.fragmentShader = stellarPhotosphereFragmentShader
  material.uniforms = createStellarUniforms(material.uniforms)
  material.alphaToCoverage = true
  material.toneMapped = true
  material.userData.bodyRenderPath = STELLAR_PHOTOSPHERE_RENDER_PATH
  material.needsUpdate = true
}

export function isStellarPhotosphereMaterial(material: THREE.ShaderMaterial) {
  return material.userData.bodyRenderPath === STELLAR_PHOTOSPHERE_RENDER_PATH ||
    material.fragmentShader === stellarPhotosphereFragmentShader
}

export function updateStellarPhotosphereMaterial(
  material: THREE.ShaderMaterial,
  frame: StellarPhotosphereFrame,
) {
  const identityColor = material.uniforms.uIdentityColor?.value
  if (identityColor instanceof THREE.Color) identityColor.set(frame.displayColor)
  // Low-frequency detail is LOD-filtered in the shader before it reaches small disks.
  if (material.uniforms.uDetailStrength) material.uniforms.uDetailStrength.value = 1.0
  if (material.uniforms.uRimStrength) material.uniforms.uRimStrength.value = 0.045
  if (material.uniforms.uTime) material.uniforms.uTime.value = frame.animationTimeSeconds
  if (material.uniforms.uEmissionStrength) {
    material.uniforms.uEmissionStrength.value = frame.renderProfile.photosphereIntensity
  }
  if (material.uniforms.uSurfaceVariant) {
    material.uniforms.uSurfaceVariant.value = frame.evolutionPhase01
  }
}

function inheritMergedStellarEvolution(body: BodyState, previousBodies: BodyState[]) {
  if (getEffectiveBodyType(body) !== 'star' || body.stellarEvolutionStage !== undefined) return body

  const previousStars = previousBodies.filter((candidate) => getEffectiveBodyType(candidate) === 'star')
  const sameBody = previousStars.find((candidate) => candidate.id === body.id)
  let source = sameBody

  if (!source && body.stellarCollisionOutcome === 'merge') {
    for (let firstIndex = 0; firstIndex < previousStars.length && !source; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < previousStars.length; secondIndex += 1) {
        const first = previousStars[firstIndex]
        const second = previousStars[secondIndex]
        if (body.id !== `${first.id}+${second.id}` && body.id !== `${second.id}+${first.id}`) continue
        source = first.mass >= second.mass ? first : second
        break
      }
    }
  }

  if (!source) return body
  return {
    ...body,
    stellarEvolutionStage: source.stellarEvolutionStage ?? 'mainSequence',
    stellarEvolutionPhase01: source.stellarEvolutionPhase01 ?? 0.5,
    stellarRadiusScale: source.stellarRadiusScale ?? 1,
  }
}

export function syncStellarPhotosphereState(
  bodies: BodyState[],
  previousBodies: BodyState[],
) {
  const activeBodyIds = new Set(bodies.map((body) => body.id))
  Array.from(stellarHeatClock.keys()).forEach((id) => {
    if (!activeBodyIds.has(id)) stellarHeatClock.delete(id)
  })

  return bodies.map((body) => inheritMergedStellarEvolution(body, previousBodies))
}
