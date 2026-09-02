import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import {
  getStellarComputedProperties,
  getStellarDisplayColorFromBody,
  getStellarDisplayColorFromTemperature,
  getStellarSurfaceTemperatureFromBody,
  mixStellarDisplayColors,
} from '../starColors'
import { getAtmospherePreset, getResolvedSurfaceProfile } from '../surfacePresets'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'
import { getStellarRenderProfile } from './stellarRenderProfile'

export { getCollisionEffectProfile } from './collisionEffectProfile'
export type { CollisionEffectProfile } from './collisionEffectProfile'

const MAX_STAR_LIGHTS = 6
const FRAGMENT_VISUAL_MIN_RADIUS = 0.022
const STELLAR_VISUAL_MIN_RADIUS = 0.025
const EFFECT_MESH_EPSILON = 0.0001
const trailColorScratch = new THREE.Color()
const outerHaloColorScratch = new THREE.Color()
const whiteColor = new THREE.Color('#ffffff')

let installed = false
let bodyBySeed = new Map<string, BodyState>()
let lightingStars: BodyState[] = []
const stellarHeatClock = new Map<string, { token: string; startedAt: number }>()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

type StellarGlowLayer = 'inner' | 'outer'
type StellarGlowUniformState = {
  uStellarGlowTime: { value: number }
  uStellarGlowSeed: { value: number }
  uStellarGlowLayer: { value: number }
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

function getResolvedStellarColor(body: BodyState) {
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

type CollisionEffectsLayer = ReturnType<typeof createCollisionEffectsLayer>
const collisionEffectsByScene = new WeakMap<THREE.Scene, CollisionEffectsLayer>()
const collisionEffectScenesByRenderer = new WeakMap<THREE.WebGLRenderer, Set<THREE.Scene>>()

function getBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 1000
}

function seedKey(seed: number) {
  return seed.toFixed(8)
}

function isBodyShader(values: Record<string, any> | undefined) {
  return Boolean(
    values?.uniforms?.uSeed &&
    typeof values?.fragmentShader === 'string' &&
    values.fragmentShader.includes('drawBodyEmission'),
  )
}

const litBodyFragmentShader = `
  uniform vec3 uIdentityColor;
  uniform vec3 uSecondaryColor;
  uniform vec3 uPolarColor;
  uniform float uSeed;
  uniform float uSurfaceSeed;
  uniform float uTime;
  uniform float uDetailStrength;
  uniform float uRimStrength;
  uniform float uOpacity;
  uniform float uSelfLuminous;
  uniform float uEmissionStrength;
  uniform float uWhiteHotMix;
  uniform float uBodyKind;
  uniform float uSpecularStrength;
  uniform float uSpecularPower;
  uniform float uAmbientStrength;
  uniform float uTerminatorPower;
  uniform float uAtmosphereStrength;
  uniform float uBandStrength;
  uniform float uCraterStrength;
  uniform float uCloudStrength;
  uniform float uSurfaceVariant;
  uniform int uLightCount;
  uniform vec3 uLightPositions[${MAX_STAR_LIGHTS}];
  uniform vec3 uLightColors[${MAX_STAR_LIGHTS}];
  uniform float uLightStrengths[${MAX_STAR_LIGHTS}];

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

  float drawBodySurfaceDetail(vec3 objectNormal) {
    vec3 seedOffset = vec3(
      uSurfaceSeed * 0.071 + uSurfaceVariant * 2.71,
      uSurfaceSeed * 0.113 - uSurfaceVariant * 1.83,
      uSurfaceSeed * 0.157 + uSurfaceVariant * 1.19
    );
    float broad = valueNoise(objectNormal * 3.4 + seedOffset);
    float medium = valueNoise(objectNormal * 7.2 - seedOffset * 1.1);
    float fine = valueNoise(objectNormal * 15.5 + seedOffset * 2.2);
    float bands = 0.5 + 0.5 * sin((objectNormal.y * 6.8 + broad * 0.75 + uSurfaceSeed * 0.013) * 6.2831853);
    float variation;

    if (uBodyKind < 0.5) {
      variation =
        (broad - 0.5) * 0.095 +
        (medium - 0.5) * 0.04 +
        (bands - 0.5) * 0.018;
    } else if (uBodyKind < 1.5) {
      variation =
        (broad - 0.5) * 0.17 +
        (medium - 0.5) * 0.08 +
        (bands - 0.5) * 0.08 * uBandStrength;
    } else if (uBodyKind < 2.5) {
      variation =
        (broad - 0.5) * 0.16 +
        (fine - 0.5) * 0.1;
    } else {
      variation =
        (broad - 0.5) * 0.24 +
        (medium - 0.5) * 0.15 +
        (fine - 0.5) * 0.1;
    }

    return clamp(1.0 + variation * uDetailStrength, 0.48, 1.28);
  }

  vec3 drawNonStellarAlbedo(vec3 objectNormal, float surfaceDetail) {
    vec3 seedOffset = vec3(
      uSurfaceSeed * 0.043 + uSurfaceVariant * 3.13,
      uSurfaceSeed * 0.079 - uSurfaceVariant * 2.37,
      uSurfaceSeed * 0.131 + uSurfaceVariant * 1.67
    );
    float broad = valueNoise(objectNormal * 2.9 + seedOffset);
    float medium = valueNoise(objectNormal * 6.4 - seedOffset * 0.8);
    float fine = valueNoise(objectNormal * 17.0 + seedOffset * 1.4);
    float bandWave = 0.5 + 0.5 * sin(
      objectNormal.y * (18.0 + uSurfaceVariant * 8.0) +
      broad * 3.2 +
      uSurfaceSeed * 0.07
    );
    float terrain = clamp(broad * 0.63 + medium * 0.27 + fine * 0.1, 0.0, 1.0);
    terrain = clamp(terrain + (bandWave - 0.5) * uBandStrength * 0.82, 0.0, 1.0);
    vec3 albedo = mix(uIdentityColor, uSecondaryColor, smoothstep(0.27, 0.78, terrain));

    float polar = smoothstep(0.58, 0.94, abs(objectNormal.y));
    albedo = mix(albedo, uPolarColor, polar * (0.34 + 0.38 * uCloudStrength));

    float craterSeed = medium * 0.58 + fine * 0.42;
    float craters = smoothstep(0.77, 0.965, craterSeed) * uCraterStrength;
    float craterRim = smoothstep(0.67, 0.79, craterSeed) * (1.0 - smoothstep(0.79, 0.92, craterSeed));
    albedo *= 1.0 - craters * 0.38;
    albedo += uPolarColor * craterRim * uCraterStrength * 0.07;

    float cloudField = smoothstep(0.66, 0.9, medium * 0.68 + fine * 0.32);
    float clouds = cloudField * uCloudStrength;
    albedo = mix(albedo, vec3(0.92, 0.96, 1.0), clouds * 0.58);

    return albedo * surfaceDetail;
  }

  float drawBodyEmission(vec3 worldNormal, vec3 viewDirection) {
    float limb = max(dot(worldNormal, viewDirection), 0.0);
    float limbDarkening = 0.74 + 0.26 * pow(limb, 0.52);
    float centerEmission = 1.06 + 0.22 * pow(limb, 0.78);
    return limbDarkening * centerEmission;
  }

  float drawBodyRim(vec3 worldNormal, vec3 viewDirection) {
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
    float rim = drawBodyRim(normalWorld, viewDirection);
    float stellarSurfaceModulation = 1.0;
    vec3 color;

    if (uSelfLuminous > 0.5) {
      float granulation = drawStellarGranulation(objectNormal);
      float emission = drawBodyEmission(normalWorld, viewDirection);
      float intensity = min((emission * granulation + rim * 0.45) * uEmissionStrength, 1.22);
      vec3 stellarColor = toneMapStellarHuePreserving(uIdentityColor * intensity);
      float granulationContrast = clamp((granulation - 1.0) * 1.75, -0.055, 0.055);
      stellarSurfaceModulation = 1.0 + granulationContrast;
      float limb = max(dot(normalWorld, viewDirection), 0.0);
      float whiteHotCore = pow(limb, 14.0) * uWhiteHotMix;
      float peak = min(0.98, max(max(stellarColor.r, stellarColor.g), stellarColor.b) + 0.055);
      color = mix(stellarColor, vec3(peak), whiteHotCore);
    } else {
      float surfaceDetail = drawBodySurfaceDetail(objectNormal);
      vec3 albedo = drawNonStellarAlbedo(objectNormal, surfaceDetail);
      vec3 litColor = albedo * uAmbientStrength;
      vec3 atmosphereLight = vec3(0.0);
      float viewFresnel = pow(1.0 - max(dot(normalWorld, viewDirection), 0.0), 3.2);

      for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
        if (i < uLightCount) {
          vec3 lightDelta = uLightPositions[i] - vWorldPosition;
          float distanceSquared = max(dot(lightDelta, lightDelta), 0.0025);
          vec3 lightDirection = normalize(lightDelta);
          float normalLight = max(dot(normalWorld, lightDirection), 0.0);
          float diffuse = pow(normalLight, uTerminatorPower);
          float attenuation = 1.0 / (1.0 + distanceSquared * 0.16);
          vec3 irradiance = uLightColors[i] * uLightStrengths[i] * attenuation;
          vec3 halfDirection = normalize(lightDirection + viewDirection);
          float specular =
            pow(max(dot(normalWorld, halfDirection), 0.0), uSpecularPower) *
            diffuse *
            uSpecularStrength;

          litColor += albedo * irradiance * diffuse;
          litColor += irradiance * specular;
          atmosphereLight += irradiance * (0.22 + diffuse * 0.78);
        }
      }

      litColor += atmosphereLight * viewFresnel * uAtmosphereStrength;
      litColor += albedo * rim * 0.16;
      color = min(litColor, vec3(1.24));
    }

    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    if (uSelfLuminous > 0.5) {
      gl_FragColor.rgb *= stellarSurfaceModulation;
    }
    #include <colorspace_fragment>
  }
`

function setSurfaceProfile(material: THREE.ShaderMaterial, body: BodyState) {
  const bodyType = getEffectiveBodyType(body)
  const identityColor = material.uniforms.uIdentityColor.value as THREE.Color
  const secondaryColor = material.uniforms.uSecondaryColor.value as THREE.Color
  const polarColor = material.uniforms.uPolarColor.value as THREE.Color

  if (bodyType === 'star') {
    const resolved = getResolvedStellarColor(body)
    identityColor.set(resolved)
    secondaryColor.set(resolved)
    polarColor.set(resolved)
    material.uniforms.uBodyKind.value = 0
    material.uniforms.uDetailStrength.value = 1
    material.uniforms.uRimStrength.value = 0.045
    material.uniforms.uSpecularStrength.value = 0
    material.uniforms.uSpecularPower.value = 32
    material.uniforms.uAmbientStrength.value = 0
    material.uniforms.uTerminatorPower.value = 1
    material.uniforms.uAtmosphereStrength.value = 0
    material.uniforms.uBandStrength.value = 0
    material.uniforms.uCraterStrength.value = 0
    material.uniforms.uCloudStrength.value = 0
    material.uniforms.uSurfaceVariant.value = body.stellarEvolutionPhase01 ?? 0.5
    return
  }

  if (bodyType === 'planet' || bodyType === 'moon' || bodyType === 'fragment') {
    const profile = getResolvedSurfaceProfile(body, bodyType)
    const atmosphere = getAtmospherePreset(body.atmospherePresetId ?? profile.defaultAtmosphere)
    identityColor.set(profile.baseColor)
    secondaryColor.set(profile.secondaryColor)
    polarColor.set(profile.polarTint)
    material.uniforms.uBodyKind.value = bodyType === 'planet' ? 1 : bodyType === 'moon' ? 2 : 3
    material.uniforms.uDetailStrength.value = profile.detailStrength
    material.uniforms.uRimStrength.value = bodyType === 'planet' ? 0.026 : bodyType === 'moon' ? 0.012 : 0.008
    material.uniforms.uSpecularStrength.value = profile.specularStrength
    material.uniforms.uSpecularPower.value = profile.specularPower
    material.uniforms.uAmbientStrength.value = profile.ambientStrength
    material.uniforms.uTerminatorPower.value = profile.terminatorPower
    material.uniforms.uAtmosphereStrength.value = profile.atmosphereStrength * atmosphere.strengthMultiplier
    material.uniforms.uBandStrength.value = profile.bandStrength
    material.uniforms.uCraterStrength.value = profile.craterStrength
    material.uniforms.uCloudStrength.value = profile.cloudStrength
    material.uniforms.uSurfaceVariant.value = body.surfaceVariant01 ?? 0.5
    return
  }

  identityColor.set(body.color)
  secondaryColor.set(body.color)
  polarColor.set(body.color)
  material.uniforms.uBodyKind.value = 4
}

function getTrailDisplayColor(body: BodyState) {
  const bodyType = getEffectiveBodyType(body)
  if (bodyType === 'star') return getResolvedStellarColor(body)
  if (bodyType === 'planet' || bodyType === 'moon' || bodyType === 'fragment') {
    return getResolvedSurfaceProfile(body, bodyType).baseColor
  }
  return body.color
}

function updateTrailColor(scene: THREE.Scene, objectIndex: number, body: BodyState) {
  trailColorScratch.set(getTrailDisplayColor(body))
  const trailPoints = scene.children[objectIndex - 3]
  const trailRibbon = scene.children[objectIndex - 4]

  if (trailPoints instanceof THREE.Points && trailPoints.material instanceof THREE.ShaderMaterial) {
    const uniform = trailPoints.material.uniforms.uColor
    if (uniform?.value instanceof THREE.Color) uniform.value.copy(trailColorScratch)
  }

  if (trailRibbon instanceof THREE.Mesh && trailRibbon.material instanceof THREE.ShaderMaterial) {
    const uniform = trailRibbon.material.uniforms.uColor
    if (uniform?.value instanceof THREE.Color) uniform.value.copy(trailColorScratch)
  }
}

function configureStellarGlowMaterial(
  material: THREE.SpriteMaterial,
  layer: StellarGlowLayer,
  seed: number,
  timeSeconds: number,
) {
  if (material.blending !== THREE.NormalBlending) {
    material.blending = THREE.NormalBlending
    material.needsUpdate = true
  }

  material.userData.stellarGlowTime = timeSeconds
  material.userData.stellarGlowSeed = seed
  material.userData.stellarGlowLayer = layer === 'outer' ? 1 : 0

  if (!material.userData.stellarGlowShaderInstalled) {
    material.userData.stellarGlowShaderInstalled = true
    material.onBeforeCompile = (shader) => {
      const uniforms: StellarGlowUniformState = {
        uStellarGlowTime: { value: material.userData.stellarGlowTime ?? 0 },
        uStellarGlowSeed: { value: material.userData.stellarGlowSeed ?? 0 },
        uStellarGlowLayer: { value: material.userData.stellarGlowLayer ?? 0 },
      }
      shader.uniforms.uStellarGlowTime = uniforms.uStellarGlowTime
      shader.uniforms.uStellarGlowSeed = uniforms.uStellarGlowSeed
      shader.uniforms.uStellarGlowLayer = uniforms.uStellarGlowLayer
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uStellarGlowTime;
          uniform float uStellarGlowSeed;
          uniform float uStellarGlowLayer;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 stellarGlowDelta = vMapUv - vec2(0.5);
          float stellarGlowRadius = min(length(stellarGlowDelta) * 2.0, 1.5);
          float stellarGlowAngle = atan(stellarGlowDelta.y, stellarGlowDelta.x);
          float stellarOuter = step(0.5, uStellarGlowLayer);
          float stellarEdgeWeight = smoothstep(0.12, 0.98, stellarGlowRadius);
          float stellarAngularA = sin(
            stellarGlowAngle * 5.0 +
            uStellarGlowSeed * 0.071 +
            uStellarGlowTime * 0.025
          );
          float stellarAngularB = sin(
            stellarGlowAngle * 9.0 -
            uStellarGlowSeed * 0.113 -
            uStellarGlowTime * 0.018
          );
          float stellarVariation = mix(
            stellarAngularA * 0.026,
            stellarAngularA * 0.065 + stellarAngularB * 0.035,
            stellarOuter
          );
          diffuseColor.a *= clamp(
            1.0 + stellarVariation * stellarEdgeWeight,
            0.88,
            1.12
          );
          float stellarInnerLift =
            (1.0 - stellarOuter) *
            (1.0 - smoothstep(0.08, 0.62, stellarGlowRadius)) *
            0.045;
          diffuseColor.rgb *= 1.0 + stellarInnerLift;`,
        )
      material.userData.stellarGlowUniforms = uniforms
    }
    material.needsUpdate = true
  }

  const uniforms = material.userData.stellarGlowUniforms as StellarGlowUniformState | undefined
  if (uniforms) {
    uniforms.uStellarGlowTime.value = timeSeconds
    uniforms.uStellarGlowSeed.value = seed
    uniforms.uStellarGlowLayer.value = layer === 'outer' ? 1 : 0
  }
}

function setBodyGlowVisibility(
  scene: THREE.Scene,
  objectIndex: number,
  visible: boolean,
  body?: BodyState,
  stellarColor?: string,
) {
  const glowInner = scene.children[objectIndex - 1]
  const glowOuter = scene.children[objectIndex - 2]

  if (!visible || !body || !stellarColor) {
    if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
      glowInner.visible = false
      glowInner.material.opacity = 0
    }
    if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
      glowOuter.visible = false
      glowOuter.material.opacity = 0
    }
    return
  }

  const properties = getStellarComputedProperties(body)
  const renderProfile = getStellarRenderProfile(
    properties.luminositySolar,
    properties.surfaceTemperatureK,
  )
  const renderRadius = Math.max(body.radius, STELLAR_VISUAL_MIN_RADIUS)
  const visualTimeSeconds = (nowMs() * 0.001) % 4096
  const glowSeed = getBodySeed(body.id)

  if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
    configureStellarGlowMaterial(glowInner.material, 'inner', glowSeed, visualTimeSeconds)
    glowInner.visible = true
    glowInner.material.color.set(stellarColor)
    glowInner.material.opacity = Math.min(0.49, renderProfile.innerGlowOpacity * 1.07)
    glowInner.scale.setScalar(renderRadius * renderProfile.innerGlowScale)
  }

  if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
    configureStellarGlowMaterial(glowOuter.material, 'outer', glowSeed, visualTimeSeconds)
    glowOuter.visible = true
    outerHaloColorScratch.set(stellarColor).lerp(whiteColor, renderProfile.outerHaloWhiteMix)
    glowOuter.material.color.copy(outerHaloColorScratch)
    glowOuter.material.opacity = renderProfile.outerGlowOpacity
    glowOuter.scale.setScalar(renderRadius * renderProfile.outerGlowScale)
  }
}

function syncBodyPresentationBeforeRender(scene: THREE.Scene) {
  scene.children.forEach((object, objectIndex) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) return
    const seed = object.material.uniforms.uSeed?.value
    if (typeof seed !== 'number') return
    const body = bodyBySeed.get(seedKey(seed))
    if (!body) return

    const bodyType = getEffectiveBodyType(body)
    const stellarColor = bodyType === 'star' ? getResolvedStellarColor(body) : undefined
    setSurfaceProfile(object.material, body)
    if (objectIndex >= 2) {
      setBodyGlowVisibility(
        scene,
        objectIndex,
        bodyType === 'star',
        bodyType === 'star' ? body : undefined,
        stellarColor,
      )
    }
    if (bodyType !== 'effect' && objectIndex >= 4) updateTrailColor(scene, objectIndex, body)
  })
}

function updateBodyLighting(material: THREE.ShaderMaterial, scene: THREE.Scene, object: THREE.Object3D) {
  const seed = material.uniforms.uSeed?.value
  if (typeof seed !== 'number') return

  const body = bodyBySeed.get(seedKey(seed))
  if (!body) return

  const bodyType = getEffectiveBodyType(body)
  const isStar = bodyType === 'star'
  const isEffect = bodyType === 'effect'
  const selfLuminous = isStar || isEffect
  const renderTimeSeconds = (nowMs() * 0.001) % 4096

  let emissionStrength = 0
  let whiteHotMix = 0
  let effectOpacity = 1

  setSurfaceProfile(material, body)

  if (isStar) {
    const properties = getStellarComputedProperties(body)
    const renderProfile = getStellarRenderProfile(
      properties.luminositySolar,
      properties.surfaceTemperatureK,
    )
    emissionStrength = renderProfile.photosphereIntensity
    whiteHotMix = renderProfile.whiteHotMix
  } else if (bodyType === 'fragment') {
    object.scale.setScalar(Math.max(body.radius, FRAGMENT_VISUAL_MIN_RADIUS))
  } else if (isEffect) {
    emissionStrength = 0
    effectOpacity = 0
    object.scale.setScalar(EFFECT_MESH_EPSILON)
  }

  material.uniforms.uSelfLuminous.value = selfLuminous ? 1 : 0
  material.uniforms.uEmissionStrength.value = emissionStrength
  material.uniforms.uWhiteHotMix.value = whiteHotMix
  material.uniforms.uTime.value = isStar ? renderTimeSeconds : 0
  material.uniforms.uLightCount.value = lightingStars.length
  if (isEffect && material.uniforms.uOpacity) material.uniforms.uOpacity.value = effectOpacity

  const lightPositions = material.uniforms.uLightPositions.value as THREE.Vector3[]
  const lightColors = material.uniforms.uLightColors.value as THREE.Color[]
  const lightStrengths = material.uniforms.uLightStrengths.value as number[]

  for (let index = 0; index < MAX_STAR_LIGHTS; index += 1) {
    const star = lightingStars[index]
    if (!star) {
      lightPositions[index].set(0, 0, 0)
      lightColors[index].setRGB(0, 0, 0)
      lightStrengths[index] = 0
      continue
    }

    const properties = getStellarComputedProperties(star)
    lightPositions[index].set(star.position.x, star.position.y, star.position.z)
    lightColors[index].set(getResolvedStellarColor(star))
    lightStrengths[index] = Math.min(
      5.2,
      0.78 + Math.log2(1 + Math.max(properties.luminositySolar, 0)) * 0.34,
    )
  }

  const objectIndex = scene.children.indexOf(object)
  if (objectIndex >= 2) {
    setBodyGlowVisibility(
      scene,
      objectIndex,
      isStar,
      isStar ? body : undefined,
      isStar ? getResolvedStellarColor(body) : undefined,
    )
    if (!isEffect && objectIndex >= 4) updateTrailColor(scene, objectIndex, body)
  }
}

function installCollisionEffectRenderHook() {
  const rendererPrototype = THREE.WebGLRenderer.prototype as any
  const originalRender = rendererPrototype.render
  const originalDispose = rendererPrototype.dispose

  rendererPrototype.render = function renderWithCollisionEffects(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ) {
    if (scene instanceof THREE.Scene) {
      syncBodyPresentationBeforeRender(scene)

      let layer = collisionEffectsByScene.get(scene)
      if (!layer) {
        layer = createCollisionEffectsLayer(scene)
        collisionEffectsByScene.set(scene, layer)
      }

      let scenes = collisionEffectScenesByRenderer.get(this as THREE.WebGLRenderer)
      if (!scenes) {
        scenes = new Set<THREE.Scene>()
        collisionEffectScenesByRenderer.set(this as THREE.WebGLRenderer, scenes)
      }
      scenes.add(scene)
      layer.update(Array.from(bodyBySeed.values()), camera)
    }

    return originalRender.call(this, scene, camera)
  }

  rendererPrototype.dispose = function disposeWithCollisionEffects() {
    const renderer = this as THREE.WebGLRenderer
    const scenes = collisionEffectScenesByRenderer.get(renderer)
    scenes?.forEach((scene) => {
      collisionEffectsByScene.get(scene)?.dispose()
      collisionEffectsByScene.delete(scene)
    })
    collisionEffectScenesByRenderer.delete(renderer)
    return originalDispose.call(this)
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

export function syncBodyLightingState(bodies: BodyState[]) {
  const activeBodyIds = new Set(bodies.map((body) => body.id))
  Array.from(stellarHeatClock.keys()).forEach((id) => {
    if (!activeBodyIds.has(id)) stellarHeatClock.delete(id)
  })

  const previousBodies = Array.from(bodyBySeed.values())
  const presentationBodies = bodies.map((body) => inheritMergedStellarEvolution(body, previousBodies))
  const nextBodyBySeed = new Map<string, BodyState>()
  presentationBodies.forEach((body) => nextBodyBySeed.set(seedKey(getBodySeed(body.id)), body))
  bodyBySeed = nextBodyBySeed
  lightingStars = presentationBodies
    .filter((body) => getEffectiveBodyType(body) === 'star')
    .slice(0, MAX_STAR_LIGHTS)
}

export function installBodyLighting() {
  if (installed) return
  installed = true

  const shaderPrototype = THREE.ShaderMaterial.prototype as any
  const originalSetValues = shaderPrototype.setValues

  shaderPrototype.setValues = function setLightingAwareShaderValues(values: Record<string, any>) {
    if (!isBodyShader(values)) return originalSetValues.call(this, values)

    const nextValues = {
      ...values,
      fragmentShader: litBodyFragmentShader,
      uniforms: {
        ...values.uniforms,
        uSurfaceSeed: { value: values.uniforms.uSeed.value },
        uTime: { value: 0 },
        uSecondaryColor: { value: new THREE.Color('#ffffff') },
        uPolarColor: { value: new THREE.Color('#ffffff') },
        uSelfLuminous: { value: 1 },
        uEmissionStrength: { value: 1 },
        uWhiteHotMix: { value: 0 },
        uBodyKind: { value: 0 },
        uSpecularStrength: { value: 0 },
        uSpecularPower: { value: 32 },
        uAmbientStrength: { value: 0.05 },
        uTerminatorPower: { value: 1 },
        uAtmosphereStrength: { value: 0 },
        uBandStrength: { value: 0 },
        uCraterStrength: { value: 0 },
        uCloudStrength: { value: 0 },
        uSurfaceVariant: { value: 0.5 },
        uLightCount: { value: 0 },
        uLightPositions: {
          value: Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3()),
        },
        uLightColors: {
          value: Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0, 0, 0)),
        },
        uLightStrengths: {
          value: Array.from({ length: MAX_STAR_LIGHTS }, () => 0),
        },
      },
    }

    const result = originalSetValues.call(this, nextValues)
    this.onBeforeRender = (
      _renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      _camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      object: THREE.Object3D,
    ) => {
      updateBodyLighting(this as THREE.ShaderMaterial, scene, object)
    }
    return result
  }

  installCollisionEffectRenderHook()
}
