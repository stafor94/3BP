import type { BodyState } from '../src/types'
import {
  getCollisionEffectProfile,
  SMALL_HEAD_ON_CONTACT_FLASH_TAIL_SENTINEL,
} from '../src/rendering/collisionEffectProfile'
import {
  createDisruptionChunkDescriptors,
  DISRUPTION_CHUNK_MAX_COUNT,
  DISRUPTION_CHUNK_MIN_COUNT,
  shouldSuppressDisruptionChunks,
} from '../src/rendering/disruptionChunkVisual'
import { findCollisionVisualTransitions } from '../src/rendering/collisionVisualOutcome'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeFlash(sourceMaxRadius: number, widthScale: number, stellarCollision = false): BodyState {
  return {
    id: stellarCollision ? 'artifact:stellar-flash' : `artifact:flash:${sourceMaxRadius}:${widthScale}`,
    name: 'Collision flash',
    color: '#b88b67',
    mass: 0,
    radius: 0.055,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'effect',
    age: 0,
    lifetime: 0.72,
    effectVisual: {
      kind: 'contactFlash',
      direction: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      stretch: stellarCollision ? 5.4 : 3.6,
      widthScale,
      brightness: stellarCollision ? 2.3 : 1.8,
      turbulence: 0.12,
      pulseStrength: 0.08,
      sourceMaxRadius: stellarCollision ? undefined : sourceMaxRadius,
      stellarCollision,
    },
  }
}

function testSmallHeadOnFlashSelectsRadialMask() {
  const headOn = getCollisionEffectProfile(makeFlash(0.024, 0.29))
  assert(
    headOn.tailLength === SMALL_HEAD_ON_CONTACT_FLASH_TAIL_SENTINEL,
    'small high-head-on contact flash must select the ridge-free radial shader mask',
  )

  const grazing = getCollisionEffectProfile(makeFlash(0.024, 0.44))
  assert(grazing.tailLength === -1,
    'small grazing contact flash must preserve the existing compact directional mask')

  const normalSized = getCollisionEffectProfile(makeFlash(0.04, 0.29))
  assert(normalSized.tailLength === -1,
    'normal-sized head-on contact flash must remain on the existing compact mask')

  const stellar = getCollisionEffectProfile(makeFlash(0.24, 0.22, true))
  assert(stellar.tailLength === 0,
    'stellar contact flash must remain on the stellar shader path')
}

function makeBody(
  id: string,
  radius: number,
  x: number,
  velocityX: number,
): BodyState {
  return {
    id,
    name: id,
    color: '#9b7559',
    mass: 0.02,
    radius,
    position: { x, y: 0, z: 0 },
    velocity: { x: velocityX, y: 0, z: 0 },
    bodyType: 'moon',
  }
}

function testSmallHeadOnChunksAreSuppressed() {
  const a = makeBody('artifact-a', 0.024, -0.0235, 1)
  const b = makeBody('artifact-b', 0.023, 0.0235, -1)
  const fragments: BodyState[] = [0, 1, 2, 3].map((index) => ({
    id: `artifact-a+artifact-b+fragment-${index}`,
    name: `artifact-fragment-${index}`,
    color: '#8c684f',
    mass: 0.006,
    radius: 0.007 + index * 0.0005,
    position: { x: (index - 1.5) * 0.009, y: (index % 2 === 0 ? -1 : 1) * 0.002, z: 0 },
    velocity: { x: (index % 2 === 0 ? -1 : 1) * (0.18 + index * 0.03), y: 0, z: 0 },
    bodyType: 'fragment',
    age: 0,
  }))

  const transitions = findCollisionVisualTransitions([a, b], fragments)
    .filter((transition) => transition.outcome === 'disrupted')
  assert(transitions.length === 2,
    'small head-on disruption fixture must produce presentation disruption transitions for both sources')
  assert(transitions.every((transition) => transition.presentationHeadOn > 0.99),
    'rendering transition must reconstruct the head-on trajectory from impact parameter')
  assert(transitions.every((transition) => shouldSuppressDisruptionChunks(transition.source, transition)),
    'small high-head-on transitions must suppress synthetic solid chunks')
  assert(transitions.every((transition) => createDisruptionChunkDescriptors(transition.source, transition).length === 0),
    'suppressed small high-head-on transitions must instantiate zero synthetic solid chunks')

  const preservedGrazing = {
    ...transitions[0],
    presentationHeadOn: 0.35,
  }
  const grazingChunks = createDisruptionChunkDescriptors(preservedGrazing.source, preservedGrazing)
  assert(
    grazingChunks.length >= DISRUPTION_CHUNK_MIN_COUNT && grazingChunks.length <= DISRUPTION_CHUNK_MAX_COUNT,
    'grazing disruption must preserve the existing synthetic chunk presentation',
  )

  const normalSource: BodyState = {
    ...transitions[0].source,
    id: 'artifact-normal-source',
    radius: 0.04,
  }
  const normalTransition = {
    ...transitions[0],
    source: normalSource,
    presentationHeadOn: 1,
  }
  const normalChunks = createDisruptionChunkDescriptors(normalSource, normalTransition)
  assert(
    normalChunks.length >= DISRUPTION_CHUNK_MIN_COUNT && normalChunks.length <= DISRUPTION_CHUNK_MAX_COUNT,
    'normal-sized head-on disruption must preserve the existing synthetic chunk presentation',
  )
}

testSmallHeadOnFlashSelectsRadialMask()
testSmallHeadOnChunksAreSuppressed()
console.log('collision presentation artifact regression checks passed (2)')
