from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one literal match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:120]!r}")
    write(path, next_text)


# 1) Collision geometry: use trajectory impact parameter and actual penetration depth.
replace_once(
    'src/physics/engine.ts',
    "  speedRatio: number\n  headOn: number\n  grazing: number\n}",
    "  speedRatio: number\n  headOn: number\n  grazing: number\n  impactParameter: number\n  compressionSeverity: number\n}",
)

replace_once(
    'src/physics/engine.ts',
    "  const speedRatio = relativeSpeed / Math.max(escapeSpeed, 1e-6)\n  const headOn = relativeSpeed > 1e-9\n    ? clamp(Math.abs(dot(relativeVelocity, normal)) / relativeSpeed, 0, 1)\n    : 1\n  const grazing = Math.sqrt(Math.max(0, 1 - headOn * headOn))\n\n  return {\n    normal,\n    tangent,\n    distance,\n    relativeVelocity,\n    relativeSpeed,\n    escapeSpeed,\n    speedRatio,\n    headOn,\n    grazing,\n  }",
    "  const speedRatio = relativeSpeed / Math.max(escapeSpeed, 1e-6)\n  const impactParameter = relativeSpeed > 1e-9\n    ? clamp(magnitude(cross(delta, relativeVelocity)) / Math.max(relativeSpeed * contactDistance, 1e-9), 0, 1)\n    : 0\n  // Use the trajectory impact parameter rather than the instantaneous velocity/radius\n  // angle after bodies have already numerically overlapped. This remains stable through\n  // the contact step and does not turn a deep encounter into a fake grazing bounce.\n  const grazing = impactParameter\n  const headOn = Math.sqrt(Math.max(0, 1 - grazing * grazing))\n  const compressionSeverity = clamp(\n    (contactDistance - distance) / Math.max(Math.min(a.radius, b.radius), 1e-6),\n    0,\n    1,\n  )\n\n  return {\n    normal,\n    tangent,\n    distance,\n    relativeVelocity,\n    relativeSpeed,\n    escapeSpeed,\n    speedRatio,\n    headOn,\n    grazing,\n    impactParameter,\n    compressionSeverity,\n  }",
)

replace_once(
    'src/physics/engine.ts',
    "  const { speedRatio, headOn, grazing } = geometry",
    "  const { speedRatio, headOn, grazing, compressionSeverity } = geometry",
)

stellar_block = r"  if \(starCount === 2\) \{.*?\n  \}\n\n  const hasPlanet"
stellar_replacement = '''  if (starCount === 2) {
    const shallowGrazingPass =
      grazing > 0.86 &&
      compressionSeverity < 0.16 &&
      speedRatio > 1.02 &&
      speedRatio < 2.8
    const partialSeverity = clamp(
      clamp((speedRatio - 0.82) / 1.25, 0, 1) * 0.5 +
        headOn * 0.18 +
        compressionSeverity * 0.72 +
        (1 - massRatio) * 0.16,
      0,
      1,
    )

    // A stellar hit-and-run must actually have enough relative energy to escape
    // and must remain a shallow surface-skimming encounter. Sub-escape contacts
    // are capture/merge events; deeper overlaps are fluid compression/stripping,
    // not rigid-body bounces.
    if (shallowGrazingPass) {
      const strippedFractionOfSmaller = clamp(
        0.03 + (speedRatio - 1.02) * 0.035 + (grazing - 0.86) * 0.11,
        0.025,
        0.09,
      )
      return {
        mode: 'hitRun',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'hitAndRun',
      }
    }

    // High-energy contacts that penetrate substantially through either photosphere
    // remain two remnants only as a stripping/disruption event. Never teleport
    // them apart as an elastic hit-and-run.
    if (
      speedRatio > 1.08 &&
      compressionSeverity >= 0.14 &&
      (compressionSeverity >= 0.22 || headOn > 0.42 || massRatio < 0.9)
    ) {
      const strippedFractionOfSmaller = clamp(
        0.055 + partialSeverity * 0.145,
        0.055,
        0.2,
      )
      return {
        mode: 'disrupt',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'partialDisruption',
      }
    }

    const stellarFlyThroughThreshold = 2.25 - headOn * 0.2
    if (speedRatio > stellarFlyThroughThreshold) {
      if (grazing > 0.8 && compressionSeverity < 0.12) {
        const strippedFractionOfSmaller = clamp(
          0.05 + (speedRatio - stellarFlyThroughThreshold) * 0.06,
          0.05,
          0.11,
        )
        return {
          mode: 'hitRun',
          ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
          stellarOutcome: 'hitAndRun',
        }
      }

      const strippedFractionOfSmaller = clamp(
        0.07 + partialSeverity * 0.13,
        0.07,
        0.2,
      )
      return {
        mode: 'disrupt',
        ejectaFraction: smallerMassFraction * strippedFractionOfSmaller,
        stellarOutcome: 'partialDisruption',
      }
    }

    return {
      mode: 'merge',
      ejectaFraction: clamp(
        0.01 + speedRatio * 0.018 + headOn * 0.01 + compressionSeverity * 0.025,
        0.01,
        0.075,
      ),
      stellarOutcome: 'merge',
    }
  }

  const hasPlanet'''
