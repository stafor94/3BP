import * as THREE from 'three'
import type { BodyState, Vec3 } from '../types'
import {
  findCollisionVisualTransitions,
  type CollisionVisualTransition,
} from './collisionVisualOutcome'

export const SURVIVOR_RESPONSE_DURATION_MS = 850
export const SURVIVOR_RESPONSE_MAX_MASS_RATIO = 0.45
export const SURVIVOR_RESPONSE_MIN_SPEED_RATIO = 0.35

const EPSILON = 1e-12
const STABLE_SOURCE_RADIUS_TOLERANCE = 0.995
const BODY_VERTEX_MARKER = `    vObjectNormal = objectNormal;
    vec4 worldPosition = modelMatrix * vec4(revealPosition, 1.0);`

export type CollisionSurvivorResponseProfile = {
  headOn: number
  grazing: number
  massRatio: number
  radiusRatio: number
  relativeSpeed: number
  speedRatio: number
  recoilDelta: Vec3
  recoilSpeed: number
  normalRecoilSpeed: number
  tangentialRecoilSpeed: number
  recoilEvidence: number
  normal: Vec3
  tangent: Vec3
  envelope: number
  baseCompression: number
  baseShear: number
  compression: number
  shear: number
  eligible: boolean
  enabled: boolean
}

type ActiveSurvivorResponse = {
  startedAt: number
  source: BodyState
  partner: BodyState
  contactNormal: Vec3
  presentationHeadOn: number
}

let installed = false
let previousBodies: BodyState[] | null = null
let lastSimulationTime = 0
let currentBodiesById = new Map<string, BodyState>()
let currentBodiesBySeed = new Map<number, BodyState>()
let stableSourcesById = new Map<string, BodyState>()
const activeResponses = new Map<string, ActiveSurvivorResponse>()

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number) {
  return clamp(value, 0, 1)
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function length(value: Vec3) {
  return Math.hypot(value.x, value.y, value.z)
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(value: Vec3, fallback: Vec3 = { x: 1, y: 0, z: 0 }): Vec3 {
  const valueLength = length(value)
  if (valueLength > EPSILON) return scale(value, 1 / valueLength)
  const fallbackLength = length(fallback)
  return fallbackLength > EPSILON
    ? scale(fallback, 1 / fallbackLength)
    : { x: 1, y: 0, z: 0 }
}

function projectToPlane(value: Vec3, normal: Vec3) {
  return subtract(value, scale(normal, dot(value, normal)))
}

function cloneBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    collisionLineageIds: body.collisionLineageIds ? [...body.collisionLineageIds] : undefined,
    trackingContinuationIds: body.trackingContinuationIds
      ? [...body.trackingContinuationIds]
      : undefined,
  }
}

function isStableResponseSource(body: BodyState) {
  return body.bodyType !== 'star' && body.bodyType !== 'effect' && body.bodyType !== 'fragment'
}

function updateStableSourceCache(bodies: BodyState[]) {
  bodies.forEach((body) => {
    if (!isStableResponseSource(body)) return
    const cached = stableSourcesById.get(body.id)
    // Stage 2 intentionally shrinks an absorbed body during penetration staging.
    // Keep the last essentially-full-size contact state instead of allowing that
    // staging radius to masquerade as the physical impactor size for Stage 4.
    if (!cached || body.radius >= cached.radius * STABLE_SOURCE_RADIUS_TOLERANCE) {
      stableSourcesById.set(body.id, cloneBody(body))
    }
  })
}

function getSimulationBodySeed(id: string) {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 1000
}

export function getSurvivorResponseEnvelope(elapsedMs: number) {
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed >= SURVIVOR_RESPONSE_DURATION_MS) return 0
  return 1 - smooth01(elapsed / SURVIVOR_RESPONSE_DURATION_MS)
}

