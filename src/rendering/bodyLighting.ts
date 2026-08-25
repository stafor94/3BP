import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import { getNearestStellarColor } from '../starColors'
import type { BodyState } from '../types'
import { createCollisionEffectsLayer } from './collisionEffectRenderer'

export { getCollisionEffectProfile } from './collisionEffectProfile'
export type { CollisionEffectProfile } from './collisionEffectProfile'

const MAX_STAR_LIGHTS = 6
const FRAGMENT_VISUAL_MIN_RADIUS = 0.022
const EFFECT_MESH_EPSILON = 0.0001

let installed = false
let bodyBySeed = new Map<string, BodyState>()
let lightingStars: BodyState[] = []

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
  uniform float uSeed;
  uniform float uDetailStrength;
  uniform float uRimStrength;
  uniform float uOpacity;
  uniform float uSelfLuminous;
  uniform float uEmissionStrength;
  uniform float uBodyKind;
  uniform float uSpecularStrength;
  uniform float uSpecularPower;
  uniform float uAmbientStrength;
  uniform float uTerminatorPower;
  uniform float uAtmosphereStrength;
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
    vec3 seedOffset = vec3(uSeed * 0.071, uSeed * 0.113, uSeed * 0.157);
    float broad = valueNoise(objectNormal * 3.4 + seedOffset);
    float medium = valueNoise(objectNormal * 7.2 - seedOffset * 1.1);
    float fine = valueNoise(objectNormal * 15.5 + seedOffset * 2.2);
    float bands = 0.5 + 0.5 * sin((objectNormal.y * 6.8 + broad * 0.75 + uSeed * 0.013) * 6.2831853);
    float variation;

    if (uBodyKind < 0.5) {
      variation =
        (broad - 0.5) * 0.095 +
        (medium - 0.5) * 0.04 +
        (bands - 0.5) * 0.018;
    } else if (uBodyKind < 1.5) {
      // Planet: broad continents/cloud belts with finer weather-scale breakup.
      float cloud = smoothstep(0.68, 0.9, medium) * (0.35 + 0.65 * fine);
      variation =
        (broad - 0.5) * 0.24 +
        (medium - 0.5) * 0.11 +
        (bands - 0.5) * 0.075 +
        cloud * 0.065;
    } else if (uBodyKind < 2.5) {
      // Moon: rough regolith and darker crater-like pits without atmospheric bands.
      float pits = smoothstep(0.76, 0.96, medium * 0.62 + fine * 0.38);
      float highlands = smoothstep(0.57, 0.82, broad) * 0.08;
      variation =
        (broad - 0.5) * 0.18 +
        (fine - 0.5) * 0.11 +
        highlands -
        pits * 0.24;
    } else {
      // Solid fragments: coarse, chipped rock with much stronger local albedo variation.
      float chips = smoothstep(0.7, 0.93, medium) * smoothstep(0.48, 0.8, fine);
      variation =
        (broad - 0.5) * 0.28 +
        (medium - 0.5) * 0.18 +
        (fine - 0.5) * 0.12 -
        chips * 0.22;
    }

    return clamp(1.0 + variation * uDetailStrength, 0.52, 1.22);
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
    // Collision effects are drawn by the dedicated directional effect layer.
    if (uOpacity <= 0.001) discard;

    vec3 normalWorld = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float surfaceDetail = drawBodySurfaceDetail(normalize(vObjectNormal));
    float rim = drawBodyRim(normalWorld, viewDirection);
    vec3 color;

    if (uSelfLuminous > 0.5) {
      float emission = drawBodyEmission(normalWorld, viewDirection);
      float intensity = min((emission * surfaceDetail + rim) * uEmissionStrength, 1.42);
      color = uIdentityColor * intensity;
    } else {
      vec3 albedo = uIdentityColor * surfaceDetail;
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

      // Planetary atmosphere is deliberately confined to the surface limb so it
      // cannot read as the additive stellar corona used by actual stars.
      litColor += atmosphereLight * viewFresnel * uAtmosphereStrength;
      litColor += albedo * rim * 0.16;
      color = min(litColor, vec3(1.22));
    }

    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function setSurfaceProfile(material: THREE.ShaderMaterial, body: BodyState) {
  const bodyType = getEffectiveBodyType(body)
  const identityColor = material.uniforms.uIdentityColor.value as THREE.Color

  if (bodyType === 'star') {
    identityColor.set(getNearestStellarColor(body.color).hex)
    material.uniforms.uBodyKind.value = 0
    material.uniforms.uSpecularStrength.value = 0
    material.uniforms.uSpecularPower.value = 32
    material.uniforms.uAmbientStrength.value = 0
    material.uniforms.uTerminatorPower.value = 1
    material.uniforms.uAtmosphereStrength.value = 0
    return
  }

  identityColor.set(body.color)

  if (bodyType === 'planet') {
    identityColor.multiplyScalar(0.82)
    material.uniforms.uBodyKind.value = 1
    material.uniforms.uDetailStrength.value = 0.9
    material.uniforms.uRimStrength.value = 0.025
    material.uniforms.uSpecularStrength.value = 0.095
    material.uniforms.uSpecularPower.value = 38
    material.uniforms.uAmbientStrength.value = 0.055
    material.uniforms.uTerminatorPower.value = 0.9
    material.uniforms.uAtmosphereStrength.value = 0.045
    return
  }

  if (bodyType === 'moon') {
    identityColor.lerp(new THREE.Color('#9f9b92'), 0.28).multiplyScalar(0.7)
    material.uniforms.uBodyKind.value = 2
    material.uniforms.uDetailStrength.value = 1.12
    material.uniforms.uRimStrength.value = 0.012
    material.uniforms.uSpecularStrength.value = 0.018
    material.uniforms.uSpecularPower.value = 18
    material.uniforms.uAmbientStrength.value = 0.038
    material.uniforms.uTerminatorPower.value = 1.06
    material.uniforms.uAtmosphereStrength.value = 0
    return
  }

  if (bodyType === 'fragment') {
    identityColor.lerp(new THREE.Color('#71675f'), 0.24).multiplyScalar(0.58)
    material.uniforms.uBodyKind.value = 3
    material.uniforms.uDetailStrength.value = 1.28
    material.uniforms.uRimStrength.value = 0.008
    material.uniforms.uSpecularStrength.value = 0.012
    material.uniforms.uSpecularPower.value = 14
    material.uniforms.uAmbientStrength.value = 0.025
    material.uniforms.uTerminatorPower.value = 1.12
    material.uniforms.uAtmosphereStrength.value = 0
    return
  }

  material.uniforms.uBodyKind.value = 4
}

