import * as THREE from 'three'

export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass5'

type StellarCoronaUniformState = {
  uCoronaTime: { value: number }
  uCoronaSeed: { value: number }
  uCoronaPhotosphereRadiusUv: { value: number }
  uCoronaOuterWhiteMix: { value: number }
}

export type StellarCoronaFrame = {
  seed: number
  timeSeconds: number
  photosphereRadiusUv: number
  outerWhiteMix: number
}

export function configureStellarCoronaMaterial(
  material: THREE.SpriteMaterial,
  frame: StellarCoronaFrame,
) {
  // Preserve the existing additive stellar-light compositing. Normal blending can
  // make the carrier quad itself perceptible over a dark background even when the
  // intended corona is faint.
  if (material.blending !== THREE.AdditiveBlending) {
    material.blending = THREE.AdditiveBlending
    material.needsUpdate = true
  }

  material.userData.stellarCoronaTime = frame.timeSeconds
  material.userData.stellarCoronaSeed = frame.seed
  material.userData.stellarCoronaPhotosphereRadiusUv = frame.photosphereRadiusUv
  material.userData.stellarCoronaOuterWhiteMix = frame.outerWhiteMix

  if (!material.userData.stellarCoronaShaderInstalled) {
    material.userData.stellarCoronaShaderInstalled = true
    material.onBeforeCompile = (shader) => {
      const uniforms: StellarCoronaUniformState = {
        uCoronaTime: { value: material.userData.stellarCoronaTime ?? 0 },
        uCoronaSeed: { value: material.userData.stellarCoronaSeed ?? 0 },
        uCoronaPhotosphereRadiusUv: {
          value: material.userData.stellarCoronaPhotosphereRadiusUv ?? 0.72,
        },
        uCoronaOuterWhiteMix: {
          value: material.userData.stellarCoronaOuterWhiteMix ?? 0.02,
        },
      }
      shader.uniforms.uCoronaTime = uniforms.uCoronaTime
      shader.uniforms.uCoronaSeed = uniforms.uCoronaSeed
      shader.uniforms.uCoronaPhotosphereRadiusUv = uniforms.uCoronaPhotosphereRadiusUv
      shader.uniforms.uCoronaOuterWhiteMix = uniforms.uCoronaOuterWhiteMix
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uCoronaTime;
          uniform float uCoronaSeed;
          uniform float uCoronaPhotosphereRadiusUv;
          uniform float uCoronaOuterWhiteMix;`,
        )
        // SpriteMaterial uses the standard map_fragment chunk. Override alpha
        // immediately after its shared texture sample so one existing Sprite can
        // carry both the photosphere-adjacent glow and the faint diffuse corona.
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 coronaDelta = vMapUv - vec2(0.5);
          float coronaRadius = length(coronaDelta) * 2.0;
          float coronaAngle = atan(coronaDelta.y, coronaDelta.x);
          float coronaPhotosphereRadius = clamp(uCoronaPhotosphereRadiusUv, 0.56, 0.82);
          float coronaSpan = max(1.0 - coronaPhotosphereRadius, 0.08);
          float coronaDistance01 = max(coronaRadius - coronaPhotosphereRadius, 0.0) / coronaSpan;
          float coronaPhase = uCoronaTime * 0.0016;
          float coronaAngularA = sin(coronaAngle * 5.0 + uCoronaSeed * 0.071 + coronaPhase);
          float coronaAngularB = sin(coronaAngle * 9.0 - uCoronaSeed * 0.113 - coronaPhase * 0.73);
          float coronaAngularWarp = coronaAngularA * 0.050 + coronaAngularB * 0.024;
          coronaAngularWarp *= 0.68;
          float coronaWarpWeight = smoothstep(0.10, 0.90, coronaDistance01);
          float warpedDistance01 = max(
            coronaDistance01 * (1.0 + coronaAngularWarp * coronaWarpWeight),
            0.0
          );

          // The corona begins at the silhouette, not over the photosphere. A tiny
          // derivative-independent overlap prevents a dark seam without washing
          // out Pass 2 granulation or Pass 3 center-to-limb depth.
          float coronaOutsideMask = smoothstep(
            coronaPhotosphereRadius - 0.002,
            coronaPhotosphereRadius + 0.018,
            coronaRadius
          );

          // Keep a compact shoulder visible at production mobile scale without
          // letting it become either a detached halo or a thin neon outline.
          float coronaNearLimb = exp(-pow(warpedDistance01 / 0.12, 2.0));
          float coronaNearShoulder = exp(-pow(warpedDistance01 / 0.27, 1.62));
          float coronaNearRegion = coronaNearLimb * 0.46 + coronaNearShoulder * 0.54;

          // The weak outer component rises after the shoulder, decays quickly,
          // and reaches zero well before the Sprite edge.
          float coronaOuter =
            exp(-warpedDistance01 * 6.4) *
            (1.0 - smoothstep(0.58, 0.78, warpedDistance01));
          float coronaOuterRise = smoothstep(0.10, 0.22, warpedDistance01);
          float coronaOuterDiffuse =
            exp(-warpedDistance01 * 4.2) *
            coronaOuterRise *
            (1.0 - smoothstep(0.52, 0.72, warpedDistance01));
          float coronaOuterRegion = coronaOuter * 0.34 + coronaOuterDiffuse * 0.66;

          float coronaAngularBrightness = clamp(
            1.0 + coronaAngularA * 0.018 + coronaAngularB * 0.008,
            0.96,
            1.04
          );
          float coronaSpriteEdge = 1.0 - smoothstep(0.90, 0.985, coronaRadius);
          float coronaAlpha =
            coronaOutsideMask *
            (coronaNearRegion * 0.74 + coronaOuterRegion * 0.24) *
            0.80 *
            coronaAngularBrightness *
            coronaSpriteEdge;
          diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);

          // Preserve temperature identity through most of the corona. Only the
          // weakest outer tail receives the already tightly bounded desaturation.
          float coronaOuterColorWeight = smoothstep(0.28, 0.84, warpedDistance01);
          float coronaPeak = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
          diffuseColor.rgb = mix(
            diffuseColor.rgb,
            vec3(coronaPeak),
            uCoronaOuterWhiteMix * coronaOuterColorWeight
          );`,
        )
      material.userData.stellarCoronaUniforms = uniforms
    }
    material.customProgramCacheKey = () => STELLAR_CORONA_RENDER_PATH
    material.needsUpdate = true
  }

  const uniforms = material.userData.stellarCoronaUniforms as StellarCoronaUniformState | undefined
  if (uniforms) {
    uniforms.uCoronaTime.value = frame.timeSeconds
    uniforms.uCoronaSeed.value = frame.seed
    uniforms.uCoronaPhotosphereRadiusUv.value = frame.photosphereRadiusUv
    uniforms.uCoronaOuterWhiteMix.value = frame.outerWhiteMix
  }
}
