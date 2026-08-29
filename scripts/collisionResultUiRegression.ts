import { resolveCollisionWatchOutcome } from '../src/collisionWatch'
import type { BodyState, BodyType, StellarCollisionOutcome } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeBody(
  id: string,
  bodyType: BodyType,
  overrides: Partial<BodyState> = {},
): BodyState {
  return {
    id,
    name: id,
    color: '#ffffff',
    mass: 1,
    radius: 0.1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
    ...overrides,
  }
}

function makeFlash(
  bodyAId: string,
  bodyBId: string,
  stellarOutcome?: StellarCollisionOutcome,
): BodyState {
  return makeBody(`${bodyAId}+${bodyBId}+flash1`, 'effect', {
    name: 'Collision flash',
    mass: 0,
    radius: 0.01,
    age: 0,
    lifetime: 1,
    effectVisual: {
      kind: 'contactFlash',
      direction: { x: 1, y: 0, z: 0 },
      stellarOutcome,
    },
  })
}

const pendingA = makeBody('pending-a', 'moon')
const pendingB = makeBody('pending-b', 'moon')
assert(
  resolveCollisionWatchOutcome([pendingA, pendingB], 'pending-a', 'pending-b', 'moon', 'moon') === null,
  'pre-impact pair must not expose a collision result',
)

const stellarMerge = makeBody('star-a', 'star', {
  collisionLineageIds: ['star-a', 'star-b'],
  stellarCollisionOutcome: 'merge',
})
assert(
  resolveCollisionWatchOutcome([stellarMerge], 'star-a', 'star-b', 'star', 'star') === 'merge',
  'stellar merge must use the engine stellarCollisionOutcome',
)

const stellarHitA = makeBody('hit-star-a', 'star', {
  collisionCooldown: 0.05,
  stellarCollisionOutcome: 'hitAndRun',
})
const stellarHitB = makeBody('hit-star-b', 'star', {
  collisionCooldown: 0.05,
  stellarCollisionOutcome: 'hitAndRun',
})
assert(
  resolveCollisionWatchOutcome(
    [stellarHitA, stellarHitB, makeFlash('hit-star-a', 'hit-star-b', 'hitAndRun')],
    'hit-star-a',
    'hit-star-b',
    'star',
    'star',
  ) === 'hitAndRun',
  'stellar hit-and-run must use the engine stellarCollisionOutcome',
)

const partialA = makeBody('partial-star-a', 'star', {
  collisionCooldown: 0.05,
  stellarCollisionOutcome: 'partialDisruption',
})
const partialB = makeBody('partial-star-b', 'star', {
  collisionCooldown: 0.05,
  stellarCollisionOutcome: 'partialDisruption',
})
assert(
  resolveCollisionWatchOutcome(
    [partialA, partialB, makeFlash('partial-star-a', 'partial-star-b', 'partialDisruption')],
    'partial-star-a',
    'partial-star-b',
    'star',
    'star',
  ) === 'partialDisruption',
  'stellar partial disruption must use the engine stellarCollisionOutcome',
)

const disrupted = makeBody('moon-a+moon-b', 'moon', {
  collisionLineageIds: ['moon-a', 'moon-b'],
})
assert(
  resolveCollisionWatchOutcome([disrupted], 'moon-a', 'moon-b', 'moon', 'moon') === 'disrupt',
  'non-stellar disruption must be identified from the engine composite-remnant identity',
)

const mergedOrAbsorbed = makeBody('planet-a', 'planet', {
  collisionLineageIds: ['planet-a', 'moon-c'],
})
assert(
  resolveCollisionWatchOutcome(
    [mergedOrAbsorbed],
    'planet-a',
    'moon-c',
    'planet',
    'moon',
  ) === 'mergeOrAbsorb',
  'single-remnant non-stellar merge/absorb must remain an honest combined presentation bucket',
)

const hitRunA = makeBody('moon-d', 'moon', { collisionCooldown: 0.05 })
const hitRunB = makeBody('moon-e', 'moon', { collisionCooldown: 0.05 })
assert(
  resolveCollisionWatchOutcome(
    [hitRunA, hitRunB, makeFlash('moon-d', 'moon-e')],
    'moon-d',
    'moon-e',
    'moon',
    'moon',
  ) === 'hitRun',
  'two-survivor non-stellar result must map to hit-and-run',
)

console.log('collision result UI regression passed')
