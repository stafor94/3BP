import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import { getBodyPresentationRadius } from './bodyPresentationRadius'
import {
  getCollisionPreTransitionAbsorptionPresentation,
  resetCollisionPresentationContactState,
} from './collisionPresentationContact'
import {
  COLLISION_REMNANT_FORMATION_START_MS,
  findCollisionVisualTransitions,
  getCollisionVisualLifecycle,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'

export const COLLISION_SOLID_HANDOFF_DURATION_MS = COLLISION_REMNANT_FORMATION_START_MS
const ABSORBED_HANDOFF_MAX_INWARD_TRAVEL_RATIO = 0.28

type AbsorbedSolidHandoff = {
  source: BodyState
  contactNormal: Vec3
  initialErosionProgress: number
}

type ActiveSolidHandoff = {
  resultId: string
  survivor: BodyState
  absorbed: AbsorbedSolidHandoff[]
  initialResultPosition: Vec3
  result: BodyState
  startedAt: number | null
}

type HandoffSample = {
  elapsedMs: number
  progress: number
  resultPosition: Vec3
  survivorPosition: Vec3
  survivorRadius: number
  resultRadius: number
  survivorColor: string
  absorbed: Array<{
    source: BodyState
    position: Vec3
    radius: number
    startRadius: number
    opacity: number
    erosionProgress: number
    collapseProgress: number
    contactNormal: Vec3
    contactAxisScale: number
    lateralScaleA: number
    lateralScaleB: number
  }>
}

export type CollisionAbsorbedShapeProgress = {
  erosionProgress: number
  contactAxisScale: number
  lateralScaleA: number
  lateralScaleB: number
}

export type CollisionAbsorbedSolidProgress = CollisionAbsorbedShapeProgress & {
  collapseProgress: number
  radiusScale: number
  opacity: number
}

export type CollisionSolidHandoffPresentationOverride = {
  resultId: string
  role: 'survivor' | 'absorbed'
  position: Vec3
  radius: number
  color: string | null
  opacity: number
  contactNormal?: Vec3
  contactAxisScale?: number
  lateralScaleA?: number
  lateralScaleB?: number
}

type CollisionPreTransitionAbsorptionOverride = CollisionAbsorbedShapeProgress & {
  sourceId: string
  contactNormal: Vec3
}

export type CollisionSolidHandoffTelemetry = {
  resultId: string
  survivorSourceId: string
  elapsedMs: number
  phase: ReturnType<typeof getCollisionVisualLifecycle>['phase']
  progress: number
  overrideSampled: boolean
  overrideApplied: boolean
  renderFrameSequence: number
  appliedBodyIds: string[]
  resultActualPosition: Vec3
  survivor: {
    position: Vec3
    radius: number
    targetRadius: number
    distanceToResult: number
  }
  absorbed: Array<{
    sourceId: string
    position: Vec3
    radius: number
    startRadius: number
    opacity: number
    erosionProgress: number
    collapseProgress: number
    contactNormal: Vec3
    contactAxisScale: number
    lateralScaleA: number
    lateralScaleB: number
    distanceToResult: number
  }>
}

export type CollisionSolidHandoffRenderFrame = {
  overrides: Map<string, CollisionSolidHandoffPresentationOverride>
  telemetry: Record<string, CollisionSolidHandoffTelemetry>
}

const activeHandoffs = new Map<string, ActiveSolidHandoff>()
const activePreTransitionAbsorptions = new Map<string, CollisionPreTransitionAbsorptionOverride>()
const retiredPresentationSeeds = new Set<string>()
const deformedPresentationSeeds = new Set<string>()
let previousBodies: BodyState[] | null = null

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
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
  }
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    z: THREE.MathUtils.lerp(a.z, b.z, t),
  }
}

