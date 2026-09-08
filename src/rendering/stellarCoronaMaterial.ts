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
          float coronaPhotosphereRadius = clamp(uCoronaPhotosphereRadiusUv, 0.20, 0.82);
          float radiusInPhotospheres = coronaRadius / coronaPhotosphereRadius;
          float coronaPhase = uCoronaTime * 0.0016;
          float coronaAngularA = sin(coronaAngle * 5.0 + uCoronaSeed * 0.071 + coronaPhase);
          float coronaAngularB = sin(coronaAngle * 9.0 - uCoronaSeed * 0.113 - coronaPhase * 0.73);
          float distanceOutside = max(radiusInPhotospheres - 0.95, 0.0);
          float angularWarp = 1.0 + (coronaAngularA * 0.05 + coronaAngularB * 0.025)
            * smoothstep(0.0, 0.7, distanceOutside);
          float distanceR = distanceOutside * angularWarp;

          // Three overlapping, monotonically decaying light distributions.
          // No outside-only rising mask: it left an unlit seam at the silhouette.
          // The bright inner component overlaps the photosphere's alpha feather.
          float pixelR = fwidth(radiusInPhotospheres);
          // A Gaussian shoulder has zero slope where it meets the disk.
          // The former exponential lost most near-light within 0.12R, leaving
          // a crisp silhouette despite the broad, faint outer halo.
          float immediateWidth = max(0.24, pixelR * 1.5);
          float immediateGlow = exp(-pow(distanceR / immediateWidth, 2.0)) * 0.62;
          float softShoulder = exp(-distanceR / 0.42) * 0.28;
          float diffuseHalo = exp(-distanceR / 1.0) * 0.10;
          float carrierFade = 1.0 - smoothstep(0.88, 0.995, coronaRadius);
          float coronaAlpha = (immediateGlow + softShoulder + diffuseHalo) * carrierFade;
          diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);

          // Keep the photosphere-adjacent glow mostly temperature-colored. Only a
          // small neutral component remains at the handoff; the existing radial
          // light distributions and falloff are intentionally unchanged.
          float nearWhite = exp(-distanceR / 0.24);
          float whiteMix = mix(uCoronaOuterWhiteMix, 0.18, nearWhite);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), whiteMix);`,
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