regex_once('src/physics/engine.ts', stellar_block, stellar_replacement)

# 2) Separated stellar remnants: dissipate tangential shear instead of preserving
# almost all of it like rigid billiard balls.
replace_once(
    'src/physics/engine.ts',
    "  let velocityA = sub(a.velocity, scale(geometry.normal, impulseMagnitude / a.mass))\n  let velocityB = add(b.velocity, scale(geometry.normal, impulseMagnitude / b.mass))\n\n  const center = centerOfMassPosition(a, b)",
    "  let velocityA = sub(a.velocity, scale(geometry.normal, impulseMagnitude / a.mass))\n  let velocityB = add(b.velocity, scale(geometry.normal, impulseMagnitude / b.mass))\n\n  const relativeAfterNormalImpulse = sub(velocityB, velocityA)\n  const normalAfterImpulse = scale(\n    geometry.normal,\n    dot(relativeAfterNormalImpulse, geometry.normal),\n  )\n  const tangentAfterImpulse = sub(relativeAfterNormalImpulse, normalAfterImpulse)\n  const tangentRetention = outcome === 'partialDisruption'\n    ? clamp(0.42 + geometry.grazing * 0.12 - geometry.compressionSeverity * 0.2, 0.32, 0.56)\n    : clamp(0.72 + geometry.grazing * 0.1 - geometry.compressionSeverity * 0.24, 0.62, 0.82)\n  const tangentToDissipate = scale(tangentAfterImpulse, 1 - tangentRetention)\n  const tangentialImpulse = scale(\n    tangentToDissipate,\n    1 / Math.max(1 / a.mass + 1 / b.mass, 1e-9),\n  )\n  velocityA = add(velocityA, scale(tangentialImpulse, 1 / a.mass))\n  velocityB = sub(velocityB, scale(tangentialImpulse, 1 / b.mass))\n\n  const center = centerOfMassPosition(a, b)",
)

# 3) Surface color: shock-heated plasma may be white-hot, but the entire stellar
# disc must not instantly become the shock temperature.
replace_once(
    'src/starColors.ts',
    "export function getEquilibriumStellarDisplayColor(mass: number) {\n  return getStellarDisplayColorFromTemperature(getStellarTemperatureKelvin(mass))\n}\n",
    "export function getEquilibriumStellarDisplayColor(mass: number) {\n  return getStellarDisplayColorFromTemperature(getStellarTemperatureKelvin(mass))\n}\n\nexport function mixStellarDisplayColors(a: string, b: string, mix01: number) {\n  const first = hexToRgb(a)\n  const second = hexToRgb(b)\n  const t = clamp(mix01, 0, 1)\n  return rgbToHex({\n    r: first.r + (second.r - first.r) * t,\n    g: first.g + (second.g - first.g) * t,\n    b: first.b + (second.b - first.b) * t,\n  })\n}\n",
)

replace_once(
    'src/rendering/bodyLighting.ts',
    "  getNearestStellarColor,\n  getStellarDisplayColorFromTemperature,\n  getStellarTemperatureKelvin,",
    "  getNearestStellarColor,\n  getStellarDisplayColorFromTemperature,\n  getStellarTemperatureKelvin,\n  mixStellarDisplayColors,",
)

replace_once(
    'src/rendering/bodyLighting.ts',
    "  const equilibriumTemperature = body.stellarTemperatureK ?? getStellarTemperatureKelvin(body.mass)\n  const heatedTemperature = equilibriumTemperature + (body.shockTemperatureBiasK ?? 0) * heatStrength\n  return getStellarDisplayColorFromTemperature(heatedTemperature)",
    "  const equilibriumTemperature = body.stellarTemperatureK ?? getStellarTemperatureKelvin(body.mass)\n  const heatedTemperature = equilibriumTemperature + (body.shockTemperatureBiasK ?? 0) * heatStrength\n  const heatedColor = getStellarDisplayColorFromTemperature(heatedTemperature)\n  const globalSurfaceHeatShare = body.stellarCollisionOutcome === 'merge'\n    ? 0.28\n    : body.stellarCollisionOutcome === 'partialDisruption'\n      ? 0.16\n      : 0.08\n\n  // White-hot temperatures belong primarily to the local contact sheet/plasma.\n  // The whole stellar photosphere only receives a limited global tint, so an\n  // M/K star cannot turn into an A-type white disc for a grazing encounter.\n  return mixStellarDisplayColors(\n    equilibriumColor,\n    heatedColor,\n    heatStrength * globalSurfaceHeatShare,\n  )",
)