function getAbsorbedHandoffPosition(
  sourceStart: Vec3,
  resultPosition: Vec3,
  sourceRadius: number,
  progress: number,
) {
  const towardResult = subtract(resultPosition, sourceStart)
  const distanceToResult = Math.hypot(towardResult.x, towardResult.y, towardResult.z)
  if (distanceToResult <= 1e-12) return { ...sourceStart }

  // Phase-1 continuity keeps the absorbed source visible while the remnant takes
  // ownership. Do not use that continuity window to drag an intact-looking solid
  // all the way to the remnant center. Its inward travel is normalized to its own
  // physical radius and advances smoothly with the same handoff progress.
  const maximumTravel = Math.min(
    distanceToResult,
    Math.max(sourceRadius, 0) * ABSORBED_HANDOFF_MAX_INWARD_TRAVEL_RATIO,
  )
  const travel = maximumTravel * progress
  const scale = travel / distanceToResult
  return {
    x: sourceStart.x + towardResult.x * scale,
    y: sourceStart.y + towardResult.y * scale,
    z: sourceStart.z + towardResult.z * scale,
  }
}

function bodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 1000
}

function seedKey(seed: number) {
  return seed.toFixed(8)
}

function blendColor(source: string, target: string, progress: number) {
  return `#${new THREE.Color(source).lerp(new THREE.Color(target), progress).getHexString()}`
}

function getCollisionAbsorbedShape(erosionProgress: number): CollisionAbsorbedShapeProgress {
  const erosion = clamp01(erosionProgress)
  return {
    erosionProgress: erosion,
    contactAxisScale: 1 - erosion * 0.58,
    lateralScaleA: 1 - erosion * 0.18,
    lateralScaleB: 1 - erosion * 0.30,
  }
}

export function getCollisionPreTransitionAbsorbedSolidProgress(
  absorptionProgress: number,
): CollisionAbsorbedShapeProgress {
  // The physical absorption stage already provides a monotonic radius-loss
  // signal before topology collapse. Bias it toward the start so the contact
  // face visibly gives way while most of the source silhouette still remains.
  return getCollisionAbsorbedShape(Math.pow(clamp01(absorptionProgress), 0.55))
}

export function getCollisionAbsorbedSolidProgress(progress: number): CollisionAbsorbedSolidProgress {
  const normalized = clamp01(progress)
  // Contact-facing deformation starts first. Whole-body collapse is delayed
  // until the contact side is already visibly compromised, and global alpha is
  // reserved for the final irregular remainder. The existing 520 ms handoff
  // lifetime and motion path are intentionally unchanged.
  const erosionProgress = smooth01((normalized - 0.02) / 0.94)
  const collapseProgress = smooth01((normalized - 0.38) / 0.62)
  const fadeProgress = smooth01((normalized - 0.78) / 0.20)
  return {
    ...getCollisionAbsorbedShape(erosionProgress),
    collapseProgress,
    radiusScale: 1 - collapseProgress,
    opacity: 1 - fadeProgress,
  }
}

function groupTopologyTransitions(transitions: CollisionVisualTransition[]) {
  const grouped = new Map<string, CollisionVisualTransition[]>()
  transitions.forEach((transition) => {
    if (!transition.resultId) return
    const entries = grouped.get(transition.resultId) ?? []
    entries.push(transition)
    grouped.set(transition.resultId, entries)
  })
  return grouped
}

