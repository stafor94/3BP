import type { BodyState, StellarEvolutionStage } from './types'

export type StellarSpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M'

export type StellarColorOption = {
  spectralClass: StellarSpectralClass
  hex: string
  temperatureK: number
  nameKo: string
  nameEn: string
}

export type StellarRgb = { r: number; g: number; b: number }

export type StellarComputedProperties = {
  stage: StellarEvolutionStage
  phase01: number
  radiusSolar: number
  luminositySolar: number
  surfaceTemperatureK: number
  coreTemperatureK: number
  spectralClass: StellarSpectralClass
  displayColor: string
  simulationRadius: number
}

export const STELLAR_EVOLUTION_STAGES: readonly StellarEvolutionStage[] = [
  'protostar',
  'mainSequence',
  'subgiant',
  'giant',
  'supergiant',
  'whiteDwarf',
] as const

// Retained as a read-only legend and for legacy preset compatibility. A star's
// actual identity color is no longer selected from this table by the user.
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
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1)

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
  return clamp(Number.isFinite(mass) ? mass : 1, 0.08, 120)
}

function normalizePhase(phase01: number | undefined) {
  return clamp(Number.isFinite(phase01) ? phase01 as number : 0.5, 0, 1)
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

  // Massive stars flatten toward an Eddington-like regime so collision remnants
  // remain numerically stable instead of following M^3.5 without bound.
  const luminosityAt20 = 1.5 * 20 ** 3.5
  return luminosityAt20 * (m / 20) ** 1.35
}

export function getStellarRadiusFromMass(mass: number) {
  return normalizeStellarMass(mass) ** 0.8
}

export function getStellarStageRadiusMultiplier(
  mass: number,
  stage: StellarEvolutionStage,
  phase01 = 0.5,
) {
  const m = normalizeStellarMass(mass)
  const phase = normalizePhase(phase01)

  if (stage === 'protostar') {
    const lowMassInflation = clamp((1.2 / m) ** 0.12, 0.9, 1.35)
    return lerp(3.8, 1.45, phase) * lowMassInflation
  }
  if (stage === 'mainSequence') return lerp(0.97, 1.1, phase)
  if (stage === 'subgiant') return lerp(1.45, 2.8, phase)
  if (stage === 'giant') {
    const highMassCompression = m >= 8 ? 0.72 : m >= 3 ? 0.86 : 1
    return lerp(6, 28, phase) * highMassCompression
  }
  if (stage === 'supergiant') {
    if (m >= 8) return lerp(8, 58, phase)
    return lerp(14, 42, phase)
  }

  // White dwarfs are set by an approximate mass-radius relation rather than by
  // inflating a main-sequence radius. The multiplier form keeps the public API
  // uniform while producing ~0.008-0.02 R_sun remnants.
  const whiteDwarfRadius = clamp(0.0125 * (0.65 / clamp(m, 0.35, 1.35)) ** 0.55, 0.007, 0.021)
  return whiteDwarfRadius / getStellarRadiusFromMass(m)
}

export function getStellarStageLuminosityMultiplier(
  mass: number,
  stage: StellarEvolutionStage,
  phase01 = 0.5,
) {
  const m = normalizeStellarMass(mass)
  const phase = normalizePhase(phase01)

  if (stage === 'protostar') return lerp(0.78, 0.62, phase) * clamp(m ** 0.08, 0.82, 1.22)
  if (stage === 'mainSequence') return lerp(0.9, 1.22, phase)
  if (stage === 'subgiant') return lerp(1.5, 4.2, phase)
  if (stage === 'giant') return lerp(12, m >= 8 ? 62 : 95, phase)
  if (stage === 'supergiant') {
    if (m >= 8) return lerp(2.2, 4.8, phase)
    return lerp(90, 360, phase)
  }

  const cooling = (1 - phase) ** 2.25
  return 0.004 + 0.42 * cooling / Math.max(getStellarLuminosityFromMass(m), 0.02)
}

export function getStellarRadiusFromEvolution(
  mass: number,
  stage: StellarEvolutionStage,
  phase01 = 0.5,
  radiusScale = 1,
) {
  const safeScale = clamp(Number.isFinite(radiusScale) ? radiusScale : 1, 0.2, 5)
  return Math.max(
    0.006,
    getStellarRadiusFromMass(mass) * getStellarStageRadiusMultiplier(mass, stage, phase01) * safeScale,
  )
}

export function getStellarLuminosityFromEvolution(
  mass: number,
  stage: StellarEvolutionStage,
  phase01 = 0.5,
) {
  return Math.max(
    0.0001,
    getStellarLuminosityFromMass(mass) * getStellarStageLuminosityMultiplier(mass, stage, phase01),
  )
}

export function getStellarSurfaceTemperatureKelvin(
  _mass: number,
  radiusSolar: number,
  luminositySolar: number,
) {
  const radius = Math.max(radiusSolar, 0.004)
  const luminosity = Math.max(luminositySolar, 0.00001)
  return clamp(5778 * (luminosity / (radius * radius)) ** 0.25, 1800, 60000)
}

