export type StellarSpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M'

export type StellarColorOption = {
  spectralClass: StellarSpectralClass
  hex: string
  temperatureK: number
  nameKo: string
  nameEn: string
}

export type StellarRgb = { r: number; g: number; b: number }

// Display-oriented approximations of visible stellar colors. The palette deliberately
// keeps realistic spectral ordering while increasing perceptual separation for the simulator UI.
export const STELLAR_COLOR_OPTIONS: readonly StellarColorOption[] = [
  { spectralClass: 'O', hex: '#7ea7ff', temperatureK: 35000, nameKo: '청색', nameEn: 'Blue' },
  { spectralClass: 'B', hex: '#a9c6ff', temperatureK: 18000, nameKo: '청백색', nameEn: 'Blue-white' },
  { spectralClass: 'A', hex: '#f5f7ff', temperatureK: 9000, nameKo: '백색', nameEn: 'White' },
  { spectralClass: 'F', hex: '#fff4e8', temperatureK: 7000, nameKo: '황백색', nameEn: 'Yellow-white' },
  { spectralClass: 'G', hex: '#ffd36b', temperatureK: 5800, nameKo: '황색(태양형)', nameEn: 'Yellow (Sun-like)' },
  { spectralClass: 'K', hex: '#ffaf5f', temperatureK: 4500, nameKo: '주황색', nameEn: 'Orange' },
  { spectralClass: 'M', hex: '#ff6b5e', temperatureK: 3200, nameKo: '적색', nameEn: 'Red' },
] as const

export const STELLAR_COLOR_BY_CLASS = Object.fromEntries(
  STELLAR_COLOR_OPTIONS.map((option) => [option.spectralClass, option.hex]),
) as Record<StellarSpectralClass, string>

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return { r: 255, g: 255, b: 255 }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function normalizeStellarMass(mass: number) {
  return clamp(Number.isFinite(mass) ? mass : 1, 0.08, 60)
}

function rgbToHex({ r, g, b }: StellarRgb) {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function getStellarLuminosityFromMass(mass: number) {
  const m = normalizeStellarMass(mass)
  if (m < 0.43) return 0.23 * m ** 2.3
  if (m < 2) return m ** 4
  if (m < 20) return 1.5 * m ** 3.5

  // Very massive main-sequence stars approach the Eddington regime, so do not
  // continue the steep M^3.5 law indefinitely. Preserve monotonicity while
  // keeping collision remnants numerically and visually bounded.
  const luminosityAt20 = 1.5 * 20 ** 3.5
  return luminosityAt20 * (m / 20) ** 1.35
}

export function getStellarRadiusFromMass(mass: number) {
  return normalizeStellarMass(mass) ** 0.8
}

export function getStellarTemperatureKelvin(
  mass: number,
  radiusSolar = getStellarRadiusFromMass(mass),
) {
  const luminositySolar = getStellarLuminosityFromMass(mass)
  const radius = Math.max(radiusSolar, 0.05)
  return clamp(5778 * (luminositySolar / (radius * radius)) ** 0.25, 2400, 50000)
}

export function kelvinToRgb(temperatureK: number): StellarRgb {
  const temperature = clamp(temperatureK, 1000, 40000) / 100
  let r: number
  let g: number
  let b: number

  if (temperature <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(temperature) - 161.1195681661
  } else {
    r = 329.698727446 * (temperature - 60) ** -0.1332047592
    g = 288.1221695283 * (temperature - 60) ** -0.0755148492
  }

  if (temperature >= 66) b = 255
  else if (temperature <= 19) b = 0
  else b = 138.5177312231 * Math.log(temperature - 10) - 305.044792731

  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
  }
}

export function getStellarDisplayColorFromTemperature(temperatureK: number) {
  const source = kelvinToRgb(temperatureK)
  const luminance = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722
  const desaturate = 0.055
  const whiteMix = 0.045
  const toneMapped: StellarRgb = {
    r: (source.r * (1 - desaturate) + luminance * desaturate) * (1 - whiteMix) + 255 * whiteMix,
    g: (source.g * (1 - desaturate) + luminance * desaturate) * (1 - whiteMix) + 255 * whiteMix,
    b: (source.b * (1 - desaturate) + luminance * desaturate) * (1 - whiteMix) + 255 * whiteMix,
  }
  return rgbToHex(toneMapped)
}

export function getEquilibriumStellarDisplayColor(mass: number) {
  return getStellarDisplayColorFromTemperature(getStellarTemperatureKelvin(mass))
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
