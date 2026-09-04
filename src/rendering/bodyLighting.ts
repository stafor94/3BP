import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import { getAtmospherePreset, getResolvedSurfaceProfile } from '../surfacePresets'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'
import {
  STELLAR_PHOTOSPHERE_RENDER_PATH,
  configureStellarPhotosphereMaterial,
  createStellarPhotosphereMaterialValues,
  getResolvedStellarPhotosphereColor,
  getStellarPhotosphereFrame,
  isStellarPhotosphereMaterial,
  syncStellarPhotosphereState,
  updateStellarPhotosphereMaterial,
  type StellarPhotosphereFrame,
} from './stellarPhotosphereMaterial'
import { configureStellarCoronaMaterial } from './stellarCoronaMaterial'

export { getCollisionEffectProfile } from './collisionEffectProfile'
export type { CollisionEffectProfile } from './collisionEffectProfile'

const MAX_STAR_LIGHTS = 6
const FRAGMENT_VISUAL_MIN_RADIUS = 0.022
const STELLAR_VISUAL_MIN_RADIUS = 0.025
const EFFECT_MESH_EPSILON = 0.0001
const GENERIC_BODY_RENDER_PATH = 'generic-body'
const trailColorScratch = new THREE.Color()

let installed = false
let bodyBySeed = new Map<string, BodyState>()
let lightingStars: BodyState[] = []

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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

function getBodyFromSeed(seed: unknown) {
  return typeof seed === 'number' ? bodyBySeed.get(seedKey(seed)) : undefined
}

function isBodyShader(values: Record<string, any> | undefined) {
  return Boolean(
    values?.uniforms?.uSeed &&
    typeof values?.fragmentShader === 'string' &&
    values.fragmentShader.includes('drawBodyEmission'),
  )
}