function updateTrailColor(scene: THREE.Scene, objectIndex: number, body: BodyState) {
  const trailColor = new THREE.Color(
    getEffectiveBodyType(body) === 'star'
      ? getNearestStellarColor(body.color).hex
      : body.color,
  )
  const trailPoints = scene.children[objectIndex - 3]
  const trailRibbon = scene.children[objectIndex - 4]

  if (trailPoints instanceof THREE.Points && trailPoints.material instanceof THREE.ShaderMaterial) {
    const uniform = trailPoints.material.uniforms.uColor
    if (uniform?.value instanceof THREE.Color) uniform.value.copy(trailColor)
  }

  if (trailRibbon instanceof THREE.Mesh && trailRibbon.material instanceof THREE.ShaderMaterial) {
    const uniform = trailRibbon.material.uniforms.uColor
    if (uniform?.value instanceof THREE.Color) uniform.value.copy(trailColor)
  }
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

  let emissionStrength = isStar ? 1 : 0
  let effectOpacity = 1

  setSurfaceProfile(material, body)

  if (bodyType === 'fragment') {
    object.scale.setScalar(Math.max(body.radius, FRAGMENT_VISUAL_MIN_RADIUS))
  } else if (isEffect) {
    // Never let an effect fall back to the spherical body mesh or radial sprite
    // path: contact flash, shear, plasma and sparks all use directional shaders.
    emissionStrength = 0
    effectOpacity = 0
    object.scale.setScalar(EFFECT_MESH_EPSILON)
  }

  material.uniforms.uSelfLuminous.value = selfLuminous ? 1 : 0
  material.uniforms.uEmissionStrength.value = emissionStrength
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

    lightPositions[index].set(star.position.x, star.position.y, star.position.z)
    lightColors[index].set(getNearestStellarColor(star.color).hex)
    lightStrengths[index] = Math.min(4.2, 1 + Math.log2(1 + Math.max(star.mass, 0)) * 0.72)
  }

  const objectIndex = scene.children.indexOf(object)
  if (objectIndex >= 2) {
    const glowInner = scene.children[objectIndex - 1]
    const glowOuter = scene.children[objectIndex - 2]

    if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
      if (isStar) {
        glowInner.visible = true
      } else {
        glowInner.visible = false
        glowInner.material.opacity = 0
      }
    }

    if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
      if (isStar) {
        glowOuter.visible = true
      } else {
        glowOuter.visible = false
        glowOuter.material.opacity = 0
      }
    }

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
  const nextBodyBySeed = new Map<string, BodyState>()
  bodies.forEach((body) => nextBodyBySeed.set(seedKey(getBodySeed(body.id)), body))
  bodyBySeed = nextBodyBySeed
  lightingStars = bodies
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
        uSelfLuminous: { value: 1 },
        uEmissionStrength: { value: 1 },
        uBodyKind: { value: 0 },
        uSpecularStrength: { value: 0 },
        uSpecularPower: { value: 32 },
        uAmbientStrength: { value: 0.05 },
        uTerminatorPower: { value: 1 },
        uAtmosphereStrength: { value: 0 },
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
