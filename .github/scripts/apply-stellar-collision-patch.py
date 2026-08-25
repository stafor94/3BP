from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one literal match, found {count}: {old[:100]!r}')
    write(path, source.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    source = read(path)
    matches = list(re.finditer(pattern, source, re.S))
    if len(matches) != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {len(matches)}: {pattern[:100]!r}')
    write(path, re.sub(pattern, replacement, source, count=1, flags=re.S))


write('src/starColors.ts', r'''export type StellarSpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M'

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
''')

replace_once(
    'src/types.ts',
    "export type BodyType = 'star' | 'planet' | 'moon' | 'fragment' | 'effect'\n",
    "export type BodyType = 'star' | 'planet' | 'moon' | 'fragment' | 'effect'\n\nexport type StellarCollisionOutcome = 'merge' | 'hitAndRun' | 'partialDisruption'\n",
)
replace_once(
    'src/types.ts',
    "  stellarCollision?: boolean\n}",
    "  stellarCollision?: boolean\n  stellarOutcome?: StellarCollisionOutcome\n}",
)
replace_once(
    'src/types.ts',
    "  effectVisual?: EffectVisualState\n  /**",
    "  effectVisual?: EffectVisualState\n  stellarCollisionOutcome?: StellarCollisionOutcome\n  stellarTemperatureK?: number\n  transientHeat01?: number\n  transientHeatDecayMs?: number\n  shockTemperatureBiasK?: number\n  transientHeatToken?: string\n  collisionScarIntensity?: number\n  trailExcitation01?: number\n  /**",
)

replace_once(
    'src/physics/engine.ts',
    "import type { BodyState, BodyType, EffectVisualState, Vec3 } from '../types'\n",
    "import { getEquilibriumStellarDisplayColor, getStellarTemperatureKelvin } from '../starColors'\nimport type { BodyState, BodyType, EffectVisualState, StellarCollisionOutcome, Vec3 } from '../types'\n",
)
replace_once(
    'src/physics/engine.ts',
    "type CollisionDecision = {\n  mode: CollisionMode\n  ejectaFraction: number\n}",
    "type CollisionDecision = {\n  mode: CollisionMode\n  ejectaFraction: number\n  stellarOutcome?: StellarCollisionOutcome\n}",
)
replace_once(
    'src/physics/engine.ts',
    "function isStellarCollision(a: BodyState, b: BodyState) {\n  return inferBodyType(a) === 'star' && inferBodyType(b) === 'star'\n}\n",
    r'''function isStellarCollision(a: BodyState, b: BodyState) {
  return inferBodyType(a) === 'star' && inferBodyType(b) === 'star'
}

function getStellarRadiusAfterMassChange(body: BodyState, newMass: number) {
  const massRatio = Math.max(newMass, 1e-9) / Math.max(body.mass, 1e-9)
  return Math.max(body.radius * 0.32, body.radius * massRatio ** 0.8)
}

function getMergedStellarRadius(
  a: BodyState,
  b: BodyState,
  remnantMass: number,
  remnantVolume: number,
) {
  const dominant = a.mass >= b.mass ? a : b
  const volumeRadius = Math.cbrt(Math.max(remnantVolume, 1e-12))
  const massScaledRadius = getStellarRadiusAfterMassChange(dominant, remnantMass)
  return clamp(
    volumeRadius * 0.55 + massScaledRadius * 0.45,
    Math.max(volumeRadius * 0.82, dominant.radius * 0.72),
    Math.max(a.radius + b.radius, volumeRadius),
  )
}

function getStellarCollisionAppearance(
  body: BodyState,
  newMass: number,
  outcome: StellarCollisionOutcome,
  geometry: CollisionGeometry,
  damageBias = 1,
) {
  const speedEnergy = clamp(geometry.speedRatio / 2.35, 0, 1)
  const compression = clamp(geometry.headOn * 0.64 + speedEnergy * 0.52, 0, 1)
  let heatStrength: number
  let heatDecayMs: number
  let temperatureBiasK: number
  let scarIntensity: number
  let trailExcitation: number

  if (outcome === 'merge') {
    heatStrength = clamp(0.82 + compression * 0.18, 0.82, 1)
    heatDecayMs = 2050 + compression * 450
    temperatureBiasK = 9000 + compression * 5500
    scarIntensity = 0.62 + compression * 0.3
    trailExcitation = 0.62 + speedEnergy * 0.26
  } else if (outcome === 'partialDisruption') {
    heatStrength = clamp((0.58 + speedEnergy * 0.2 + geometry.headOn * 0.1) * damageBias, 0.5, 0.94)
    heatDecayMs = clamp(1500 + speedEnergy * 520 + geometry.headOn * 260, 1500, 2350)
    temperatureBiasK = clamp((6200 + speedEnergy * 4300 + geometry.headOn * 1600) * damageBias, 5800, 12500)
    scarIntensity = clamp((0.46 + speedEnergy * 0.26) * damageBias, 0.38, 0.96)
    trailExcitation = clamp((0.48 + speedEnergy * 0.25) * damageBias, 0.42, 0.92)
  } else {
    heatStrength = clamp((0.46 + speedEnergy * 0.17 + geometry.grazing * 0.08) * damageBias, 0.42, 0.8)
    heatDecayMs = clamp(1050 + speedEnergy * 430 + geometry.grazing * 180, 1050, 1750)
    temperatureBiasK = clamp((3900 + speedEnergy * 3600 + geometry.grazing * 900) * damageBias, 3600, 8800)
    scarIntensity = clamp((0.26 + speedEnergy * 0.2 + geometry.grazing * 0.08) * damageBias, 0.22, 0.76)
    trailExcitation = clamp((0.34 + speedEnergy * 0.2 + geometry.grazing * 0.12) * damageBias, 0.3, 0.78)
  }

  return {
    color: getEquilibriumStellarDisplayColor(newMass),
    stellarTemperatureK: getStellarTemperatureKelvin(newMass),
    stellarCollisionOutcome: outcome,
    transientHeat01: heatStrength,
    transientHeatDecayMs: heatDecayMs,
    shockTemperatureBiasK: temperatureBiasK,
    transientHeatToken: `${collisionSerial}:${outcome}:${body.id}`,
    collisionScarIntensity: scarIntensity,
    trailExcitation01: trailExcitation,
  }
}
''',
)

old_star_block = r'''  if (starCount === 2) {
    if (grazing > 0.82 && speedRatio > 0.65 && speedRatio < 2.8) {
      return { mode: 'hitRun', ejectaFraction: clamp(0.012 + speedRatio * 0.022, 0.018, 0.075) }
    }
    const stellarFlyThroughThreshold = 2.25 - headOn * 0.2
    if (speedRatio > stellarFlyThroughThreshold) {
      return {
        mode: 'hitRun',
        ejectaFraction: clamp(0.1 + (speedRatio - stellarFlyThroughThreshold) * 0.1, 0.1, 0.3),
      }
    }
    return { mode: 'merge', ejectaFraction: clamp(0.008 + speedRatio * 0.018 + headOn * 0.008, 0.008, 0.07) }
  }'''
new_star_block = r'''  if (starCount === 2) {
    const partialSeverity =
      clamp((speedRatio - 0.82) / 1.25, 0, 1) *
      (0.55 + headOn * 0.45) *
      (0.75 + (1 - massRatio) * 0.45)

    // Unequal stellar encounters with meaningful compression strip the smaller
    // star instead of collapsing every non-hit-and-run outcome into a merge.
    if (
      massRatio < 0.82 &&
      speedRatio > 0.92 &&
      speedRatio < 2.3 &&
      headOn > 0.34 &&
      grazing < 0.88 &&
      partialSeverity > 0.16
    ) {
      const strippedFractionOfSmaller = clamp(
        0.05 + partialSeverity * 0.13 + (1 - massRatio) * 0.035,
        0.05,
        0.2,
      )
      return {
        mode: 'disrupt',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'partialDisruption',
      }
    }

    if (grazing > 0.82 && speedRatio > 0.65 && speedRatio < 2.8) {
      const strippedFractionOfSmaller = clamp(
        0.015 + speedRatio * 0.014 + (grazing - 0.82) * 0.08,
        0.015,
        0.075,
      )
      return {
        mode: 'hitRun',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'hitAndRun',
      }
    }

    const stellarFlyThroughThreshold = 2.25 - headOn * 0.2
    if (speedRatio > stellarFlyThroughThreshold) {
      const strippedFractionOfSmaller = clamp(
        0.045 + (speedRatio - stellarFlyThroughThreshold) * 0.055,
        0.045,
        0.1,
      )
      return {
        mode: 'hitRun',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'hitAndRun',
      }
    }

    return {
      mode: 'merge',
      ejectaFraction: clamp(0.008 + speedRatio * 0.018 + headOn * 0.008, 0.008, 0.07),
      stellarOutcome: 'merge',
    }
  }'''
replace_once('src/physics/engine.ts', old_star_block, new_star_block)

replace_regex(
    'src/physics/engine.ts',
    r"function makeCollisionFlash\(.*?\n}\n\nfunction makeStellarCompressionSheet",
    r'''function makeCollisionFlash(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)
  const phaseOffset = seededScalar(`${a.id}:${b.id}:flash:${collisionSerial}`)
  const stellarCollision = isStellarCollision(a, b)
  const stellarOutcome = decision.stellarOutcome
  const outcomeRadiusScale = stellarOutcome === 'merge'
    ? 1.12
    : stellarOutcome === 'partialDisruption'
      ? 1.02
      : stellarOutcome === 'hitAndRun'
        ? 0.9
        : 1
  const outcomeBrightness = stellarOutcome === 'merge'
    ? 0.28
    : stellarOutcome === 'partialDisruption'
      ? 0.14
      : 0

  return {
    id: `${a.id}+${b.id}+flash${collisionSerial}`,
    name: 'Collision flash',
    color: dominant.color,
    mass: 0,
    radius: stellarCollision
      ? Math.max(0.1, Math.min(0.31, totalRadius * 0.78 * outcomeRadiusScale))
      : Math.max(COLLISION_FLASH_RADIUS, Math.min(0.13, totalRadius * 0.42)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: stellarCollision
      ? STELLAR_FLASH_LIFETIME + (stellarOutcome === 'merge' ? 0.1 : stellarOutcome === 'partialDisruption' ? 0.05 : 0)
      : COLLISION_FLASH_LIFETIME,
    effectVisual: {
      kind: 'contactFlash',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: stellarCollision
        ? clamp(
            4.15 + geometry.headOn * 1.25 + geometry.grazing * 0.55 + (stellarOutcome === 'merge' ? 0.45 : 0),
            4.1,
            6.15,
          )
        : clamp(2.65 + geometry.headOn * 0.95 + geometry.grazing * 0.2, 2.6, 3.8),
      widthScale: stellarCollision
        ? clamp(0.31 - geometry.headOn * 0.07 + geometry.grazing * 0.05, 0.22, 0.36)
        : clamp(0.42 - geometry.headOn * 0.13 + geometry.grazing * 0.04, 0.25, 0.44),
      tailLength: 0,
      brightness: stellarCollision
        ? clamp(2.05 + geometry.headOn * 0.45 + speedHeat * 0.32 + outcomeBrightness, 2.05, 2.82)
        : clamp(1.28 + geometry.headOn * 0.48 + speedHeat * 0.34, 1.3, 2.05),
      turbulence: stellarCollision
        ? clamp(0.42 + geometry.grazing * 0.34 + speedHeat * 0.16, 0.42, 0.88)
        : clamp(0.12 + geometry.grazing * 0.3 + speedHeat * 0.18, 0.12, 0.58),
      pulseStrength: stellarCollision ? 0.09 : 0.16 + geometry.headOn * 0.1,
      phaseOffset,
      secondaryColor: secondary.color,
      temperatureBias: speedHeat,
      stellarCollision,
      stellarOutcome,
    },
  }
}

function makeStellarCompressionSheet''',
)

replace_regex(
    'src/physics/engine.ts',
    r"function makeStellarCompressionSheet\(.*?\n}\n\nfunction makeStellarAfterglow",
    r'''function makeStellarCompressionSheet(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const speedHeat = clamp(geometry.speedRatio / 2.8, 0, 1)
  const stellarOutcome = decision.stellarOutcome
  const mergeBoost = stellarOutcome === 'merge' ? 1 : 0
  const partialBoost = stellarOutcome === 'partialDisruption' ? 1 : 0

  return {
    id: `${a.id}+${b.id}+shock${collisionSerial}`,
    name: 'Stellar shock sheet',
    color: dominant.color,
    mass: 0,
    radius: Math.max(0.09, Math.min(0.29, totalRadius * (0.62 + mergeBoost * 0.08))),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime: STELLAR_SHOCK_LIFETIME + mergeBoost * 0.18 + partialBoost * 0.08,
    effectVisual: {
      kind: 'compressionShear',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: clamp(
        4.1 + geometry.grazing * 2.1 + geometry.headOn * 0.55 + mergeBoost * 0.5,
        4.2,
        7.2,
      ),
      widthScale: clamp(
        0.31 - geometry.grazing * 0.08 + geometry.headOn * 0.03 + mergeBoost * 0.035,
        0.2,
        0.38,
      ),
      tailLength: 0.22 + geometry.grazing * 0.34 + (stellarOutcome === 'hitAndRun' ? 0.14 : 0),
      brightness: clamp(
        1.48 + geometry.headOn * 0.22 + speedHeat * 0.24 + mergeBoost * 0.2 + partialBoost * 0.1,
        1.48,
        2.12,
      ),
      turbulence: clamp(0.66 + geometry.grazing * 0.24 + speedHeat * 0.12, 0.66, 1),
      pulseStrength: 0.055,
      phaseOffset: seededScalar(`${a.id}:${b.id}:shock:${collisionSerial}`),
      secondaryColor: secondary.color,
      temperatureBias: speedHeat,
      stellarCollision: true,
      stellarOutcome,
    },
  }
}

function makeStellarAfterglow''',
)

replace_regex(
    'src/physics/engine.ts',
    r"function makeStellarAfterglow\(.*?\n}\n\nfunction makeCollisionEffects",
    r'''function makeStellarAfterglow(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
): BodyState {
  const dominant = a.mass >= b.mass ? a : b
  const secondary = dominant === a ? b : a
  const totalRadius = a.radius + b.radius
  const stellarOutcome = decision.stellarOutcome
  const radiusScale = stellarOutcome === 'merge'
    ? 0.82
    : stellarOutcome === 'partialDisruption'
      ? 0.7
      : 0.58
  const lifetime = stellarOutcome === 'merge'
    ? 1.55
    : stellarOutcome === 'partialDisruption'
      ? 1.25
      : 0.95

  return {
    id: `${a.id}+${b.id}+afterglow${collisionSerial}`,
    name: 'Stellar afterglow',
    color: dominant.color,
    mass: 0,
    radius: Math.max(0.1, Math.min(0.36, totalRadius * radiusScale)),
    position: collisionContactPoint(a, b, geometry.normal),
    velocity: centerOfMassVelocity(a, b),
    bodyType: 'effect',
    age: 0,
    lifetime,
    effectVisual: {
      kind: 'stellarAfterglow',
      direction: { ...geometry.tangent },
      normal: { ...geometry.normal },
      stretch: clamp(
        1.18 + geometry.grazing * 0.42 + (stellarOutcome === 'hitAndRun' ? 0.18 : 0),
        1.18,
        1.8,
      ),
      widthScale: clamp(0.9 - geometry.grazing * 0.14, 0.72, 0.92),
      brightness: stellarOutcome === 'merge' ? 1.38 : stellarOutcome === 'partialDisruption' ? 1.25 : 1.08,
      turbulence: 0.72 + geometry.grazing * 0.2,
      pulseStrength: 0.02,
      phaseOffset: seededScalar(`${a.id}:${b.id}:afterglow:${collisionSerial}`),
      secondaryColor: secondary.color,
      temperatureBias: 0.62,
      stellarCollision: true,
      stellarOutcome,
    },
  }
}

function makeCollisionEffects''',
)

replace_regex(
    'src/physics/engine.ts',
    r"function makeCollisionEffects\(.*?\n}\n\nfunction getEjectaDirection",
    r'''function makeCollisionEffects(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
) {
  const flash = makeCollisionFlash(a, b, geometry, decision)
  if (!isStellarCollision(a, b)) return [flash]
  return [
    flash,
    makeStellarCompressionSheet(a, b, geometry, decision),
    makeStellarAfterglow(a, b, geometry, decision),
  ]
}

function getEjectaDirection''',
)

replace_regex(
    'src/physics/engine.ts',
    r"function makeStellarEffectVisual\(.*?\n}\n\nfunction makeEjecta",
    r'''function makeStellarEffectVisual(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  direction: Vec3,
  index: number,
  count: number,
  largeCount: number,
  stellarBias: StellarEjectaBias,
  decision: CollisionDecision,
  seed: string,
): EffectVisualState {
  const large = index < largeCount
  const stellarCollision = isStellarCollision(a, b)
  const stellarOutcome = decision.stellarOutcome
  const speedEnergy = clamp(geometry.speedRatio / 2.6, 0, 1)
  const geometryStretch = geometry.grazing * 2.4 - geometry.headOn * 0.45
  const sizeStretch = large ? 0.15 : 0.58
  const variance = seededScalar(`${seed}:shape:${index}`)
  const widthVariance = seededScalar(`${seed}:width:${index}`)
  const tailVariance = seededScalar(`${seed}:tail:${index}`)
  const phaseOffset = seededScalar(`${seed}:phase:${index}`)
  const sourceBias = stellarBias.massAsymmetry
  const outcomeTailBoost = stellarOutcome === 'hitAndRun'
    ? 0.34
    : stellarOutcome === 'partialDisruption'
      ? 0.2
      : 0
  const outcomeBrightness = stellarOutcome === 'merge'
    ? 0.14
    : stellarOutcome === 'partialDisruption'
      ? 0.1
      : 0.05

  return {
    kind: 'stellarPlasma',
    direction: { ...direction },
    normal: { ...geometry.normal },
    stretch: clamp(
      2.0 + geometryStretch + speedEnergy * 0.72 + sizeStretch + variance * 0.55 +
        (stellarCollision ? 0.42 : 0) + outcomeTailBoost * 0.75,
      1.75,
      stellarCollision ? 6.8 : 5.8,
    ),
    widthScale: clamp(
      0.92 - geometry.grazing * 0.35 + geometry.headOn * 0.12 + (widthVariance - 0.5) * 0.18,
      0.42,
      1.08,
    ),
    tailLength: clamp(
      0.38 + geometry.grazing * 0.72 + speedEnergy * 0.34 + (large ? 0.08 : 0.28) +
        tailVariance * 0.22 + (stellarCollision ? 0.12 : 0) + outcomeTailBoost,
      0.35,
      1.9,
    ),
    brightness: clamp(
      1.0 + speedEnergy * 0.28 + (large ? 0.18 : -0.02) + variance * 0.1 +
        (stellarCollision ? 0.16 : 0) + outcomeBrightness,
      0.92,
      stellarCollision ? 1.78 : 1.48,
    ),
    turbulence: clamp(
      0.38 + geometry.grazing * 0.27 + speedEnergy * 0.2 + (large ? 0.04 : 0.14) +
        (stellarCollision ? 0.08 : 0) + (stellarOutcome === 'partialDisruption' ? 0.08 : 0),
      0.38,
      1,
    ),
    pulseStrength: 0.035 + (1 - index / Math.max(count - 1, 1)) * 0.055,
    phaseOffset,
    secondaryColor: index % 3 === 0 || sourceBias < 0.32
      ? stellarBias.larger.color
      : stellarBias.smaller.color,
    temperatureBias: speedEnergy,
    stellarCollision,
    stellarOutcome,
  }
}

function makeEjecta''',
)
replace_once(
    'src/physics/engine.ts',
    "          stellarBias,\n          seed,\n        ),",
    "          stellarBias,\n          decision,\n          seed,\n        ),",
)

replace_regex(
    'src/physics/engine.ts',
    r"function resolveMergedCollision\(.*?\n}\n\nfunction resolveHitAndRun\(",
    r'''function resolveMergedCollision(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
): BodyState[] {
  const totalMass = a.mass + b.mass
  const totalVolume = a.radius ** 3 + b.radius ** 3
  const requestedEjectaMass = totalMass * decision.ejectaFraction
  const requestedEjectaVolume = totalVolume * decision.ejectaFraction
  const fragments = makeEjecta(
    a,
    b,
    geometry,
    decision,
    requestedEjectaMass,
    requestedEjectaVolume,
    availableSlots,
  )
  const representedEjectaMass = fragments.reduce((sum, fragment) => sum + fragment.mass, 0)
  const representedEjectaVolume = fragments.reduce((sum, fragment) => sum + fragment.radius ** 3, 0)
  const missingEjectaMass = Math.max(0, requestedEjectaMass - representedEjectaMass)
  const missingEjectaVolume = Math.max(0, requestedEjectaVolume - representedEjectaVolume)
  const remnantMass = Math.max(totalMass - requestedEjectaMass, totalMass * 0.05)
  const remnantVolume = Math.max(totalVolume - representedEjectaVolume - missingEjectaVolume, totalVolume * 0.02)
  const totalMomentum = add(momentum(a), momentum(b))
  const representedEjectaMomentum = fragments.reduce(
    (sum, fragment) => add(sum, momentum(fragment)),
    { x: 0, y: 0, z: 0 },
  )
  const missingEjectaMomentum = scale(centerOfMassVelocity(a, b), missingEjectaMass)
  const remnantVelocity = scale(
    sub(totalMomentum, add(representedEjectaMomentum, missingEjectaMomentum)),
    1 / remnantMass,
  )
  const dominant = a.mass >= b.mass ? a : b
  const bodyType = dominantBodyType(a, b)
  const remnantRadius = bodyType === 'star'
    ? getMergedStellarRadius(a, b, remnantMass, remnantVolume)
    : Math.cbrt(remnantVolume)
  const stellarOutcome = decision.stellarOutcome ?? 'merge'
  const remnant: BodyState = {
    id: `${a.id}+${b.id}`,
    name: mergedBodyName(a, b),
    color: dominant.color,
    mass: remnantMass,
    radius: remnantRadius,
    position: centerOfMassPosition(a, b),
    velocity: remnantVelocity,
    bodyType,
    ...(bodyType === 'star'
      ? getStellarCollisionAppearance(dominant, remnantMass, stellarOutcome, geometry)
      : {}),
  }

  return [remnant, ...fragments, ...makeCollisionEffects(a, b, geometry, decision)]
}

function resolveStellarSeparatedCollision(
  a: BodyState,
  b: BodyState,
  geometry: CollisionGeometry,
  decision: CollisionDecision,
  availableSlots: number,
  outcome: Extract<StellarCollisionOutcome, 'hitAndRun' | 'partialDisruption'>,
): BodyState[] {
  const totalMass = a.mass + b.mass
  const totalVolume = a.radius ** 3 + b.radius ** 3
  const requestedEjectaMass = totalMass * decision.ejectaFraction
  const requestedEjectaVolume = totalVolume * decision.ejectaFraction
  const fragments = makeEjecta(
    a,
    b,
    geometry,
    decision,
    requestedEjectaMass,
    requestedEjectaVolume,
    availableSlots,
  )
  const representedEjectaMass = fragments.reduce((sum, fragment) => sum + fragment.mass, 0)
  const missingEjectaMass = Math.max(0, requestedEjectaMass - representedEjectaMass)
  const smaller = a.mass <= b.mass ? a : b
  const larger = smaller === a ? b : a
  const massRatio = smaller.mass / Math.max(larger.mass, 1e-9)
  const massAsymmetry = 1 - clamp(massRatio, 0, 1)
  const smallerLossShare = outcome === 'partialDisruption'
    ? clamp(0.76 + massAsymmetry * 0.15 + geometry.headOn * 0.05, 0.74, 0.94)
    : clamp(0.58 + massAsymmetry * 0.18 + geometry.headOn * 0.04, 0.56, 0.82)
  const smallerLoss = requestedEjectaMass * smallerLossShare
  const largerLoss = Math.max(0, requestedEjectaMass - smallerLoss)
  const transferFraction = outcome === 'partialDisruption'
    ? clamp(0.012 + geometry.speedRatio * 0.01 + geometry.grazing * 0.014, 0.012, 0.045)
    : clamp(0.006 + geometry.speedRatio * 0.006 + geometry.grazing * 0.008, 0.006, 0.025)
  const transferMass = Math.min(
    smaller.mass * transferFraction,
    Math.max(0, smaller.mass - smallerLoss - smaller.mass * 0.22),
  )

  const smallerMass = Math.max(smaller.mass - smallerLoss - transferMass, smaller.mass * 0.2)
  const largerMass = Math.max(larger.mass - largerLoss + transferMass, larger.mass * 0.2)
  const massA = smaller === a ? smallerMass : largerMass
  const massB = smaller === b ? smallerMass : largerMass
  const radiusA = getStellarRadiusAfterMassChange(a, massA)
  const radiusB = getStellarRadiusAfterMassChange(b, massB)

  const relativeNormalSpeed = dot(geometry.relativeVelocity, geometry.normal)
  const restitution = outcome === 'partialDisruption'
    ? clamp(0.08 + geometry.grazing * 0.19, 0.09, 0.27)
    : clamp(0.16 + geometry.grazing * 0.28, 0.18, 0.42)
  const impulseMagnitude = relativeNormalSpeed < 0
    ? (-(1 + restitution) * relativeNormalSpeed) / (1 / a.mass + 1 / b.mass)
    : 0
  let velocityA = sub(a.velocity, scale(geometry.normal, impulseMagnitude / a.mass))
  let velocityB = add(b.velocity, scale(geometry.normal, impulseMagnitude / b.mass))

  const center = centerOfMassPosition(a, b)
  const separationScale = outcome === 'partialDisruption' ? 1.035 : 1 + geometry.grazing * 0.08
  const separation = (radiusA + radiusB) * separationScale + 1e-4
  const survivorMass = massA + massB
  const positionA = sub(center, scale(geometry.normal, separation * (massB / survivorMass)))
  const positionB = add(center, scale(geometry.normal, separation * (massA / survivorMass)))

  const fragmentMomentum = fragments.reduce(
    (sum, fragment) => add(sum, momentum(fragment)),
    { x: 0, y: 0, z: 0 },
  )
  const missingEjectaMomentum = scale(centerOfMassVelocity(a, b), missingEjectaMass)
  const targetMomentum = sub(
    add(momentum(a), momentum(b)),
    add(fragmentMomentum, missingEjectaMomentum),
  )
  const survivorMomentum = add(scale(velocityA, massA), scale(velocityB, massB))
  const correction = scale(sub(targetMomentum, survivorMomentum), 1 / survivorMass)
  velocityA = add(velocityA, correction)
  velocityB = add(velocityB, correction)

  const smallerDamageBias = outcome === 'partialDisruption' ? 1.18 : 1.08
  const largerDamageBias = outcome === 'partialDisruption' ? 0.82 : 0.92
  const survivorA: BodyState = {
    ...cloneBody(a),
    mass: massA,
    radius: radiusA,
    position: positionA,
    velocity: velocityA,
    bodyType: 'star',
    collisionCooldown: HIT_RUN_COOLDOWN,
    ...getStellarCollisionAppearance(
      a,
      massA,
      outcome,
      geometry,
      a === smaller ? smallerDamageBias : largerDamageBias,
    ),
  }
  const survivorB: BodyState = {
    ...cloneBody(b),
    mass: massB,
    radius: radiusB,
    position: positionB,
    velocity: velocityB,
    bodyType: 'star',
    collisionCooldown: HIT_RUN_COOLDOWN,
    ...getStellarCollisionAppearance(
      b,
      massB,
      outcome,
      geometry,
      b === smaller ? smallerDamageBias : largerDamageBias,
    ),
  }

  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry, decision)]
}

function resolveHitAndRun(''',
)

replace_once(
    'src/physics/engine.ts',
    "function resolveHitAndRun(\n  a: BodyState,\n  b: BodyState,\n  geometry: CollisionGeometry,\n  decision: CollisionDecision,\n  availableSlots: number,\n): BodyState[] {\n  const totalMass = a.mass + b.mass",
    "function resolveHitAndRun(\n  a: BodyState,\n  b: BodyState,\n  geometry: CollisionGeometry,\n  decision: CollisionDecision,\n  availableSlots: number,\n): BodyState[] {\n  if (isStellarCollision(a, b)) {\n    return resolveStellarSeparatedCollision(a, b, geometry, decision, availableSlots, 'hitAndRun')\n  }\n\n  const totalMass = a.mass + b.mass",
)
replace_once(
    'src/physics/engine.ts',
    "  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry)]\n}\n\nfunction resolveCollisions",
    "  return [survivorA, survivorB, ...fragments, ...makeCollisionEffects(a, b, geometry, decision)]\n}\n\nfunction resolvePartialDisruption(\n  a: BodyState,\n  b: BodyState,\n  geometry: CollisionGeometry,\n  decision: CollisionDecision,\n  availableSlots: number,\n): BodyState[] {\n  if (!isStellarCollision(a, b)) {\n    return resolveMergedCollision(a, b, geometry, decision, availableSlots)\n  }\n  return resolveStellarSeparatedCollision(\n    a,\n    b,\n    geometry,\n    decision,\n    availableSlots,\n    'partialDisruption',\n  )\n}\n\nfunction resolveCollisions",
)
replace_once(
    'src/physics/engine.ts',
    "        const baseResultCount = decision.mode === 'hitRun' ? 2 : 1",
    "        const baseResultCount = decision.mode === 'hitRun' || decision.stellarOutcome === 'partialDisruption' ? 2 : 1",
)
replace_once(
    'src/physics/engine.ts',
    "        const replacement = decision.mode === 'hitRun'\n          ? resolveHitAndRun(a, b, geometry, decision, availableSlots)\n          : resolveMergedCollision(a, b, geometry, decision, availableSlots)",
    "        const replacement = decision.stellarOutcome === 'partialDisruption'\n          ? resolvePartialDisruption(a, b, geometry, decision, availableSlots)\n          : decision.mode === 'hitRun'\n            ? resolveHitAndRun(a, b, geometry, decision, availableSlots)\n            : resolveMergedCollision(a, b, geometry, decision, availableSlots)",
)

replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "const STELLAR_MERGE_IMPACT_SIM_DURATION = 0.009\nconst IMPACT_MAX_OVERLAP_RATIO = 0.14\nconst STELLAR_MERGE_MAX_OVERLAP_RATIO = 0.34",
    "const STELLAR_MERGE_IMPACT_SIM_DURATION = 0.009\nconst STELLAR_PARTIAL_IMPACT_SIM_DURATION = 0.0075\nconst IMPACT_MAX_OVERLAP_RATIO = 0.14\nconst STELLAR_MERGE_MAX_OVERLAP_RATIO = 0.34\nconst STELLAR_PARTIAL_MAX_OVERLAP_RATIO = 0.22",
)
replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "type CollisionPresentationMode = 'merge' | 'hitRun'",
    "type CollisionPresentationMode = 'merge' | 'hitRun' | 'partialDisruption'",
)
replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "  const survivorA = stepped.some((body) => body.bodyType !== 'effect' && body.id === bodyA.id)\n  const survivorB = stepped.some((body) => body.bodyType !== 'effect' && body.id === bodyB.id)\n  return survivorA && survivorB ? 'hitRun' : 'merge'",
    "  const stellarOutcome = stepped.find((body) => (\n    body.bodyType === 'effect' &&\n    body.effectVisual?.stellarOutcome\n  ))?.effectVisual?.stellarOutcome\n  if (stellarOutcome === 'partialDisruption') return 'partialDisruption'\n\n  const survivorA = stepped.some((body) => body.bodyType !== 'effect' && body.id === bodyA.id)\n  const survivorB = stepped.some((body) => body.bodyType !== 'effect' && body.id === bodyB.id)\n  return survivorA && survivorB ? 'hitRun' : 'merge'",
)
replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "function getImpactDuration(a: BodyState, b: BodyState, mode: CollisionPresentationMode) {\n  return isStellarMerge(a, b, mode)\n    ? STELLAR_MERGE_IMPACT_SIM_DURATION\n    : COLLISION_IMPACT_SIM_DURATION\n}",
    "function getImpactDuration(a: BodyState, b: BodyState, mode: CollisionPresentationMode) {\n  if (isStellarMerge(a, b, mode)) return STELLAR_MERGE_IMPACT_SIM_DURATION\n  if (\n    mode === 'partialDisruption' &&\n    getEffectiveBodyType(a) === 'star' &&\n    getEffectiveBodyType(b) === 'star'\n  ) return STELLAR_PARTIAL_IMPACT_SIM_DURATION\n  return COLLISION_IMPACT_SIM_DURATION\n}",
)
replace_regex(
    'src/physics/fragmentAwareEngine.ts',
    r"function lerp\(a: number, b: number, t: number\) \{.*?\n}\n\nfunction smoothstep01",
    "function smoothstep01",
)
replace_regex(
    'src/physics/fragmentAwareEngine.ts',
    r"function brightenHex\(color: string, amount: number\) \{.*?\n}\n\nfunction advanceDisplayBody",
    "function advanceDisplayBody",
)
replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "  const overlapRatio = isStellarMerge(a, b, mode)\n    ? STELLAR_MERGE_MAX_OVERLAP_RATIO\n    : IMPACT_MAX_OVERLAP_RATIO\n  const maxOverlap = Math.min(a.radius, b.radius) * overlapRatio\n  if (mode === 'hitRun') return maxOverlap * Math.sin(Math.PI * progress)\n  return maxOverlap * smoothstep01(progress)",
    "  const overlapRatio = isStellarMerge(a, b, mode)\n    ? STELLAR_MERGE_MAX_OVERLAP_RATIO\n    : mode === 'partialDisruption'\n      ? STELLAR_PARTIAL_MAX_OVERLAP_RATIO\n      : IMPACT_MAX_OVERLAP_RATIO\n  const maxOverlap = Math.min(a.radius, b.radius) * overlapRatio\n  if (mode !== 'merge') return maxOverlap * Math.sin(Math.PI * progress)\n  return maxOverlap * smoothstep01(progress)",
)
replace_regex(
    'src/physics/fragmentAwareEngine.ts',
    r"function animateCollider\(.*?\n}\n\nfunction getTransitionBodies",
    r'''function animateCollider(
  body: BodyState,
  impactPosition: Vec3,
) {
  // The overlap bridge is positional only. Never rewrite body.color here: doing
  // so made the additive synthetic contact sheet read as a permanent yellow/white
  // recolor of the stellar disc. Shock heating is rendered from transient state
  // only after the physical outcome exists.
  return {
    ...cloneBody(body),
    position: { ...impactPosition },
  }
}

function getTransitionBodies''',
)
replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "        return animateCollider(body, impactPositions.bodyA, progress, transition.mode)",
    "        return animateCollider(body, impactPositions.bodyA)",
)
replace_once(
    'src/physics/fragmentAwareEngine.ts',
    "        return animateCollider(body, impactPositions.bodyB, progress, transition.mode)",
    "        return animateCollider(body, impactPositions.bodyB)",
)

