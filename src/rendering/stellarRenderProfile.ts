export type StellarRenderProfile = {
  photosphereIntensity: number
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
    // Keep the local photosphere range close to linear before ACES so the broad
    // radial gradient and low-frequency texture survive tone mapping. Preserve a
    // small emissive floor for the coolest stars without restoring the old white
    // shoulder or using global exposure as compensation.
    photosphereIntensity: 1.03 + luminosity01 * 0.07 + temperature01 * 0.03,
    // One existing sprite carries immediate glow and a much wider diffuse tail.
    // Its edge is beyond the visible tail so no circular cutoff is perceptible.
    coronaScale: 8.0 + luminosity01 * 0.4,
    coronaOpacity: 0.88 + luminosity01 * 0.06,
    coronaOuterWhiteMix: 0.02,
  }
}
