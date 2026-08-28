import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import { getBodyPresentationRadius } from './bodyPresentationRadius'
import {
  COLLISION_REMNANT_FORMATION_START_MS,
  findCollisionVisualTransitions,
  getCollisionVisualLifecycle,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'

export const COLLISION_SOLID_HANDOFF_DURATION_MS = COLLISION_REMNANT_FORMATION_START_MS

type ActiveSolidHandoff = {
  resultId: string
  survivor: BodyState
  absorbed: BodyState[]
  initialResultPosition: Vec3
  result: BodyState
  startedAt: number
}

type SolidPresentationOverride = {
  bodyId: string
  position: Vec3
  radius: number
  color: string | null
}

export type CollisionSolidHandoffTelemetry = {
  resultId: string
  survivorSourceId: string
  elapsedMs: number
  phase: ReturnType<typeof getCollisionVisualLifecycle>['phase']
  progress: number
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
    distanceToResult: number
  }>
}

const activeHandoffs = new Map<string, ActiveSolidHandoff>()
let previousBodies: BodyState[] | null = null
let rendererHookInstalled = false

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

function groupMergeTransitions(transitions: CollisionVisualTransition[]) {
  const grouped = new Map<string, CollisionVisualTransition[]>()
  transitions.forEach((transition) => {
    if (!transition.resultId) return
    if (transition.outcome !== 'merged-survivor' && transition.outcome !== 'absorbed') return
    const entries = grouped.get(transition.resultId) ?? []
    entries.push(transition)
    grouped.set(transition.resultId, entries)
  })
  return grouped
}

function beginHandoffs(previous: BodyState[], current: BodyState[], now: number) {
  const currentById = new Map(current.map((body) => [body.id, body]))
  const grouped = groupMergeTransitions(findCollisionVisualTransitions(previous, current))

  grouped.forEach((transitions, resultId) => {
    if (activeHandoffs.has(resultId)) return
    const survivorTransition = transitions.find((transition) => transition.outcome === 'merged-survivor')
    const absorbedTransitions = transitions.filter((transition) => transition.outcome === 'absorbed')
    const result = currentById.get(resultId)
    if (!survivorTransition || absorbedTransitions.length === 0 || !result) return
    if (result.bodyType === 'star') return

    activeHandoffs.set(resultId, {
      resultId,
      survivor: cloneBody(survivorTransition.source),
      absorbed: absorbedTransitions.map((transition) => cloneBody(transition.source)),
      initialResultPosition: { ...result.position },
      result: cloneBody(result),
      startedAt: now,
    })
  })
}

function syncHandoffs(bodies: BodyState[], now: number) {
  if (previousBodies) beginHandoffs(previousBodies, bodies, now)

  const currentById = new Map(bodies.map((body) => [body.id, body]))
  activeHandoffs.forEach((handoff, resultId) => {
    const result = currentById.get(resultId)
    if (!result) {
      activeHandoffs.delete(resultId)
      return
    }
    handoff.result = cloneBody(result)
    if (now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS + 100) {
      activeHandoffs.delete(resultId)
    }
  })
  previousBodies = bodies.map(cloneBody)
}

function getHandoffProgress(handoff: ActiveSolidHandoff, now: number) {
  const elapsedMs = Math.max(0, now - handoff.startedAt)
  return {
    elapsedMs,
    progress: smooth01(elapsedMs / Math.max(1, COLLISION_SOLID_HANDOFF_DURATION_MS)),
  }
}