replace_once(
    'src/rendering/collisionEffectRenderer.ts',
    "  uniform float uPulse;\n",
    "  uniform float uPulse;\n  uniform float uSynthetic;\n",
)
replace_once(
    'src/rendering/collisionEffectRenderer.ts',
    "      alpha = max(halo * 0.58, hotBand * 0.9) + ridge * 0.52;\n      core = ridge + hotBand * 0.72;\n      body = hotBand * 0.7 + halo * 0.35;\n      edge = halo;",
    "      alpha = max(halo * 0.58, hotBand * 0.9) + ridge * 0.52;\n      core = ridge + hotBand * 0.72;\n      body = hotBand * 0.7 + halo * 0.35;\n      edge = halo;\n\n      if (uSynthetic > 0.5) {\n        // Keep overlap preview concentrated around the compression boundary. A\n        // full-opacity additive center reads as if the stellar disc itself changed hue.\n        float centerRelief = 0.66 + 0.34 * smoothstep(0.08, 0.52, abs(p.x));\n        alpha *= centerRelief * 0.82;\n        core *= 0.76;\n        body *= 0.72;\n      }",
)
replace_once(
    'src/rendering/collisionEffectRenderer.ts',
    "      uPulse: { value: 0 },\n",
    "      uPulse: { value: 0 },\n      uSynthetic: { value: 0 },\n",
)
replace_once(
    'src/rendering/collisionEffectRenderer.ts',
    "    const profile = getCollisionEffectProfile(body)\n",
    "    const profile = getCollisionEffectProfile(body)\n    const synthetic = body.id.startsWith('preview:')\n",
)
replace_once(
    'src/rendering/collisionEffectRenderer.ts',
    "    uniforms.uOpacity.value = clamp(\n      profile.baseOpacity * profile.fadeAlpha * clamp(opacityScale, 0, 1),\n      0,\n      body.effectVisual?.stellarCollision ? 0.97 : 0.94,\n    )",
    "    const syntheticOpacityCap = profile.kind === 'contactFlash'\n      ? 0.5\n      : profile.kind === 'compressionShear'\n        ? 0.48\n        : 0.6\n    uniforms.uOpacity.value = clamp(\n      profile.baseOpacity * profile.fadeAlpha * clamp(opacityScale, 0, 1),\n      0,\n      synthetic\n        ? syntheticOpacityCap\n        : body.effectVisual?.stellarCollision\n          ? 0.97\n          : 0.94,\n    )",
)
replace_once(
    'src/rendering/collisionEffectRenderer.ts',
    "    uniforms.uBrightness.value = clamp(profile.brightness, 0, 2.62)\n    uniforms.uPulse.value = profile.pulseStrength",
    "    uniforms.uBrightness.value = clamp(\n      profile.brightness * (synthetic ? 0.9 : 1),\n      0,\n      synthetic ? 1.45 : 2.82,\n    )\n    uniforms.uPulse.value = profile.pulseStrength\n    uniforms.uSynthetic.value = synthetic ? 1 : 0",
)

replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "  const visual = body.effectVisual\n",
    "  const visual = body.effectVisual\n  const stellarOutcome = visual?.stellarOutcome\n",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "      baseOpacity: stellar ? 0.97 : 0.94,",
    "      baseOpacity: stellar\n        ? stellarOutcome === 'hitAndRun'\n          ? 0.88\n          : stellarOutcome === 'partialDisruption'\n            ? 0.93\n            : 0.97\n        : 0.94,",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "      visualRadius: stellar\n        ? THREE.MathUtils.clamp(body.radius * 0.78, 0.11, 0.28)",
    "      visualRadius: stellar\n        ? THREE.MathUtils.clamp(\n            body.radius * (stellarOutcome === 'merge' ? 0.86 : stellarOutcome === 'hitAndRun' ? 0.7 : 0.78),\n            0.1,\n            0.31,\n          )",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "      baseOpacity: stellar ? 0.8 : 0.7,",
    "      baseOpacity: stellar\n        ? stellarOutcome === 'merge'\n          ? 0.84\n          : stellarOutcome === 'partialDisruption'\n            ? 0.76\n            : 0.66\n        : 0.7,",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "    const linger = Math.pow(1 - progress, stellar ? 1.18 : 1.28)",
    "    const lingerExponent = stellar\n      ? stellarOutcome === 'hitAndRun'\n        ? 1.02\n        : stellarOutcome === 'partialDisruption'\n          ? 1.1\n          : 1.18\n      : 1.28\n    const linger = Math.pow(1 - progress, lingerExponent)",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "      tailLength: (visual?.tailLength ?? 0.76) * (0.72 + expansion * 0.72),",
    "      tailLength: (visual?.tailLength ?? 0.76) *\n        (0.72 + expansion * 0.72) *\n        (stellarOutcome === 'hitAndRun' ? 1.18 : stellarOutcome === 'partialDisruption' ? 1.1 : 1),",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "      baseOpacity: 0.48,",
    "      baseOpacity: stellarOutcome === 'merge' ? 0.54 : stellarOutcome === 'partialDisruption' ? 0.44 : 0.34,",
)
replace_once(
    'src/rendering/collisionEffectProfile.ts',
    "      visualRadius: THREE.MathUtils.clamp(body.radius * (0.72 + expansion * 0.6), 0.09, 0.32),",
    "      visualRadius: THREE.MathUtils.clamp(\n        body.radius * (0.72 + expansion * 0.6) *\n          (stellarOutcome === 'merge' ? 1.12 : stellarOutcome === 'hitAndRun' ? 0.9 : 1),\n        0.08,\n        0.36,\n      ),",
)

