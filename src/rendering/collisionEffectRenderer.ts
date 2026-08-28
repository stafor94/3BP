import * as THREE from 'three'
import { getEffectiveBodyType } from '../bodyTypes'
import { getNearestStellarColor } from '../starColors'
import type { BodyState, EffectVisualKind, Vec3 } from '../types'
import { getCollisionEffectProfile } from './collisionEffectProfile'

type CollisionEffectVisual = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  material: THREE.ShaderMaterial
}

const MAX_SYNTHETIC_STELLAR_PAIRS = 2
const PREVIEW_FLASH_LIFETIME = 0.72
const PREVIEW_SHEAR_LIFETIME = 0.82
const PREVIEW_PLASMA_LIFETIME = 1.55
const SYNTHETIC_RETIRE_MS = 420
const PHYSICAL_EFFECT_FADE_IN_MS = 140

const effectVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const effectFragmentShader = `
  uniform vec3 uCoreColor;
  uniform vec3 uMidColor;
  uniform vec3 uEdgeColor;
  uniform float uOpacity;
  uniform float uProgress;
  uniform float uSeed;
  uniform float uKind;
  uniform float uTail;
  uniform float uTurbulence;
  uniform float uBrightness;
  uniform float uInnerGlow;
  uniform float uOuterGlow;
  uniform float uPulse;
  uniform float uSynthetic;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float plasmaNoise(vec2 p) {
    float broad = valueNoise(p * 3.2 + uSeed * 0.017);
    float fine = valueNoise(p * 8.4 - uSeed * 0.029);
    return broad * 0.68 + fine * 0.32;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float alpha = 0.0;
    float core = 0.0;
    float body = 0.0;
    float edge = 0.0;
    float noise = plasmaNoise(p + vec2(uProgress * 0.7, -uProgress * 0.23));

    if (uKind < 0.5) {
      // Contact flash: compressed impact sheet rather than a spherical glow.
      float warpedY = p.y + (noise - 0.5) * 0.16 * uTurbulence;
      float lens = length(vec2(p.x * 0.72, warpedY * 3.35));
      float halo = 1.0 - smoothstep(0.35, 1.0, lens);
      float hotBand = exp(-abs(warpedY) * 10.0) * (1.0 - smoothstep(0.58, 1.0, abs(p.x)));
      float ridge = exp(-abs(warpedY) * 24.0) * (1.0 - smoothstep(0.18, 0.92, abs(p.x)));
      alpha = max(halo * 0.58, hotBand * 0.9) + ridge * 0.52;
      core = ridge + hotBand * 0.72;
      body = hotBand * 0.7 + halo * 0.35;
      edge = halo;

      if (uSynthetic > 0.5) {
        // Keep the topology mask ridge-shaped rather than turning it into a white
        // stellar disc, but let peak compression genuinely obscure the handoff.
        float centerRelief = 0.74 + 0.26 * smoothstep(0.08, 0.52, abs(p.x));
        alpha *= centerRelief * 0.90;
        core *= 0.86;
        body *= 0.78;
      }
    } else if (uKind < 1.5) {
      // Compression/shear: uneven turbulent sheet with hot knots and filaments.
      float wave = sin((p.x * 5.4 + uSeed * 0.11) + noise * 3.4) * 0.08 * uTurbulence;
      float distanceToBand = abs(p.y - wave);
      float envelope = 1.0 - smoothstep(0.72, 1.0, abs(p.x));
      float band = exp(-distanceToBand * 11.0) * envelope;
      float filament = exp(-distanceToBand * 25.0) * envelope;
      float knots = smoothstep(0.48, 0.9, noise) * band;
      alpha = band * (0.62 + noise * 0.35) + filament * 0.2;
      core = filament * 0.72 + knots * 0.55;
      body = band;
      edge = band * (1.0 - filament);
    } else if (uKind < 2.5) {
      // Stellar plasma: hot head, torn tail, cooling edge and turbulent filaments.
      float headDistance = length(vec2((p.x - 0.28) * 1.08, p.y * 1.22));
      float head = 1.0 - smoothstep(0.24, 0.92, headDistance);
      float tailT = clamp((0.34 - p.x) / max(0.55, 1.1 + uTail * 0.28), 0.0, 1.0);
      float tailCenter =
        sin((p.x + uSeed * 0.009) * 8.0 + noise * 4.0) *
        (0.035 + 0.12 * tailT) * uTurbulence;
      float tailWidth = mix(0.34, 0.065, pow(tailT, 0.72));
      float tornWidth = tailWidth * mix(0.72, 1.24, noise);
      float tailBand = 1.0 - smoothstep(tornWidth * 0.42, tornWidth, abs(p.y - tailCenter));
      float tailEnvelope =
        smoothstep(-1.06, -0.72, p.x) *
        (1.0 - smoothstep(0.12, 0.48, p.x));
      float tail = tailBand * tailEnvelope;
      float filamentA = exp(-abs(p.y - tailCenter * 0.45) * (19.0 - tailT * 5.0)) * tailEnvelope;
      float filamentB = exp(-abs(p.y + tailCenter * 1.35 + 0.08 * sin(p.x * 13.0)) * 23.0) * tailEnvelope;
      float irregularHead = head * mix(0.72, 1.08, noise);
      alpha = max(irregularHead, tail * (0.58 + noise * 0.34));
      alpha += (filamentA * 0.22 + filamentB * 0.13) * (0.35 + uTail * 0.45);
      core = (1.0 - smoothstep(0.0, 0.43, headDistance)) + filamentA * 0.34;
      body = max(head * 0.72, tail * 0.75);
      edge = max(head, tail) * (1.0 - clamp(core, 0.0, 1.0));
    } else if (uKind < 3.5) {
      // Stellar afterglow: hollow, broken, expanding shell with turbulent gaps.
      float radial = length(vec2(p.x * 0.9, p.y * 1.06));
      float shellRadius = mix(0.34, 0.84, smoothstep(0.0, 0.78, uProgress));
      float shellWidth = mix(0.18, 0.055, smoothstep(0.08, 1.0, uProgress));
      float shell = exp(-abs(radial - shellRadius) / max(shellWidth, 0.025));
      float angularBreakup = 0.48 + noise * 0.62;
      float hollow = smoothstep(0.18, shellRadius * 0.9, radial);
      float knots = smoothstep(0.58, 0.88, noise) * shell;
      alpha = shell * angularBreakup * hollow;
      core = knots * 0.34;
      body = shell * (0.45 + noise * 0.35);
      edge = shell * (0.7 + noise * 0.3);
    } else {
      // Small sparks stay aligned to their real travel direction, but the tail
      // footprint follows presentation-only profile geometry so head-on ejecta
      // reads as a compact fleck instead of a full-length +/-tangent spike.
      float headDistance = length(vec2((p.x - 0.2) * 1.15, p.y * 1.6));
      float head = 1.0 - smoothstep(0.18, 0.82, headDistance);
      float tail01 = smoothstep(0.035, 0.22, uTail);
      float tailReach = mix(0.28, 1.0, tail01);
      float tail = exp(-abs(p.y) * 8.0) *
        smoothstep(-tailReach, -tailReach * 0.62, p.x) *
        (1.0 - smoothstep(0.02, 0.38, p.x));
      alpha = max(head, tail * 0.52);
      core = 1.0 - smoothstep(0.0, 0.34, headDistance);
      body = max(head * 0.7, tail * 0.55);
      edge = alpha * (1.0 - core);
    }

    // Profile glow values are real shader inputs, not dead tuning knobs. This is
    // a lightweight impact-only bloom surrogate that does not require a global
    // post-processing pass or contaminate the stellar body material.
    if (uKind < 0.5) {
      float auraRadius = length(vec2(p.x * 0.72, p.y * 1.28));
      float innerAura = 1.0 - smoothstep(0.08, 0.56, auraRadius);
      float outerAura = 1.0 - smoothstep(0.36, 1.0, auraRadius);
      float syntheticAuraScale = uSynthetic > 0.5 ? 0.68 : 1.0;
      alpha = max(alpha, innerAura * 0.34 * uInnerGlow * syntheticAuraScale);
      alpha = max(alpha, outerAura * 0.24 * uOuterGlow * syntheticAuraScale);
      core += innerAura * 0.22 * uInnerGlow * syntheticAuraScale;
      edge += outerAura * 0.2 * uOuterGlow * syntheticAuraScale;
    } else if (uKind < 1.5) {
      float sheetAura = exp(-abs(p.y) * 4.5) * (1.0 - smoothstep(0.66, 1.0, abs(p.x)));
      alpha += sheetAura * 0.11 * uOuterGlow;
      core += sheetAura * 0.07 * uInnerGlow;
    } else if (uKind < 2.5) {
      float plasmaAura = 1.0 - smoothstep(0.2, 0.96, length(vec2((p.x - 0.18) * 0.9, p.y * 1.18)));
      alpha = max(alpha, plasmaAura * 0.12 * uOuterGlow);
      core += plasmaAura * 0.06 * uInnerGlow;
    } else if (uKind < 3.5) {
      float shellAura = 1.0 - smoothstep(0.42, 1.0, length(vec2(p.x * 0.9, p.y)));
      alpha = max(alpha, shellAura * 0.1 * uOuterGlow);
    }

    float feather = 1.0 - smoothstep(0.78, 1.0, max(abs(p.x), abs(p.y)));
    alpha *= feather * uOpacity;
    if (alpha <= 0.002) discard;

    float pulse = 1.0 + sin((uProgress * 8.0 + uSeed * 0.013) * 6.2831853) * uPulse;
    vec3 color = mix(uEdgeColor, uMidColor, clamp(body, 0.0, 1.0));
    color = mix(color, uCoreColor, clamp(core, 0.0, 1.0));
    color += uEdgeColor * edge * 0.08;
    color *= uBrightness * pulse;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function magnitude(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function scale(value: Vec3, scalar: number): Vec3 {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = magnitude(value)
  if (length > 1e-10) return scale(value, 1 / length)
  const fallbackLength = magnitude(fallback)
  return fallbackLength > 1e-10 ? scale(fallback, 1 / fallbackLength) : { x: 1, y: 0, z: 0 }
}

function getBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function getSeededSignedScalar(seed: string) {
  return getBodySeed(seed) * 2 - 1
}

function getPreviewContactSurfacePoint(
  source: BodyState,
  a: BodyState,
  normal: Vec3,
  tangent: Vec3,
  pairKey: string,
  index: number,
  is2d: boolean,
) {
  const contactNormal = source === a ? normal : scale(normal, -1)
  const tangentOffset = getSeededSignedScalar(`${pairKey}:patch-tangent:${index}`) * 0.2
  let surfaceDirection = add(contactNormal, scale(tangent, tangentOffset))

  if (!is2d) {
    const referenceAxis: Vec3 = Math.abs(contactNormal.z) < 0.86
      ? { x: 0, y: 0, z: 1 }
      : { x: 0, y: 1, z: 0 }
    const binormal = normalize(cross(contactNormal, tangent), cross(contactNormal, referenceAxis))
    const binormalOffset = getSeededSignedScalar(`${pairKey}:patch-binormal:${index}`) * 0.18
    surfaceDirection = add(surfaceDirection, scale(binormal, binormalOffset))
  }

  surfaceDirection = normalize(surfaceDirection, contactNormal)
  return add(source.position, scale(surfaceDirection, source.radius * 1.008))
}

function getPreviewSplashPlaneDirection(
  pairKey: string,
  index: number,
  normal: Vec3,
  tangent: Vec3,
  is2d: boolean,
  sign: number,
) {
  if (is2d) return scale(tangent, sign)

  const referenceAxis: Vec3 = Math.abs(normal.z) < 0.86
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 }
  const binormal = normalize(cross(normal, tangent), cross(normal, referenceAxis))
  const angle = getBodySeed(`${pairKey}:splash:${index}`) * Math.PI * 1.45 - Math.PI * 0.725
  const candidate = normalize(
    add(scale(tangent, Math.cos(angle) * sign), scale(binormal, Math.sin(angle))),
    scale(tangent, sign),
  )
  return dot(candidate, tangent) * sign < 0 ? scale(candidate, -1) : candidate
}

function kindNumber(kind: EffectVisualKind) {
  if (kind === 'contactFlash') return 0
  if (kind === 'compressionShear') return 1
  if (kind === 'stellarPlasma') return 2
  if (kind === 'stellarAfterglow') return 3
  return 4
}

function vec3LengthSquared(value: Vec3) {
  return value.x * value.x + value.y * value.y + value.z * value.z
}

function createEffectMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoreColor: { value: new THREE.Color('#f7fbff') },
      uMidColor: { value: new THREE.Color('#dcecff') },
      uEdgeColor: { value: new THREE.Color('#9fb8d4') },
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uSeed: { value: 0 },
      uKind: { value: 0 },
      uTail: { value: 0 },
      uTurbulence: { value: 0 },
      uBrightness: { value: 1 },
      uInnerGlow: { value: 0 },
      uOuterGlow: { value: 0 },
      uPulse: { value: 0 },
      uSynthetic: { value: 0 },
    },
    vertexShader: effectVertexShader,
    fragmentShader: effectFragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
}

export function getSyntheticStellarEffects(bodies: BodyState[]) {
  const stars = bodies.filter((body) => getEffectiveBodyType(body) === 'star')
  const effects: BodyState[] = []
  let pairCount = 0

  for (let i = 0; i < stars.length && pairCount < MAX_SYNTHETIC_STELLAR_PAIRS; i += 1) {
    for (let j = i + 1; j < stars.length && pairCount < MAX_SYNTHETIC_STELLAR_PAIRS; j += 1) {
      const a = stars[i]
      const b = stars[j]
      const delta = sub(b.position, a.position)
      const distance = magnitude(delta)
      const contactDistance = a.radius + b.radius
      const overlap = contactDistance - distance
      if (overlap <= Math.max(1e-7, Math.min(a.radius, b.radius) * 0.002)) continue

      const normal = normalize(delta, sub(b.velocity, a.velocity))
      const relativeVelocity = sub(b.velocity, a.velocity)
      const relativeSpeed = magnitude(relativeVelocity)
      const normalVelocity = scale(normal, dot(relativeVelocity, normal))
      const tangentialVelocity = sub(relativeVelocity, normalVelocity)
      const is2d =
        Math.abs(a.position.z) + Math.abs(b.position.z) + Math.abs(a.velocity.z) + Math.abs(b.velocity.z) < 1e-8
      const referenceAxis: Vec3 = Math.abs(normal.z) < 0.86
        ? { x: 0, y: 0, z: 1 }
        : { x: 0, y: 1, z: 0 }
      const tangent = normalize(tangentialVelocity, cross(referenceAxis, normal))
      const headOn = relativeSpeed > 1e-9
        ? clamp(Math.abs(dot(relativeVelocity, normal)) / relativeSpeed, 0, 1)
        : 1
      const grazing = Math.sqrt(Math.max(0, 1 - headOn * headOn))
      const minRadius = Math.max(Math.min(a.radius, b.radius), 1e-6)
      const overlapRatio = overlap / minRadius
      const dominant = a.mass >= b.mass ? a : b
      const smaller = dominant === a ? b : a
      const totalMass = Math.max(a.mass + b.mass, 1e-9)
      const centerVelocity = {
        x: (a.velocity.x * a.mass + b.velocity.x * b.mass) / totalMass,
        y: (a.velocity.y * a.mass + b.velocity.y * b.mass) / totalMass,
        z: (a.velocity.z * a.mass + b.velocity.z * b.mass) / totalMass,
      }
      const pointA = add(a.position, scale(normal, a.radius))
      const pointB = sub(b.position, scale(normal, b.radius))
      const contactPoint = scale(add(pointA, pointB), 0.5)
      const pairKey = [a.id, b.id].sort().join('~')
      const massRatio = Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, 1e-9)
      const massAsymmetry = 1 - massRatio
      const relativeDirection = normalize(relativeVelocity, tangent)
      const strippedDirection = smaller === a ? scale(relativeDirection, -1) : relativeDirection
      const planarStrippedDirection = normalize(
        sub(strippedDirection, scale(normal, dot(strippedDirection, normal))),
        tangent,
      )
      const dominantTangentSign = dot(planarStrippedDirection, tangent) < 0 ? -1 : 1
      // These are compression/buildup phases, not physical effect ages. Keep the
      // mapping aligned with the staged stellar overlap envelope (18-36%).
      const flashProgress = clamp(overlapRatio / 0.34, 0, 1)
      const shearProgress = clamp(overlapRatio / 0.32, 0, 1)

      effects.push({
        id: `preview:${pairKey}:flash`,
        name: 'Collision flash',
        color: dominant.color,
        mass: 0,
        radius: Math.max(0.055, Math.min(0.15, contactDistance * 0.4)),
        position: contactPoint,
        velocity: centerVelocity,
        bodyType: 'effect',
        age: PREVIEW_FLASH_LIFETIME * flashProgress,
        lifetime: PREVIEW_FLASH_LIFETIME,
        effectVisual: {
          kind: 'contactFlash',
          direction: tangent,
          normal,
          stretch: 2.8 + headOn * 1.0 + grazing * 0.24,
          widthScale: clamp(0.42 - headOn * 0.13 + grazing * 0.04, 0.25, 0.44),
          brightness: 1.58 + headOn * 0.42 + clamp(relativeSpeed, 0, 2) * 0.08,
          turbulence: 0.14 + grazing * 0.34,
          pulseStrength: 0.18 + headOn * 0.08,
          phaseOffset: getBodySeed(pairKey),
          secondaryColor: smaller.color,
          stellarCollision: true,
        },
      })

      effects.push({
        id: `preview:${pairKey}:shear`,
        name: 'Collision shear',
        color: dominant.color,
        mass: 0,
        radius: Math.max(0.06, Math.min(0.18, contactDistance * 0.36)),
        position: contactPoint,
        velocity: centerVelocity,
        bodyType: 'effect',
        age: PREVIEW_SHEAR_LIFETIME * shearProgress,
        lifetime: PREVIEW_SHEAR_LIFETIME,
        effectVisual: {
          kind: 'compressionShear',
          direction: tangent,
          normal,
          stretch: 3.35 + grazing * 1.5 + headOn * 0.34,
          widthScale: clamp(0.34 - grazing * 0.07 + headOn * 0.04, 0.25, 0.4),
          tailLength: 0.18 + grazing * 0.3,
          brightness: 1.1 + headOn * 0.25 + grazing * 0.08,
          turbulence: 0.44 + grazing * 0.3,
          pulseStrength: 0.08,
          phaseOffset: getBodySeed(`${pairKey}:shear`),
          secondaryColor: smaller.color,
          stellarCollision: true,
        },
      })

      // Plasma starts on separate patches of the two contact hemispheres instead
      // of translating several meshes out of one shared contact point.
      const plasmaPhase = clamp((overlapRatio - 0.055) / 0.22, 0, 1)
      if (plasmaPhase > 0) {
        const previewCount = grazing > 0.55 ? 3 : 2
        for (let index = 0; index < previewCount; index += 1) {
          const smallerSourceProbability = clamp(0.55 + massAsymmetry * 0.25 + grazing * 0.05, 0.55, 0.85)
          const source = getBodySeed(`${pairKey}:source:${index}`) < smallerSourceProbability
            ? smaller
            : dominant
          const counterStream = grazing > 0.55 && index === previewCount - 1
          const sign = counterStream ? -dominantTangentSign : dominantTangentSign
          const splashDirection = getPreviewSplashPlaneDirection(
            pairKey,
            index,
            normal,
            tangent,
            is2d,
            headOn > 0.7 ? (index % 2 === 0 ? 1 : -1) : sign,
          )
          const direction = headOn > 0.7
            ? normalize(
                add(
                  scale(splashDirection, 0.9),
                  scale(normal, (index % 2 === 0 ? 1 : -1) * 0.03),
                ),
                splashDirection,
              )
            : normalize(
                add(
                  add(
                    scale(tangent, sign * (counterStream ? 0.82 : 0.9)),
                    scale(planarStrippedDirection, 0.08 + massAsymmetry * 0.1),
                  ),
                  scale(normal, (index % 2 === 0 ? 1 : -1) * 0.025),
                ),
                scale(tangent, sign),
              )
          const strength = counterStream ? 0.36 : 1 - index * 0.1
          const sourceWeight = index === 0 ? 0.62 : 0.52
          const inheritedVelocity = add(
            scale(source.velocity, sourceWeight),
            scale(centerVelocity, 1 - sourceWeight),
          )
          const velocity = add(
            inheritedVelocity,
            scale(direction, Math.max(relativeSpeed * 0.48 * strength, 0.08)),
          )
          const travelDirection = normalize(sub(velocity, centerVelocity), direction)
          const surfacePoint = getPreviewContactSurfacePoint(
            source,
            a,
            normal,
            tangent,
            pairKey,
            index,
            is2d,
          )
          const travel = minRadius * plasmaPhase * 0.08 * strength
          const radiusScale = counterStream ? 0.09 : index === 0 ? 0.2 : 0.13

          effects.push({
            id: `preview:${pairKey}:plasma-${index}`,
            name: 'Stellar plasma',
            color: source.color,
            mass: 0,
            radius: minRadius * radiusScale,
            position: add(surfacePoint, scale(travelDirection, travel)),
            velocity,
            bodyType: 'effect',
            age: PREVIEW_PLASMA_LIFETIME * plasmaPhase,
            lifetime: PREVIEW_PLASMA_LIFETIME,
            effectVisual: {
              kind: 'stellarPlasma',
              direction: travelDirection,
              normal,
              stretch: clamp(
                2.0 + grazing * 2.6 + plasmaPhase * 0.8 + index * 0.2 - (counterStream ? 0.45 : 0),
                1.9,
                5.5,
              ),
              widthScale: clamp(0.9 - grazing * 0.38 - index * 0.04, 0.45, 1.02),
              tailLength: 0.34 + grazing * 0.72 + plasmaPhase * 0.34 + index * 0.08,
              brightness: 1.12 + plasmaPhase * 0.12 + (index === 0 ? 0.18 : counterStream ? -0.1 : 0.04),
              turbulence: 0.48 + grazing * 0.32 + index * 0.06,
              pulseStrength: 0.05,
              phaseOffset: getBodySeed(`${pairKey}:plasma:${index}`),
              secondaryColor: source === smaller ? dominant.color : smaller.color,
              stellarCollision: true,
            },
          })
        }
      }

      pairCount += 1
    }
  }

  return effects
}

export function createCollisionEffectsLayer(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'collision-effects'
  group.renderOrder = 14
  scene.add(group)

  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  const visuals = new Map<string, CollisionEffectVisual>()
  const previousSyntheticBodies = new Map<string, BodyState>()
  const retiringSyntheticBodies = new Map<string, { body: BodyState; startedAt: number }>()
  const physicalEffectIntroducedAt = new Map<string, number>()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const coreColor = new THREE.Color()
  const midColor = new THREE.Color()
  const edgeColor = new THREE.Color()
  const baseColor = new THREE.Color()
  const secondaryColor = new THREE.Color()
  const hotWhite = new THREE.Color('#f8fcff')
  const paleBlue = new THREE.Color('#d9eeff')
  const coolingAmber = new THREE.Color('#d98c73')
  const coolingRed = new THREE.Color('#c66f62')

  const remove = (id: string) => {
    const visual = visuals.get(id)
    if (!visual) return
    group.remove(visual.mesh)
    visual.material.dispose()
    visuals.delete(id)
  }

  const ensure = (body: BodyState) => {
    const existing = visuals.get(body.id)
    if (existing) return existing

    const material = createEffectMaterial()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 14
    group.add(mesh)

    const created = { mesh, material }
    visuals.set(body.id, created)
    return created
  }

  const updateVisual = (
    visual: CollisionEffectVisual,
    body: BodyState,
    camera: THREE.Camera,
    opacityScale = 1,
  ) => {
    const profile = getCollisionEffectProfile(body)
    const synthetic = body.id.startsWith('preview:')
    const stellarEffect = body.effectVisual?.stellarCollision === true
    const effectDirection = body.effectVisual?.direction
    const fallbackDirection = vec3LengthSquared(body.velocity) > 1e-12
      ? body.velocity
      : body.effectVisual?.normal ?? { x: 1, y: 0, z: 0 }
    const sourceDirection = effectDirection && vec3LengthSquared(effectDirection) > 1e-12
      ? effectDirection
      : fallbackDirection

    direction.set(sourceDirection.x, sourceDirection.y, sourceDirection.z).normalize()
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    const screenAngle = Math.atan2(direction.dot(up), direction.dot(right))

    visual.mesh.position.set(body.position.x, body.position.y, body.position.z)
    visual.mesh.quaternion.copy(camera.quaternion)
    visual.mesh.rotateZ(screenAngle)

    const diameter = profile.visualRadius * 2
    let scaleX = diameter * profile.anisotropicStretch
    let scaleY = diameter * profile.widthScale
    const maxWorldDiameter = profile.kind === 'stellarAfterglow'
      ? stellarEffect ? 1.28 : 0.96
      : stellarEffect
        ? synthetic
          ? 0.98
          : profile.kind === 'contactFlash'
            ? 1.18
            : 1.08
        : 0.64
    const largestAxis = Math.max(scaleX, scaleY)
    if (largestAxis > maxWorldDiameter) {
      const scaleClamp = maxWorldDiameter / largestAxis
      scaleX *= scaleClamp
      scaleY *= scaleClamp
    }
    visual.mesh.scale.set(scaleX, scaleY, 1)
    visual.mesh.visible = profile.fadeAlpha > 0.002

    const stellarHex = getNearestStellarColor(body.color).hex
    const secondaryHex = getNearestStellarColor(body.effectVisual?.secondaryColor ?? body.color).hex
    baseColor.set(stellarHex)
    secondaryColor.set(secondaryHex)
    baseColor.lerp(secondaryColor, profile.kind === 'stellarPlasma' ? 0.28 : 0.16)

    coreColor.copy(hotWhite).lerp(
      baseColor,
      profile.kind === 'stellarPlasma' ? 0.11 : profile.kind === 'stellarAfterglow' ? 0.28 : 0.06,
    )
    midColor.copy(baseColor).lerp(
      paleBlue,
      profile.kind === 'contactFlash' ? 0.68 : profile.kind === 'stellarAfterglow' ? 0.18 : 0.25,
    )
    edgeColor.copy(baseColor)
    const coolingTarget = profile.kind === 'stellarPlasma' ? coolingRed : coolingAmber
    edgeColor.lerp(
      coolingTarget,
      profile.cooling * (profile.kind === 'stellarPlasma' ? 0.34 : profile.kind === 'stellarAfterglow' ? 0.24 : 0.16),
    )
    edgeColor.offsetHSL(0, -0.08, 0.02)

    const uniforms = visual.material.uniforms
    ;(uniforms.uCoreColor.value as THREE.Color).copy(coreColor)
    ;(uniforms.uMidColor.value as THREE.Color).copy(midColor)
    ;(uniforms.uEdgeColor.value as THREE.Color).copy(edgeColor)
    const syntheticOpacityCap = profile.kind === 'contactFlash'
      ? 0.72
      : profile.kind === 'compressionShear'
        ? 0.60
        : 0.70
    uniforms.uOpacity.value = clamp(
      profile.baseOpacity * profile.fadeAlpha * clamp(opacityScale, 0, 1),
      0,
      synthetic
        ? syntheticOpacityCap
        : stellarEffect
          ? 0.98
          : 0.94,
    )
    uniforms.uProgress.value = profile.progress
    uniforms.uSeed.value = getBodySeed(body.id) * 1000 + (body.effectVisual?.phaseOffset ?? 0) * 37
    uniforms.uKind.value = kindNumber(profile.kind)
    uniforms.uTail.value = profile.tailLength
    uniforms.uTurbulence.value = profile.turbulence
    const brightnessCap = synthetic
      ? profile.kind === 'contactFlash'
        ? 2.08
        : profile.kind === 'compressionShear'
          ? 1.78
          : 1.82
      : stellarEffect
        ? profile.kind === 'contactFlash'
          ? 3.45
          : 3.05
        : 2.82
    uniforms.uBrightness.value = clamp(
      profile.brightness,
      0,
      brightnessCap,
    )
    uniforms.uInnerGlow.value = profile.innerGlow
    uniforms.uOuterGlow.value = profile.outerGlow
    uniforms.uPulse.value = profile.pulseStrength
    uniforms.uSynthetic.value = synthetic ? 1 : 0
  }

  return {
    update(bodies: BodyState[], camera: THREE.Camera) {
      const now = performance.now()
      const physicalEffects = bodies.filter((body) => body.bodyType === 'effect')
      const syntheticEffects = getSyntheticStellarEffects(bodies)
      const syntheticIds = new Set(syntheticEffects.map((body) => body.id))
      const physicalIds = new Set(physicalEffects.map((body) => body.id))

      // Synthetic overlap effects are regenerated from the two still-existing stars.
      // When the solver replaces those stars with a remnant, retain the last peak
      // preview while the physical contact flash appears on the same render update.
      previousSyntheticBodies.forEach((body, id) => {
        if (!syntheticIds.has(id) && !retiringSyntheticBodies.has(id)) {
          retiringSyntheticBodies.set(id, { body, startedAt: now })
        }
      })
      previousSyntheticBodies.clear()
      syntheticEffects.forEach((body) => {
        previousSyntheticBodies.set(body.id, body)
        retiringSyntheticBodies.delete(body.id)
      })

      const retiringEffects: Array<{ body: BodyState; opacity: number }> = []
      retiringSyntheticBodies.forEach((entry, id) => {
        const progress = clamp((now - entry.startedAt) / SYNTHETIC_RETIRE_MS, 0, 1)
        if (progress >= 1) {
          retiringSyntheticBodies.delete(id)
          return
        }
        const smoothProgress = progress * progress * (3 - 2 * progress)
        retiringEffects.push({ body: entry.body, opacity: 1 - smoothProgress })
      })

      physicalEffects.forEach((body) => {
        if (!physicalEffectIntroducedAt.has(body.id)) physicalEffectIntroducedAt.set(body.id, now)
      })
      Array.from(physicalEffectIntroducedAt.keys()).forEach((id) => {
        if (!physicalIds.has(id)) physicalEffectIntroducedAt.delete(id)
      })

      const currentIds = new Set([
        ...physicalEffects.map((body) => body.id),
        ...syntheticEffects.map((body) => body.id),
        ...retiringEffects.map((entry) => entry.body.id),
      ])

      Array.from(visuals.keys()).forEach((id) => {
        if (!currentIds.has(id)) remove(id)
      })

      physicalEffects.forEach((body) => {
        const introducedAt = physicalEffectIntroducedAt.get(body.id) ?? now
        const kind = body.effectVisual?.kind
        const fadeProgress = clamp((now - introducedAt) / PHYSICAL_EFFECT_FADE_IN_MS, 0, 1)
        const smoothFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
        // The physical contact flash starts immediately while the synthetic peak is
        // still retiring. Larger shear/plasma structures then complete the crossfade.
        const opacity = kind === 'contactFlash' ? 1 : 0.22 + smoothFade * 0.78
        // Physical collision VFX age in real time so 0.03x/0.08x observation does
        // not stretch a 0.5-2s visual effect into many seconds of wall-clock time.
        const visualBody = {
          ...body,
          age: Math.max(0, (now - introducedAt) / 1000),
        }
        updateVisual(ensure(body), visualBody, camera, opacity)
      })
      syntheticEffects.forEach((body) => updateVisual(ensure(body), body, camera))
      retiringEffects.forEach(({ body, opacity }) => {
        updateVisual(ensure(body), body, camera, opacity)
      })
    },
    dispose() {
      previousSyntheticBodies.clear()
      retiringSyntheticBodies.clear()
      physicalEffectIntroducedAt.clear()
      Array.from(visuals.keys()).forEach(remove)
      scene.remove(group)
      geometry.dispose()
    },
  }
}
