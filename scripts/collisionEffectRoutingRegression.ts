import { getCelestialBodyRenderBodies } from '../src/rendering/collisionEffectRouting'
import type { BodyState, EffectVisualKind } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeBody(id: string, bodyType: BodyState['bodyType']): BodyState {
  return {
    id,
    name: id,
    color: '#d9b77c',
    mass: bodyType === 'effect' ? 0 : 1,
    radius: 0.1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType,
  }
}

function makeEffect(kind: EffectVisualKind): BodyState {
  return {
    ...makeBody(`effect:${kind}`, 'effect'),
    effectVisual: {
      kind,
      direction: { x: 1, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
    },
  }
}

const physical = makeBody('physical', 'planet')
const remnant = { ...makeBody('primary+impactor', 'planet'), mass: 1.6, radius: 0.13 }
const fragment = { ...makeBody('fragment', 'fragment'), mass: 0.02, radius: 0.025 }
const effects: BodyState[] = [
  makeEffect('contactFlash'),
  makeEffect('compressionShear'),
  makeEffect('stellarPlasma'),
  makeEffect('stellarAfterglow'),
  makeEffect('collisionSpark'),
]
const source = [physical, remnant, fragment, ...effects]
const rendered = getCelestialBodyRenderBodies(source)

assert(rendered.includes(physical), 'ordinary physical bodies must remain in the celestial-body renderer')
assert(rendered.includes(remnant), 'collision remnants must remain in the celestial-body renderer')
assert(rendered.includes(fragment), 'real debris fragments must remain in the celestial-body renderer')
assert(rendered.length === 3, 'only physical bodies and real fragments may enter the celestial-body renderer')
assert(
  effects.every((effect) => !rendered.includes(effect)),
  'every collision effect kind must be owned exclusively by dedicated VFX layers',
)
assert(source.length === 3 + effects.length, 'render routing must not mutate the live simulation body state')
assert(
  source.every((body, index) => body === [physical, remnant, fragment, ...effects][index]),
  'render routing must preserve body object identity and collision state',
)

console.log('Collision effect routing regression passed')
