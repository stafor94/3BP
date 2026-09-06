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
  // on SDR displays; temperature identity is carried by the surrounding light.
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
    // Keep all three core channels on the photographic highlight shoulder.
    photosphereIntensity: 4.0 + luminosity01 * 0.45 + temperature01 * 0.10,
    whiteHotMix: 0.98,
    // One existing sprite carries immediate glow and a much wider diffuse tail.
    // Its edge is beyond the visible tail so no circular cutoff is perceptible.
    coronaScale: 8.0 + luminosity01 * 0.4,
    coronaOpacity: 0.88 + luminosity01 * 0.06,
    coronaOuterWhiteMix: 0.02,
  }
}
