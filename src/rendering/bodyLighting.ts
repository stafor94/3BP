import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import { getNearestStellarColor } from '../starColors'
import type { BodyState } from '../types'

const MAX_STAR_LIGHTS = 6

let installed = false
let lightingBodies: BodyState[] = []

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
  uniform float uSelfLuminous;
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
      float intensity = min(emission * surfaceDetail + rim, 1.42);
      color = uIdentityColor * intensity;
    } else {
      vec3 albedo = uIdentityColor * surfaceDetail;
      vec3 litColor = albedo * 0.055;

      for (int i = 0; i < ${MAX_STAR_LIGHTS}; i++) {
        if (i < uLightCount) {
          vec3 lightDelta = uLightPositions[i] - vWorldPosition;
          float distanceSquared = max(dot(lightDelta, lightDelta), 0.0025);
          vec3 lightDirection = normalize(lightDelta);
          float diffuse = max(dot(normalWorld, lightDirection), 0.0);
          float attenuation = 1.0 / (1.0 + distanceSquared * 0.16);
          vec3 irradiance = uLightColors[i] * uLightStrengths[i] * attenuation;
          vec3 halfDirection = normalize(lightDirection + viewDirection);
          float specular = pow(max(dot(normalWorld, halfDirection), 0.0), 28.0) * diffuse * 0.16;

          litColor += albedo * irradiance * diffuse;
          litColor += irradiance * specular;
        }
      }

      litColor += albedo * rim * 0.32;
      color = min(litColor, vec3(1.35));
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function updateSceneLighting(scene: THREE.Scene) {
  const bodyBySeed = new Map<string, BodyState>()
  lightingBodies.forEach((body) => bodyBySeed.set(seedKey(getBodySeed(body.id)), body))

  const stars = lightingBodies
    .filter((body) => getEffectiveBodyType(body) === 'star')
    .slice(0, MAX_STAR_LIGHTS)

  scene.children.forEach((object, objectIndex) => {
    if (!(object instanceof THREE.Mesh)) return
    if (!(object.material instanceof THREE.ShaderMaterial)) return

    const material = object.material
    const seed = material.uniforms.uSeed?.value
    if (typeof seed !== 'number' || material.uniforms.uSelfLuminous === undefined) return

    const body = bodyBySeed.get(seedKey(seed))
    if (!body) return

    const bodyType = getEffectiveBodyType(body)
    const selfLuminous = bodyType === 'star' || bodyType === 'effect'
    material.uniforms.uSelfLuminous.value = selfLuminous ? 1 : 0
    material.uniforms.uLightCount.value = stars.length

    const lightPositions = material.uniforms.uLightPositions.value as THREE.Vector3[]
    const lightColors = material.uniforms.uLightColors.value as THREE.Color[]
    const lightStrengths = material.uniforms.uLightStrengths.value as number[]

    for (let index = 0; index < MAX_STAR_LIGHTS; index += 1) {
      const star = stars[index]
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

    const glowInner = scene.children[objectIndex - 1]
    const glowOuter = scene.children[objectIndex - 2]
    if (glowInner instanceof THREE.Sprite) glowInner.visible = selfLuminous
    if (glowOuter instanceof THREE.Sprite) glowOuter.visible = selfLuminous
  })
}

export function syncBodyLightingState(bodies: BodyState[]) {
  lightingBodies = bodies
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
    return originalSetValues.call(this, nextValues)
  }

  const rendererPrototype = THREE.WebGLRenderer.prototype as any
  const originalRender = rendererPrototype.render
  rendererPrototype.render = function renderWithBodyLighting(scene: THREE.Scene, camera: THREE.Camera) {
    updateSceneLighting(scene)
    return originalRender.call(this, scene, camera)
  }
}