function beginHandoffs(previous: BodyState[], current: BodyState[]) {
  const currentById = new Map(current.map((body) => [body.id, body]))
  const grouped = groupTopologyTransitions(findCollisionVisualTransitions(previous, current))

  grouped.forEach((transitions, resultId) => {
    if (activeHandoffs.has(resultId)) return
    const result = currentById.get(resultId)
    const uniqueTransitions = [...new Map(
      transitions.map((transition) => [transition.source.id, transition]),
    ).values()]
    if (uniqueTransitions.length < 2 || !result) return
    if (result.bodyType === 'star' || result.bodyType === 'fragment' || result.bodyType === 'effect') return
    const survivorTransition = uniqueTransitions.slice().sort((a, b) =>
      b.source.mass - a.source.mass || b.source.radius - a.source.radius ||
      a.source.id.localeCompare(b.source.id)
    )[0]
    const absorbedTransitions = uniqueTransitions.filter((transition) => transition !== survivorTransition)

    absorbedTransitions.forEach((transition) => {
      retiredPresentationSeeds.delete(seedKey(bodySeed(transition.source.id)))
    })
    activeHandoffs.set(resultId, {
      resultId,
      survivor: cloneBody(survivorTransition.source),
      absorbed: absorbedTransitions.map((transition) => {
        const preTransition = getCollisionPreTransitionAbsorptionPresentation(transition.source)
        return {
          source: cloneBody(transition.source),
          contactNormal: { ...transition.contactNormal },
          initialErosionProgress: preTransition
            ? getCollisionPreTransitionAbsorbedSolidProgress(
              preTransition.absorptionProgress,
            ).erosionProgress
            : 0,
        }
      }),
      initialResultPosition: { ...result.position },
      result: cloneBody(result),
      // Do not start the visible handoff clock while React is only routing body
      // data. A delayed WebGL frame must still render the source-continuous first
      // frame instead of skipping ahead before anything was presented onscreen.
      startedAt: null,
    })
  })
}

function retireAbsorbedPresentation(handoff: ActiveSolidHandoff) {
  handoff.absorbed.forEach(({ source }) => {
    retiredPresentationSeeds.add(seedKey(bodySeed(source.id)))
  })
}

function syncHandoffs(bodies: BodyState[], now: number) {
  if (previousBodies) beginHandoffs(previousBodies, bodies)

  const currentById = new Map(bodies.map((body) => [body.id, body]))
  activeHandoffs.forEach((handoff, resultId) => {
    const result = currentById.get(resultId)
    if (!result) {
      retireAbsorbedPresentation(handoff)
      activeHandoffs.delete(resultId)
      return
    }
    handoff.result = cloneBody(result)
    if (
      handoff.startedAt !== null &&
      now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS + 100
    ) {
      retireAbsorbedPresentation(handoff)
      activeHandoffs.delete(resultId)
    }
  })
  previousBodies = bodies.map(cloneBody)
}

function syncPreTransitionAbsorptions(bodies: BodyState[]) {
  activePreTransitionAbsorptions.clear()
  bodies.forEach((body) => {
    const presentation = getCollisionPreTransitionAbsorptionPresentation(body)
    if (!presentation || presentation.absorptionProgress <= 0) return
    const shape = getCollisionPreTransitionAbsorbedSolidProgress(presentation.absorptionProgress)
    activePreTransitionAbsorptions.set(body.id, {
      sourceId: body.id,
      contactNormal: { ...presentation.contactNormal },
      ...shape,
    })
  })
}