function makeOverrides(now: number) {
  const overrides = new Map<string, SolidPresentationOverride>()
  const telemetry: Record<string, CollisionSolidHandoffTelemetry> = {}

  activeHandoffs.forEach((handoff) => {
    const { elapsedMs, progress } = getHandoffProgress(handoff, now)
    const resultPosition = handoff.result.position
    const resultDrift = subtract(resultPosition, handoff.initialResultPosition)
    const survivorStart = add(handoff.survivor.position, resultDrift)
    const survivorPosition = lerpVec3(survivorStart, resultPosition, progress)
    const survivorStartRadius = getBodyPresentationRadius(handoff.survivor.radius)
    const resultRadius = getBodyPresentationRadius(handoff.result.radius)
    const survivorRadius = THREE.MathUtils.lerp(survivorStartRadius, resultRadius, progress)

    overrides.set(seedKey(bodySeed(handoff.resultId)), {
      bodyId: handoff.resultId,
      position: survivorPosition,
      radius: survivorRadius,
      color: blendColor(handoff.survivor.color, handoff.result.color, progress),
    })

    const absorbedTelemetry = handoff.absorbed.map((source) => {
      const sourceStart = add(source.position, resultDrift)
      const position = lerpVec3(sourceStart, resultPosition, progress)
      const startRadius = getBodyPresentationRadius(source.radius)
      const radius = startRadius * (1 - progress)
      overrides.set(seedKey(bodySeed(source.id)), {
        bodyId: source.id,
        position,
        radius,
        color: null,
      })
      return {
        sourceId: source.id,
        position,
        radius,
        startRadius,
        opacity: progress >= 1 ? 0 : 1,
        distanceToResult: distance(position, resultPosition),
      }
    })

    telemetry[handoff.resultId] = {
      resultId: handoff.resultId,
      survivorSourceId: handoff.survivor.id,
      elapsedMs,
      phase: getCollisionVisualLifecycle(elapsedMs).phase,
      progress,
      resultActualPosition: { ...resultPosition },
      survivor: {
        position: survivorPosition,
        radius: survivorRadius,
        targetRadius: resultRadius,
        distanceToResult: distance(survivorPosition, resultPosition),
      },
      absorbed: absorbedTelemetry,
    }
  })

  if (typeof window !== 'undefined') window.__collisionSolidHandoffMetrics = telemetry
  return overrides
}

function applyOverrideToScene(scene: THREE.Scene, override: SolidPresentationOverride, mesh: THREE.Mesh) {
  const baseRadius = Math.max(Math.abs(mesh.scale.x), 1e-9)
  const scaleRatio = override.radius / baseRadius
  mesh.position.set(override.position.x, override.position.y, override.position.z)
  mesh.scale.setScalar(override.radius)

  const material = mesh.material instanceof THREE.ShaderMaterial ? mesh.material : null
  if (material && override.color && material.uniforms.uIdentityColor?.value instanceof THREE.Color) {
    material.uniforms.uIdentityColor.value.set(override.color)
  }

  const objectIndex = scene.children.indexOf(mesh)
  const inner = objectIndex >= 1 ? scene.children[objectIndex - 1] : undefined
  const outer = objectIndex >= 2 ? scene.children[objectIndex - 2] : undefined
  ;[inner, outer].forEach((candidate) => {
    if (!(candidate instanceof THREE.Sprite)) return
    candidate.position.copy(mesh.position)
    candidate.scale.multiplyScalar(scaleRatio)
    if (override.color && candidate.material instanceof THREE.SpriteMaterial) {
      candidate.material.color.set(override.color)
    }
  })
}

function installRendererHook() {
  if (rendererHookInstalled) return
  rendererHookInstalled = true
  const prototype = THREE.WebGLRenderer.prototype as any
  const previousRender = prototype.render
  prototype.render = function renderWithCollisionSolidHandoff(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ) {
    if (scene instanceof THREE.Scene && activeHandoffs.size > 0) {
      const overrides = makeOverrides(performance.now())
      scene.children.forEach((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const material = object.material
        if (!(material instanceof THREE.ShaderMaterial)) return
        const seed = Number(material.uniforms.uSeed?.value)
        if (!Number.isFinite(seed)) return
        const override = overrides.get(seedKey(seed))
        if (override) applyOverrideToScene(scene, override, object)
      })
    } else if (typeof window !== 'undefined') {
      window.__collisionSolidHandoffMetrics = {}
    }
    return previousRender.call(this, scene, camera)
  }
}

export function getCollisionSolidHandoffRenderBodies(bodies: BodyState[]) {
  installRendererHook()
  const now = performance.now()
  syncHandoffs(bodies, now)

  const rendered = [...bodies]
  const renderedIds = new Set(rendered.map((body) => body.id))
  activeHandoffs.forEach((handoff) => {
    if (now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS) return
    handoff.absorbed.forEach((source) => {
      if (renderedIds.has(source.id)) return
      rendered.push(cloneBody(source))
      renderedIds.add(source.id)
    })
  })
  return rendered
}

export function resetCollisionSolidHandoffState() {
  activeHandoffs.clear()
  previousBodies = null
  if (typeof window !== 'undefined') window.__collisionSolidHandoffMetrics = {}
}

declare global {
  interface Window {
    __collisionSolidHandoffMetrics?: Record<string, CollisionSolidHandoffTelemetry>
  }
}