replace_once(
    'src/rendering/bodyLighting.ts',
    "import { getNearestStellarColor } from '../starColors'",
    "import {\n  getNearestStellarColor,\n  getStellarDisplayColorFromTemperature,\n  getStellarTemperatureKelvin,\n} from '../starColors'",
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "let lightingStars: BodyState[] = []\n",
    r'''let lightingStars: BodyState[] = []
const stellarHeatClock = new Map<string, { token: string; startedAt: number }>()

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getTransientHeatStrength(body: BodyState) {
  const token = body.transientHeatToken
  const initialStrength = body.transientHeat01 ?? 0
  const decayMs = body.transientHeatDecayMs ?? 0
  if (!token || initialStrength <= 0 || decayMs <= 0) return 0

  const existing = stellarHeatClock.get(body.id)
  const clock = existing?.token === token
    ? existing
    : { token, startedAt: nowMs() }
  if (existing?.token !== token) stellarHeatClock.set(body.id, clock)

  const progress = Math.min(1, Math.max(0, (nowMs() - clock.startedAt) / decayMs))
  return initialStrength * (1 - progress) ** 1.55
}

function getResolvedStellarColor(body: BodyState) {
  const equilibriumColor = body.stellarTemperatureK !== undefined
    ? body.color
    : getNearestStellarColor(body.color).hex
  const heatStrength = getTransientHeatStrength(body)
  if (heatStrength <= 0.001) return equilibriumColor

  const equilibriumTemperature = body.stellarTemperatureK ?? getStellarTemperatureKelvin(body.mass)
  const heatedTemperature = equilibriumTemperature + (body.shockTemperatureBiasK ?? 0) * heatStrength
  return getStellarDisplayColorFromTemperature(heatedTemperature)
}
''',
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "    identityColor.set(getNearestStellarColor(body.color).hex)",
    "    identityColor.set(getResolvedStellarColor(body))",
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "      ? getNearestStellarColor(body.color).hex\n      : body.color,",
    "      ? getResolvedStellarColor(body)\n      : body.color,",
)
replace_regex(
    'src/rendering/bodyLighting.ts',
    r"function setBodyGlowVisibility\(scene: THREE.Scene, objectIndex: number, visible: boolean\) \{.*?\n}\n\nfunction syncBodyPresentationBeforeRender",
    r'''function setBodyGlowVisibility(
  scene: THREE.Scene,
  objectIndex: number,
  visible: boolean,
  stellarColor?: string,
) {
  const glowInner = scene.children[objectIndex - 1]
  const glowOuter = scene.children[objectIndex - 2]

  if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
    glowInner.visible = visible
    if (!visible) glowInner.material.opacity = 0
    else if (stellarColor) glowInner.material.color.set(stellarColor)
  }

  if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
    glowOuter.visible = visible
    if (!visible) glowOuter.material.opacity = 0
    else if (stellarColor) glowOuter.material.color.set(stellarColor)
  }
}

function syncBodyPresentationBeforeRender''',
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "    const bodyType = getEffectiveBodyType(body)\n    setSurfaceProfile(object.material, body)\n    if (objectIndex >= 2) setBodyGlowVisibility(scene, objectIndex, bodyType === 'star')",
    "    const bodyType = getEffectiveBodyType(body)\n    const stellarColor = bodyType === 'star' ? getResolvedStellarColor(body) : undefined\n    setSurfaceProfile(object.material, body)\n    if (objectIndex >= 2) setBodyGlowVisibility(scene, objectIndex, bodyType === 'star', stellarColor)",
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "    lightColors[index].set(getNearestStellarColor(star.color).hex)",
    "    lightColors[index].set(getResolvedStellarColor(star))",
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "    setBodyGlowVisibility(scene, objectIndex, isStar)",
    "    setBodyGlowVisibility(scene, objectIndex, isStar, isStar ? getResolvedStellarColor(body) : undefined)",
)
replace_once(
    'src/rendering/bodyLighting.ts',
    "export function syncBodyLightingState(bodies: BodyState[]) {\n  const nextBodyBySeed = new Map<string, BodyState>()",
    "export function syncBodyLightingState(bodies: BodyState[]) {\n  const activeBodyIds = new Set(bodies.map((body) => body.id))\n  Array.from(stellarHeatClock.keys()).forEach((id) => {\n    if (!activeBodyIds.has(id)) stellarHeatClock.delete(id)\n  })\n\n  const nextBodyBySeed = new Map<string, BodyState>()",
)

