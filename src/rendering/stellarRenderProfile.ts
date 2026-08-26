export type StellarRenderProfile = {
  photosphereIntensity: number
  whiteHotMix: number
  innerGlowScale: number
  outerGlowScale: number
  innerGlowOpacity: number
  outerGlowOpacity: number
  outerHaloWhiteMix: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function getCompressedStellarLuminosity01(luminositySolar: number) {
  const safeLuminosity = Math.max(
    Number.isFinite(luminositySolar) ? luminositySolar : 1,
    0.0001,
  )

  // Rendered brightness deliberately spans a much smaller range than physical
  // luminosity. This keeps multi-order-of-magnitude stellar luminosities legible
  // on SDR displays without erasing the photosphere hue through clipping.
  return clamp((Math.log10(safeLuminosity) + 2.5) / 8.5, 0, 1)
}

export function getStellarRenderProfile(
  luminositySolar: number,
  surfaceTemperatureK: number,
): StellarRenderProfile {
  const luminosity01 = getCompressedStellarLuminosity01(luminositySolar)
  const temperature01 = clamp(
    ((Number.isFinite(surfaceTemperatureK) ? surfaceTemperatureK : 5778) - 2800) / 27200,
    0,
    1,
  )

  return {
    // The photosphere stays near display-white luminance, while luminosity is
    // communicated mostly through halo extent/opacity and illumination.
    photosphereIntensity: 0.92 + luminosity01 * 0.10 + temperature01 * 0.035,
    // Only a very small central patch is allowed to trend white-hot.
    whiteHotMix: 0.008 + temperature01 * 0.032 + luminosity01 * 0.012,
    innerGlowScale: 3.65 + luminosity01 * 0.85,
    outerGlowScale: 7.10 + luminosity01 * 1.75,
    innerGlowOpacity: 0.28 + luminosity01 * 0.16,
    outerGlowOpacity: 0.07 + luminosity01 * 0.09,
    // The far halo may desaturate slightly while the core/inner glow retain hue.
    outerHaloWhiteMix: 0.055 + luminosity01 * 0.045,
  }
}
