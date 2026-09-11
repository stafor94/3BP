import * as THREE from 'three'
import type { BodyState } from '../types'
import type { CollisionEffectProfile } from './collisionEffectProfile'
import {
  COLLISION_REMNANT_FORMATION_START_MS,
  COLLISION_REMNANT_SETTLE_END_MS,
  findCollisionVisualTransitions,
  getCollisionRemnantVisualLifecycle,
} from './collisionVisualOutcome'

export type CollisionRemnantContinuityState = {
  scale: number
  opacity: number
  deformation: number
  compression: number
  heat: number
}

export type CollisionRemnantSilhouetteMetrics = {
  physicalRadius: number
  visualScale: number
  contactAxisRadius: number
  perpendicularAxisRadius: number
  equivalentRadius: number
  boundingRadius: number
  minimumRadius: number
  aspectRatio: number
}

export type CollisionContinuityTelemetry = CollisionRemnantSilhouetteMetrics & {
  elapsedMs: number
  sourceLastVisibleBoundingRadius: number
  opacity: number
  deformation: number
  compression: number
  heat: number
}

export type CollisionEffectContinuityTelemetry = {
  kind: number
  opacity: number
  transformAspectRatio: number
  finalSilhouetteAspectRatio: number
  scaleX: number
  scaleY: number
}

export const COLLISION_REMNANT_VISIBLE_OPACITY_THRESHOLD = 0.55
export const COLLISION_REMNANT_VISIBLE_TARGET_SCALE = 0.972
export const COLLISION_REMNANT_FORMATION_TARGET_SCALE = 0.996
export const COLLISION_REMNANT_INITIAL_DEFORMATION = 0.10
export const COLLISION_REMNANT_VISIBLE_DEFORMATION = 0.008
export const COLLISION_REMNANT_INITIAL_COMPRESSION = 0.07
export const COLLISION_REMNANT_VISIBLE_COMPRESSION = 0.004

const CONTACT_FLASH_COMPACT_MARKER = 'edge = halo;'
const COMPRESSION_SHEAR_COMPACT_MARKER = 'edge = band * (1.0 - filament);'
const BODY_TANGENT_SCALE_MARKER = `      float tangentScale = 1.0 + uCollisionFormationCompression * 0.16;
      float axisScale = 1.0 - uCollisionFormationCompression;`
const BODY_TANGENT_SCALE_REPLACEMENT = `      // Preserve equivalent volume while the contact axis compresses. The old
      // tangentScale only recovered 16% of compression and made the whole remnant
      // visibly lose mass before expanding again.
      float axisScale = max(0.72, 1.0 - uCollisionFormationCompression);
      float tangentScale = inversesqrt(axisScale);`

let installed = false
let previousBodies: BodyState[] | null = null
const activeRemnants = new Map<string, {
  sourceRadius: number
  resultRadius: number
  startedAt: number
}>()

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function cloneBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    trackingContinuationIds: body.trackingContinuationIds ? [...body.trackingContinuationIds] : undefined,
  }
}