const litGenericBodyFragmentShader = `
  uniform vec3 uIdentityColor;
  uniform vec3 uSecondaryColor;
  uniform vec3 uPolarColor;
  uniform float uSeed;
  uniform float uSurfaceSeed;
  uniform float uDetailStrength;
  uniform float uRimStrength;
  uniform float uOpacity;
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

  float drawBodyRim(vec3 worldNormal, vec3 viewDirection) {
    float fresnel = 1.0 - max(dot(worldNormal, viewDirection), 0.0);
    return pow(fresnel, 2.45) * uRimStrength;
  }

  void main() {
    if (uOpacity <= 0.001) discard;

    vec3 objectNormal = normalize(vObjectNormal);
    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float rim = drawBodyRim(normalWorld, viewDirection);
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
    vec3 color = min(litColor, vec3(1.24));

    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function createGenericBodyUniforms(uniforms: Record<string, any>) {
  const nextUniforms = { ...uniforms }
  delete nextUniforms.uTime
  delete nextUniforms.uEmissionStrength
  delete nextUniforms.uWhiteHotMix

  const seed = typeof uniforms.uSeed?.value === 'number' ? uniforms.uSeed.value : 0
  nextUniforms.uSurfaceSeed ??= { value: seed }
  nextUniforms.uSecondaryColor ??= { value: new THREE.Color('#ffffff') }
  nextUniforms.uPolarColor ??= { value: new THREE.Color('#ffffff') }
  nextUniforms.uBodyKind ??= { value: 0 }
  nextUniforms.uSpecularStrength ??= { value: 0 }
  nextUniforms.uSpecularPower ??= { value: 32 }
  nextUniforms.uAmbientStrength ??= { value: 0.05 }
  nextUniforms.uTerminatorPower ??= { value: 1 }
  nextUniforms.uAtmosphereStrength ??= { value: 0 }
  nextUniforms.uBandStrength ??= { value: 0 }
  nextUniforms.uCraterStrength ??= { value: 0 }
  nextUniforms.uCloudStrength ??= { value: 0 }
  nextUniforms.uSurfaceVariant ??= { value: 0.5 }
  nextUniforms.uLightCount ??= { value: 0 }
  nextUniforms.uLightPositions ??= {
    value: Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Vector3()),
  }
  nextUniforms.uLightColors ??= {
    value: Array.from({ length: MAX_STAR_LIGHTS }, () => new THREE.Color(0, 0, 0)),
  }
  nextUniforms.uLightStrengths ??= {
    value: Array.from({ length: MAX_STAR_LIGHTS }, () => 0),
  }
  return nextUniforms
}

function createGenericBodyMaterialValues(values: Record<string, any>) {
  return {
    ...values,
    fragmentShader: litGenericBodyFragmentShader,
    uniforms: createGenericBodyUniforms(values.uniforms ?? {}),
  }
}

function configureGenericBodyMaterial(material: THREE.ShaderMaterial) {
  material.fragmentShader = litGenericBodyFragmentShader
  material.uniforms = createGenericBodyUniforms(material.uniforms)
  material.userData.bodyRenderPath = GENERIC_BODY_RENDER_PATH
  material.needsUpdate = true
}

function ensureBodyMaterialPath(material: THREE.ShaderMaterial, body: BodyState) {
  const shouldUseStellarPath = getEffectiveBodyType(body) === 'star'
  const usesStellarPath = isStellarPhotosphereMaterial(material)
  if (shouldUseStellarPath === usesStellarPath) return

  if (shouldUseStellarPath) configureStellarPhotosphereMaterial(material)
  else configureGenericBodyMaterial(material)
}

function setGenericSurfaceProfile(material: THREE.ShaderMaterial, body: BodyState) {
  const bodyType = getEffectiveBodyType(body)
  const identityColor = material.uniforms.uIdentityColor.value as THREE.Color
  const secondaryColor = material.uniforms.uSecondaryColor.value as THREE.Color
  const polarColor = material.uniforms.uPolarColor.value as THREE.Color

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
  if (bodyType === 'star') return getResolvedStellarPhotosphereColor(body)
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

function setBodyGlowVisibility(
  scene: THREE.Scene,
  objectIndex: number,
  visible: boolean,
  body?: BodyState,
  stellarFrame?: StellarPhotosphereFrame,
) {
  const glowInner = scene.children[objectIndex - 1]
  const glowOuter = scene.children[objectIndex - 2]

  if (!visible || !body || !stellarFrame) {
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

  const renderProfile = stellarFrame.renderProfile
  const renderRadius = Math.max(body.radius, STELLAR_VISUAL_MIN_RADIUS)
  const coronaSeed = getBodySeed(body.id)

  // Reuse the existing inner glow Sprite as the only stellar corona carrier.
  // Scale and opacity are deliberately applied here, after the generic renderer
  // update, so the production tracking/collision-watch projection receives the
  // full broad corona footprint rather than only a shader change on a small quad.
  if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
    configureStellarCoronaMaterial(glowInner.material, {
      seed: coronaSeed,
      timeSeconds: stellarFrame.animationTimeSeconds,
      photosphereRadiusUv: 2 / renderProfile.coronaScale,
      outerWhiteMix: renderProfile.coronaOuterWhiteMix,
    })
    glowInner.visible = true
    glowInner.material.color.set(stellarFrame.displayColor)
    glowInner.material.opacity = renderProfile.coronaOpacity
    glowInner.scale.setScalar(renderRadius * renderProfile.coronaScale)
  }

  // Keep the shared VisualBody allocation/layout intact for planets/fragments, but
  // stellar rendering no longer submits the legacy second halo Sprite draw call.
  if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
    glowOuter.visible = false
    glowOuter.material.opacity = 0
  }
}

function updateStellarBodyPresentation(
  material: THREE.ShaderMaterial,
  scene: THREE.Scene,
  object: THREE.Object3D,
  body: BodyState,
) {
  const renderTimeSeconds = (nowMs() * 0.001) % 4096
  const frame = getStellarPhotosphereFrame(body, renderTimeSeconds)
  updateStellarPhotosphereMaterial(material, frame)

  const objectIndex = scene.children.indexOf(object)
  if (objectIndex >= 2) {
    setBodyGlowVisibility(scene, objectIndex, true, body, frame)
    if (objectIndex >= 4) updateTrailColor(scene, objectIndex, body)
  }
}

function syncBodyPresentationBeforeRender(scene: THREE.Scene) {
  scene.children.forEach((object, objectIndex) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) return
    const seed = object.material.uniforms.uSeed?.value
    const body = getBodyFromSeed(seed)
    if (!body) return

    ensureBodyMaterialPath(object.material, body)
    const bodyType = getEffectiveBodyType(body)
    if (bodyType === 'star') {
      const frame = getStellarPhotosphereFrame(body, (nowMs() * 0.001) % 4096)
      updateStellarPhotosphereMaterial(object.material, frame)
      if (objectIndex >= 2) setBodyGlowVisibility(scene, objectIndex, true, body, frame)
    } else {
      setGenericSurfaceProfile(object.material, body)
      if (objectIndex >= 2) setBodyGlowVisibility(scene, objectIndex, false)
    }
    if (bodyType !== 'effect' && objectIndex >= 4) updateTrailColor(scene, objectIndex, body)
  })
}

function updateGenericBodyLighting(
  material: THREE.ShaderMaterial,
  scene: THREE.Scene,
  object: THREE.Object3D,
  body: BodyState,
) {
  const bodyType = getEffectiveBodyType(body)
  const isEffect = bodyType === 'effect'
  setGenericSurfaceProfile(material, body)

  if (bodyType === 'fragment') {
    object.scale.setScalar(Math.max(body.radius, FRAGMENT_VISUAL_MIN_RADIUS))
  } else if (isEffect) {
    object.scale.setScalar(EFFECT_MESH_EPSILON)
    if (material.uniforms.uOpacity) material.uniforms.uOpacity.value = 0
  }

  material.uniforms.uLightCount.value = lightingStars.length
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

    const stellarFrame = getStellarPhotosphereFrame(star, 0)
    lightPositions[index].set(star.position.x, star.position.y, star.position.z)
    lightColors[index].set(stellarFrame.displayColor)
    lightStrengths[index] = Math.min(
      5.2,
      0.78 + Math.log2(1 + Math.max(stellarFrame.luminositySolar, 0)) * 0.34,
    )
  }

  const objectIndex = scene.children.indexOf(object)
  if (objectIndex >= 2) {
    setBodyGlowVisibility(scene, objectIndex, false)
    if (!isEffect && objectIndex >= 4) updateTrailColor(scene, objectIndex, body)
  }
}

function updateBodyMaterialBeforeRender(
  material: THREE.ShaderMaterial,
  scene: THREE.Scene,
  object: THREE.Object3D,
) {
  const body = getBodyFromSeed(material.uniforms.uSeed?.value)
  if (!body) return

  ensureBodyMaterialPath(material, body)
  if (getEffectiveBodyType(body) === 'star') {
    updateStellarBodyPresentation(material, scene, object, body)
    return
  }
  updateGenericBodyLighting(material, scene, object, body)
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

export function syncBodyLightingState(bodies: BodyState[]) {
  const previousBodies = Array.from(bodyBySeed.values())
  const presentationBodies = syncStellarPhotosphereState(bodies, previousBodies)
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

    const body = getBodyFromSeed(values.uniforms?.uSeed?.value)
    const useStellarPath = body ? getEffectiveBodyType(body) === 'star' : false
    const nextValues = useStellarPath
      ? createStellarPhotosphereMaterialValues(values)
      : createGenericBodyMaterialValues(values)

    const result = originalSetValues.call(this, nextValues)
    this.userData.bodyRenderPath = useStellarPath
      ? STELLAR_PHOTOSPHERE_RENDER_PATH
      : GENERIC_BODY_RENDER_PATH
    this.onBeforeRender = (
      _renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      _camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      object: THREE.Object3D,
    ) => {
      updateBodyMaterialBeforeRender(this as THREE.ShaderMaterial, scene, object)
    }
    return result
  }

  installCollisionEffectRenderHook()
}
