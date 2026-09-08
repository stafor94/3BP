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
  uniform float uCenterHighlightStrength;
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
    // Photographic highlights carry only a minute, broad brightness variation.
    // Fade it out at gameplay size; no mid/fine granulation or contrast boost.
    float footprint = max(length(fwidth(objectNormal)), 0.000001);
    float resolved = 1.0 - smoothstep(0.012, 0.045, footprint);
    vec3 offset = vec3(uSurfaceSeed * 0.051, uSurfaceSeed * 0.089, uSurfaceVariant);
    float broad = valueNoise(objectNormal * 2.6 + offset);
    float evolution = 1.0 + 0.01 * sin(uTime * 0.0031 + uSurfaceSeed * 0.009);
    return 1.0 + (broad - 0.5) * 0.012 * resolved * evolution * uDetailStrength;
  }

  float drawStellarEmission(float viewMu) {
    // Keep the disk luminous without pushing every identity-color channel into
    // the ACES white shoulder. Radial depth must not expose a shaded sphere.
    return 0.78 + 0.22 * smoothstep(0.0, 0.75, viewMu);
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

    // Preserve temperature identity across the disk, then add a compact white-hot
    // highlight only near the projected center. This keeps the photographic core
    // while leaving the mid-disk and limb visibly warm/cool after ACES tone mapping.
    vec3 coloredEmission = uIdentityColor * linearIntensity;
    float projectedRadius = sqrt(max(1.0 - viewMu * viewMu, 0.0));
    float centerHighlightMask = exp(-pow(projectedRadius / 0.24, 2.0));
    vec3 highlightColor = mix(uIdentityColor, vec3(1.0), 0.70);
    vec3 color = coloredEmission + highlightColor * uCenterHighlightStrength * centerHighlightMask;

    gl_FragColor = vec4(color, uOpacity * edgeCoverage);
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
  nextUniforms.uCenterHighlightStrength ??= { value: 0 }
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
  // Only a faint broad variation may resolve when enlarged.
  if (material.uniforms.uDetailStrength) material.uniforms.uDetailStrength.value = 1.0
  if (material.uniforms.uRimStrength) material.uniforms.uRimStrength.value = 0.045
  if (material.uniforms.uTime) material.uniforms.uTime.value = frame.animationTimeSeconds
  if (material.uniforms.uEmissionStrength) {
    material.uniforms.uEmissionStrength.value = frame.renderProfile.photosphereIntensity
  }
  if (material.uniforms.uCenterHighlightStrength) {
    material.uniforms.uCenterHighlightStrength.value = frame.renderProfile.centerHighlightStrength
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