replace_once(
    'src/rendering/simulationRenderer.ts',
    "  const stellarColor = getNearestStellarColor(body.color).hex",
    "  const stellarColor = body.stellarTemperatureK !== undefined\n    ? body.color\n    : getNearestStellarColor(body.color).hex",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "function updateTrailRibbon(\n  ribbon: TrailRibbon,\n  samples: TrailCurveSample[],\n  currentTime: number,\n  duration: number,\n) {",
    "function updateTrailRibbon(\n  ribbon: TrailRibbon,\n  samples: TrailCurveSample[],\n  currentTime: number,\n  duration: number,\n  energyBoost = 0,\n) {",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "    const width = THREE.MathUtils.lerp(\n      RENDER_TUNING.trail.lineWidthOld,\n      RENDER_TUNING.trail.lineWidthNew,\n      widthProgress,\n    )\n    const alpha = RENDER_TUNING.trail.lineOpacity * alphaProgress",
    "    const boost = THREE.MathUtils.clamp(energyBoost, 0, 1)\n    const width = THREE.MathUtils.lerp(\n      RENDER_TUNING.trail.lineWidthOld,\n      RENDER_TUNING.trail.lineWidthNew,\n      widthProgress,\n    ) * (1 + boost * 0.08 * freshness)\n    const alpha = RENDER_TUNING.trail.lineOpacity * alphaProgress *\n      (1 + boost * 0.34 * freshness * freshness)",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "    currentBodyPosition?: THREE.Vector3,\n  ) => {",
    "    currentBodyPosition?: THREE.Vector3,\n    energyBoost = 0,\n  ) => {",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "      visual.trailAlphas[index] = RENDER_TUNING.trail.softPointAlpha * featherProgress\n      visual.trailSizes[index] = THREE.MathUtils.lerp(\n        RENDER_TUNING.trail.softPointSizeOld,\n        RENDER_TUNING.trail.softPointSizeNew,\n        Math.pow(freshness, 0.9),\n      )",
    "      const boost = THREE.MathUtils.clamp(energyBoost, 0, 1)\n      visual.trailAlphas[index] = RENDER_TUNING.trail.softPointAlpha * featherProgress *\n        (1 + boost * 0.38 * freshness * freshness)\n      visual.trailSizes[index] = THREE.MathUtils.lerp(\n        RENDER_TUNING.trail.softPointSizeOld,\n        RENDER_TUNING.trail.softPointSizeNew,\n        Math.pow(freshness, 0.9),\n      ) * (1 + boost * 0.08 * freshness)",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "    updateTrailRibbon(visual.trailRibbon, smoothSamples, currentTime, duration)",
    "    updateTrailRibbon(visual.trailRibbon, smoothSamples, currentTime, duration, energyBoost)",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "  const visuals = new Map<string, VisualBody>()\n",
    r'''  const visuals = new Map<string, VisualBody>()
  const trailExcitationClock = new Map<string, { token: string; startedAt: number }>()

  const getTrailExcitation = (body: BodyState, timeMs: number) => {
    if (body.bodyType !== 'star' || !body.transientHeatToken || (body.trailExcitation01 ?? 0) <= 0) return 0
    const token = body.transientHeatToken
    const existing = trailExcitationClock.get(body.id)
    const clock = existing?.token === token ? existing : { token, startedAt: timeMs }
    if (existing?.token !== token) trailExcitationClock.set(body.id, clock)
    const decayMs = Math.max(body.transientHeatDecayMs ?? 1200, 1)
    const progress = THREE.MathUtils.clamp((timeMs - clock.startedAt) / decayMs, 0, 1)
    return (body.trailExcitation01 ?? 0) * (1 - progress) ** 1.45
  }
''',
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "    visuals.delete(id)\n  }",
    "    visuals.delete(id)\n    trailExcitationClock.delete(id)\n  }",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "    current.forEach((body) => {\n      const visual = ensureVisual(body)",
    "    const renderNowMs = performance.now()\n    current.forEach((body) => {\n      const visual = ensureVisual(body)",
)
replace_once(
    'src/rendering/simulationRenderer.ts',
    "        trailVisibleForBody,\n        visual.mesh.position,\n      )",
    "        trailVisibleForBody,\n        visual.mesh.position,\n        getTrailExcitation(body, renderNowMs),\n      )",
)

