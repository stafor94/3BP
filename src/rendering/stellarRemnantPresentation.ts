import * as THREE from 'three'
import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import type { BodyState, StellarCollisionOutcome, Vec3 } from '../types'

type MaterialRenderCallback = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  object: THREE.Object3D,
  group: THREE.Group | null,
) => void

export type StellarRemnantTransition = {
  token: string
  outcome: StellarCollisionOutcome
  role: 'remnant' | 'survivor'
  impactNormal: Vec3
  impactSpeed: number
  impactParameter: number
  massRatio: number
  massLoss: number
  sourceVisualRadius: number
  targetVisualRadius: number
  deformation01: number
  durationMs: number
}

export type StellarRemnantVisualTransform = {
  relaxationProgress: number
  displayRadius: number
  scale: Vec3
}

type ActiveStellarRemnantTransition = StellarRemnantTransition & {
  startedAtMs: number
}

const MERGE_RELAXATION_MS = 1200
const PARTIAL_RELAXATION_MS = 950
const HIT_RUN_RELAXATION_MS = 650
const LOCAL_IMPACT_AXIS = new THREE.Vector3(1, 0, 0)
const impactDirectionScratch = new THREE.Vector3()
const EPSILON = 1e-9

let installed = false
let currentBodiesBySeed = new Map<string, BodyState>()
let previousBodies: BodyState[] = []
let lastSimulationTime = 0
const activeTransitions = new Map<string, ActiveStellarRemnantTransition>()
const completedTokens = new Map<string, string>()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function isStar(body: BodyState) {
  return body.bodyType === 'star'
}

function cloneBody(body: BodyState): BodyState {
  return {
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
    effectVisual: body.effectVisual
      ? {
          ...body.effectVisual,
          direction: { ...body.effectVisual.direction },
          normal: body.effectVisual.normal ? { ...body.effectVisual.normal } : undefined,
        }
      : undefined,
  }
}

function getBodySeed(id: string) {
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

function normalize(value: Vec3, fallback: Vec3 = { x: 1, y: 0, z: 0 }): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length > EPSILON) {
    return { x: value.x / length, y: value.y / length, z: value.z / length }
  }

  const fallbackLength = Math.hypot(fallback.x, fallback.y, fallback.z)
  if (fallbackLength > EPSILON) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
      z: fallback.z / fallbackLength,
    }
  }
  return { x: 1, y: 0, z: 0 }
}

function getCollisionSerial(body: BodyState) {
  if (!body.transientHeatToken || !body.stellarCollisionOutcome) return null
  const separator = body.transientHeatToken.indexOf(':')
  if (separator <= 0) return null
  const serial = body.transientHeatToken.slice(0, separator)
  return /^\d+$/.test(serial) ? serial : null
}

function getCollisionFlash(
  currentBodies: BodyState[],
  serial: string,
  outcome: StellarCollisionOutcome,
) {
  const suffix = `+flash${serial}`
  return currentBodies.find((body) => (
    body.bodyType === 'effect' &&
    body.name === 'Collision flash' &&
    body.id.endsWith(suffix) &&
    body.effectVisual?.stellarOutcome === outcome
  ))
}

function findMergedSourcePair(previous: BodyState[], remnant: BodyState) {
  const stars = previous.filter(isStar)
  for (let firstIndex = 0; firstIndex < stars.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < stars.length; secondIndex += 1) {
      const first = stars[firstIndex]
      const second = stars[secondIndex]
      if (
        bodyCarriesCollisionLineage(remnant, first.id) &&
        bodyCarriesCollisionLineage(remnant, second.id)
      ) {
        return [first, second] as const
      }
    }
  }
  return null
}

