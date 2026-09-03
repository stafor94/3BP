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

  const float STELLAR_CONVECTION_FREQUENCY = 2.7;
  const float STELLAR_GRANULE_FREQUENCY = 7.2;
  const float STELLAR_FINE_FREQUENCY = 21.0;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
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

  vec4 sampleStellarCellular(vec3 p, vec3 seedOffset) {
    vec3 lattice = floor(p);
    vec3 local = fract(p);
    float nearestDistanceSq = 9.0;
    float secondDistanceSq = 9.0;
    float nearestHeat = 0.5;
    float secondHeat = 0.5;

    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 neighbor = vec3(float(x), float(y), float(z));
          vec3 cell = lattice + neighbor;
          vec3 jitter = 0.10 + hash33(cell + seedOffset) * 0.80;
          vec3 delta = neighbor + jitter - local;
          float heat = hash31(cell + seedOffset * 1.73 + vec3(7.31, -3.17, 5.83));
          float cellSizeScale = 0.88 + heat * 0.28;
          float distanceSq = dot(delta, delta) / (cellSizeScale * cellSizeScale);

          if (distanceSq < nearestDistanceSq) {
            secondDistanceSq = nearestDistanceSq;
            secondHeat = nearestHeat;
            nearestDistanceSq = distanceSq;
            nearestHeat = heat;
          } else if (distanceSq < secondDistanceSq) {
            secondDistanceSq = distanceSq;
            secondHeat = heat;
          }
        }
      }
    }

    return vec4(
      sqrt(nearestDistanceSq),
      sqrt(secondDistanceSq),
      nearestHeat,
      secondHeat
    );
  }

  float getStellarNormalPixelFootprint(vec3 objectNormal) {
    vec3 normalWidth = fwidth(objectNormal);
    return max(max(normalWidth.x, normalWidth.y), max(normalWidth.z, 0.000001));
  }

  float getStellarFeaturePixels(float normalPixelFootprint, float frequency) {
    return 1.0 / max(normalPixelFootprint * frequency, 0.0001);
  }

  float drawIntergranularLane(vec4 cellular, float laneLod) {
    float boundaryDistance = max(cellular.y - cellular.x, 0.0);
    float lanePixelWidth = min(fwidth(boundaryDistance) * 0.35, 0.035);
    float laneInner = max(0.0, 0.012 - lanePixelWidth * 0.35);
    float laneOuter = 0.075 + lanePixelWidth;
    float lane = 1.0 - smoothstep(laneInner, laneOuter, boundaryDistance);
    float mergeAffinity = 1.0 - smoothstep(0.060, 0.25, abs(cellular.z - cellular.w));
    return lane * mix(1.0, 0.20, mergeAffinity) * laneLod;
  }

  float drawStellarGranulation(vec3 objectNormal) {
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
    float granulePixels = getStellarFeaturePixels(
      normalPixelFootprint,
      STELLAR_GRANULE_FREQUENCY
    );
    float finePixels = getStellarFeaturePixels(
      normalPixelFootprint,
      STELLAR_FINE_FREQUENCY
    );
    float convectionLod = mix(
      0.72,
      1.0,
      smoothstep(0.65, 2.40, convectionPixels)
    );
    float granuleLod = smoothstep(0.90, 2.35, granulePixels);
    float laneLod = smoothstep(1.35, 3.25, granulePixels);
    float fineLod = smoothstep(1.15, 2.65, finePixels);

    float convection = valueNoise(
      objectNormal * STELLAR_CONVECTION_FREQUENCY + seedOffset * 0.41
    );
    float convectionBreath = 1.0 + 0.025 * sin(
      uTime * 0.0035 + uSurfaceSeed * 0.009
    );

    vec4 cellular = sampleStellarCellular(
      objectNormal * STELLAR_GRANULE_FREQUENCY + seedOffset * 0.97,
      seedOffset * 1.19 + vec3(11.7, -4.3, 6.9)
    );
    float boundaryDistance = max(cellular.y - cellular.x, 0.0);
    float granuleInterior = smoothstep(0.030, 0.17, boundaryDistance);
    float granuleCenter = 1.0 - smoothstep(0.30, 0.74, cellular.x);
    float intergranularLane = drawIntergranularLane(cellular, laneLod);
    float cellThermalBias = cellular.z - 0.5;
    float cellPulse = 0.5 + 0.5 * sin(
      uTime * 0.009 +
      cellular.z * 6.2831853 +
      uSurfaceSeed * 0.021
    );

    float fineBreakup = valueNoise(
      objectNormal * STELLAR_FINE_FREQUENCY - seedOffset * 0.57
    );
    float fineBreath = 1.0 + 0.015 * sin(
      uTime * 0.0055 + uSurfaceSeed * 0.013 + 1.1
    );

    float convectionVariation =
      (convection - 0.5) * 0.035 * convectionLod * convectionBreath;
    float granuleVariation = (
      (granuleInterior - 0.56) * 0.064 +
      granuleCenter * 0.016 +
      cellThermalBias * 0.010
    ) * granuleLod - intergranularLane * 0.075;
    float fineVariation =
      (fineBreakup - 0.5) * 0.008 * fineLod * fineBreath;
    float temporalVariation =
      (cellPulse - 0.5) * granuleInterior * 0.006 * granuleLod;
    float variation =
      convectionVariation +
      granuleVariation +
      fineVariation +
      temporalVariation;

    return clamp(1.0 + variation * uDetailStrength, 0.84, 1.13);
  }

  float drawStellarEmission(vec3 worldNormal, vec3 viewDirection) {
    float viewMu = max(dot(worldNormal, viewDirection), 0.0);
    float broadLimb = pow(viewMu, 0.42);
    float centerLift = pow(viewMu, 1.85);
    return 0.92 + broadLimb * 0.18 + centerLift * 0.16;
  }

  float drawStellarFringe(vec3 worldNormal, vec3 viewDirection) {
    float viewMu = max(dot(worldNormal, viewDirection), 0.0);
    float fresnel = 1.0 - viewMu;
    float fringeRise = smoothstep(0.68, 0.88, fresnel);
    float fringeFall = 1.0 - smoothstep(0.94, 0.995, fresnel);
    return fringeRise * fringeFall * uRimStrength;
  }

  float getStellarEdgeCoverage(vec3 worldNormal, vec3 viewDirection) {
    float viewMu = max(dot(worldNormal, viewDirection), 0.0);
    float viewMuWidth = min(max(fwidth(viewMu) * 1.90, 0.060), 0.28);
    return smoothstep(0.0, viewMuWidth, viewMu);
  }

  void main() {
    if (uOpacity <= 0.001) discard;

    vec3 objectNormal = normalize(vObjectNormal);
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float granulation = drawStellarGranulation(objectNormal);
    float emission = drawStellarEmission(normalWorld, viewDirection);
    float fringe = drawStellarFringe(normalWorld, viewDirection);
    float edgeCoverage = getStellarEdgeCoverage(normalWorld, viewDirection);

    // Keep mean photosphere luminance independent from cellular contrast. The
    // surface variation is applied once in linear/HDR space and then handed to
    // the renderer's single global ACES tone-mapping pass.
    float meanEmission = (emission + fringe * 0.52) * uEmissionStrength;
    float surfaceVariation = clamp((granulation - 1.0) * 0.92, -0.095, 0.075);
    float linearIntensity = meanEmission * (1.0 + surfaceVariation);

    // Near-neutral stellar colors put all three channels on the ACES shoulder at
    // once. Reserve a bounded amount of pre-ACES headroom only for that case;
    // warm and blue-biased stars retain the existing intensity calibration.
    float identityChannelFloor = min(min(uIdentityColor.r, uIdentityColor.g), uIdentityColor.b);
    float neutralHue01 = smoothstep(0.50, 0.78, identityChannelFloor);
    linearIntensity *= mix(1.0, 0.72, neutralHue01);

    // Restore a small amount of the cellular signal lost to the ACES shoulder
    // without changing granulation topology, LOD, limb, or corona parameters.
    linearIntensity *= 1.0 + surfaceVariation * 0.08;
    vec3 color = uIdentityColor * linearIntensity;

    float limb = max(dot(normalWorld, viewDirection), 0.0);
    float whiteHotCore = pow(limb, 18.0) * uWhiteHotMix;
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