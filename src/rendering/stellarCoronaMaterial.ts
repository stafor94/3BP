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
        // SpriteMaterial uses map_particle_fragment, not the mesh map_fragment
        // chunk. Override alpha immediately after its shared texture sample so the
        // legacy radial glow texture no longer determines stellar halo shape.
        .replace(
          '#include <map_particle_fragment>',
          `#include <map_particle_fragment>
          vec2 coronaDelta = vMapUv - vec2(0.5);
          float coronaRadius = length(coronaDelta) * 2.0;
          float coronaAngle = atan(coronaDelta.y, coronaDelta.x);
          float coronaPhotosphereRadius = clamp(uCoronaPhotosphereRadiusUv, 0.54, 0.82);
          float coronaSpan = max(1.0 - coronaPhotosphereRadius, 0.08);
          float coronaDistance01 = max(coronaRadius - coronaPhotosphereRadius, 0.0) / coronaSpan;
          float coronaPhase = uCoronaTime * 0.0016;
          float coronaAngularA = sin(coronaAngle * 5.0 + uCoronaSeed * 0.071 + coronaPhase);
          float coronaAngularB = sin(coronaAngle * 9.0 - uCoronaSeed * 0.113 - coronaPhase * 0.73);
          float coronaAngularWarp = coronaAngularA * 0.050 + coronaAngularB * 0.024;
          float coronaWarpWeight = smoothstep(0.05, 0.88, coronaDistance01);
          float warpedDistance01 = max(
            coronaDistance01 * (1.0 + coronaAngularWarp * coronaWarpWeight),
            0.0
          );
          float coronaOutsideMask = smoothstep(
            coronaPhotosphereRadius - 0.010,
            coronaPhotosphereRadius + 0.014,
            coronaRadius
          );
          float coronaNearLimb = exp(-pow(warpedDistance01 / 0.14, 2.0));
          float coronaOuter =
            exp(-warpedDistance01 * 5.4) *
            (1.0 - smoothstep(0.72, 1.0, warpedDistance01));
          float coronaAngularBrightness = clamp(
            1.0 + coronaAngularA * 0.040 + coronaAngularB * 0.018,
            0.92,
            1.08
          );
          float coronaSpriteEdge = 1.0 - smoothstep(0.91, 1.0, coronaRadius);
          float coronaAlpha =
            coronaOutsideMask *
            (coronaNearLimb * 0.84 + coronaOuter * 0.16) *
            coronaAngularBrightness *
            coronaSpriteEdge;
          diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);
          float coronaOuterColorWeight = smoothstep(0.14, 0.78, warpedDistance01);
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