function findSeparatedSourcePair(
  previous: BodyState[],
  current: BodyState[],
  survivor: BodyState,
  serial: string,
) {
  const source = previous.find((body) => body.id === survivor.id && isStar(body))
  if (!source) return null

  const peer = current.find((body) => (
    body.id !== survivor.id &&
    isStar(body) &&
    body.stellarCollisionOutcome === survivor.stellarCollisionOutcome &&
    getCollisionSerial(body) === serial
  ))
  if (!peer) return null

  const peerSource = previous.find((body) => body.id === peer.id && isStar(body))
  return peerSource ? [source, peerSource] as const : null
}

function getPairPresentationData(pair: readonly [BodyState, BodyState] | null) {
  if (!pair) {
    return {
      normal: { x: 1, y: 0, z: 0 } as Vec3,
      impactSpeed: 0,
      impactParameter: 0,
      massRatio: 1,
    }
  }

  const [a, b] = pair
  const delta = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  }
  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    y: b.velocity.y - a.velocity.y,
    z: b.velocity.z - a.velocity.z,
  }
  const impactSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z)
  const contactDistance = Math.max(a.radius + b.radius, EPSILON)
  const cross = {
    x: delta.y * relativeVelocity.z - delta.z * relativeVelocity.y,
    y: delta.z * relativeVelocity.x - delta.x * relativeVelocity.z,
    z: delta.x * relativeVelocity.y - delta.y * relativeVelocity.x,
  }
  const crossMagnitude = Math.hypot(cross.x, cross.y, cross.z)
  const impactParameter = impactSpeed > EPSILON
    ? clamp(crossMagnitude / Math.max(impactSpeed * contactDistance, EPSILON), 0, 1)
    : 0

  return {
    normal: normalize(delta, relativeVelocity),
    impactSpeed,
    impactParameter,
    massRatio: Math.min(a.mass, b.mass) / Math.max(a.mass, b.mass, EPSILON),
  }
}

function getSourceVisualRadius(
  body: BodyState,
  sourcePair: readonly [BodyState, BodyState] | null,
  sourceBody: BodyState | undefined,
) {
  const target = Math.max(body.radius, EPSILON)
  if (body.stellarCollisionOutcome === 'merge' && sourcePair) {
    const combinedVolumeRadius = Math.cbrt(sourcePair[0].radius ** 3 + sourcePair[1].radius ** 3)
    return clamp(combinedVolumeRadius, target * 0.78, target * 1.08)
  }
  if (sourceBody) return clamp(sourceBody.radius, target * 0.72, target * 1.28)
  return target
}

function getDeformationStrength(
  outcome: StellarCollisionOutcome,
  sourceBody: BodyState | undefined,
  body: BodyState,
) {
  if (outcome === 'merge') return 1
  const relativeMassChange = sourceBody
    ? Math.abs(body.mass - sourceBody.mass) / Math.max(sourceBody.mass, EPSILON)
    : 0
  if (outcome === 'partialDisruption') {
    return clamp(0.58 + relativeMassChange * 2.2, 0.58, 0.88)
  }
  return clamp(0.32 + relativeMassChange * 1.8, 0.32, 0.5)
}

function getRelaxationDuration(outcome: StellarCollisionOutcome) {
  if (outcome === 'merge') return MERGE_RELAXATION_MS
  if (outcome === 'partialDisruption') return PARTIAL_RELAXATION_MS
  return HIT_RUN_RELAXATION_MS
}

