export type StellarRenderProfile = {
  photosphereIntensity: number
  whiteHotMix: number
  coronaScale: number
  coronaOpacity: number
  coronaOuterWhiteMix: number
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
    photosphereIntensity: 0.92 + luminosity01 * 0.10 + temperature01 * 0.035,
    whiteHotMix: 0.008 + temperature01 * 0.032 + luminosity01 * 0.012,
    // Corona stays a short atmospheric fringe around the photosphere. Stellar
    // identity and apparent brightness come from the textured emitting surface,
    // not from a large diffuse Sprite footprint.
    coronaScale: 2.90 + luminosity01 * 0.14,
    coronaOpacity: 0.18 + luminosity01 * 0.055,
    // Only the faint outer tail may desaturate, and even there very slightly.
    coronaOuterWhiteMix: 0.014 + luminosity01 * 0.020,
  }
}
