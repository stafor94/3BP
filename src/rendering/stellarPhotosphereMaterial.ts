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

  const float STELLAR_CONVECTION_FREQUENCY = 2.6;
  const float STELLAR_WARP_FREQUENCY = 5.2;
  const float STELLAR_PRIMARY_FREQUENCY = 13.0;
  const float STELLAR_PRIMARY_SECONDARY_FREQUENCY = 21.0;
  const float STELLAR_FINE_FREQUENCY = 58.0;

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

  float getStellarNormalPixelFootprint(vec3 objectNormal) {
    vec3 normalWidth = fwidth(objectNormal);
    return max(max(normalWidth.x, normalWidth.y), max(normalWidth.z, 0.000001));
  }

  float getStellarFeaturePixels(float normalPixelFootprint, float frequency) {
    return 1.0 / max(normalPixelFootprint * frequency, 0.0001);
  }

  float drawStellarSurfaceVariation(vec3 objectNormal) {
    vec3 seedOffset = vec3(
      uSurfaceSeed * 0.051 + uSurfaceVariant * 2.17,
      uSurfaceSeed * 0.089 - uSurfaceVariant * 1.61,
      uSurfaceSeed * 0.137 + uSurfaceVariant * 1.31
    );

    float normalPixelFootprint = getStellarNormalPixelFootprint(objectNormal);
    float convectionPixels = getStellarFeaturePixels(
      normalPixelFootprint,
      STELLAR_CONVECTION_FREQUENCY
    );
    float primaryPixels = getStellarFeaturePixels(
      normalPixelFootprint,
      STELLAR_PRIMARY_FREQUENCY
    );
    float secondaryPixels = getStellarFeaturePixels(
      normalPixelFootprint,
      STELLAR_PRIMARY_SECONDARY_FREQUENCY
    );
    float finePixels = getStellarFeaturePixels(
      normalPixelFootprint,
      STELLAR_FINE_FREQUENCY
    );
    float convectionLod = mix(
      0.84,
      1.0,
      smoothstep(0.55, 1.80, convectionPixels)
    );
    // The primary pair is deliberately mid-scale: at the production mobile
    // tracking diameter it still spans several pixels instead of disappearing
    // and leaving only unresolved fine noise. Fine breakup remains conservative
    // so it cannot shimmer or turn the smooth value field into cell boundaries.
    float primaryLod = smoothstep(0.48, 1.45, primaryPixels);
    float secondaryLod = smoothstep(0.58, 1.65, secondaryPixels);
    float fineLod = smoothstep(1.85, 4.20, finePixels);

    float convectionA = valueNoise(
      objectNormal * STELLAR_CONVECTION_FREQUENCY + seedOffset * 0.41
    );
    float convectionB = valueNoise(
      objectNormal.yzx * STELLAR_CONVECTION_FREQUENCY -
      seedOffset * 0.29 +
      vec3(3.17, -5.31, 1.93)
    );
    float convection = mix(convectionA, convectionB, 0.38);
    float convectionEvolution = 1.0 + 0.014 * sin(
      uTime * 0.0031 + uSurfaceSeed * 0.009
    );

    // A small, low-frequency coordinate distortion breaks the interpolation
    // lattice without defining cells or edges. It is static in surface space;
    // time only changes amplitudes below, so detail never slides over the star.
    float warpA = valueNoise(
      objectNormal * STELLAR_WARP_FREQUENCY +
      seedOffset * 0.23 +
      vec3(-4.7, 2.1, 6.3)
    );
    float warpB = valueNoise(
      objectNormal.zxy * (STELLAR_WARP_FREQUENCY * 1.13) -
      seedOffset * 0.19 +
      vec3(1.8, 7.4, -3.2)
    );
    vec3 warpVector = vec3(
      warpA - 0.5,
      warpB - 0.5,
      (warpA - warpB) * 0.72
    );
    vec3 warpedNormal = normalize(objectNormal + warpVector * 0.075);

    // Primary granulation is a decorrelated signed band assembled from several
    // nearby scales. No sample encodes a nearest point, boundary distance, or
    // closed edge; dark structure is only the natural trough of this field.
    float primaryA = valueNoise(
      warpedNormal * STELLAR_PRIMARY_FREQUENCY +
      seedOffset * 0.79 +
      vec3(-2.7, 4.1, 7.3)
    );
    float primaryB = valueNoise(
      warpedNormal.zxy * STELLAR_PRIMARY_SECONDARY_FREQUENCY -
      seedOffset * 0.67 +
      vec3(6.4, 1.8, -3.9)
    );
    float primaryC = valueNoise(
      warpedNormal.yzx * (STELLAR_PRIMARY_FREQUENCY * 1.24) +
      seedOffset * 0.53 +
      vec3(8.6, -6.1, 2.7)
    );
    float primaryLow = (primaryA - 0.5) * 0.58 * primaryLod;
    float primaryHigh = (primaryB - 0.5) * 0.42 * secondaryLod;
    float primaryCross = (primaryC - 0.5) * 0.38 * secondaryLod;
    float primaryGranulation = primaryLow - primaryHigh + primaryCross;
    primaryGranulation +=
      (primaryA - 0.5) * (primaryC - 0.5) * 0.18 * secondaryLod;
    float primaryEvolution = 1.0 + 0.012 * sin(
      uTime * 0.0043 + uSurfaceSeed * 0.011 + 0.7
    );

    float fineBreakup = valueNoise(
      warpedNormal.yzx * STELLAR_FINE_FREQUENCY -
      seedOffset * 0.57 +
      vec3(9.2, -1.4, 5.6)
    );

    float convectionVariation =
      (convection - 0.5) * 0.052 * convectionLod * convectionEvolution;
    float resolvedGranulationBoost = mix(1.18, 1.62, secondaryLod);
    float primaryVariation =
      primaryGranulation * 0.132 * primaryEvolution * resolvedGranulationBoost;
    float fineVariation =
      (fineBreakup - 0.5) * 0.003 * fineLod;
    float variation =
      convectionVariation +
      primaryVariation +
      fineVariation;

    return clamp(1.0 + variation * uDetailStrength, 0.86, 1.14);
  }

  float drawStellarEmission(float viewMu) {
    // Keep the Pass 2 disk-average HDR budget while making the center-to-limb
    // depth more legible. The center peak is unchanged; energy is redistributed
    // out of the outer disk instead of creating a separate bright core.
    float broadDepth = pow(viewMu, 0.32);
    float centerDepth = pow(viewMu, 1.35);
    return 0.90 + broadDepth * 0.12 + centerDepth * 0.29;
  }

  float getStellarDetailEnvelope(float viewMu) {
    // Compress granulation across a broad grazing-angle range, not only at the
    // last few silhouette pixels. This preserves center/mid structure while
    // preventing projection-compressed texture from becoming denser at the limb.
    // A nonzero floor keeps the transition plasma-like rather than forming a
    // smooth radial band.
    return mix(0.32, 1.0, smoothstep(0.14, 0.72, viewMu));
  }

  float drawStellarFringe(float viewMu) {
    float fresnel = 1.0 - viewMu;
    float fringeRise = smoothstep(0.52, 0.76, fresnel);
    float fringeFall = 1.0 - smoothstep(0.94, 0.995, fresnel);
    return fringeRise * fringeFall * uRimStrength;
  }

  float getStellarEdgeCoverage(float viewMu) {
    // Restrict antialiasing to the geometric silhouette. A wide alpha ramp over
    // the already limb-darkened surface composites as a black outline.
    float viewMuWidth = min(max(fwidth(viewMu) * 0.82, 0.012), 0.075);
    return smoothstep(0.0, viewMuWidth, viewMu);
  }

  void main() {
    if (uOpacity <= 0.001) discard;

    vec3 objectNormal = normalize(vObjectNormal);
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float viewMu = max(dot(normalWorld, viewDirection), 0.0);
    float surfaceDetail = drawStellarSurfaceVariation(objectNormal);
    float emission = drawStellarEmission(viewMu);
    float detailEnvelope = getStellarDetailEnvelope(viewMu);
    float fringe = drawStellarFringe(viewMu);
    float edgeCoverage = getStellarEdgeCoverage(viewMu);

    // Mean photosphere energy is driven by the smooth center-to-limb emission.
    // Fringe contribution is intentionally tiny so it cannot become a bright
    // outline. Procedural detail stays a bounded linear/HDR modulation.
    float meanEmission = (emission + fringe * 0.22) * uEmissionStrength;
    float surfaceVariation = clamp((surfaceDetail - 1.0) * 1.08, -0.15, 0.13);
    surfaceVariation *= detailEnvelope;
    float linearIntensity = meanEmission * (1.0 + surfaceVariation);

    // Near-neutral stellar colors put all three channels on the ACES shoulder at
    // once. Reserve a bounded amount of pre-ACES headroom only for that case;
    // warm and blue-biased stars retain the existing intensity calibration.
    float identityChannelFloor = min(min(uIdentityColor.r, uIdentityColor.g), uIdentityColor.b);
    float neutralHue01 = smoothstep(0.50, 0.78, identityChannelFloor);
    linearIntensity *= mix(1.0, 0.72, neutralHue01);

    // Recover only a small amount of surface contrast lost to the ACES shoulder;
    // no topology-producing signal is introduced here.
    linearIntensity *= 1.0 + surfaceVariation * 0.08;
    vec3 color = uIdentityColor * linearIntensity;

    // White-hot treatment is a very small pre-ACES center desaturation, not an
    // independent white disk. Narrowing and reducing it preserves temperature ID.
    float whiteHotCore = pow(viewMu, 22.0) * uWhiteHotMix * 0.72;
    float peak = max(max(color.r, color.g), color.b);
    color = mix(color, vec3(peak), whiteHotCore);

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
  nextUniforms.uWhiteHotMix ??= { value: 0 }
  nextUniforms.uSurfaceVariant ??= { value: 0.5 }
  return nextUniforms
}

export function createStellarPhotosphereMaterialValues(values: Record<string, any>) {
  return {
    ...values,
    fragmentShader: stellarPhotosphereFragmentShader,
    uniforms: createStellarUniforms(values.uniforms ?? {}),
    alphaToCoverage: true,
  }
}

export function configureStellarPhotosphereMaterial(material: THREE.ShaderMaterial) {
  material.fragmentShader = stellarPhotosphereFragmentShader
  material.uniforms = createStellarUniforms(material.uniforms)
  material.alphaToCoverage = true
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
  // Keep the mid-scale convection readable at ordinary mobile tracking size;
  // fine detail is separately derivative-gated in the shader.
  if (material.uniforms.uDetailStrength) material.uniforms.uDetailStrength.value = 2.65
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
