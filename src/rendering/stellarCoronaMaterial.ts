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
          // This value is derived from the Sprite's real scale (2 / scale), so
          // do not clamp it back to the old compact carrier footprint.
          float coronaPhotosphereRadius = clamp(uCoronaPhotosphereRadiusUv, 0.40, 0.82);
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

          // Keep the compact core, but give its shoulder enough energy to remain
          // legible at production mobile scale. The broad lobe avoids turning the
          // extra energy into a thin outline while leaving the photosphere masked.
          float coronaNearLimb = exp(-pow(warpedDistance01 / 0.14, 2.0));
          float coronaNearShoulder = exp(-pow(warpedDistance01 / 0.42, 1.48));
          float coronaNearRegion = coronaNearLimb * 0.38 + coronaNearShoulder * 0.62;

          // Keep the historical fast tail present for continuity, but make the
          // visible outer region come primarily from a much weaker, slower diffuse
          // component. It rises after the near-limb shoulder and is forced to zero
          // before the Sprite edge so it cannot read as a separate circular halo.
          float coronaOuter =
            exp(-warpedDistance01 * 4.8) *
            (1.0 - smoothstep(0.82, 1.0, warpedDistance01));
          float coronaOuterRise = smoothstep(0.10, 0.28, warpedDistance01);
          float coronaOuterDiffuse =
            exp(-warpedDistance01 * 2.10) *
            coronaOuterRise *
            (1.0 - smoothstep(0.88, 0.995, warpedDistance01));
          float coronaOuterRegion = coronaOuter * 0.10 + coronaOuterDiffuse * 0.90;

          float coronaAngularBrightness = clamp(
            1.0 + coronaAngularA * 0.018 + coronaAngularB * 0.008,
            0.96,
            1.04
          );
          float coronaSpriteEdge = 1.0 - smoothstep(0.90, 0.985, coronaRadius);
          float coronaAlpha =
            coronaOutsideMask *
            (coronaNearRegion * 0.70 + coronaOuterRegion * 0.42) *
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