export function getCollisionSurvivorResponseProfile(
  source: BodyState,
  partner: BodyState,
  result: BodyState,
  contactNormal: Vec3,
  presentationHeadOn: number,
  elapsedMs = 0,
  enabled = true,
): CollisionSurvivorResponseProfile {
  const normal = normalize(contactNormal)
  const relativeVelocity = subtract(partner.velocity, source.velocity)
  const relativeSpeed = length(relativeVelocity)
  const tangentialTravel = projectToPlane(relativeVelocity, normal)
  const referenceAxis: Vec3 = Math.abs(normal.z) < 0.85
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 }
  const tangent = normalize(tangentialTravel, cross(referenceAxis, normal))
  const headOn = clamp01(presentationHeadOn)
  const grazing = Math.sqrt(Math.max(0, 1 - headOn * headOn))
  const massRatio = clamp(
    partner.mass / Math.max(source.mass, EPSILON),
    0,
    1,
  )
  const radiusRatio = clamp(
    partner.radius / Math.max(source.radius, EPSILON),
    0,
    1,
  )
  const escapeSpeed = Math.sqrt(
    Math.max(
      0,
      (2 * (source.mass + partner.mass)) /
        Math.max(source.radius + partner.radius, 1e-6),
    ),
  )
  const speedRatio = relativeSpeed / Math.max(escapeSpeed, 1e-6)
  const recoilDelta = subtract(result.velocity, source.velocity)
  const recoilSpeed = length(recoilDelta)
  const normalRecoilSpeed = Math.abs(dot(recoilDelta, normal))
  const tangentialRecoilSpeed = length(projectToPlane(recoilDelta, normal))
  const partnerMassShare = partner.mass / Math.max(source.mass + partner.mass, EPSILON)
  const expectedRecoil = relativeSpeed * partnerMassShare
  const recoilEvidence = relativeSpeed > EPSILON
    ? clamp(recoilSpeed / Math.max(expectedRecoil * 0.2, 1e-7), 0, 1)
    : 0
  const eligible =
    massRatio <= SURVIVOR_RESPONSE_MAX_MASS_RATIO &&
    speedRatio >= SURVIVOR_RESPONSE_MIN_SPEED_RATIO &&
    recoilEvidence > 1e-5

  let baseCompression = 0
  let baseShear = 0
  if (eligible) {
    const sizeScale = clamp(
      Math.sqrt(radiusRatio) * 0.55 + Math.cbrt(partnerMassShare) * 0.45,
      0,
      1,
    )
    const energyScale = clamp((speedRatio - 0.25) / 1.1, 0, 1)
    const severity = clamp(
      sizeScale * (0.55 + energyScale * 0.45) * recoilEvidence,
      0,
      1,
    )
    // A contact-local dent of a few percent of survivor radius remains modest,
    // but is large enough to read beside a ~27% radius impactor. The amplitude
    // still comes entirely from measured size/energy/recoil evidence.
    baseCompression = clamp(
      severity * (0.09 + headOn * 0.045),
      0,
      0.06,
    )
    const tangentialRecoilShare = recoilSpeed > EPSILON
      ? clamp(tangentialRecoilSpeed / recoilSpeed, 0, 1)
      : 0
    baseShear = clamp(
      severity * grazing * (0.055 + tangentialRecoilShare * 0.03),
      0,
      0.04,
    )
  }

  const envelope = getSurvivorResponseEnvelope(elapsedMs)
  return {
    headOn,
    grazing,
    massRatio,
    radiusRatio,
    relativeSpeed,
    speedRatio,
    recoilDelta,
    recoilSpeed,
    normalRecoilSpeed,
    tangentialRecoilSpeed,
    recoilEvidence,
    normal,
    tangent,
    envelope,
    baseCompression,
    baseShear,
    compression: enabled ? baseCompression * envelope : 0,
    shear: enabled ? baseShear * envelope : 0,
    eligible,
    enabled,
  }
}

function selectResponseTransition(transitions: CollisionVisualTransition[]) {
  const explicitSurvivor = transitions.find((transition) =>
    transition.outcome === 'merged-survivor' || transition.outcome === 'survivor',
  )
  if (explicitSurvivor) return explicitSurvivor
  return transitions
    .filter((transition) => transition.outcome === 'disrupted')
    .slice()
    .sort((a, b) =>
      b.source.mass - a.source.mass ||
      b.source.radius - a.source.radius ||
      a.source.id.localeCompare(b.source.id),
    )[0]
}

function selectPartnerTransition(
  transitions: CollisionVisualTransition[],
  sourceTransition: CollisionVisualTransition,
) {
  return transitions
    .filter((transition) => transition.source.id !== sourceTransition.source.id)
    .slice()
    .sort((a, b) =>
      a.source.mass - b.source.mass ||
      a.source.radius - b.source.radius ||
      a.source.id.localeCompare(b.source.id),
    )[0]
}

function isStageFourEnabled() {
  if (typeof window === 'undefined') return true
  const baseline = new URLSearchParams(window.location.search)
    .get('survivor-response-baseline')
  return baseline !== 'stage3'
}

