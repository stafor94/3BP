import * as THREE from 'three'
import type { BodyState, EffectVisualKind } from '../types'

export type CollisionEffectProfile = {
  kind: EffectVisualKind
  progress: number
  fadeAlpha: number
  baseOpacity: number
  innerGlow: number
  outerGlow: number
  visualRadius: number
  anisotropicStretch: number
  widthScale: number
  tailLength: number
  pulseStrength: number
  brightness: number
  turbulence: number
  cooling: number
}

function smooth01(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function inferEffectVisualKind(body: BodyState): EffectVisualKind {
  if (body.effectVisual?.kind) return body.effectVisual.kind
  if (body.name === 'Collision flash') return 'contactFlash'
  if (body.name === 'Collision spark') return 'collisionSpark'
  if (body.name === 'Stellar plasma' || body.id.includes('+plasma')) return 'stellarPlasma'
  return 'collisionSpark'
}

export function getCollisionEffectProfile(body: BodyState): CollisionEffectProfile {
  const kind = inferEffectVisualKind(body)
  const age = Math.max(body.age ?? 0, 0)
  const defaultLifetime = kind === 'contactFlash'
    ? 0.72
    : kind === 'compressionShear'
      ? 0.82
      : kind === 'stellarPlasma'
        ? 1.55
        : kind === 'stellarAfterglow'
          ? 1.1
          : 0.9
  const duration = Math.max(body.lifetime ?? defaultLifetime, 1e-6)
  const progress = THREE.MathUtils.clamp(age / duration, 0, 1)
  const visual = body.effectVisual
  const stellarOutcome = visual?.stellarOutcome
  const stellar = visual?.stellarCollision === true
  const physicalStellar = stellar && !body.id.startsWith('preview:')

  if (kind === 'contactFlash') {
    // Hold the physical stellar core close to peak through the topology-mask
    // window. Previously the ^4.1 decay made a nominally long flash lose most of
    // its energy before the eye could read the 2→1 / 2→2 transition underneath.
    const rise = physicalStellar ? 1 : 0.58 + 0.42 * smooth01(progress / 0.055)
    const peakHoldProgress = 0.2
    const postPeakProgress = THREE.MathUtils.clamp(
      (progress - peakHoldProgress) / Math.max(1 - peakHoldProgress, 1e-6),
      0,
      1,
    )
    const decay = physicalStellar
      ? progress <= peakHoldProgress
        ? 1
        : Math.pow(1 - postPeakProgress, 2.7)
      : Math.pow(1 - progress, 3.2)
    const outcomeBrightnessBoost = physicalStellar
      ? stellarOutcome === 'merge'
        ? 1.18
        : stellarOutcome === 'partialDisruption'
          ? 1.1
          : 1.05
      : 1

    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: physicalStellar
        ? stellarOutcome === 'hitAndRun'
          ? 0.92
          : stellarOutcome === 'partialDisruption'
            ? 0.96
            : 1
        : 0.94,
      innerGlow: 1,
      outerGlow: physicalStellar ? 0.48 : 0.3,
      visualRadius: physicalStellar
        ? THREE.MathUtils.clamp(
            body.radius * (stellarOutcome === 'merge' ? 1.04 : stellarOutcome === 'hitAndRun' ? 0.84 : 0.94),
            0.11,
            0.34,
          )
        : THREE.MathUtils.clamp(body.radius * 0.42, 0.052, 0.13),
      anisotropicStretch: visual?.stretch ?? (physicalStellar ? 5.1 : 3.1),
      widthScale: visual?.widthScale ?? (physicalStellar ? 0.3 : 0.34),
      tailLength: 0,
      pulseStrength: visual?.pulseStrength ?? (physicalStellar ? 0.18 : 0.24),
      brightness: (visual?.brightness ?? (physicalStellar ? 2.35 : 1.55)) * outcomeBrightnessBoost,
      turbulence: visual?.turbulence ?? (physicalStellar ? 0.68 : 0.18),
      cooling: smooth01(progress),
    }
  }

  if (kind === 'compressionShear') {
    const rise = smooth01(progress / (physicalStellar ? 0.045 : stellar ? 0.08 : 0.12))
    const decay = Math.pow(1 - progress, physicalStellar ? 1.18 : stellar ? 1.5 : 1.7)
    const outcomeBoost = physicalStellar
      ? stellarOutcome === 'merge'
        ? 1.16
        : stellarOutcome === 'partialDisruption'
          ? 1.1
          : 1.06
      : 1
    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: physicalStellar
        ? stellarOutcome === 'merge'
          ? 0.9
          : stellarOutcome === 'partialDisruption'
            ? 0.82
            : 0.74
        : stellar
          ? stellarOutcome === 'merge'
            ? 0.84
            : stellarOutcome === 'partialDisruption'
              ? 0.76
              : 0.66
          : 0.7,
      innerGlow: physicalStellar ? 0.9 : stellar ? 0.82 : 0.72,
      outerGlow: physicalStellar ? 0.3 : stellar ? 0.24 : 0.18,
      visualRadius: physicalStellar
        ? THREE.MathUtils.clamp(body.radius * 0.66, 0.085, 0.28)
        : stellar
          ? THREE.MathUtils.clamp(body.radius * 0.55, 0.075, 0.23)
          : THREE.MathUtils.clamp(body.radius * 0.34, 0.045, 0.11),
      anisotropicStretch: (visual?.stretch ?? 3.8) * (0.96 + progress * (physicalStellar ? 0.24 : 0.18)),
      widthScale: (visual?.widthScale ?? 0.3) * (1 + progress * (physicalStellar ? 0.18 : 0.12)),
      tailLength: (visual?.tailLength ?? 0.2) * (physicalStellar && stellarOutcome === 'hitAndRun' ? 1.22 : 1),
      pulseStrength: visual?.pulseStrength ?? 0.12,
      brightness: (visual?.brightness ?? (physicalStellar ? 1.32 : 1.18)) * outcomeBoost,
      turbulence: visual?.turbulence ?? (physicalStellar ? 0.62 : 0.5),
      cooling: smooth01(progress),
    }
  }

  if (kind === 'stellarPlasma') {
    const lingerExponent = physicalStellar
      ? stellarOutcome === 'hitAndRun'
        ? 0.82
        : stellarOutcome === 'partialDisruption'
          ? 0.94
          : 1.02
      : stellar
        ? stellarOutcome === 'hitAndRun'
          ? 1.02
          : stellarOutcome === 'partialDisruption'
            ? 1.1
            : 1.18
        : 1.28
    const linger = Math.pow(1 - progress, lingerExponent)
    const expansion = smooth01(progress)
    const tailOutcomeBoost = physicalStellar
      ? stellarOutcome === 'hitAndRun'
        ? 1.35
        : stellarOutcome === 'partialDisruption'
          ? 1.2
          : 1.05
      : stellarOutcome === 'hitAndRun'
        ? 1.18
        : stellarOutcome === 'partialDisruption'
          ? 1.1
          : 1
    return {
      kind,
      progress,
      fadeAlpha: linger,
      baseOpacity: physicalStellar ? 0.86 : 0.78,
      innerGlow: physicalStellar ? 0.9 : 0.82,
      outerGlow: physicalStellar ? 0.26 : 0.21,
      visualRadius: physicalStellar
        ? THREE.MathUtils.clamp(body.radius * 0.38, 0.028, 0.086)
        : stellar
          ? THREE.MathUtils.clamp(body.radius * 0.32, 0.024, 0.074)
          : THREE.MathUtils.clamp(body.radius * 0.26, 0.021, 0.058),
      anisotropicStretch: (visual?.stretch ?? 2.7) * (0.94 + expansion * (physicalStellar ? 0.7 : 0.58)),
      widthScale: (visual?.widthScale ?? 0.72) * (1 + expansion * (physicalStellar ? 0.36 : 0.3)),
      tailLength: (visual?.tailLength ?? 0.76) *
        (0.74 + expansion * (physicalStellar ? 0.82 : 0.72)) *
        tailOutcomeBoost,
      pulseStrength: visual?.pulseStrength ?? 0.08,
      brightness: (visual?.brightness ?? (physicalStellar ? 1.4 : stellar ? 1.28 : 1.12)) *
        (1 - progress * (physicalStellar ? 0.12 : 0.18)),
      turbulence: visual?.turbulence ?? (physicalStellar ? 0.7 : 0.62),
      cooling: Math.pow(progress, 1.18),
    }
  }

  if (kind === 'stellarAfterglow') {
    const expansion = smooth01(progress / 0.72)
    const decay = Math.pow(1 - progress, physicalStellar ? 1.55 : 1.85)
    return {
      kind,
      progress,
      fadeAlpha: decay,
      baseOpacity: stellarOutcome === 'merge' ? 0.62 : stellarOutcome === 'partialDisruption' ? 0.5 : 0.4,
      innerGlow: physicalStellar ? 0.24 : 0.18,
      outerGlow: physicalStellar ? 0.72 : 0.62,
      visualRadius: THREE.MathUtils.clamp(
        body.radius * (0.76 + expansion * 0.68) *
          (stellarOutcome === 'merge' ? 1.18 : stellarOutcome === 'hitAndRun' ? 0.94 : 1.04),
        0.085,
        0.4,
      ),
      anisotropicStretch: (visual?.stretch ?? 1.28) * (0.9 + expansion * 0.44),
      widthScale: (visual?.widthScale ?? 0.82) * (0.92 + expansion * 0.34),
      tailLength: 0,
      pulseStrength: visual?.pulseStrength ?? 0.02,
      brightness: (visual?.brightness ?? 1.2) * (1 - progress * (physicalStellar ? 0.18 : 0.25)),
      turbulence: visual?.turbulence ?? 0.78,
      cooling: Math.pow(progress, 0.82),
    }
  }

  const decay = Math.pow(1 - progress, 2.15)
  return {
    kind,
    progress,
    fadeAlpha: decay,
    baseOpacity: 0.66,
    innerGlow: 0.68,
    outerGlow: 0.12,
    visualRadius: THREE.MathUtils.clamp(body.radius * 0.76, 0.012, 0.032),
    anisotropicStretch: visual?.stretch ?? 1.9,
    widthScale: visual?.widthScale ?? 0.48,
    tailLength: visual?.tailLength ?? 0.48,
    pulseStrength: visual?.pulseStrength ?? 0.08,
    brightness: visual?.brightness ?? 0.92,
    turbulence: visual?.turbulence ?? 0.3,
    cooling: smooth01(progress),
  }
}