# 4) Regression coverage for the exact failure mode in the supplied video.
replace_once(
    'scripts/stellarCollisionRegression.ts',
    "    { x: 0.15, y: -1, z: 0 },",
    "    { x: 0.15, y: -1.65, z: 0 },",
)
replace_once(
    'scripts/stellarCollisionRegression.ts',
    "    { x: -0.15, y: 1, z: 0 },",
    "    { x: -0.15, y: 1.65, z: 0 },",
)

insert_before = "function testHeadOnMergeUsesRemnantMassColor() {"
new_tests = r'''function testSubEscapeGrazingContactCapturesInsteadOfBouncing() {
  const a = makeStar(
    'stellar-bound-graze-a',
    1,
    0.3,
    -0.2999995,
    '#ff6b5e',
    { x: 0.15, y: -1, z: 0 },
  )
  const b = makeStar(
    'stellar-bound-graze-b',
    1,
    0.3,
    0.2999995,
    '#f5f7ff',
    { x: -0.15, y: 1, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const survivorA = result.find((body) => body.id === a.id)
  const survivorB = result.find((body) => body.id === b.id)
  assert(
    !(survivorA?.stellarCollisionOutcome === 'hitAndRun' && survivorB?.stellarCollisionOutcome === 'hitAndRun'),
    'sub-escape stellar contact must not be resolved as an elastic-looking hit-and-run',
  )
  assert(
    result.some((body) => body.bodyType === 'star' && body.id.includes(a.id) && body.id.includes(b.id)),
    'sub-escape grazing stellar contact should be captured into a merged remnant',
  )
}

function testDeepOverlapCannotBecomeHitAndRun() {
  const a = makeStar(
    'stellar-deep-a',
    1,
    0.3,
    -0.22,
    '#ff6b5e',
    { x: 0.1, y: -1.65, z: 0 },
  )
  const b = makeStar(
    'stellar-deep-b',
    1,
    0.3,
    0.22,
    '#f5f7ff',
    { x: -0.1, y: 1.65, z: 0 },
  )

  const result = stepCoreBodies([a, b], 1e-8)
  const survivorA = result.find((body) => body.id === a.id)
  const survivorB = result.find((body) => body.id === b.id)
  assert(
    !(survivorA?.stellarCollisionOutcome === 'hitAndRun' && survivorB?.stellarCollisionOutcome === 'hitAndRun'),
    'deep stellar overlap must be merge/stripping, never a teleport-apart hit-and-run',
  )
}

'''
replace_once('scripts/stellarCollisionRegression.ts', insert_before, new_tests + insert_before)
replace_once(
    'scripts/stellarCollisionRegression.ts',
    "testGrazingHitAndRunHasConsequences()\ntestHeadOnMergeUsesRemnantMassColor()",
    "testGrazingHitAndRunHasConsequences()\ntestSubEscapeGrazingContactCapturesInsteadOfBouncing()\ntestDeepOverlapCannotBecomeHitAndRun()\ntestHeadOnMergeUsesRemnantMassColor()",
)

# 5) Release metadata: this is a bug fix on 0.18.0.
replace_once(
    'package.json',
    '  "version": "0.18.0",',
    '  "version": "0.18.1",',
)

changelog = read('CHANGELOG.md')
marker = "## [0.18.0] - 2026-08-26\n"
entry = """## [0.18.1] - 2026-08-26

### Changed
- 항성 hit-and-run은 충돌 궤적의 impact parameter와 실제 침투/압축 깊이를 함께 사용해 판정하며, 상호 탈출속도보다 느린 접촉이나 깊게 겹친 충돌은 더 이상 탄성충돌처럼 분리시키지 않습니다.
- 실제 hit-and-run에서도 접선 상대속도의 일부를 전단/충격 에너지로 소산해 두 항성이 당구공처럼 원래 진행방향을 거의 그대로 유지하지 않도록 했습니다.
- white-hot 충격 온도는 접촉면·플라즈마 VFX에 집중시키고 항성 본체 전체에는 제한된 비율만 반영해, 적색/주황색 항성이 grazing 충돌 직후 통째로 백색으로 변하는 현상을 제거했습니다.

### Fixed
- 깊게 겹친 항성 충돌이 `grazing > 0.82` 조건만으로 hit-and-run 판정을 받아 다음 프레임에 두 본체가 강제로 떨어지는 오류를 수정했습니다.
- sub-escape grazing 접촉과 deep-overlap 접촉이 hit-and-run으로 빠지지 않는지 검증하는 회귀 테스트를 추가했습니다.

"""
if marker not in changelog:
    raise RuntimeError('CHANGELOG marker not found')
write('CHANGELOG.md', changelog.replace(marker, entry + marker, 1))

print('stellar hit-run/contact color fix applied')
