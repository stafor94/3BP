import * as THREE from 'three'

export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass6'

type StellarCoronaUniformState = {
  uCoronaTime: { value: number }
  uCoronaSeed: { value: number }
  uCoronaPhotosphereRadiusUv: { value: number }
  uCoronaOuterWhiteMix: { value: number }
  uCoronaEnvelope: { value: number }
}

export type StellarCoronaFrame = {
  seed: number
  timeSeconds: number
  photosphereRadiusUv: number
  outerWhiteMix: number
  envelopeActive?: boolean
}

export function configureStellarCoronaMaterial(
  material: THREE.SpriteMaterial,
  frame: StellarCoronaFrame,
) {
  // The corona is an emissive transparent carrier: additive color with straight
  // alpha, depth-tested against opaque photospheres, and never writing depth.
  // This keeps a farther star's glow from drawing through a nearer stellar disk
  // while preserving order-independent additive overlap between corona sprites.
  let renderStateChanged = false
  if (material.blending !== THREE.AdditiveBlending) {
    material.blending = THREE.AdditiveBlending
    renderStateChanged = true
  }
  if (!material.depthTest) {
    material.depthTest = true
    renderStateChanged = true
  }
  if (material.depthWrite) {
    material.depthWrite = false
    renderStateChanged = true
  }
  if (material.premultipliedAlpha) {
    material.premultipliedAlpha = false
    renderStateChanged = true
  }
  if (renderStateChanged) material.needsUpdate = true

  material.userData.stellarCoronaTime = frame.timeSeconds
  material.userData.stellarCoronaSeed = frame.seed
  material.userData.stellarCoronaPhotosphereRadiusUv = frame.photosphereRadiusUv
  material.userData.stellarCoronaOuterWhiteMix = frame.outerWhiteMix
  material.userData.stellarCoronaEnvelope = frame.envelopeActive ? 1 : 0

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
        uCoronaEnvelope: { value: material.userData.stellarCoronaEnvelope ?? 0 },
      }
      shader.uniforms.uCoronaTime = uniforms.uCoronaTime
      shader.uniforms.uCoronaSeed = uniforms.uCoronaSeed
      shader.uniforms.uCoronaPhotosphereRadiusUv = uniforms.uCoronaPhotosphereRadiusUv
      shader.uniforms.uCoronaOuterWhiteMix = uniforms.uCoronaOuterWhiteMix
      shader.uniforms.uCoronaEnvelope = uniforms.uCoronaEnvelope
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uCoronaTime;
          uniform float uCoronaSeed;
          uniform float uCoronaPhotosphereRadiusUv;
          uniform float uCoronaOuterWhiteMix;
          uniform float uCoronaEnvelope;`,
        )
        // SpriteMaterial uses the standard map_fragment chunk. The shared legacy
        // texture still supplies UV/RGB carrier data, but corona alpha is owned by
        // this signed-distance profile so scale changes do not expose texture bands.
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
          float signedDistance = radiusInPhotospheres - 1.0;
          float distanceOutside = max(signedDistance, 0.0);
          float angularWarp = 1.0 + (coronaAngularA * 0.05 + coronaAngularB * 0.025)
            * smoothstep(0.0, 0.7, distanceOutside);
          float distanceR = distanceOutside * angularWarp;

          // Keep the photosphere-adjacent glow broad and subordinate to the body.
          // A high peak exactly at the silhouette reads as a stamped white ring on
          // compact post-collision survivors, so energy rises outside the limb and
          // decays smoothly into the existing diffuse halo.
          float pixelR = fwidth(radiusInPhotospheres);
          float immediateWidth = max(0.30, pixelR * 1.8);
          float immediateGlow = exp(-pow(distanceR / immediateWidth, 2.0)) * 0.20;
          float softShoulder = exp(-distanceR / 0.46) * 0.17;
          float diffuseHalo = exp(-distanceR / 1.0) * 0.10;
          // Fade over the outer quarter of the carrier rather than close to its
          // edge so sprite scaling/rotation cannot reveal a circular cutoff.
          float carrierFade = 1.0 - smoothstep(0.74, 1.0, coronaRadius);

          // Let only a very small pixel-aware overlap bridge photosphere AA. Most
          // corona energy begins outside the physical limb, preventing additive
          // light from becoming a bright annulus inside a dimmer stellar edge.
          float overlapWidth = clamp(pixelR * 1.5, 0.025, 0.05);
          float coronaCoverage = smoothstep(
            -overlapWidth * 0.20,
            overlapWidth * 0.80,
            signedDistance
          );
          // A deformed envelope has no circular hidden-body outline. The envelope
          // factor is continuously relaxed during late settle by its owner layer.
          coronaCoverage = mix(coronaCoverage, 1.0, uCoronaEnvelope);
          float coronaAlpha = clamp(
            (immediateGlow + softShoulder + diffuseHalo)
            * carrierFade
            * coronaCoverage,
            0.0,
            1.0
          );
          diffuseColor.a = opacity * coronaAlpha;
          if (diffuseColor.a <= 0.0005) discard;

          // Preserve stellar temperature hue at the silhouette. The corona may
          // whiten slightly outward, but never enough to stamp a white rim.
          float nearWhite = exp(-distanceR / 0.24);
          float whiteMix = mix(uCoronaOuterWhiteMix, 0.055, nearWhite);
          vec3 coronaColor = mix(diffuseColor.rgb, vec3(1.0), whiteMix);
          diffuseColor.rgb = coronaColor;`,
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
    uniforms.uCoronaEnvelope.value = frame.envelopeActive ? 1 : 0
  }
}