function getBodySeed01(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function resolveVisibleTargetScale(sourceRadius: number, resultRadius: number, seed01: number) {
  const safeResultRadius = Math.max(Math.abs(resultRadius), 1e-9)
  const inheritedScale = Math.abs(sourceRadius) / safeResultRadius
  const continuityMin = inheritedScale * 0.90
  const continuityMax = inheritedScale * 1.05
  const seededTarget = COLLISION_REMNANT_VISIBLE_TARGET_SCALE + (clamp01(seed01) - 0.5) * 0.004
  return THREE.MathUtils.clamp(seededTarget, continuityMin, continuityMax)
}

export function getCollisionRemnantContinuityState(
  elapsedMs: number,
  sourceRadius: number,
  resultRadius: number,
  seed01 = 0.5,
): CollisionRemnantContinuityState {
  const elapsed = Math.max(0, elapsedMs)
  const safeResultRadius = Math.max(Math.abs(resultRadius), 1e-9)
  const inheritedScale = Math.abs(sourceRadius) / safeResultRadius
  const visibleTargetScale = resolveVisibleTargetScale(sourceRadius, resultRadius, seed01)
  const preRevealProgress = smooth01(elapsed / Math.max(1, COLLISION_REMNANT_FORMATION_START_MS))
  const lifecycle = getCollisionRemnantVisualLifecycle(elapsed)

  if (elapsed <= COLLISION_REMNANT_FORMATION_START_MS) {
    return {
      scale: THREE.MathUtils.lerp(inheritedScale, visibleTargetScale, preRevealProgress),
      opacity: 0.32 + preRevealProgress * 0.22,
      deformation: THREE.MathUtils.lerp(COLLISION_REMNANT_INITIAL_DEFORMATION, COLLISION_REMNANT_VISIBLE_DEFORMATION, preRevealProgress),
      compression: THREE.MathUtils.lerp(COLLISION_REMNANT_INITIAL_COMPRESSION, COLLISION_REMNANT_VISIBLE_COMPRESSION, preRevealProgress),
      heat: THREE.MathUtils.lerp(0.26, 0.16, preRevealProgress),
    }
  }

  if (lifecycle.phase === 'FORMING') {
    const formation = lifecycle.formationProgress
    return {
      scale: THREE.MathUtils.lerp(visibleTargetScale, COLLISION_REMNANT_FORMATION_TARGET_SCALE, formation),
      opacity: Math.min(1, 0.54 + Math.pow(formation, 0.62) * 0.46),
      deformation: THREE.MathUtils.lerp(COLLISION_REMNANT_VISIBLE_DEFORMATION, 0.004, formation),
      compression: THREE.MathUtils.lerp(COLLISION_REMNANT_VISIBLE_COMPRESSION, 0.002, formation),
      heat: THREE.MathUtils.lerp(0.16, 0.12, formation),
    }
  }

  if (lifecycle.phase === 'SETTLING') {
    const settle = lifecycle.settleProgress
    const settleEnvelope = 1 - settle
    return {
      scale: THREE.MathUtils.lerp(COLLISION_REMNANT_FORMATION_TARGET_SCALE, 1, settle),
      opacity: 1,
      deformation: 0.004 * settleEnvelope,
      compression: 0.002 * settleEnvelope,
      heat: 0.12 * Math.pow(settleEnvelope, 1.18),
    }
  }

  return { scale: 1, opacity: 1, deformation: 0, compression: 0, heat: 0 }
}

export function getCollisionRemnantSilhouetteMetrics(
  state: CollisionRemnantContinuityState,
  physicalRadius: number,
): CollisionRemnantSilhouetteMetrics {
  const radius = Math.max(Math.abs(physicalRadius), 1e-9)
  const baseRadius = radius * state.scale
  const axisScale = Math.max(0.72, 1 - state.compression)
  const tangentScale = 1 / Math.sqrt(axisScale)
  const radialVariation = Math.min(0.18, Math.max(0, state.deformation) * (0.34 + 0.19 + 0.14))
  const contactAxisRadius = baseRadius * axisScale
  const perpendicularAxisRadius = baseRadius * tangentScale
  const minimumRadius = Math.min(contactAxisRadius, perpendicularAxisRadius) * (1 - radialVariation)
  const boundingRadius = Math.max(contactAxisRadius, perpendicularAxisRadius) * (1 + radialVariation)
  const equivalentRadius = baseRadius * Math.cbrt(axisScale * tangentScale * tangentScale)
  return {
    physicalRadius: radius,
    visualScale: state.scale,
    contactAxisRadius,
    perpendicularAxisRadius,
    equivalentRadius,
    boundingRadius,
    minimumRadius,
    aspectRatio: boundingRadius / Math.max(minimumRadius, 1e-9),
  }
}

export function getCollisionEffectSilhouetteMetrics(profile: CollisionEffectProfile) {
  const scaleX = profile.visualRadius * 2 * profile.anisotropicStretch
  const scaleY = profile.visualRadius * 2 * profile.widthScale
  const transformAspectRatio = Math.max(scaleX, scaleY) / Math.max(Math.min(scaleX, scaleY), 1e-9)
  const compactSolid = profile.tailLength < -0.5 && (profile.kind === 'contactFlash' || profile.kind === 'compressionShear')
  let footprintAspect = 1
  if (compactSolid) {
    footprintAspect = profile.kind === 'contactFlash'
      ? profile.tailLength < -1.5
        ? (1 / 0.98) / (1 / 1.02)
        : (1 / 0.92) / (1 / 1.02)
      : (1 / 0.94) / (1 / 1.04)
  }
  return { scaleX, scaleY, transformAspectRatio, finalSilhouetteAspectRatio: transformAspectRatio * footprintAspect }
}

function patchCollisionEffectShader(material: THREE.ShaderMaterial) {
  if (material.userData.collisionContinuityEffectPatched) return
  if (!material.uniforms.uKind || !material.uniforms.uTail || !material.fragmentShader.includes(CONTACT_FLASH_COMPACT_MARKER) || !material.fragmentShader.includes(COMPRESSION_SHEAR_COMPACT_MARKER)) return

  material.fragmentShader = material.fragmentShader
    .replace(CONTACT_FLASH_COMPACT_MARKER, `${CONTACT_FLASH_COMPACT_MARKER}\n\n      if (uTail < -1.5) {\n        // Small high-head-on solid impacts must read as a contact-local burst.\n        // Do not reintroduce the tangent-aligned band/ridge that becomes a\n        // bright screen-space pillar when the collision normal is horizontal.\n        float compactRadius = length(vec2(p.x * 0.98, warpedY * 1.02));\n        float compactMass = 1.0 - smoothstep(0.24, 0.90, compactRadius);\n        float compactCore = 1.0 - smoothstep(0.08, 0.52, compactRadius);\n        alpha = compactMass * 0.86;\n        core = compactCore * 0.82;\n        body = compactMass * 0.84;\n        edge = compactMass * (1.0 - compactCore * 0.88);\n      } else if (uTail < -0.5) {\n        float compactRadius = length(vec2(p.x * 0.92, warpedY * 1.02));\n        float compactMass = 1.0 - smoothstep(0.28, 0.92, compactRadius);\n        float directionalBand = exp(-abs(warpedY) * 5.4) * (1.0 - smoothstep(0.62, 1.0, abs(p.x)));\n        float directionalRidge = exp(-abs(warpedY) * 10.0) * (1.0 - smoothstep(0.30, 0.90, abs(p.x)));\n        alpha = max(compactMass * 0.78, directionalBand * 0.46) + directionalRidge * 0.16;\n        core = compactMass * 0.78 + directionalRidge * 0.28;\n        body = max(compactMass * 0.84, directionalBand * 0.42);\n        edge = compactMass * (1.0 - clamp(core * 0.8, 0.0, 1.0)) + directionalBand * 0.16;\n      }`)
    .replace(COMPRESSION_SHEAR_COMPACT_MARKER, `${COMPRESSION_SHEAR_COMPACT_MARKER}\n\n      if (uTail < -0.5) {\n        float compactShearRadius = length(vec2(p.x * 0.94, (p.y - wave) * 1.04));\n        float compactShearMass = 1.0 - smoothstep(0.32, 0.94, compactShearRadius);\n        float broadBand = exp(-distanceToBand * 5.2) * envelope;\n        float broadFilament = exp(-distanceToBand * 11.0) * envelope;\n        alpha = max(compactShearMass * 0.66, broadBand * 0.44) + broadFilament * 0.12;\n        core = compactShearMass * 0.58 + broadFilament * 0.24;\n        body = max(compactShearMass * 0.78, broadBand * 0.48);\n        edge = compactShearMass * 0.24 + broadBand * 0.18;\n      }`)
  material.userData.collisionContinuityEffectPatched = true
  material.needsUpdate = true

  const previousOnBeforeRender = (material as any).onBeforeRender as ((...args: any[]) => void) | undefined
  ;(material as any).onBeforeRender = function collisionEffectContinuityBeforeRender(this: THREE.ShaderMaterial, ...args: any[]) {
    previousOnBeforeRender?.apply(this, args)
    const kind = Number(material.uniforms.uKind?.value)
    const tail = Number(material.uniforms.uTail?.value)
    if (!(tail < -0.5) || !(kind < 1.5)) return
    const object = args[4] as THREE.Object3D | undefined
    if (!object) return
    const scaleX = Math.abs(object.scale.x)
    const scaleY = Math.abs(object.scale.y)
    const transformAspectRatio = Math.max(scaleX, scaleY) / Math.max(Math.min(scaleX, scaleY), 1e-9)
    const footprintAspect = kind < 0.5
      ? tail < -1.5
        ? (1 / 0.98) / (1 / 1.02)
        : (1 / 0.92) / (1 / 1.02)
      : (1 / 0.94) / (1 / 1.04)
    if (typeof window !== 'undefined') {
      window.__collisionEffectContinuityMetrics ??= {}
      window.__collisionEffectContinuityMetrics[object.uuid] = {
        kind,
        opacity: Number(material.uniforms.uOpacity?.value ?? 0),
        transformAspectRatio,
        finalSilhouetteAspectRatio: transformAspectRatio * footprintAspect,
        scaleX,
        scaleY,
      }
    }
  }
}

function publishRemnantTelemetry(bodyId: string, elapsedMs: number, sourceRadius: number, state: CollisionRemnantContinuityState, resultRadius: number) {
  if (typeof window === 'undefined') return
  const metrics = getCollisionRemnantSilhouetteMetrics(state, resultRadius)
  window.__collisionContinuityMetrics ??= {}
  window.__collisionContinuityMetrics[bodyId] = {
    elapsedMs,
    sourceLastVisibleBoundingRadius: Math.abs(sourceRadius),
    opacity: state.opacity,
    deformation: state.deformation,
    compression: state.compression,
    heat: state.heat,
    ...metrics,
  }
}

function applyRemnantContinuity(material: THREE.ShaderMaterial) {
  const bodyId = material.userData.simulationBodyId
  if (typeof bodyId !== 'string') return
  const continuity = activeRemnants.get(bodyId)
  if (!continuity) return
  const elapsedMs = Math.max(0, performance.now() - continuity.startedAt)
  const seed01 = getBodySeed01(bodyId)
  const state = getCollisionRemnantContinuityState(elapsedMs, continuity.sourceRadius, continuity.resultRadius, seed01)

  if (elapsedMs >= COLLISION_REMNANT_SETTLE_END_MS) {
    publishRemnantTelemetry(bodyId, COLLISION_REMNANT_SETTLE_END_MS, continuity.sourceRadius, getCollisionRemnantContinuityState(COLLISION_REMNANT_SETTLE_END_MS, continuity.sourceRadius, continuity.resultRadius, seed01), continuity.resultRadius)
    activeRemnants.delete(bodyId)
    return
  }

  if (material.uniforms.uCollisionRevealScale) material.uniforms.uCollisionRevealScale.value = state.scale
  if (material.uniforms.uCollisionFormationActive) material.uniforms.uCollisionFormationActive.value = 1
  if (material.uniforms.uCollisionFormationDeformation) material.uniforms.uCollisionFormationDeformation.value = state.deformation
  if (material.uniforms.uCollisionFormationCompression) material.uniforms.uCollisionFormationCompression.value = state.compression
  if (material.uniforms.uCollisionFormationHeat) material.uniforms.uCollisionFormationHeat.value = state.heat
  const baseOpacity = Number(material.userData.collisionVisualBaseOpacity)
  if (material.uniforms.uOpacity && Number.isFinite(baseOpacity)) material.uniforms.uOpacity.value = baseOpacity * state.opacity
  material.userData.collisionRemnantPresentation = { ...state }
  publishRemnantTelemetry(bodyId, elapsedMs, continuity.sourceRadius, state, continuity.resultRadius)
}

function patchCollisionBodyMaterial(material: THREE.ShaderMaterial) {
  if (material.userData.collisionContinuityBodyPatched) return
  if (!material.uniforms.uCollisionRevealScale || !material.uniforms.uCollisionFormationCompression || !material.vertexShader.includes(BODY_TANGENT_SCALE_MARKER)) return
  material.vertexShader = material.vertexShader.replace(BODY_TANGENT_SCALE_MARKER, BODY_TANGENT_SCALE_REPLACEMENT)
  material.userData.collisionContinuityBodyPatched = true
  material.needsUpdate = true
  const previousOnBeforeRender = (material as any).onBeforeRender as ((...args: any[]) => void) | undefined
  ;(material as any).onBeforeRender = function collisionBodyContinuityBeforeRender(this: THREE.ShaderMaterial, ...args: any[]) {
    previousOnBeforeRender?.apply(this, args)
    applyRemnantContinuity(material)
  }
}

export function syncCollisionVisualContinuityState(bodies: BodyState[]) {
  const now = performance.now()
  const currentIds = new Set(bodies.map((body) => body.id))
  if (previousBodies) {
    const transitions = findCollisionVisualTransitions(previousBodies, bodies)
    const resultIds = Array.from(new Set(transitions.filter((transition) => transition.outcome === 'disrupted' && transition.resultId).map((transition) => transition.resultId as string)))
    resultIds.forEach((resultId) => {
      if (activeRemnants.has(resultId)) return
      const result = bodies.find((body) => body.id === resultId)
      if (!result) return
      const source = transitions
        .filter((transition) => transition.outcome === 'disrupted' && transition.resultId === resultId)
        .map((transition) => transition.source)
        .sort((a, b) => b.mass - a.mass || b.radius - a.radius || a.id.localeCompare(b.id))[0]
      if (!source) return
      activeRemnants.set(resultId, { sourceRadius: Math.abs(source.radius), resultRadius: Math.abs(result.radius), startedAt: now })
    })
  }
  activeRemnants.forEach((_value, bodyId) => { if (!currentIds.has(bodyId)) activeRemnants.delete(bodyId) })
  if (typeof window !== 'undefined' && window.__collisionContinuityMetrics) {
    Object.keys(window.__collisionContinuityMetrics).forEach((bodyId) => {
      if (!currentIds.has(bodyId)) delete window.__collisionContinuityMetrics?.[bodyId]
    })
  }
  previousBodies = bodies.map(cloneBody)
}

export function installCollisionVisualContinuity() {
  if (installed) return
  installed = true
  const prototype = THREE.ShaderMaterial.prototype as any
  const previousSetValues = prototype.setValues
  prototype.setValues = function setValuesWithCollisionContinuity(values: Record<string, any>) {
    const result = previousSetValues.call(this, values)
    const material = this as THREE.ShaderMaterial
    patchCollisionEffectShader(material)
    patchCollisionBodyMaterial(material)
    return result
  }
}

declare global {
  interface Window {
    __collisionContinuityMetrics?: Record<string, CollisionContinuityTelemetry>
    __collisionEffectContinuityMetrics?: Record<string, CollisionEffectContinuityTelemetry>
  }
}