function sampleHandoff(handoff: ActiveSolidHandoff, now: number): HandoffSample {
  const elapsedMs = handoff.startedAt === null
    ? 0
    : Math.max(0, now - handoff.startedAt)
  const progress = smooth01(elapsedMs / Math.max(1, COLLISION_SOLID_HANDOFF_DURATION_MS))
  const resultPosition = handoff.result.position
  const resultDrift = subtract(resultPosition, handoff.initialResultPosition)
  const survivorStart = add(handoff.survivor.position, resultDrift)
  const survivorPosition = lerpVec3(survivorStart, resultPosition, progress)
  const survivorStartRadius = getBodyPresentationRadius(handoff.survivor.radius)
  const resultRadius = getBodyPresentationRadius(handoff.result.radius)
  const absorbedProgress = getCollisionAbsorbedSolidProgress(progress)

  return {
    elapsedMs,
    progress,
    resultPosition,
    survivorPosition,
    survivorRadius: THREE.MathUtils.lerp(survivorStartRadius, resultRadius, progress),
    resultRadius,
    survivorColor: blendColor(handoff.survivor.color, handoff.result.color, progress),
    absorbed: handoff.absorbed.map(({ source, contactNormal, initialErosionProgress }) => {
      const sourceStart = add(source.position, resultDrift)
      const startRadius = getBodyPresentationRadius(source.radius)
      const inwardPosition = getAbsorbedHandoffPosition(
        sourceStart,
        resultPosition,
        source.radius,
        progress,
      )
      const erosionProgress = THREE.MathUtils.lerp(
        initialErosionProgress,
        1,
        absorbedProgress.erosionProgress,
      )
      const absorbedShape = getCollisionAbsorbedShape(erosionProgress)
      return {
        source,
        position: inwardPosition,
        radius: startRadius * absorbedProgress.radiusScale,
        startRadius,
        opacity: absorbedProgress.opacity,
        erosionProgress,
        collapseProgress: absorbedProgress.collapseProgress,
        contactNormal,
        contactAxisScale: absorbedShape.contactAxisScale,
        lateralScaleA: absorbedShape.lateralScaleA,
        lateralScaleB: absorbedShape.lateralScaleB,
      }
    }),
  }
}

export function sampleCollisionSolidHandoffRenderFrame(
  now = performance.now(),
): CollisionSolidHandoffRenderFrame {
  const overrides = new Map<string, CollisionSolidHandoffPresentationOverride>()
  const telemetry: Record<string, CollisionSolidHandoffTelemetry> = {}

  activeHandoffs.forEach((handoff, resultId) => {
    if (
      handoff.startedAt !== null &&
      now - handoff.startedAt >= COLLISION_SOLID_HANDOFF_DURATION_MS
    ) {
      retireAbsorbedPresentation(handoff)
      activeHandoffs.delete(resultId)
      return
    }

    const sample = sampleHandoff(handoff, now)
    overrides.set(handoff.resultId, {
      resultId: handoff.resultId,
      role: 'survivor',
      position: sample.survivorPosition,
      radius: sample.survivorRadius,
      color: sample.survivorColor,
      opacity: 1,
    })

    sample.absorbed.forEach(({
      source,
      position,
      radius,
      opacity,
      contactNormal,
      contactAxisScale,
      lateralScaleA,
      lateralScaleB,
    }) => {
      overrides.set(source.id, {
        resultId: handoff.resultId,
        role: 'absorbed',
        position,
        radius,
        color: null,
        opacity,
        contactNormal,
        contactAxisScale,
        lateralScaleA,
        lateralScaleB,
      })
    })

    telemetry[handoff.resultId] = {
      resultId: handoff.resultId,
      survivorSourceId: handoff.survivor.id,
      elapsedMs: sample.elapsedMs,
      phase: getCollisionVisualLifecycle(sample.elapsedMs).phase,
      progress: sample.progress,
      overrideSampled: true,
      overrideApplied: false,
      renderFrameSequence: 0,
      appliedBodyIds: [],
      resultActualPosition: { ...sample.resultPosition },
      survivor: {
        position: sample.survivorPosition,
        radius: sample.survivorRadius,
        targetRadius: sample.resultRadius,
        distanceToResult: distance(sample.survivorPosition, sample.resultPosition),
      },
      absorbed: sample.absorbed.map(({
        source,
        position,
        radius,
        startRadius,
        opacity,
        erosionProgress,
        collapseProgress,
        contactNormal,
        contactAxisScale,
        lateralScaleA,
        lateralScaleB,
      }) => ({
        sourceId: source.id,
        position,
        radius,
        startRadius,
        opacity,
        erosionProgress,
        collapseProgress,
        contactNormal: { ...contactNormal },
        contactAxisScale,
        lateralScaleA,
        lateralScaleB,
        distanceToResult: distance(position, sample.resultPosition),
      })),
    }
  })

  return { overrides, telemetry }
}

