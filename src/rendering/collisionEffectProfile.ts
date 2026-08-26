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

function clamp(value: number, min: number, max: number) {
  return THREE.MathUtils.clamp(value, min, max)
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
  const progress = clamp(age / duration, 0, 1)
  const visual = body.effectVisual
  const stellarOutcome = visual?.stellarOutcome
  const stellar = visual?.stellarCollision === true
  const syntheticStellar = stellar && body.id.startsWith('preview:')
  const physicalStellar = stellar && !syntheticStellar

  if (kind === 'contactFlash') {
    // Synthetic overlap flashes build toward contact. Physical flashes start at
    // the impact peak and collapse quickly, avoiding a lingering flare blade.
    const syntheticBuild = syntheticStellar ? smooth01(progress / 0.72) : 0
    const rise = syntheticStellar
      ? 0.14 + syntheticBuild * 0.86
      : physicalStellar
        ? 1
        : 0.56 + 0.44 * smooth01(progress / 0.055)
    const peakHoldProgress = physicalStellar ? 0.1 : 0.16
    const postPeakProgress = clamp(
      (progress - peakHoldProgress) / Math.max(1 - peakHoldProgress, 1e-6),
      0,
      1,
    )
    const decay = syntheticStellar
      ? 1
      : progress <= peakHoldProgress
        ? 1
        : Math.pow(1 - postPeakProgress, physicalStellar ? 3.55 : 3.2)
    const outcomeBrightnessBoost = physicalStellar
      ? stellarOutcome === 'merge'
        ? 1.1
        : stellarOutcome === 'partialDisruption'
          ? 1.05
          : 1
      : 1
    const rawStretch = visual?.stretch ?? (physicalStellar ? 2.75 : 2.55)
    const rawWidth = visual?.widthScale ?? (physicalStellar ? 0.48 : 0.42)

    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: syntheticStellar
        ? 0.72
        : physicalStellar
          ? stellarOutcome === 'hitAndRun'
            ? 0.82
            : 0.9
          : 0.92,
      innerGlow: syntheticStellar ? 0.48 : physicalStellar ? 0.72 : 0.9,
      outerGlow: syntheticStellar ? 0.18 : physicalStellar ? 0.22 : 0.26,
      visualRadius: syntheticStellar
        ? clamp(body.radius * (0.76 + progress * 0.14), 0.05, 0.13)
        : physicalStellar
          ? clamp(
              body.radius * (stellarOutcome === 'merge' ? 0.88 : stellarOutcome === 'hitAndRun' ? 0.72 : 0.8),
              0.085,
              0.25,
            )
          : clamp(body.radius * 0.42, 0.052, 0.13),
      anisotropicStretch: clamp(rawStretch, 1.55, syntheticStellar ? 2.7 : physicalStellar ? 3.05 : 3.2),
      widthScale: clamp(rawWidth, physicalStellar ? 0.38 : 0.32, 0.66),
      tailLength: 0,
      pulseStrength: clamp(visual?.pulseStrength ?? (physicalStellar ? 0.055 : 0.16), 0, physicalStellar ? 0.075 : 0.2),
      brightness: syntheticStellar
        ? (visual?.brightness ?? 1.35) * (0.76 + syntheticBuild * 0.24)
        : (visual?.brightness ?? (physicalStellar ? 2.08 : 1.5)) * outcomeBrightnessBoost,
      turbulence: visual?.turbulence ?? (physicalStellar ? 0.72 : 0.2),
      cooling: syntheticStellar ? progress * 0.1 : smooth01(progress),
    }
  }

  if (kind === 'compressionShear') {
    const syntheticBuild = syntheticStellar ? smooth01(progress / 0.62) : 0
    const rise = syntheticStellar
      ? 0.08 + syntheticBuild * 0.92
      : smooth01(progress / (physicalStellar ? 0.05 : stellar ? 0.08 : 0.12))
    const decay = syntheticStellar
      ? 1
      : Math.pow(1 - progress, physicalStellar ? 1.75 : stellar ? 1.55 : 1.7)
    const outcomeBoost = physicalStellar
      ? stellarOutcome === 'merge'
        ? 1.08
        : stellarOutcome === 'partialDisruption'
          ? 1.04
          : 0.96
      : 1
    const rawStretch = visual?.stretch ?? 2.8
    const rawWidth = visual?.widthScale ?? 0.5

    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: syntheticStellar
        ? 0.56
        : physicalStellar
          ? stellarOutcome === 'merge'
            ? 0.74
            : stellarOutcome === 'partialDisruption'
              ? 0.68
              : 0.58
          : 0.68,
      innerGlow: syntheticStellar ? 0.42 : physicalStellar ? 0.64 : stellar ? 0.6 : 0.68,
      outerGlow: syntheticStellar ? 0.12 : physicalStellar ? 0.16 : stellar ? 0.15 : 0.18,
      visualRadius: physicalStellar
        ? clamp(body.radius * 0.56, 0.075, 0.23)
        : stellar
          ? clamp(body.radius * 0.5, 0.068, 0.2)
          : clamp(body.radius * 0.34, 0.045, 0.11),
      anisotropicStretch: clamp(
        rawStretch * (0.92 + progress * (physicalStellar ? 0.12 : 0.1)),
        1.65,
        syntheticStellar ? 3.05 : physicalStellar ? 3.35 : 3.55,
      ),
      widthScale: clamp(
        rawWidth * (1 + progress * (physicalStellar ? 0.16 : 0.1)),
        physicalStellar ? 0.4 : 0.34,
        0.78,
      ),
      tailLength: clamp(
        (visual?.tailLength ?? 0.16) * (physicalStellar && stellarOutcome === 'hitAndRun' ? 1.08 : 1),
        0,
        0.46,
      ),
      pulseStrength: clamp(visual?.pulseStrength ?? 0.05, 0, 0.075),
      brightness: syntheticStellar
        ? (visual?.brightness ?? 1.08) * (0.78 + syntheticBuild * 0.22)
        : (visual?.brightness ?? (physicalStellar ? 1.26 : 1.14)) * outcomeBoost,
      turbulence: visual?.turbulence ?? (physicalStellar ? 0.82 : 0.56),
      cooling: syntheticStellar ? progress * 0.1 : smooth01(progress),
    }
  }

  if (kind === 'stellarPlasma') {
    const syntheticBuild = syntheticStellar ? smooth01(progress / 0.72) : 0
    const lingerExponent = physicalStellar
      ? stellarOutcome === 'hitAndRun'
        ? 1.02
        : stellarOutcome === 'partialDisruption'
          ? 1.08
          : 1.18
      : stellar
        ? 1.12
        : 1.28
    const linger = syntheticStellar
      ? 0.06 + syntheticBuild * 0.94
      : Math.pow(1 - progress, lingerExponent)
    const expansion = smooth01(progress)
    const rawStretch = visual?.stretch ?? 2.25
    const rawWidth = visual?.widthScale ?? 0.82
    const rawTail = visual?.tailLength ?? 0.62
    const maxStretch = physicalStellar
      ? stellarOutcome === 'hitAndRun'
        ? 3.5
        : stellarOutcome === 'partialDisruption'
          ? 3.25
          : 2.9
      : syntheticStellar
        ? 3.25
        : 3.4
    const maxTail = physicalStellar
      ? stellarOutcome === 'hitAndRun'
        ? 1.02
        : stellarOutcome === 'partialDisruption'
          ? 0.94
          : 0.82
      : syntheticStellar
        ? 0.9
        : 1

    return {
      kind,
      progress,
      fadeAlpha: linger,
      baseOpacity: syntheticStellar ? 0.6 : physicalStellar ? 0.72 : 0.72,
      innerGlow: syntheticStellar ? 0.5 : physicalStellar ? 0.66 : 0.72,
      outerGlow: syntheticStellar ? 0.1 : physicalStellar ? 0.13 : 0.18,
      visualRadius: physicalStellar
        ? clamp(body.radius * 0.42, 0.03, 0.09)
        : stellar
          ? clamp(body.radius * 0.36, 0.026, 0.078)
          : clamp(body.radius * 0.26, 0.021, 0.058),
      anisotropicStretch: clamp(
        rawStretch * (0.9 + expansion * (physicalStellar ? 0.18 : 0.15)),
        1.45,
        maxStretch,
      ),
      widthScale: clamp(
        rawWidth * (1 + expansion * (physicalStellar ? 0.24 : 0.18)),
        physicalStellar ? 0.58 : 0.52,
        1.16,
      ),
      tailLength: clamp(
        rawTail * (0.72 + expansion * 0.22),
        0.22,
        maxTail,
      ),
      pulseStrength: clamp(visual?.pulseStrength ?? 0.035, 0, 0.055),
      brightness: syntheticStellar
        ? (visual?.brightness ?? 1.18) * (0.76 + syntheticBuild * 0.24)
        : (visual?.brightness ?? (physicalStellar ? 1.3 : stellar ? 1.22 : 1.08)) *
          (1 - progress * (physicalStellar ? 0.2 : 0.18)),
      turbulence: clamp(visual?.turbulence ?? (physicalStellar ? 0.82 : 0.66), 0.44, 1),
      cooling: syntheticStellar ? progress * 0.1 : Math.pow(progress, 1.08),
    }
  }

  if (kind === 'stellarAfterglow') {
    // The afterglow pass carries the expanding shock shell. Keep it close to
    // circular with a crisp edge so it reads as a shell, not another bloom halo.
    const expansion = smooth01(progress / 0.68)
    const decay = Math.pow(1 - progress, physicalStellar ? 1.5 : 1.7)
    const rawStretch = visual?.stretch ?? 1.08
    const rawWidth = visual?.widthScale ?? 0.98
    return {
      kind,
      progress,
      fadeAlpha: decay,
      baseOpacity: stellarOutcome === 'merge' ? 0.58 : stellarOutcome === 'partialDisruption' ? 0.5 : 0.4,
      innerGlow: physicalStellar ? 0.08 : 0.07,
      outerGlow: physicalStellar ? 0.25 : 0.22,
      visualRadius: clamp(
        body.radius * (0.72 + expansion * 0.92) *
          (stellarOutcome === 'merge' ? 1.08 : stellarOutcome === 'hitAndRun' ? 0.88 : 0.98),
        0.08,
        0.42,
      ),
      anisotropicStretch: clamp(rawStretch * (0.96 + expansion * 0.06), 0.96, 1.18),
      widthScale: clamp(rawWidth * (0.97 + expansion * 0.05), 0.9, 1.08),
      tailLength: 0,
      pulseStrength: clamp(visual?.pulseStrength ?? 0.012, 0, 0.025),
      brightness: (visual?.brightness ?? 1.08) * (1 - progress * (physicalStellar ? 0.22 : 0.28)),
      turbulence: visual?.turbulence ?? 0.82,
      cooling: Math.pow(progress, 0.78),
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
    visualRadius: clamp(body.radius * 0.76, 0.012, 0.032),
    anisotropicStretch: visual?.stretch ?? 1.9,
    widthScale: visual?.widthScale ?? 0.48,
    tailLength: visual?.tailLength ?? 0.48,
    pulseStrength: visual?.pulseStrength ?? 0.08,
    brightness: visual?.brightness ?? 0.92,
    turbulence: visual?.turbulence ?? 0.3,
    cooling: smooth01(progress),
  }
}