function resetState() {
  activeResponses.clear()
  previousBodies = null
  currentBodiesById = new Map()
  currentBodiesBySeed = new Map()
  stableSourcesById = new Map()
}

export function syncCollisionSurvivorResponseState(
  bodies: BodyState[],
  simulationTime: number,
) {
  if (simulationTime + 1e-9 < lastSimulationTime) resetState()

  const transitions = previousBodies
    ? findCollisionVisualTransitions(previousBodies, bodies)
    : []
  const resultIds = Array.from(new Set(
    transitions
      .map((transition) => transition.resultId)
      .filter((resultId): resultId is string => Boolean(resultId)),
  ))
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()

  resultIds.forEach((resultId) => {
    const result = bodies.find((body) =>
      body.id === resultId &&
      body.bodyType !== 'effect' &&
      body.bodyType !== 'fragment' &&
      body.bodyType !== 'star'
    )
    if (!result) return
    const resultTransitions = transitions.filter((transition) => transition.resultId === resultId)
    const responseTransition = selectResponseTransition(resultTransitions)
    if (!responseTransition) return
    const partnerTransition = selectPartnerTransition(resultTransitions, responseTransition)
    if (!partnerTransition) return

    const source = stableSourcesById.get(responseTransition.source.id) ?? responseTransition.source
    const partner = stableSourcesById.get(partnerTransition.source.id) ?? partnerTransition.source
    const profile = getCollisionSurvivorResponseProfile(
      source,
      partner,
      result,
      responseTransition.contactNormal,
      responseTransition.presentationHeadOn,
      0,
      true,
    )
    if (!profile.eligible || profile.baseCompression + profile.baseShear <= 1e-5) return

    activeResponses.set(resultId, {
      startedAt: now,
      source: cloneBody(source),
      partner: cloneBody(partner),
      contactNormal: { ...responseTransition.contactNormal },
      presentationHeadOn: responseTransition.presentationHeadOn,
    })
  })

  const activeIds = new Set(bodies.map((body) => body.id))
  activeResponses.forEach((_response, bodyId) => {
    if (!activeIds.has(bodyId)) activeResponses.delete(bodyId)
  })
  stableSourcesById.forEach((_body, bodyId) => {
    if (!activeIds.has(bodyId)) stableSourcesById.delete(bodyId)
  })
  updateStableSourceCache(bodies)

  currentBodiesById = new Map(bodies.map((body) => [body.id, body]))
  currentBodiesBySeed = new Map(
    bodies.map((body) => [getSimulationBodySeed(body.id), body]),
  )
  previousBodies = bodies.map(cloneBody)
  lastSimulationTime = simulationTime
}

function resolveMaterialBody(material: THREE.ShaderMaterial) {
  const cachedId = material.userData.simulationBodyId
  if (typeof cachedId === 'string') {
    const body = currentBodiesById.get(cachedId)
    if (body) return body
  }
  const seed = material.uniforms.uSeed?.value
  if (typeof seed !== 'number') return undefined
  const body = currentBodiesBySeed.get(seed)
  if (body) material.userData.simulationBodyId = body.id
  return body
}

function resetResponseUniforms(material: THREE.ShaderMaterial) {
  if (material.uniforms.uCollisionSurfaceResponseActive) {
    material.uniforms.uCollisionSurfaceResponseActive.value = 0
  }
  if (material.uniforms.uCollisionSurfaceCompression) {
    material.uniforms.uCollisionSurfaceCompression.value = 0
  }
  if (material.uniforms.uCollisionSurfaceShear) {
    material.uniforms.uCollisionSurfaceShear.value = 0
  }
}

function publishTelemetry(bodyId: string, profile: CollisionSurvivorResponseProfile) {
  if (typeof window === 'undefined') return
  window.__survivorImpactResponseMetrics ??= {}
  window.__survivorImpactResponseMetrics[bodyId] = profile
}