export function publishCollisionSolidHandoffRenderTelemetry(
  frame: CollisionSolidHandoffRenderFrame,
  appliedBodyIds: ReadonlySet<string>,
  renderFrameSequence: number,
) {
  if (typeof window === 'undefined') return

  const published: Record<string, CollisionSolidHandoffTelemetry> = {}
  Object.values(frame.telemetry).forEach((entry) => {
    const expectedBodyIds = [entry.resultId, ...entry.absorbed.map((absorbed) => absorbed.sourceId)]
    const appliedIds = expectedBodyIds.filter((id) => appliedBodyIds.has(id))
    published[entry.resultId] = {
      ...entry,
      overrideApplied: appliedIds.length === expectedBodyIds.length,
      renderFrameSequence,
      appliedBodyIds: appliedIds,
    }
  })
  window.__collisionSolidHandoffMetrics = published
}

function setPresentationVisibility(scene: THREE.Scene, mesh: THREE.Mesh, visible: boolean) {
  mesh.visible = visible
  const objectIndex = scene.children.indexOf(mesh)
  const inner = objectIndex >= 1 ? scene.children[objectIndex - 1] : undefined
  const outer = objectIndex >= 2 ? scene.children[objectIndex - 2] : undefined
  ;[inner, outer].forEach((candidate) => {
    if (!(candidate instanceof THREE.Sprite)) return
    candidate.visible = false
    if (candidate.material instanceof THREE.SpriteMaterial) candidate.material.opacity = 0
  })
}

function ensureContactDeformationShader(material: THREE.ShaderMaterial) {
  if (!material.uniforms.uCollisionContactAxisScale) {
    material.uniforms.uCollisionContactAxisScale = { value: 1 }
    material.uniforms.uCollisionLateralScaleA = { value: 1 }
    material.uniforms.uCollisionLateralScaleB = { value: 1 }
  }
  if (material.vertexShader.includes('uCollisionContactAxisScale')) return true

  const varyingAnchor = '  varying vec3 vObjectNormal;'
  const worldPositionAnchor = '    vec4 worldPosition = modelMatrix * vec4(position, 1.0);'
  if (!material.vertexShader.includes(varyingAnchor) || !material.vertexShader.includes(worldPositionAnchor)) {
    return false
  }
  material.vertexShader = material.vertexShader
    .replace(
      varyingAnchor,
      `  uniform float uCollisionContactAxisScale;\n  uniform float uCollisionLateralScaleA;\n  uniform float uCollisionLateralScaleB;\n\n${varyingAnchor}`,
    )
    .replace(
      worldPositionAnchor,
      `    float collisionContactWeight = smoothstep(0.0, 0.86, max(position.x, 0.0));\n    vec3 collisionDeformedPosition = position;\n    collisionDeformedPosition.x *= mix(1.0, uCollisionContactAxisScale, collisionContactWeight);\n    collisionDeformedPosition.y *= mix(1.0, uCollisionLateralScaleA, collisionContactWeight);\n    collisionDeformedPosition.z *= mix(1.0, uCollisionLateralScaleB, collisionContactWeight);\n    vec4 worldPosition = modelMatrix * vec4(collisionDeformedPosition, 1.0);`,
    )
  material.needsUpdate = true
  return true
}

function setContactDeformationUniforms(
  material: THREE.ShaderMaterial,
  contactAxisScale: number,
  lateralScaleA: number,
  lateralScaleB: number,
) {
  if (!ensureContactDeformationShader(material)) return false
  material.uniforms.uCollisionContactAxisScale.value = clamp01(contactAxisScale)
  material.uniforms.uCollisionLateralScaleA.value = clamp01(lateralScaleA)
  material.uniforms.uCollisionLateralScaleB.value = clamp01(lateralScaleB)
  return true
}