write('scripts/stellarCollisionRegression.ts', r'''import {
  getEquilibriumStellarDisplayColor,
  getStellarTemperatureKelvin,
} from '../src/starColors'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeStar(
  id: string,
  mass: number,
  radius: number,
  x: number,
  color: string,
  velocity: BodyState['velocity'],
): BodyState {
  return {
    id,
    name: id,
    color,
    mass,
    radius,
    position: { x, y: 0, z: 0 },
    velocity,
    bodyType: 'star',
  }
}

function testMassTemperatureModel() {
  const cool = getStellarTemperatureKelvin(0.45)
  const solar = getStellarTemperatureKelvin(1)
  const hot = getStellarTemperatureKelvin(2)
  assert(cool < solar, 'lower-mass main-sequence stars should be cooler')
  assert(hot > solar, 'higher-mass main-sequence stars should be hotter')
  assert(
    getEquilibriumStellarDisplayColor(0.45) !== getEquilibriumStellarDisplayColor(2),
    'mass-based equilibrium display color should vary with stellar mass',
  )
}

function testGrazingHitAndRunHasConsequences() {
  const a = makeStar(
    'stellar-graze-a',
    1,
    0.3,
    -0.2999995,
    '#ffd36b',
    { x: 0.15, y: -1, z: 0 },
  )
  const b = makeStar(
    'stellar-graze-b',
    1,
    0.3,
    0.2999995,
    '#ffaf5f',
    { x: -0.15, y: 1, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const survivorA = result.find((body) => body.id === a.id)
  const survivorB = result.find((body) => body.id === b.id)
  assert(survivorA && survivorB, 'grazing stellar collision should preserve both hit-and-run survivors')
  assert(
    survivorA.stellarCollisionOutcome === 'hitAndRun' && survivorB.stellarCollisionOutcome === 'hitAndRun',
    'grazing stellar survivors should record hitAndRun outcome',
  )
  assert(
    Math.abs(survivorA.mass - a.mass) > 1e-5 && Math.abs(survivorB.mass - b.mass) > 1e-5,
    'hit-and-run must change both stellar masses instead of acting as a no-op',
  )
  assert(
    Math.abs(survivorA.radius - a.radius) > 1e-6 && Math.abs(survivorB.radius - b.radius) > 1e-6,
    'hit-and-run stellar radius must follow changed mass',
  )
  assert(
    survivorA.color === getEquilibriumStellarDisplayColor(survivorA.mass) &&
      survivorB.color === getEquilibriumStellarDisplayColor(survivorB.mass),
    'hit-and-run survivor color should be recalculated from new mass',
  )
  assert((survivorA.transientHeat01 ?? 0) > 0 && (survivorB.transientHeat01 ?? 0) > 0,
    'hit-and-run survivors should carry transient shock heat')
  assert(
    result.some((body) => body.bodyType === 'effect' && body.effectVisual?.stellarOutcome === 'hitAndRun'),
    'hit-and-run VFX should carry its outcome profile',
  )
}

function testHeadOnMergeUsesRemnantMassColor() {
  const a = makeStar(
    'stellar-merge-a2',
    1,
    0.3,
    -0.2999995,
    '#ffd36b',
    { x: 0.3, y: 0, z: 0 },
  )
  const b = makeStar(
    'stellar-merge-b2',
    1,
    0.3,
    0.2999995,
    '#ff6b5e',
    { x: -0.3, y: 0, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const remnant = result.find((body) => body.bodyType === 'star' && body.id.includes(a.id) && body.id.includes(b.id))
  assert(remnant, 'head-on low-speed stellar collision should merge')
  assert(remnant.stellarCollisionOutcome === 'merge', 'merged remnant should record merge outcome')
  assert(remnant.mass > 1.8, 'merged remnant should retain most of both stellar masses')
  assert(
    remnant.color === getEquilibriumStellarDisplayColor(remnant.mass),
    'merged remnant color should be based on remnant mass',
  )
  assert(
    (remnant.stellarTemperatureK ?? 0) > getStellarTemperatureKelvin(1),
    'more massive merged remnant should trend hotter than a solar-mass source star',
  )
  assert((remnant.transientHeat01 ?? 0) >= 0.8, 'stellar merge should receive the strongest transient heat')
}

function testPartialDisruptionStripsSmallerStar() {
  const smaller = makeStar(
    'stellar-partial-small',
    0.6,
    0.24,
    -0.2799995,
    '#ffaf5f',
    { x: 1.05, y: -1.2, z: 0 },
  )
  const larger = makeStar(
    'stellar-partial-large',
    1.3,
    0.32,
    0.2799995,
    '#fff4e8',
    { x: -1.05, y: 1.2, z: 0 },
  )

  const result = stepCoreBodies([smaller, larger], 1e-8)
  const smallSurvivor = result.find((body) => body.id === smaller.id)
  const largeSurvivor = result.find((body) => body.id === larger.id)
  assert(smallSurvivor && largeSurvivor, 'partial disruption should keep two stellar survivors')
  assert(
    smallSurvivor.stellarCollisionOutcome === 'partialDisruption' &&
      largeSurvivor.stellarCollisionOutcome === 'partialDisruption',
    'partial disruption survivors should expose explicit outcome',
  )
  const smallRelativeChange = Math.abs(smallSurvivor.mass - smaller.mass) / smaller.mass
  const largeRelativeChange = Math.abs(largeSurvivor.mass - larger.mass) / larger.mass
  assert(smallRelativeChange > largeRelativeChange,
    'partial disruption should affect the smaller star more strongly')
  assert(smallSurvivor.mass < smaller.mass, 'partial disruption should visibly strip the smaller star')
  assert(
    (smallSurvivor.collisionScarIntensity ?? 0) > (largeSurvivor.collisionScarIntensity ?? 0),
    'smaller stripped star should receive the stronger visual damage state',
  )
  assert(
    result.some((body) => body.bodyType === 'effect' && body.effectVisual?.stellarOutcome === 'partialDisruption'),
    'partial disruption should produce outcome-tagged plasma/VFX',
  )
}

function testImpactBridgeDoesNotRewriteStellarHue() {
  const a = makeStar(
    'stellar-color-bridge-a',
    1,
    0.3,
    -0.30025,
    '#7ea7ff',
    { x: 0.2, y: 0, z: 0 },
  )
  const b = makeStar(
    'stellar-color-bridge-b',
    1,
    0.3,
    0.30025,
    '#ff6b5e',
    { x: -0.2, y: 0, z: 0 },
  )

  let frame = stepFragmentAwareBodies([a, b], 0.0015)
  let sawBridge = false
  for (let index = 0; index < 8; index += 1) {
    const bodyA = frame.find((body) => body.id === a.id)
    const bodyB = frame.find((body) => body.id === b.id)
    if (bodyA && bodyB) {
      sawBridge = true
      assert(bodyA.color === a.color, 'display-only overlap must not rewrite star A base hue')
      assert(bodyB.color === b.color, 'display-only overlap must not rewrite star B base hue')
      frame = stepFragmentAwareBodies(frame, 0.0015)
      continue
    }
    break
  }
  assert(sawBridge, 'stellar collision should expose at least one staged impact bridge frame')
}

testMassTemperatureModel()
testGrazingHitAndRunHasConsequences()
testHeadOnMergeUsesRemnantMassColor()
testPartialDisruptionStripsSmallerStar()
testImpactBridgeDoesNotRewriteStellarHue()

console.log('stellar collision regression checks passed')
''')

