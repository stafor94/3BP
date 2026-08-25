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
        : 0.9
  const duration = Math.max(body.lifetime ?? defaultLifetime, 1e-6)
  const progress = THREE.MathUtils.clamp(age / duration, 0, 1)
  const visual = body.effectVisual

  if (kind === 'contactFlash') {
    const rise = 0.58 + 0.42 * smooth01(progress / 0.055)
    const decay = Math.pow(1 - progress, 3.2)
    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: 0.94,
      innerGlow: 1,
      outerGlow: 0.3,
      visualRadius: THREE.MathUtils.clamp(body.radius * 0.42, 0.052, 0.13),
      anisotropicStretch: visual?.stretch ?? 3.1,
      widthScale: visual?.widthScale ?? 0.34,
      tailLength: 0,
      pulseStrength: visual?.pulseStrength ?? 0.24,
      brightness: visual?.brightness ?? 1.55,
      turbulence: visual?.turbulence ?? 0.18,
      cooling: smooth01(progress),
    }
  }

  if (kind === 'compressionShear') {
    const rise = smooth01(progress / 0.12)
    const decay = Math.pow(1 - progress, 1.7)
    return {
      kind,
      progress,
      fadeAlpha: rise * decay,
      baseOpacity: 0.7,
      innerGlow: 0.72,
      outerGlow: 0.18,
      visualRadius: THREE.MathUtils.clamp(body.radius * 0.34, 0.045, 0.11),
      anisotropicStretch: (visual?.stretch ?? 3.8) * (0.94 + progress * 0.18),
      widthScale: (visual?.widthScale ?? 0.3) * (1 + progress * 0.12),
      tailLength: visual?.tailLength ?? 0.2,
      pulseStrength: visual?.pulseStrength ?? 0.12,
      brightness: visual?.brightness ?? 1.18,
      turbulence: visual?.turbulence ?? 0.5,
      cooling: smooth01(progress),
    }
  }

  if (kind === 'stellarPlasma') {
    const linger = Math.pow(1 - progress, 1.28)
    const expansion = smooth01(progress)
    return {
      kind,
      progress,
      fadeAlpha: linger,
      baseOpacity: 0.78,
      innerGlow: 0.82,
      outerGlow: 0.21,
      visualRadius: THREE.MathUtils.clamp(body.radius * 0.26, 0.021, 0.058),
      anisotropicStretch: (visual?.stretch ?? 2.7) * (0.92 + expansion * 0.58),
      widthScale: (visual?.widthScale ?? 0.72) * (1 + expansion * 0.3),
      tailLength: (visual?.tailLength ?? 0.76) * (0.72 + expansion * 0.72),
      pulseStrength: visual?.pulseStrength ?? 0.08,
      brightness: (visual?.brightness ?? 1.12) * (1 - progress * 0.18),
      turbulence: visual?.turbulence ?? 0.62,
      cooling: Math.pow(progress, 1.18),
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
