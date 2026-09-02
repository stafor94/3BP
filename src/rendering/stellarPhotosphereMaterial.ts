import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import {
  getStellarComputedProperties,
  getStellarDisplayColorFromBody,
  getStellarDisplayColorFromTemperature,
  getStellarSurfaceTemperatureFromBody,
  mixStellarDisplayColors,
} from '../starColors'
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
  uniform float uWhiteHotMix;
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

  float drawStellarGranulation(vec3 objectNormal) {
    vec3 seedOffset = vec3(
      uSurfaceSeed * 0.051 + uSurfaceVariant * 2.17,
      uSurfaceSeed * 0.089 - uSurfaceVariant * 1.61,
      uSurfaceSeed * 0.137 + uSurfaceVariant * 1.31
    );
    float slowTime = uTime * 0.012;
    vec3 convectionDrift = vec3(0.15, -0.10, 0.08) * slowTime;
    vec3 granuleDrift = vec3(-0.08, 0.13, -0.11) * slowTime;
    float convection = valueNoise(objectNormal * 4.2 + seedOffset + convectionDrift);
    float granules = valueNoise(objectNormal * 15.5 - seedOffset * 1.31 + granuleDrift);
    float micro = valueNoise(
      objectNormal * 31.0 +
      seedOffset * 0.57 -
      convectionDrift * 0.6 +
      granuleDrift * 0.35
    );
    float variation =
      (convection - 0.5) * 0.11 +
      (granules - 0.5) * 0.085 +
      (micro - 0.5) * 0.035;

    return clamp(1.0 + variation * uDetailStrength, 0.84, 1.16);
  }

  float drawStellarEmission(vec3 worldNormal, vec3 viewDirection) {
    float limb = max(dot(worldNormal, viewDirection), 0.0);
    float limbDarkening = 0.74 + 0.26 * pow(limb, 0.52);
    float centerEmission = 1.06 + 0.22 * pow(limb, 0.78);
    return limbDarkening * centerEmission;
  }

  float drawStellarRim(vec3 worldNormal, vec3 viewDirection) {
    float fresnel = 1.0 - max(dot(worldNormal, viewDirection), 0.0);
    return pow(fresnel, 2.45) * uRimStrength;
  }

  vec3 toneMapStellarHuePreserving(vec3 source) {
    float peak = max(max(source.r, source.g), source.b);
    if (peak <= 0.9) return source;

    // Compress only the high-luminance shoulder and scale all RGB channels by
    // the same factor. Unlike per-channel clipping, this preserves stellar hue.
    float mappedPeak = 0.9 + 0.08 * (1.0 - exp(-(peak - 0.9) * 3.0));
    return source * (mappedPeak / max(peak, 0.0001));
  }

  void main() {
    if (uOpacity <= 0.001) discard;

    vec3 objectNormal = normalize(vObjectNormal);
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float rim = drawStellarRim(normalWorld, viewDirection);
    float granulation = drawStellarGranulation(objectNormal);
    float emission = drawStellarEmission(normalWorld, viewDirection);
    float intensity = min((emission * granulation + rim * 0.45) * uEmissionStrength, 1.22);
    vec3 stellarColor = toneMapStellarHuePreserving(uIdentityColor * intensity);
    float granulationContrast = clamp((granulation - 1.0) * 1.75, -0.055, 0.055);
    float stellarSurfaceModulation = 1.0 + granulationContrast;
    float limb = max(dot(normalWorld, viewDirection), 0.0);
    float whiteHotCore = pow(limb, 14.0) * uWhiteHotMix;
    float peak = min(0.98, max(max(stellarColor.r, stellarColor.g), stellarColor.b) + 0.055);
    vec3 color = mix(stellarColor, vec3(peak), whiteHotCore);

    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    gl_FragColor.rgb *= stellarSurfaceModulation;
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
  nextUniforms.uWhiteHotMix ??= { value: 0 }
  nextUniforms.uSurfaceVariant ??= { value: 0.5 }
  return nextUniforms
}

export function createStellarPhotosphereMaterialValues(values: Record<string, any>) {
  return {
    ...values,
    fragmentShader: stellarPhotosphereFragmentShader,
    uniforms: createStellarUniforms(values.uniforms ?? {}),
  }
}

export function configureStellarPhotosphereMaterial(material: THREE.ShaderMaterial) {
  material.fragmentShader = stellarPhotosphereFragmentShader
  material.uniforms = createStellarUniforms(material.uniforms)
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
  if (material.uniforms.uDetailStrength) material.uniforms.uDetailStrength.value = 1
  if (material.uniforms.uRimStrength) material.uniforms.uRimStrength.value = 0.045
  if (material.uniforms.uTime) material.uniforms.uTime.value = frame.animationTimeSeconds
  if (material.uniforms.uEmissionStrength) {
    material.uniforms.uEmissionStrength.value = frame.renderProfile.photosphereIntensity
  }
  if (material.uniforms.uWhiteHotMix) {
    material.uniforms.uWhiteHotMix.value = frame.renderProfile.whiteHotMix
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
