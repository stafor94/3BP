import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import { getNearestStellarColor } from '../starColors'
import type { BodyState } from '../types'

const MAX_STAR_LIGHTS = 6
const FRAGMENT_VISUAL_MIN_RADIUS = 0.04
const COLLISION_FLASH_VISUAL_MIN_RADIUS = 0.04
const COLLISION_FLASH_VISUAL_MAX_RADIUS = 0.07
const STELLAR_PLASMA_VISUAL_MIN_RADIUS = 0.018
const STELLAR_PLASMA_VISUAL_MAX_RADIUS = 0.032
const COLLISION_SPARK_VISUAL_MIN_RADIUS = 0.012
const COLLISION_FLASH_VISUAL_DURATION = 0.9
const STELLAR_PLASMA_VISUAL_DURATION = 1.35
const COLLISION_SPARK_VISUAL_DURATION = 0.9
const EFFECT_MESH_EPSILON = 0.0001

let installed = false
let bodyBySeed = new Map<string, BodyState>()
let lightingStars: BodyState[] = []

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

function fadeOut(age: number, duration: number, power: number) {
  const progress = THREE.MathUtils.clamp(age / Math.max(duration, 1e-6), 0, 1)
  return {
    progress,
    alpha: Math.pow(1 - progress, power),
  }
}

const litBodyFragmentShader = `
  uniform vec3 uIdentityColor;
  uniform float uSeed;
  uniform float uDetailStrength;
  uniform float uRimStrength;
  uniform float uOpacity;
  uniform float uSelfLuminous;
  uniform float uEmissionStrength;
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
    float fine = valueNoise(objectNormal * 8.2 - seedOffset * 1.5);
    float bands = 0.5 + 0.5 * sin((objectNormal.y * 6.8 + broad * 0.75 + uSeed * 0.013) * 6.2831853);

    float variation =
      (broad - 0.5) * 0.095 +
      (fine - 0.5) * 0.04 +
      (bands - 0.5) * 0.018;

    return clamp(1.0 + variation * uDetailStrength, 0.92, 1.08);
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
      vec3 litColor = albedo * 0.09;

      for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
        if (i < uLightCount) {
          vec3 lightDelta = uLightPositions[i] - vWorldPosition;
          float distanceSquared = max(dot(lightDelta, lightDelta), 0.0025);
          vec3 lightDirection = normalize(lightDelta);
          float diffuse = max(dot(normalWorld, lightDirection), 0.0);
          float attenuation = 1.0 / (1.0 + distanceSquared * 0.16);
          vec3 irradiance = uLightColors[i] * uLightStrengths[i] * attenuation;
          vec3 halfDirection = normalize(lightDirection + viewDirection);
          float specular = pow(max(dot(normalWorld, halfDirection), 0.0), 28.0) * diffuse * 0.10;

          litColor += albedo * irradiance * diffuse;
          litColor += irradiance * specular;
        }
      }

      litColor += albedo * rim * 0.20;
      color = min(litColor, vec3(1.35));
    }

    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function updateBodyLighting(material: THREE.ShaderMaterial, scene: THREE.Scene, object: THREE.Object3D) {
  const seed = material.uniforms.uSeed?.value
  if (typeof seed !== 'number') return

  const body = bodyBySeed.get(seedKey(seed))
  if (!body) return

  const bodyType = getEffectiveBodyType(body)
  const isStar = bodyType === 'star'
  const isEffect = bodyType === 'effect'
  const isCollisionFlash = isEffect && body.name === 'Collision flash'
  const isStellarPlasma = isEffect && body.id.includes('+plasma')
  const isCollisionSpark = isEffect && body.name === 'Collision spark' && !isStellarPlasma
  const age = Math.max(body.age ?? 0, 0)
  const selfLuminous = isStar || isEffect

  let emissionStrength = isStar ? 1 : 0
  let effectOpacity = 1
  let visualRadius = body.radius
  let glowInnerScale = 0
  let glowOuterScale = 0
  let glowInnerOpacity = 0
  let glowOuterOpacity = 0

  if (bodyType === 'fragment') {
    visualRadius = Math.max(body.radius, FRAGMENT_VISUAL_MIN_RADIUS)
    object.scale.setScalar(visualRadius)
  } else if (isCollisionFlash) {
    const fade = fadeOut(age, COLLISION_FLASH_VISUAL_DURATION, 1.8)
    const pulse = 1 + Math.sin(fade.progress * Math.PI) * 0.22
    const baseRadius = THREE.MathUtils.clamp(
      body.radius * 0.24,
      COLLISION_FLASH_VISUAL_MIN_RADIUS,
      COLLISION_FLASH_VISUAL_MAX_RADIUS,
    )
    visualRadius = baseRadius * pulse
    // Flash is a luminous cloud, not a spherical body. Collapse the body mesh and
    // render only the additive glow sprites below.
    emissionStrength = 0
    effectOpacity = 0
    glowInnerScale = 5.0
    glowOuterScale = 9.0
    glowInnerOpacity = 0.72 * fade.alpha
    glowOuterOpacity = 0.22 * Math.pow(1 - fade.progress, 1.9)
    object.scale.setScalar(EFFECT_MESH_EPSILON)
  } else if (isStellarPlasma) {
    const fade = fadeOut(age, STELLAR_PLASMA_VISUAL_DURATION, 1.3)
    const pulse = 1 + Math.sin(fade.progress * Math.PI) * 0.10
    const baseRadius = THREE.MathUtils.clamp(
      body.radius * 0.18,
      STELLAR_PLASMA_VISUAL_MIN_RADIUS,
      STELLAR_PLASMA_VISUAL_MAX_RADIUS,
    )
    visualRadius = baseRadius * pulse
    // Stellar ejecta must read as diffuse plasma knots, never asteroid-sized balls.
    emissionStrength = 0
    effectOpacity = 0
    glowInnerScale = 4.2
    glowOuterScale = 7.2
    glowInnerOpacity = 0.42 * fade.alpha
    glowOuterOpacity = 0.11 * Math.pow(1 - fade.progress, 1.5)
    object.scale.setScalar(EFFECT_MESH_EPSILON)
  } else if (isCollisionSpark || isEffect) {
    const fade = fadeOut(age, COLLISION_SPARK_VISUAL_DURATION, 1.8)
    const pulse = 1 + Math.sin(fade.progress * Math.PI) * 0.10
    visualRadius = Math.max(body.radius, COLLISION_SPARK_VISUAL_MIN_RADIUS) * pulse
    emissionStrength = 0.38 * fade.alpha
    effectOpacity = 0.72 * fade.alpha
    glowInnerScale = 1.8
    glowOuterScale = 2.5
    glowInnerOpacity = 0.12 * fade.alpha
    glowOuterOpacity = 0.016 * Math.pow(1 - fade.progress, 2)
    object.scale.setScalar(visualRadius)
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
      } else if (isEffect && glowInnerOpacity > 0.001) {
        glowInner.visible = true
        glowInner.scale.setScalar(visualRadius * glowInnerScale)
        glowInner.material.opacity = glowInnerOpacity
      } else {
        glowInner.visible = false
        glowInner.material.opacity = 0
      }
    }

    if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
      if (isStar) {
        glowOuter.visible = true
      } else if (isEffect && glowOuterOpacity > 0.001) {
        glowOuter.visible = true
        glowOuter.scale.setScalar(visualRadius * glowOuterScale)
        glowOuter.material.opacity = glowOuterOpacity
      } else {
        glowOuter.visible = false
        glowOuter.material.opacity = 0
      }
    }
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
}
