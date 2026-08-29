
import { getCelestialBodyRenderBodies } from '../src/rendering/collisionEffectRouting'
import { createFragmentVisualMotionContext } from '../src/rendering/fragmentVisualMotion'
import type { BodyState, EffectVisualKind } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function near(a: number, b: number, tolerance = 1e-12) {
  return Math.abs(a - b) <= tolerance
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
assert(rendered.includes(fragment), 'persistent debris fragments must remain in the celestial-body renderer')
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

const flash: BodyState = {
  ...makeBody('primary+impactor+flash7', 'effect'),
  name: 'Collision flash',
  radius: 0.08,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0.01, y: -0.02, z: 0 },
  effectVisual: {
    kind: 'contactFlash',
    direction: { x: 0, y: 1, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    temperatureBias: 0.82,
    sourceMaxRadius: 0.1,
  },
}
const transientA: BodyState = {
  ...makeBody('primary+impactor+frag7-0', 'fragment'),
  mass: 0.008,
  radius: 0.018,
  position: { x: 0.055, y: 0.012, z: 0 },
  velocity: { x: 0.16, y: 0.19, z: 0 },
  age: 0.22,
  lifetime: 5,
}
const transientB: BodyState = {
  ...makeBody('primary+impactor+frag7-1', 'fragment'),
  mass: 0.006,
  radius: 0.014,
  position: { x: -0.048, y: -0.009, z: 0 },
  velocity: { x: -0.12, y: -0.17, z: 0 },
  age: 0.22,
  lifetime: 5,
}
const originalA = {
  position: { ...transientA.position },
  velocity: { ...transientA.velocity },
  radius: transientA.radius,
  mass: transientA.mass,
}
const originalB = {
  position: { ...transientB.position },
  velocity: { ...transientB.velocity },
  radius: transientB.radius,
  mass: transientB.mass,
}

const transientRendered = getCelestialBodyRenderBodies([transientA, transientB, flash])
const renderedA = transientRendered.find((body) => body.id === transientA.id)
const renderedB = transientRendered.find((body) => body.id === transientB.id)
assert(renderedA && renderedB, 'transient fragments must remain renderable')
assert(renderedA !== transientA && renderedB !== transientB, 'transient debris motion must use render-only clones')
assert(renderedA.position.x > transientA.position.x, 'positive-side debris must burst outward along collision normal')
assert(renderedB.position.x < transientB.position.x, 'negative-side debris must burst outward along the opposite normal')
assert(
  Math.abs(renderedA.position.y - transientA.position.y) > 1e-6,
  'debris burst must include deterministic angular variation instead of a single shared direction',
)
assert(
  !near(renderedA.radius / transientA.radius, renderedB.radius / transientB.radius, 1e-6),
  'fragment presentation size must vary deterministically across pieces',
)
assert(
  transientA.position.x === originalA.position.x && transientA.position.y === originalA.position.y &&
  transientA.velocity.x === originalA.velocity.x && transientA.velocity.y === originalA.velocity.y &&
  transientA.radius === originalA.radius && transientA.mass === originalA.mass,
  'presentation motion must not mutate fragment A physical state',
)
assert(
  transientB.position.x === originalB.position.x && transientB.position.y === originalB.position.y &&
  transientB.velocity.x === originalB.velocity.x && transientB.velocity.y === originalB.velocity.y &&
  transientB.radius === originalB.radius && transientB.mass === originalB.mass,
  'presentation motion must not mutate fragment B physical state',
)
assert(
  renderedA.age === transientA.age && renderedA.lifetime === transientA.lifetime &&
  renderedB.age === transientB.age && renderedB.lifetime === transientB.lifetime,
  'fragment lifecycle and fade inputs must remain unchanged',
)

const repeated = getCelestialBodyRenderBodies([transientA, transientB, flash])
const repeatedA = repeated.find((body) => body.id === transientA.id)
assert(repeatedA, 'deterministic replay must keep fragment A renderable')
assert(
  near(repeatedA.position.x, renderedA.position.x) &&
  near(repeatedA.position.y, renderedA.position.y) &&
  near(repeatedA.radius, renderedA.radius),
  'same fragment/collision state must produce deterministic presentation motion',
)

const lowEnergyFlash: BodyState = {
  ...flash,
  effectVisual: { ...flash.effectVisual!, temperatureBias: 0.05 },
}
const highEnergyFlash: BodyState = {
  ...flash,
  effectVisual: { ...flash.effectVisual!, temperatureBias: 0.95 },
}
const lowEnergy = createFragmentVisualMotionContext(transientA, lowEnergyFlash)
const highEnergy = createFragmentVisualMotionContext(transientA, highEnergyFlash)
assert(lowEnergy && highEnergy, 'energy comparison must produce visual motion contexts')
assert(
  highEnergy.burstDistance > lowEnergy.burstDistance,
  'higher collision energy must create a longer presentation-only debris burst',
)
assert(
  highEnergy.burstDuration < lowEnergy.burstDuration,
  'higher collision energy must deliver the debris burst more quickly',
)
assert(
  Math.abs(highEnergy.direction.x) > Math.hypot(highEnergy.direction.y, highEnergy.direction.z),
  'collision normal must remain the dominant debris direction after angular variation',
)

console.log('Collision effect routing regression passed')
