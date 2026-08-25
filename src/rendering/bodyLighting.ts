import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import { getNearestStellarColor } from '../starColors'
import type { BodyState, EffectVisualKind } from '../types'

const MAX_STAR_LIGHTS = 6
const FRAGMENT_VISUAL_MIN_RADIUS = 0.04
const EFFECT_MESH_EPSILON = 0.0001

let installed = false
let bodyBySeed = new Map<string, BodyState>()
let lightingStars: BodyState[] = []

export type CollisionEffectProfile = {
  kind: EffectVisualKind
  progress: number
  fadeAlpha: number
  baseOpacity: number
  innerGlow: number
  outerGlow: number
  visualRadius: number
  anisotropicStretch: number
  widthScale: number
  tailLength: number
  pulseStrength: number
  brightness: number
  turbulence: number
  cooling: number
}

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

function smooth01(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function inferEffectVisualKind(body: BodyState): EffectVisualKind {
  if (body.effectVisual?.kind) return body.effectVisual.kind
  if (body.name === 'Collision flash') return 'contactFlash'
  if (body.name === 'Collision spark') return 'collisionSpark'
  if (body.name === 'Stellar plasma' || body.id.includes('+plasma')) return 'stellarPlasma'
  return 'collisionSpark'
}

export function getCollisionEffectProfile(body: BodyState): CollisionEffectProfile {
  const kind = inferEffectVisualKind(body)
  const age = Math.max(body.age ?? 0, 0)
  const defaultLifetime = kind === 'contactFlash'
    ? 0.72
    : kind === 'compressionShear'
      ? 0.82
      : kind === 'stellarPlasma'
        ? 1.55
        : 0.9
  const duration = Math.max(body.lifetime ?? defaultLifetime, 1e-6)
  const progress = THREE.MathUtils.clamp(age / duration, 0, 1)
  const visual = body.effectVisual

  if (kind === 'contactFlash') {
    const rise = 0.58 + 0.42 * smooth01(progress / 0.055)
    const decay = Math.pow(1 - progress, 3.2)
    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: 0.94,
      innerGlow: 1,
      outerGlow: 0.3,
      visualRadius: THREE.MathUtils.clamp(body.radius * 0.42, 0.052, 0.13),
      anisotropicStretch: visual?.stretch ?? 3.1,
      widthScale: visual?.widthScale ?? 0.34,
      tailLength: 0,
      pulseStrength: visual?.pulseStrength ?? 0.24,
      brightness: visual?.brightness ?? 1.55,
      turbulence: visual?.turbulence ?? 0.18,
      cooling: smooth01(progress),
    }
  }

  if (kind === 'compressionShear') {
    const rise = smooth01(progress / 0.12)
    const decay = Math.pow(1 - progress, 1.7)
    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: 0.7,
      innerGlow: 0.72,
      outerGlow: 0.18,
      visualRadius: THREE.MathUtils.clamp(body.radius * 0.34, 0.045, 0.11),
      anisotropicStretch: (visual?.stretch ?? 3.8) * (0.94 + progress * 0.18),
      widthScale: (visual?.widthScale ?? 0.3) * (1 + progress * 0.12),
      tailLength: visual?.tailLength ?? 0.2,
      pulseStrength: visual?.pulseStrength ?? 0.12,
      brightness: visual?.brightness ?? 1.18,
      turbulence: visual?.turbulence ?? 0.5,
      cooling: smooth01(progress),
    }
  }

  if (kind === 'stellarPlasma') {
    const linger = Math.pow(1 - progress, 1.28)
    const expansion = smooth01(progress)
    return {
      kind,
      progress,
      fadeAlpha: linger,
      baseOpacity: 0.78,
      innerGlow: 0.82,
      outerGlow: 0.21,
      visualRadius: THREE.MathUtils.clamp(body.radius * 0.26, 0.021, 0.058),
      anisotropicStretch: (visual?.stretch ?? 2.7) * (0.92 + expansion * 0.58),
      widthScale: (visual?.widthScale ?? 0.72) * (1 + expansion * 0.3),
      tailLength: (visual?.tailLength ?? 0.76) * (0.72 + expansion * 0.72),
      pulseStrength: visual?.pulseStrength ?? 0.08,
      brightness: (visual?.brightness ?? 1.12) * (1 - progress * 0.18),
      turbulence: visual?.turbulence ?? 0.62,
      cooling: Math.pow(progress, 1.18),
    }
  }

  const decay = Math.pow(1 - progress, 2.15)
  return {
    kind,
    progress,
    fadeAlpha: decay,
    baseOpacity: 0.66,
    innerGlow: 0.68,
    outerGlow: 0.12,
    visualRadius: THREE.MathUtils.clamp(body.radius * 0.76, 0.012, 0.032),
    anisotropicStretch: visual?.stretch ?? 1.9,
    widthScale: visual?.widthScale ?? 0.48,
    tailLength: visual?.tailLength ?? 0.48,
    pulseStrength: visual?.pulseStrength ?? 0.08,
    brightness: visual?.brightness ?? 0.92,
    turbulence: visual?.turbulence ?? 0.3,
    cooling: smooth01(progress),
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
  const selfLuminous = isStar || isEffect

  let emissionStrength = isStar ? 1 : 0
  let effectOpacity = 1

  if (bodyType === 'fragment') {
    object.scale.setScalar(Math.max(body.radius, FRAGMENT_VISUAL_MIN_RADIUS))
  } else if (isEffect) {
    // Collision effects are rendered by collisionEffectRenderer as directional
    // billboard planes. Suppress the legacy spherical mesh and radial glow sprites.
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
      } else if (isEffect) {
        glowInner.visible = false
        glowInner.material.opacity = 0
      }
    }

    if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
      if (isStar) {
        glowOuter.visible = true
      } else if (isEffect) {
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