function resetContactDeformation(mesh: THREE.Mesh) {
  const material = mesh.material instanceof THREE.ShaderMaterial ? mesh.material : null
  if (!material?.uniforms.uCollisionContactAxisScale) return
  material.uniforms.uCollisionContactAxisScale.value = 1
  material.uniforms.uCollisionLateralScaleA.value = 1
  material.uniforms.uCollisionLateralScaleB.value = 1
}

function alignContactNormal(mesh: THREE.Mesh, contactNormalValue: Vec3) {
  const contactNormal = new THREE.Vector3(
    contactNormalValue.x,
    contactNormalValue.y,
    contactNormalValue.z,
  )
  if (contactNormal.lengthSq() <= 1e-12) contactNormal.set(1, 0, 0)
  contactNormal.normalize()
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), contactNormal)
}

function applyPreTransitionAbsorbedShape(
  mesh: THREE.Mesh,
  override: CollisionPreTransitionAbsorptionOverride,
) {
  const material = mesh.material instanceof THREE.ShaderMaterial ? mesh.material : null
  if (!material) return false
  alignContactNormal(mesh, override.contactNormal)
  return setContactDeformationUniforms(
    material,
    override.contactAxisScale,
    override.lateralScaleA,
    override.lateralScaleB,
  )
}

function applyAbsorbedShape(
  mesh: THREE.Mesh,
  radius: number,
  override: CollisionSolidHandoffPresentationOverride,
) {
  mesh.scale.setScalar(radius)
  if (override.role !== 'absorbed' || !override.contactNormal) {
    resetContactDeformation(mesh)
    return false
  }

  const material = mesh.material instanceof THREE.ShaderMaterial ? mesh.material : null
  if (!material) return false
  alignContactNormal(mesh, override.contactNormal)
  return setContactDeformationUniforms(
    material,
    override.contactAxisScale ?? 1,
    override.lateralScaleA ?? 1,
    override.lateralScaleB ?? 1,
  )
}

function applyOverrideToScene(
  scene: THREE.Scene,
  override: CollisionSolidHandoffPresentationOverride,
  mesh: THREE.Mesh,
) {
  const radius = Math.max(0, override.radius)
  const opacity = clamp01(override.opacity)
  mesh.position.set(override.position.x, override.position.y, override.position.z)
  const deformed = applyAbsorbedShape(mesh, radius, override)

  const material = mesh.material instanceof THREE.ShaderMaterial ? mesh.material : null
  if (material) {
    const shouldBlend = opacity < 0.999
    if (material.transparent !== shouldBlend) {
      material.transparent = shouldBlend
      material.needsUpdate = true
    }
    material.depthWrite = !shouldBlend
    if (material.uniforms.uOpacity) material.uniforms.uOpacity.value = opacity
    if (override.color && material.uniforms.uIdentityColor?.value instanceof THREE.Color) {
      material.uniforms.uIdentityColor.value.set(override.color)
    }
  }

  // Non-stellar solids intentionally have their ordinary body glows suppressed
  // by bodyLighting. The absorbed presentation-only source is not in that
  // physical lookup, so suppress its generic glow here as well instead of
  // introducing a new halo during the handoff.
  setPresentationVisibility(scene, mesh, radius > 1e-6 && opacity > 1e-3)
  return deformed
}