replace_once(
    'scripts/runPhysicsRegression.mjs',
    "  { source: 'physicsRegression.ts', output: 'physicsRegression.mjs' },\n",
    "  { source: 'physicsRegression.ts', output: 'physicsRegression.mjs' },\n  { source: 'stellarCollisionRegression.ts', output: 'stellarCollisionRegression.mjs' },\n",
)

replace_once(
    'CHANGELOG.md',
    "## [0.17.24] - 2026-08-26\n",
    "## [Unreleased]\n\n### Added\n- 항성↔항성 충돌 결과를 `merge`, `hitAndRun`, `partialDisruption`으로 분리하고, 비합체 충돌에서도 질량 이동·질량 손실·반지름 갱신·충격 가열 상태가 남도록 했습니다.\n- 항성 질량에서 광도·주계열 반지름·유효온도를 근사하고 온도를 연속 RGB로 변환해, 충돌 후 질량이 바뀐 항성의 평형색이 함께 갱신되도록 했습니다.\n- grazing hit-and-run, 정면 merge, partial disruption, display-only overlap 색 보존을 검증하는 항성 충돌 회귀 체크를 추가했습니다.\n\n### Changed\n- 항성 합체는 가장 강한 섬광·충격면·afterglow, hit-and-run은 양 survivor 방향의 긴 플라즈마 stream, partial disruption은 작은 별 쪽으로 편향된 stripping VFX를 사용하도록 outcome별 profile을 분리했습니다.\n- 충돌 직후 항성 본체/광원/글로우/궤적은 평형색 위에 실시간으로 감쇠하는 shock-temperature bias를 적용하며, 궤적도 짧은 구간만 약하게 밝아지도록 했습니다.\n\n### Fixed\n- display-only 충돌 overlap이 `body.color`를 직접 백색 혼합해 항성 본체가 노랗거나 탈색된 것처럼 보이던 경로를 제거했습니다.\n- synthetic overlap contact sheet의 중심 additive 기여도와 opacity/brightness를 제한해 항성 원판 전체의 base hue를 덮지 않도록 했습니다.\n- 항성 partial disruption이 내부 `disrupt` 판정 후에도 단일 merge 잔여체로 처리되던 topology 오류를 수정했습니다.\n\n## [0.17.24] - 2026-08-26\n",
)

print('stellar collision patch applied')