function applyResponse(
  material: THREE.ShaderMaterial,
  object: THREE.Object3D,
) {
  resetResponseUniforms(material)
  const body = resolveMaterialBody(material)
  if (!body) return
  const active = activeResponses.get(body.id)
  if (!active) return

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsedMs = Math.max(0, now - active.startedAt)
  const enabled = isStageFourEnabled()
  const profile = getCollisionSurvivorResponseProfile(
    active.source,
    active.partner,
    body,
    active.contactNormal,
    active.presentationHeadOn,
    elapsedMs,
    enabled,
  )
  publishTelemetry(body.id, profile)

  if (elapsedMs >= SURVIVOR_RESPONSE_DURATION_MS) {
    activeResponses.delete(body.id)
    return
  }
  if (profile.compression + profile.shear <= 1e-6) return

  const worldQuaternion = new THREE.Quaternion()
  object.getWorldQuaternion(worldQuaternion)
  worldQuaternion.invert()
  const normalUniform = material.uniforms.uCollisionSurfaceResponseDirection?.value
  if (normalUniform instanceof THREE.Vector3) {
    normalUniform.set(profile.normal.x, profile.normal.y, profile.normal.z)
      .applyQuaternion(worldQuaternion)
      .normalize()
  }
  const tangentUniform = material.uniforms.uCollisionSurfaceResponseTangent?.value
  if (tangentUniform instanceof THREE.Vector3) {
    tangentUniform.set(profile.tangent.x, profile.tangent.y, profile.tangent.z)
      .applyQuaternion(worldQuaternion)
      .normalize()
  }
  material.uniforms.uCollisionSurfaceResponseActive.value = 1
  material.uniforms.uCollisionSurfaceCompression.value = profile.compression
  material.uniforms.uCollisionSurfaceShear.value = profile.shear
}

function patchBodyMaterial(material: THREE.ShaderMaterial) {
  if (material.userData.collisionSurvivorResponsePatched) return
  if (
    !material.uniforms.uCollisionRevealScale ||
    !material.uniforms.uSeed ||
    !material.vertexShader.includes(BODY_VERTEX_MARKER)
  ) return

  material.uniforms.uCollisionSurfaceResponseActive ??= { value: 0 }
  material.uniforms.uCollisionSurfaceResponseDirection ??= {
    value: new THREE.Vector3(1, 0, 0),
  }
  material.uniforms.uCollisionSurfaceResponseTangent ??= {
    value: new THREE.Vector3(0, 1, 0),
  }
  material.uniforms.uCollisionSurfaceCompression ??= { value: 0 }
  material.uniforms.uCollisionSurfaceShear ??= { value: 0 }

  const responseCode = `
    if (uCollisionSurfaceResponseActive > 0.5) {
      vec3 responseDirection = normalize(
        uCollisionSurfaceResponseDirection + vec3(0.000001, 0.000002, 0.000003)
      );
      vec3 responseTangent = normalize(
        uCollisionSurfaceResponseTangent + vec3(0.000003, 0.000001, 0.000002)
      );
      float responseFacing = dot(objectNormal, responseDirection);
      float responseMask = smoothstep(0.55, 0.94, responseFacing);
      float responseCore = responseMask * responseMask;
      float sourceRadius = max(length(position), 0.000001);
      revealPosition -= responseDirection * sourceRadius *
        uCollisionSurfaceCompression * responseCore;
      float tangentSide = abs(dot(objectNormal, responseTangent));
      revealPosition += responseTangent * sourceRadius *
        uCollisionSurfaceShear * responseCore * (0.58 + tangentSide * 0.42);
    }

${BODY_VERTEX_MARKER}`

  material.vertexShader = `
    uniform float uCollisionSurfaceResponseActive;
    uniform vec3 uCollisionSurfaceResponseDirection;
    uniform vec3 uCollisionSurfaceResponseTangent;
    uniform float uCollisionSurfaceCompression;
    uniform float uCollisionSurfaceShear;
${material.vertexShader.replace(BODY_VERTEX_MARKER, responseCode)}`
  material.userData.collisionSurvivorResponsePatched = true
  material.needsUpdate = true

  const previousOnBeforeRender = (material as any).onBeforeRender as
    ((...args: any[]) => void) | undefined
  ;(material as any).onBeforeRender = function collisionSurvivorResponseBeforeRender(
    this: THREE.ShaderMaterial,
    ...args: any[]
  ) {
    previousOnBeforeRender?.apply(this, args)
    const object = args[4] as THREE.Object3D | undefined
    if (object) applyResponse(material, object)
  }
}

export function installCollisionSurvivorResponse() {
  if (installed) return
  installed = true
  const prototype = THREE.ShaderMaterial.prototype as any
  const previousSetValues = prototype.setValues
  prototype.setValues = function setValuesWithCollisionSurvivorResponse(
    values: Record<string, any>,
  ) {
    const result = previousSetValues.call(this, values)
    patchBodyMaterial(this as THREE.ShaderMaterial)
    return result
  }
}

declare global {
  interface Window {
    __survivorImpactResponseMetrics?: Record<string, CollisionSurvivorResponseProfile>
  }
}
