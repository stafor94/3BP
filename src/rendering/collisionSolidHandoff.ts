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
  }>
}

export type CollisionSolidHandoffPresentationOverride = {
  resultId: string
  role: 'survivor' | 'absorbed'
  position: Vec3
  radius: number
  color: string | null
  opacity: number
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
    distanceToResult: number
  }>
}

export type CollisionSolidHandoffRenderFrame = {
  overrides: Map<string, CollisionSolidHandoffPresentationOverride>
  telemetry: Record<string, CollisionSolidHandoffTelemetry>
}

const activeHandoffs = new Map<string, ActiveSolidHandoff>()
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

function blendColor(source: string, target: string, progress: number) {
  return `#${new THREE.Color(source).lerp(new THREE.Color(target), progress).getHexString()}`
}

function getAbsorbedOpacity(progress: number) {
  const fadeProgress = smooth01((progress - 0.45) / 0.55)
  return 1 - fadeProgress
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

function sampleHandoff(handoff: ActiveSolidHandoff, now: number): HandoffSample {
  const elapsedMs = Math.max(0, now - handoff.startedAt)
  const progress = smooth01(elapsedMs / Math.max(1, COLLISION_SOLID_HANDOFF_DURATION_MS))
  const resultPosition = handoff.result.position
  const resultDrift = subtract(resultPosition, handoff.initialResultPosition)
  const survivorStart = add(handoff.survivor.position, resultDrift)
  const survivorPosition = lerpVec3(survivorStart, resultPosition, progress)
  const survivorStartRadius = getBodyPresentationRadius(handoff.survivor.radius)
  const resultRadius = getBodyPresentationRadius(handoff.result.radius)
  const absorbedOpacity = getAbsorbedOpacity(progress)

  return {
    elapsedMs,
    progress,
    resultPosition,
    survivorPosition,
    survivorRadius: THREE.MathUtils.lerp(survivorStartRadius, resultRadius, progress),
    resultRadius,
    survivorColor: blendColor(handoff.survivor.color, handoff.result.color, progress),
    absorbed: handoff.absorbed.map((source) => {
      const sourceStart = add(source.position, resultDrift)
      const startRadius = getBodyPresentationRadius(source.radius)
      return {
        source,
        position: lerpVec3(sourceStart, resultPosition, progress),
        radius: startRadius * (1 - progress),
        startRadius,
        opacity: absorbedOpacity,
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
    if (now - handoff.startedAt >= COLLISION_SOLID_HANDOFF_DURATION_MS) {
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

    sample.absorbed.forEach(({ source, position, radius, opacity }) => {
      overrides.set(source.id, {
        resultId: handoff.resultId,
        role: 'absorbed',
        position,
        radius,
        color: null,
        opacity,
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
      absorbed: sample.absorbed.map(({ source, position, radius, startRadius, opacity }) => ({
        sourceId: source.id,
        position,
        radius,
        startRadius,
        opacity,
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

export function getCollisionSolidHandoffRenderBodies(bodies: BodyState[]) {
  const now = performance.now()
  syncHandoffs(bodies, now)

  const rendered = bodies.map((body) => {
    const handoff = activeHandoffs.get(body.id)
    if (!handoff || now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS) return body
    const sample = sampleHandoff(handoff, now)
    return {
      ...body,
      position: { ...sample.survivorPosition },
      color: sample.survivorColor,
    }
  })
  const renderedIds = new Set(rendered.map((body) => body.id))

  activeHandoffs.forEach((handoff) => {
    if (now - handoff.startedAt > COLLISION_SOLID_HANDOFF_DURATION_MS) return
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
  previousBodies = null
  if (typeof window !== 'undefined') window.__collisionSolidHandoffMetrics = {}
}

declare global {
  interface Window {
    __collisionSolidHandoffMetrics?: Record<string, CollisionSolidHandoffTelemetry>
  }
}