export function getStellarCoreTemperatureKelvin(
  mass: number,
  radiusSolar: number,
  stage: StellarEvolutionStage,
) {
  const stageMultiplier: Record<StellarEvolutionStage, number> = {
    protostar: 0.48,
    mainSequence: 1,
    subgiant: 2.4,
    giant: 8,
    supergiant: 11,
    whiteDwarf: 0.42,
  }
  const raw = 1.5e7 * (normalizeStellarMass(mass) / Math.max(radiusSolar, 0.006)) * stageMultiplier[stage]
  return clamp(raw, 7.5e5, 2.2e9)
}

// Legacy mass-only helper remains available for the collision solver. New UI and
// rendering code should prefer getStellarComputedProperties/getStellarDisplayColorFromBody.
export function getStellarTemperatureKelvin(
  mass: number,
  radiusSolar = getStellarRadiusFromMass(mass),
) {
  const luminositySolar = getStellarLuminosityFromMass(mass)
  return getStellarSurfaceTemperatureKelvin(mass, radiusSolar, luminositySolar)
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

export function getStellarSpectralClassFromTemperature(temperatureK: number): StellarSpectralClass {
  if (temperatureK >= 30000) return 'O'
  if (temperatureK >= 10000) return 'B'
  if (temperatureK >= 7500) return 'A'
  if (temperatureK >= 6000) return 'F'
  if (temperatureK >= 5200) return 'G'
  if (temperatureK >= 3700) return 'K'
  return 'M'
}

export function getStellarSimulationRadius(
  mass: number,
  stage: StellarEvolutionStage,
  phase01 = 0.5,
  radiusScale = 1,
) {
  const m = normalizeStellarMass(mass)
  const mainRadius = getStellarRadiusFromMass(m)
  const evolvedRadius = getStellarRadiusFromEvolution(m, stage, phase01, radiusScale)
  const evolvedRatio = evolvedRadius / Math.max(mainRadius, 0.006)
  // 0.075 at one solar mass preserves the simulator's existing collision scale.
  // Evolutionary size differences are compressed so giants are clearly larger
  // without making an orbit-sized photosphere.
  return clamp(0.075 * m ** 0.36 * evolvedRatio ** 0.38, 0.012, 0.62)
}

export function getStellarComputedProperties(body: Pick<
  BodyState,
  'mass' | 'stellarEvolutionStage' | 'stellarEvolutionPhase01' | 'stellarRadiusScale'
>): StellarComputedProperties {
  const stage = body.stellarEvolutionStage ?? 'mainSequence'
  const phase01 = normalizePhase(body.stellarEvolutionPhase01)
  const radiusScale = body.stellarRadiusScale ?? 1
  const radiusSolar = getStellarRadiusFromEvolution(body.mass, stage, phase01, radiusScale)
  const luminositySolar = getStellarLuminosityFromEvolution(body.mass, stage, phase01)
  const surfaceTemperatureK = getStellarSurfaceTemperatureKelvin(body.mass, radiusSolar, luminositySolar)
  const coreTemperatureK = getStellarCoreTemperatureKelvin(body.mass, radiusSolar, stage)
  const spectralClass = getStellarSpectralClassFromTemperature(surfaceTemperatureK)
  const displayColor = getStellarDisplayColorFromTemperature(surfaceTemperatureK)
  const simulationRadius = getStellarSimulationRadius(body.mass, stage, phase01, radiusScale)

  return {
    stage,
    phase01,
    radiusSolar,
    luminositySolar,
    surfaceTemperatureK,
    coreTemperatureK,
    spectralClass,
    displayColor,
    simulationRadius,
  }
}

export function getStellarDisplayColorFromBody(body: Pick<
  BodyState,
  'mass' | 'stellarEvolutionStage' | 'stellarEvolutionPhase01' | 'stellarRadiusScale'
>) {
  return getStellarComputedProperties(body).displayColor
}

export function getStellarSurfaceTemperatureFromBody(body: Pick<
  BodyState,
  'mass' | 'stellarEvolutionStage' | 'stellarEvolutionPhase01' | 'stellarRadiusScale'
>) {
  return getStellarComputedProperties(body).surfaceTemperatureK
}

export function getStellarSimulationRadiusFromBody(body: Pick<
  BodyState,
  'mass' | 'stellarEvolutionStage' | 'stellarEvolutionPhase01' | 'stellarRadiusScale'
>) {
  return getStellarComputedProperties(body).simulationRadius
}

export function withComputedStellarState(body: BodyState): BodyState {
  const computed = getStellarComputedProperties(body)
  return {
    ...body,
    stellarEvolutionStage: computed.stage,
    stellarEvolutionPhase01: computed.phase01,
    stellarRadiusScale: body.stellarRadiusScale ?? 1,
    radius: computed.simulationRadius,
    stellarTemperatureK: computed.surfaceTemperatureK,
    color: computed.displayColor,
  }
}

export function getEquilibriumStellarDisplayColor(mass: number) {
  return getStellarDisplayColorFromTemperature(getStellarTemperatureKelvin(mass))
}

export function mixStellarDisplayColors(a: string, b: string, mix01: number) {
  const first = hexToRgb(a)
  const second = hexToRgb(b)
  const t = clamp(mix01, 0, 1)
  return rgbToHex({
    r: first.r + (second.r - first.r) * t,
    g: first.g + (second.g - first.g) * t,
    b: first.b + (second.b - first.b) * t,
  })
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
