import * as THREE from 'three'
import type { BodyState, EffectVisualKind } from '../types'
import {
  getBodyPresentationRadius,
  MIN_BODY_RENDER_RADIUS,
  MIN_FRAGMENT_RENDER_RADIUS,
} from './bodyPresentationRadius'

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

export const SMALL_HEAD_ON_CONTACT_FLASH_SOURCE_RADIUS_MAX = MIN_BODY_RENDER_RADIUS
export const SMALL_HEAD_ON_CONTACT_FLASH_WIDTH_MAX = 0.33
export const SMALL_HEAD_ON_CONTACT_FLASH_TAIL_SENTINEL = -2

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

function isStageFiveCollisionVfxEnabled() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('collision-vfx-baseline') !== 'stage4'
}

function getNonStellarSeverity(body: BodyState) {
  const visual = body.effectVisual
  if (visual?.temperatureBias !== undefined) return clamp(visual.temperatureBias, 0, 1)
  const brightness = visual?.brightness ?? 1
  return smooth01((brightness - 0.72) / 0.72)
}

function getNonStellarContactGeometry(body: BodyState, rawWidth: number) {
  const visual = body.effectVisual
  if (visual?.headOn !== undefined || visual?.grazing !== undefined) {
    const headOn = clamp(visual?.headOn ?? Math.sqrt(Math.max(0, 1 - (visual?.grazing ?? 0) ** 2)), 0, 1)
    const grazing = clamp(visual?.grazing ?? Math.sqrt(Math.max(0, 1 - headOn * headOn)), 0, 1)
    return { headOn, grazing }
  }

  // The existing non-stellar flash metadata narrows width as the collision becomes
  // more head-on. Reuse that renderer-only signal when explicit geometry metadata
  // is unavailable rather than re-estimating contact geometry from body positions.
  const headOn = smooth01((0.43 - rawWidth) / 0.18)
  return {
    headOn,
    grazing: Math.sqrt(Math.max(0, 1 - headOn * headOn)),
  }
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
  const stageFiveNonStellar = !stellar && isStageFiveCollisionVfxEnabled()

  if (stellar && kind === 'stellarPlasma') {
    // Physical gas parcels are the one stellar effect family that owns a world-space
    // trail. Keep its parcel-wide profile here; contact/shear/afterglow must continue
    // into their kind-specific branches below so generated shape metadata is honored.
    const sourceRadius = Math.max(visual?.sourceMaxRadius ?? body.radius, 1e-8)
    const sourcePresentationRadius = getBodyPresentationRadius(sourceRadius)
    const bodyPresentationRadius = getBodyPresentationRadius(Math.max(body.radius, 0))
    const release = smooth01((age - (visual?.phaseOffset ?? 0) * 0.009) / 0.006)
    const cooling = smooth01(progress)
    const gasTerminalFade = 1 - smooth01((progress - 0.78) / 0.22)
    return {
      kind,
      progress,
      cooling,
      fadeAlpha: release * gasTerminalFade,
      baseOpacity: 0.24,
      innerGlow: 0.08,
      outerGlow: 0.18,
      visualRadius: Math.min(bodyPresentationRadius * 1.2, sourcePresentationRadius * 0.30) *
        (1 + progress * 2.8),
      anisotropicStretch: Math.min(2.6, Math.max(1.25, (visual?.stretch ?? 2) * 0.48)),
      widthScale: 0.85 + progress * 1.2,
      tailLength: stellarOutcome === 'hitAndRun' ? 0.8 : stellarOutcome === 'partialDisruption' ? 0.65 : 0.5,
      pulseStrength: 0,
      brightness: 0.82 * (1 - cooling * 0.22),
      turbulence: visual?.turbulence ?? 0.5,
    }
  }

  if (kind === 'contactFlash') {
    // Synthetic overlap flashes build toward contact. Physical stellar flashes
    // start at the impact peak. Solid-body flashes stay compact and broad so an
    // impact reads as a local burst instead of a white beam across the survivor.
    const rawStretch = visual?.stretch ?? (physicalStellar ? 2.75 : 2.55)
    const rawWidth = visual?.widthScale ?? (physicalStellar ? 0.48 : 0.42)
    const legacySolidFlashRadius = clamp(body.radius * 0.32, 0.038, 0.082)
    const sourcePresentationRadius = visual?.sourceMaxRadius !== undefined
      ? getBodyPresentationRadius(Math.max(visual.sourceMaxRadius, 0))
      : undefined
    const solidFlashRadius = sourcePresentationRadius === undefined
      ? legacySolidFlashRadius
      : Math.min(legacySolidFlashRadius, sourcePresentationRadius * 0.98)
    const severity = stageFiveNonStellar ? getNonStellarSeverity(body) : 1
    const contactGeometry = stageFiveNonStellar
      ? getNonStellarContactGeometry(body, rawWidth)
      : { headOn: 0, grazing: 0 }
    // The physics contact-flash width is still useful presentation metadata:
    // <= 0.33 corresponds to the same sufficiently head-on range that suppresses
    // directional spark shape. Keep this renderer-only so collision staging/physics
    // do not gain another C-track branch.
    const smallHeadOnSolidFlash = !stellar &&
      visual?.sourceMaxRadius !== undefined &&
      Math.abs(visual.sourceMaxRadius) <= SMALL_HEAD_ON_CONTACT_FLASH_SOURCE_RADIUS_MAX &&
      rawWidth <= SMALL_HEAD_ON_CONTACT_FLASH_WIDTH_MAX
    // Stage 5 makes every solid-body flash a short wall-clock contact cue. Severity
    // expands the peak modestly, while head-on geometry shortens it so the physical
    // fragment silhouette becomes the visual owner by ~0.1-0.2 s.
    const stageFiveDuration = THREE.MathUtils.lerp(0.18, 0.29, severity) *
      THREE.MathUtils.lerp(1, 0.88, contactGeometry.headOn)
    const contactProgress = stageFiveNonStellar
      ? clamp(age / Math.max(stageFiveDuration, 1e-6), 0, 1)
      : smallHeadOnSolidFlash
        ? clamp(age / Math.max(duration * 0.25, 1e-6), 0, 1)
        : progress
    const syntheticBuild = syntheticStellar ? smooth01(contactProgress / 0.72) : 0
    const rise = syntheticStellar
      ? 0.14 + syntheticBuild * 0.86
      : physicalStellar
        ? 1
        : stageFiveNonStellar
          ? 0.42 + 0.58 * smooth01(contactProgress / 0.075)
          : 0.56 + 0.44 * smooth01(contactProgress / 0.055)
    const peakHoldProgress = physicalStellar ? 0.1 : stageFiveNonStellar ? 0.11 : 0.16
    const postPeakProgress = clamp(
      (contactProgress - peakHoldProgress) / Math.max(1 - peakHoldProgress, 1e-6),
      0,
      1,
    )
    const decay = syntheticStellar
      ? 1
      : contactProgress <= peakHoldProgress
        ? 1
        : Math.pow(1 - postPeakProgress, physicalStellar ? 3.55 : stageFiveNonStellar ? 3.65 : 3.2)
    const outcomeBrightnessBoost = physicalStellar
      ? stellarOutcome === 'merge'
        ? 1.08
        : stellarOutcome === 'partialDisruption'
          ? 1.04
          : 0.98
      : 1
    const stageFiveFootprintScale = stageFiveNonStellar
      ? THREE.MathUtils.lerp(0.60, 0.80, severity) *
        THREE.MathUtils.lerp(1, 1.05, contactGeometry.grazing)
      : 1
    const stageFiveStretch = stageFiveNonStellar
      ? THREE.MathUtils.lerp(1.03, 1.24, contactGeometry.grazing)
      : 1
    const stageFiveWidth = stageFiveNonStellar
      ? THREE.MathUtils.lerp(0.92, 0.80, contactGeometry.grazing)
      : 1

    return {
      kind,
      progress: contactProgress,
      fadeAlpha: rise * decay,
      baseOpacity: syntheticStellar
        ? 0.72
        : physicalStellar
          ? stellarOutcome === 'hitAndRun'
            ? 0.60
            : stellarOutcome === 'partialDisruption'
              ? 0.66
              : 0.70
          : stageFiveNonStellar
            ? THREE.MathUtils.lerp(0.48, 0.64, severity)
            : 0.78,
      innerGlow: syntheticStellar
        ? 0.48
        : physicalStellar
          ? 0.46
          : stageFiveNonStellar
            ? THREE.MathUtils.lerp(0.36, 0.50, severity)
            : 0.68,
      outerGlow: syntheticStellar
        ? 0.18
        : physicalStellar
          ? 0.10
          : stageFiveNonStellar
            ? THREE.MathUtils.lerp(0.04, 0.08, severity)
            : 0.14,
      visualRadius: syntheticStellar
        ? clamp(body.radius * (0.76 + contactProgress * 0.14), 0.05, 0.13)
        : physicalStellar
          ? clamp((sourcePresentationRadius ?? getBodyPresentationRadius(body.radius)) * 0.24, 0.055, 0.18)
          : solidFlashRadius * stageFiveFootprintScale,
      anisotropicStretch: stellar
        ? clamp(rawStretch, 1.55, syntheticStellar ? 2.7 : 3.05)
        : stageFiveNonStellar
          ? smallHeadOnSolidFlash ? 1 : stageFiveStretch
          : smallHeadOnSolidFlash
            ? 1
            : clamp(rawStretch, 1.18, 1.45),
      widthScale: stellar
        ? clamp(rawWidth, physicalStellar ? 0.38 : 0.32, 0.66)
        : stageFiveNonStellar
          ? smallHeadOnSolidFlash ? 1 : stageFiveWidth
          : smallHeadOnSolidFlash
            ? 1
            : clamp(rawWidth, 0.86, 1.00),
      // Negative tail is a renderer-local sentinel for compact solid-body masks.
      // -2 selects the radial small/high-head-on burst with no directional ridge;
      // -1 preserves the existing compact directional mask for other collisions.
      tailLength: stellar
        ? 0
        : smallHeadOnSolidFlash
          ? SMALL_HEAD_ON_CONTACT_FLASH_TAIL_SENTINEL
          : -1,
      pulseStrength: stellar
        ? clamp(visual?.pulseStrength ?? (physicalStellar ? 0.04 : 0.16), 0, physicalStellar ? 0.055 : 0.2)
        : stageFiveNonStellar
          ? clamp(visual?.pulseStrength ?? 0.03, 0, 0.035)
          : clamp(visual?.pulseStrength ?? 0.07, 0, 0.08),
      brightness: syntheticStellar
        ? (visual?.brightness ?? 1.35) * (0.76 + syntheticBuild * 0.24)
        : physicalStellar
          ? (visual?.brightness ?? 2.08) * 0.82 * outcomeBrightnessBoost
          : stageFiveNonStellar
            ? clamp(
                (visual?.brightness ?? 1.28) * THREE.MathUtils.lerp(0.74, 0.88, severity),
                0,
                1.28,
              )
            : clamp(visual?.brightness ?? 1.28, 0, 1.5),
      turbulence: visual?.turbulence ?? (physicalStellar ? 0.72 : 0.2),
      cooling: syntheticStellar ? contactProgress * 0.1 : smooth01(contactProgress),
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
    const sourcePresentationRadius = visual?.sourceMaxRadius !== undefined
      ? getBodyPresentationRadius(Math.max(visual.sourceMaxRadius, 0))
      : getBodyPresentationRadius(body.radius)

    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: syntheticStellar
        ? 0.56
        : physicalStellar
          ? stellarOutcome === 'merge'
            ? 0.62
            : stellarOutcome === 'partialDisruption'
              ? 0.58
              : 0.50
          : 0.68,
      innerGlow: syntheticStellar ? 0.42 : physicalStellar ? 0.46 : stellar ? 0.6 : 0.68,
      outerGlow: syntheticStellar ? 0.12 : physicalStellar ? 0.10 : stellar ? 0.15 : 0.18,
      visualRadius: physicalStellar
        ? clamp(sourcePresentationRadius * 0.28, 0.065, 0.21)
        : stellar
          ? clamp(sourcePresentationRadius * 0.25, 0.06, 0.19)
          : clamp(body.radius * 0.34, 0.045, 0.11),
      anisotropicStretch: clamp(
        rawStretch * (0.92 + progress * (physicalStellar ? 0.12 : 0.1)),
        stellar ? 1.65 : 1.25,
        syntheticStellar ? 3.05 : physicalStellar ? 3.35 : stellar ? 3.55 : 1.55,
      ),
      widthScale: clamp(
        rawWidth * (1 + progress * (physicalStellar ? 0.16 : 0.1)),
        physicalStellar ? 0.4 : stellar ? 0.34 : 0.86,
        stellar ? 0.78 : 1.00,
      ),
      tailLength: stellar
        ? clamp(
            (visual?.tailLength ?? 0.16) * (physicalStellar && stellarOutcome === 'hitAndRun' ? 1.08 : 1),
            0,
            0.46,
          )
        : -1,
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
    // A residual stellar afterglow is a diffuse cooling cloud, not a second shock
    // shell. Keep its footprint tied to the source presentation radius so it cannot
    // become a camera-sized ring when the effect body's physical radius is large.
    const expansion = smooth01(progress / 0.78)
    const decay = Math.pow(1 - progress, physicalStellar ? 1.7 : 1.85)
    const rawStretch = visual?.stretch ?? 1.08
    const rawWidth = visual?.widthScale ?? 0.98
    const sourcePresentationRadius = getBodyPresentationRadius(
      Math.max(visual?.sourceMaxRadius ?? body.radius, 0),
    )
    return {
      kind,
      progress,
      fadeAlpha: decay,
      baseOpacity: stellarOutcome === 'merge' ? 0.26 : stellarOutcome === 'partialDisruption' ? 0.22 : 0.18,
      innerGlow: physicalStellar ? 0.10 : 0.08,
      outerGlow: physicalStellar ? 0.12 : 0.10,
      visualRadius: clamp(
        sourcePresentationRadius * (0.30 + expansion * 0.22),
        0.06,
        0.28,
      ),
      anisotropicStretch: clamp(rawStretch * (0.98 + expansion * 0.04), 0.96, 1.24),
      widthScale: clamp(rawWidth * (0.98 + expansion * 0.04), 0.84, 1.06),
      tailLength: 0,
      pulseStrength: clamp(visual?.pulseStrength ?? 0.008, 0, 0.018),
      brightness: (visual?.brightness ?? 1.0) * (0.88 - progress * (physicalStellar ? 0.16 : 0.2)),
      turbulence: visual?.turbulence ?? 0.82,
      cooling: Math.pow(progress, 0.78),
    }
  }

  const hasGeometry = visual?.headOn !== undefined || visual?.grazing !== undefined
  const headOn = hasGeometry ? clamp(visual?.headOn ?? 0, 0, 1) : 0
  const compactSplash = hasGeometry ? smooth01((headOn - 0.62) / 0.3) : 0
  // Nearly head-on small-body ejecta now leaves the solver along ±collision normal.
  // Keep those mass-bearing sparks compact/isotropic so they do not become fake
  // directional streaks, but do not hide the actual physical ejecta motion.
  const smallNonStellarSpark = hasGeometry &&
    visual?.sourceMaxRadius !== undefined &&
    visual.sourceMaxRadius <= MIN_BODY_RENDER_RADIUS
  const directionalSuppression = smallNonStellarSpark && headOn >= 0.86
    ? 1
    : hasGeometry
      ? smooth01((headOn - 0.86) / 0.1)
      : 0
  const visibilityScale = smallNonStellarSpark
    ? THREE.MathUtils.lerp(1, 0.62, directionalSuppression)
    : 1 - directionalSuppression
  const severity = stageFiveNonStellar ? getNonStellarSeverity(body) : 1
  const stageFourVisualDuration = hasGeometry
    ? Math.max(0.42, duration * (1 - compactSplash * 0.71))
    : duration
  const visualDuration = stageFiveNonStellar && hasGeometry
    ? Math.min(
        stageFourVisualDuration,
        THREE.MathUtils.lerp(0.30, 0.48, severity) * THREE.MathUtils.lerp(1, 0.82, compactSplash),
      )
    : stageFourVisualDuration
  const sparkProgress = clamp(age / visualDuration, 0, 1)
  const decay = Math.pow(1 - sparkProgress, hasGeometry ? stageFiveNonStellar ? 2.9 : 2.6 : 2.15)
  const rawSparkStretch = clamp(visual?.stretch ?? 1.45, 1.1, 1.55)
  const rawSparkWidth = clamp(visual?.widthScale ?? 0.68, 0.6, 0.82)
  const rawSparkTail = clamp(visual?.tailLength ?? 0.16, 0.08, 0.22)
  const rawSparkBrightness = clamp(visual?.brightness ?? 0.88, 0, 1.08)
  const compactStretch = hasGeometry
    ? clamp(rawSparkStretch * (1 - compactSplash * 0.26), 1.05, 1.55)
    : rawSparkStretch
  const compactWidth = hasGeometry
    ? clamp(rawSparkWidth + compactSplash * 0.2, 0.6, 0.9)
    : rawSparkWidth
  const compactTail = hasGeometry
    ? clamp(rawSparkTail * (1 - compactSplash * 0.78), 0.035, 0.22)
    : rawSparkTail
  const sparkVisualRadius = smallNonStellarSpark && headOn >= 0.86
    ? clamp(body.radius * 0.72, MIN_FRAGMENT_RENDER_RADIUS, 0.012)
    : clamp(body.radius * 0.62, 0.01, 0.025)
  const stageFiveSparkScale = stageFiveNonStellar
    ? THREE.MathUtils.lerp(0.70, 0.86, severity)
    : 1

  return {
    kind,
    progress: sparkProgress,
    fadeAlpha: decay * visibilityScale,
    baseOpacity: 0.54 * (1 - compactSplash * 0.12) *
      (stageFiveNonStellar ? THREE.MathUtils.lerp(0.62, 0.80, severity) : 1),
    innerGlow: 0.5 * (1 - compactSplash * 0.18) *
      (stageFiveNonStellar ? THREE.MathUtils.lerp(0.58, 0.78, severity) : 1),
    outerGlow: 0.08 * (1 - compactSplash * 0.35) *
      (stageFiveNonStellar ? THREE.MathUtils.lerp(0.45, 0.68, severity) : 1),
    visualRadius: sparkVisualRadius * stageFiveSparkScale,
    anisotropicStretch: THREE.MathUtils.lerp(compactStretch, 1, directionalSuppression),
    widthScale: THREE.MathUtils.lerp(compactWidth, 1, directionalSuppression),
    tailLength: compactTail * (1 - directionalSuppression) * (stageFiveNonStellar ? 0.82 : 1),
    pulseStrength: clamp(visual?.pulseStrength ?? 0.035, 0, stageFiveNonStellar ? 0.03 : 0.045),
    brightness: rawSparkBrightness * (1 - compactSplash * 0.14) *
      (stageFiveNonStellar ? THREE.MathUtils.lerp(0.72, 0.90, severity) : 1),
    turbulence: visual?.turbulence ?? 0.3,
    cooling: smooth01(sparkProgress),
  }
}
