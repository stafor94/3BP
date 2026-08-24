export type StellarSpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M'

export type StellarColorOption = {
  spectralClass: StellarSpectralClass
  hex: string
  temperatureK: number
  nameKo: string
  nameEn: string
}

// Display-oriented approximations of visible stellar colors. Real stellar colors are
// comparatively pale because hot blackbody spectra emit across a broad wavelength range.
export const STELLAR_COLOR_OPTIONS: readonly StellarColorOption[] = [
  { spectralClass: 'O', hex: '#9bbcff', temperatureK: 35000, nameKo: '청색', nameEn: 'Blue' },
  { spectralClass: 'B', hex: '#aecbff', temperatureK: 18000, nameKo: '청백색', nameEn: 'Blue-white' },
  { spectralClass: 'A', hex: '#d5e2ff', temperatureK: 9000, nameKo: '백색', nameEn: 'White' },
  { spectralClass: 'F', hex: '#fff9f2', temperatureK: 7000, nameKo: '황백색', nameEn: 'Yellow-white' },
  { spectralClass: 'G', hex: '#fff1dc', temperatureK: 5800, nameKo: '황색', nameEn: 'Yellow' },
  { spectralClass: 'K', hex: '#ffd0a0', temperatureK: 4500, nameKo: '주황색', nameEn: 'Orange' },
  { spectralClass: 'M', hex: '#ffad73', temperatureK: 3200, nameKo: '적색', nameEn: 'Red' },
] as const

export const STELLAR_COLOR_BY_CLASS = Object.fromEntries(
  STELLAR_COLOR_OPTIONS.map((option) => [option.spectralClass, option.hex]),
) as Record<StellarSpectralClass, string>

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return { r: 255, g: 255, b: 255 }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

export function getNearestStellarColor(color: string): StellarColorOption {
  const source = hexToRgb(color)
  let best = STELLAR_COLOR_OPTIONS[0]
  let bestDistance = Number.POSITIVE_INFINITY

  STELLAR_COLOR_OPTIONS.forEach((option) => {
    const candidate = hexToRgb(option.hex)
    const distance =
      (source.r - candidate.r) ** 2 +
      (source.g - candidate.g) ** 2 +
      (source.b - candidate.b) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = option
    }
  })

  return best
}

export function formatStellarColorOption(option: StellarColorOption, language: 'ko' | 'en') {
  const name = language === 'ko' ? option.nameKo : option.nameEn
  return `${option.spectralClass} · ${name} · ≈${option.temperatureK.toLocaleString()} K`
}