export function deriveStellarRemnantTransition(
  previous: BodyState[],
  current: BodyState[],
  body: BodyState,
): StellarRemnantTransition | null {
  const outcome = body.stellarCollisionOutcome
  const token = body.transientHeatToken
  const serial = getCollisionSerial(body)
  if (!isStar(body) || !outcome || !token || !serial) return null

  const sourceBody = previous.find((candidate) => candidate.id === body.id && isStar(candidate))
  const sourcePair = outcome === 'merge'
    ? findMergedSourcePair(previous, body)
    : findSeparatedSourcePair(previous, current, body, serial)
  const pairData = getPairPresentationData(sourcePair)
  const flash = getCollisionFlash(current, serial, outcome)
  const impactNormal = normalize(flash?.effectVisual?.normal ?? pairData.normal, pairData.normal)
  const sourceMass = outcome === 'merge' && sourcePair
    ? sourcePair[0].mass + sourcePair[1].mass
    : sourceBody?.mass ?? body.mass
  const massLoss = Math.max(0, sourceMass - body.mass)

  return {
    token,
    outcome,
    role: outcome === 'merge' ? 'remnant' : 'survivor',
    impactNormal,
    impactSpeed: pairData.impactSpeed,
    impactParameter: pairData.impactParameter,
    massRatio: pairData.massRatio,
    massLoss,
    sourceVisualRadius: getSourceVisualRadius(body, sourcePair, sourceBody),
    targetVisualRadius: body.radius,
    deformation01: getDeformationStrength(outcome, sourceBody, body),
    durationMs: getRelaxationDuration(outcome),
  }
}

function criticallyDampedProgress(progress: number) {
  const t = clamp(progress, 0, 1)
  if (t <= 0) return 0
  if (t >= 1) return 1

  const response = 1 - (1 + 5.5 * t) * Math.exp(-5.5 * t)
  const responseAtEnd = 1 - 6.5 * Math.exp(-5.5)
  return clamp(response / responseAtEnd, 0, 1)
}

export function getStellarRemnantVisualTransform(
  transition: StellarRemnantTransition,
  elapsedMs: number,
): StellarRemnantVisualTransform {
  const progress = transition.durationMs <= 0
    ? 1
    : clamp(elapsedMs / transition.durationMs, 0, 1)
  const relaxationProgress = criticallyDampedProgress(progress)
  const unsettled = 1 - relaxationProgress
  const deformation = clamp(transition.deformation01, 0, 1) * unsettled
  const axialScale = 1 + deformation * 0.22
  const transverseScale = 1 / Math.sqrt(axialScale)
  const asymmetry = deformation * 0.018
  const displayRadius = transition.sourceVisualRadius +
    (transition.targetVisualRadius - transition.sourceVisualRadius) * relaxationProgress
  const radiusScale = displayRadius / Math.max(transition.targetVisualRadius, EPSILON)

  return {
    relaxationProgress,
    displayRadius,
    scale: {
      x: radiusScale * axialScale,
      y: radiusScale * transverseScale * (1 + asymmetry),
      z: radiusScale * transverseScale / (1 + asymmetry),
    },
  }
}

function resetPresentationState() {
  activeTransitions.clear()
  completedTokens.clear()
  previousBodies = []
}

export function syncStellarRemnantPresentationState(
  bodies: BodyState[],
  simulationTime: number,
) {
  if (simulationTime + 1e-9 < lastSimulationTime) resetPresentationState()

  const activeStarIds = new Set(bodies.filter(isStar).map((body) => body.id))
  Array.from(activeTransitions.keys()).forEach((id) => {
    if (!activeStarIds.has(id)) activeTransitions.delete(id)
  })
  Array.from(completedTokens.keys()).forEach((id) => {
    if (!activeStarIds.has(id)) completedTokens.delete(id)
  })

  bodies.filter(isStar).forEach((body) => {
    const token = body.transientHeatToken
    const outcome = body.stellarCollisionOutcome
    if (!token || !outcome) {
      activeTransitions.delete(body.id)
      completedTokens.delete(body.id)
      return
    }

    if (activeTransitions.get(body.id)?.token === token || completedTokens.get(body.id) === token) return
    const transition = deriveStellarRemnantTransition(previousBodies, bodies, body)
    if (!transition) return

    activeTransitions.set(body.id, {
      ...transition,
      startedAtMs: nowMs(),
    })
    completedTokens.delete(body.id)
  })

  const nextBodiesBySeed = new Map<string, BodyState>()
  bodies.forEach((body) => nextBodiesBySeed.set(seedKey(getBodySeed(body.id)), body))
  currentBodiesBySeed = nextBodiesBySeed
  previousBodies = bodies.map(cloneBody)
  lastSimulationTime = simulationTime
}