export function renderCollisionSolidHandoffFrame(
  scene: THREE.Scene,
  renderFrameSequence: number,
  now = performance.now(),
) {
  if (
    activeHandoffs.size === 0 &&
    activePreTransitionAbsorptions.size === 0 &&
    retiredPresentationSeeds.size === 0 &&
    deformedPresentationSeeds.size === 0
  ) return null

  // The handoff becomes visible only when renderer meshes are actually sampled.
  // Anchor elapsed time here so a delayed first frame cannot turn routing delay
  // into an apparent body->remnant position jump.
  activeHandoffs.forEach((handoff) => {
    if (handoff.startedAt === null) handoff.startedAt = now
  })

  const frame = sampleCollisionSolidHandoffRenderFrame(now)
  const overridesBySeed = new Map<string, {
    bodyId: string
    override: CollisionSolidHandoffPresentationOverride
  }>()
  frame.overrides.forEach((override, bodyId) => {
    overridesBySeed.set(seedKey(bodySeed(bodyId)), { bodyId, override })
  })
  const preTransitionBySeed = new Map<string, CollisionPreTransitionAbsorptionOverride>()
  activePreTransitionAbsorptions.forEach((override, bodyId) => {
    preTransitionBySeed.set(seedKey(bodySeed(bodyId)), override)
  })

  const appliedBodyIds = new Set<string>()
  const deformationSeedsToReset = new Set(deformedPresentationSeeds)
  scene.children.forEach((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material
    if (!(material instanceof THREE.ShaderMaterial)) return
    const seed = Number(material.uniforms.uSeed?.value)
    if (!Number.isFinite(seed)) return
    const key = seedKey(seed)
    const entry = overridesBySeed.get(key)
    if (entry) {
      const deformed = applyOverrideToScene(scene, entry.override, object)
      if (deformed) {
        deformedPresentationSeeds.add(key)
        deformationSeedsToReset.delete(key)
      }
      appliedBodyIds.add(entry.bodyId)
      return
    }
    const preTransition = preTransitionBySeed.get(key)
    if (preTransition) {
      if (applyPreTransitionAbsorbedShape(object, preTransition)) {
        deformedPresentationSeeds.add(key)
        deformationSeedsToReset.delete(key)
      }
      return
    }
    if (retiredPresentationSeeds.has(key)) {
      setPresentationVisibility(scene, object, false)
      return
    }
    if (deformationSeedsToReset.has(key)) resetContactDeformation(object)
  })
  deformationSeedsToReset.forEach((key) => deformedPresentationSeeds.delete(key))

  publishCollisionSolidHandoffRenderTelemetry(frame, appliedBodyIds, renderFrameSequence)
  return frame
}

export function getCollisionSolidHandoffRenderBodies(bodies: BodyState[]) {
  const now = performance.now()
  syncHandoffs(bodies, now)
  syncPreTransitionAbsorptions(bodies)

  const rendered = bodies.map((body) => {
    const handoff = activeHandoffs.get(body.id)
    if (
      !handoff ||
      (handoff.startedAt !== null && now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS)
    ) return body
    const sample = sampleHandoff(handoff, now)
    return {
      ...body,
      position: { ...sample.survivorPosition },
      color: sample.survivorColor,
    }
  })
  const renderedIds = new Set(rendered.map((body) => body.id))

  activeHandoffs.forEach((handoff) => {
    if (
      handoff.startedAt !== null &&
      now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS
    ) return
    const sample = sampleHandoff(handoff, now)
    sample.absorbed.forEach(({ source, position }) => {
      if (renderedIds.has(source.id)) return
      // This clone exists only inside the generic renderer state. Marking it as
      // an effect keeps collision-watch/tracking descendant resolution from
      // treating the temporary silhouette as a surviving physical body.
      rendered.push({
        ...cloneBody(source),
        bodyType: 'effect',
        position: { ...position },
      })
      renderedIds.add(source.id)
    })
  })
  return rendered
}

export function resetCollisionSolidHandoffState() {
  activeHandoffs.clear()
  activePreTransitionAbsorptions.clear()
  retiredPresentationSeeds.clear()
  deformedPresentationSeeds.clear()
  previousBodies = null
  resetCollisionPresentationContactState()
  if (typeof window !== 'undefined') window.__collisionSolidHandoffMetrics = {}
}

declare global {
  interface Window {
    __collisionSolidHandoffMetrics?: Record<string, CollisionSolidHandoffTelemetry>
  }
}
