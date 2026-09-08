export type StellarRenderProfile = {
  photosphereIntensity: number
  centerHighlightStrength: number
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
  // on SDR displays; temperature identity is carried by the emitted light color.
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
    // Keep the temperature-colored disk well below the ACES white shoulder.
    // A separate additive center highlight restores the compact photographic core.
    photosphereIntensity: 1.05 + luminosity01 * 0.12 + temperature01 * 0.08,
    centerHighlightStrength: 0.82 + luminosity01 * 0.12,
    // One existing sprite carries immediate glow and a much wider diffuse tail.
    // Its edge is beyond the visible tail so no circular cutoff is perceptible.
    coronaScale: 8.0 + luminosity01 * 0.4,
    coronaOpacity: 0.88 + luminosity01 * 0.06,
    coronaOuterWhiteMix: 0.02,
  }
}