function scaleAdjacentGlow(scene: THREE.Scene, objectIndex: number, radiusScale: number) {
  const glowInner = scene.children[objectIndex - 1]
  const glowOuter = scene.children[objectIndex - 2]
  if (glowInner instanceof THREE.Sprite) glowInner.scale.multiplyScalar(radiusScale)
  if (glowOuter instanceof THREE.Sprite) glowOuter.scale.multiplyScalar(radiusScale)
}

function applyStellarRemnantPresentation(
  material: THREE.ShaderMaterial,
  scene: THREE.Scene,
  object: THREE.Object3D,
) {
  const seed = material.uniforms.uSeed?.value
  if (typeof seed !== 'number') return

  const body = currentBodiesBySeed.get(seedKey(seed))
  if (!body || !isStar(body)) return

  const transition = activeTransitions.get(body.id)
  if (!transition) return
  if (body.transientHeatToken !== transition.token) {
    activeTransitions.delete(body.id)
    return
  }

  const elapsedMs = nowMs() - transition.startedAtMs
  if (elapsedMs >= transition.durationMs) {
    activeTransitions.delete(body.id)
    completedTokens.set(body.id, transition.token)
    return
  }

  const transform = getStellarRemnantVisualTransform(transition, elapsedMs)
  const baseScale = object.scale.clone()
  object.scale.set(
    baseScale.x * transform.scale.x,
    baseScale.y * transform.scale.y,
    baseScale.z * transform.scale.z,
  )

  impactDirectionScratch.set(
    transition.impactNormal.x,
    transition.impactNormal.y,
    transition.impactNormal.z,
  )
  if (impactDirectionScratch.lengthSq() <= EPSILON) impactDirectionScratch.set(1, 0, 0)
  else impactDirectionScratch.normalize()
  object.quaternion.setFromUnitVectors(LOCAL_IMPACT_AXIS, impactDirectionScratch)

  const objectIndex = scene.children.indexOf(object)
  if (objectIndex >= 2) {
    const radiusScale = transform.displayRadius / Math.max(transition.targetVisualRadius, EPSILON)
    scaleAdjacentGlow(scene, objectIndex, radiusScale)
  }
}

function isSimulationBodyShader(values: Record<string, any> | undefined) {
  return Boolean(
    values?.uniforms?.uSeed &&
    typeof values?.fragmentShader === 'string' &&
    values.fragmentShader.includes('drawBodyEmission'),
  )
}

export function installStellarRemnantPresentation() {
  if (installed) return
  installed = true

  const shaderPrototype = THREE.ShaderMaterial.prototype as any
  const previousSetValues = shaderPrototype.setValues

  shaderPrototype.setValues = function setValuesWithStellarRemnantPresentation(values: Record<string, any>) {
    const simulationBodyShader = isSimulationBodyShader(values)
    const result = previousSetValues.call(this, values)
    if (!simulationBodyShader) return result

    const material = this as THREE.ShaderMaterial & {
      onBeforeRender?: MaterialRenderCallback
      __stellarRemnantPresentationInstalled?: boolean
    }
    if (material.__stellarRemnantPresentationInstalled) return result
    material.__stellarRemnantPresentationInstalled = true

    const previousOnBeforeRender = material.onBeforeRender
    material.onBeforeRender = function stellarRemnantBeforeBodyRender(
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.Camera,
      geometry: THREE.BufferGeometry,
      object: THREE.Object3D,
      group: THREE.Group | null,
    ) {
      applyStellarRemnantPresentation(material, scene, object)
      previousOnBeforeRender?.call(
        this,
        renderer,
        scene,
        camera,
        geometry,
        object,
        group,
      )
    }

    return result
  }
}
