import {
  appendCollisionMacroFragmentRenderBodies,
  getCollisionMacroFragmentPhysicalId,
  getCollisionMacroFragmentRenderBodies,
  isCollisionMacroFragmentRenderBody,
} from '../src/rendering/collisionMacroFragmentContinuity'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeRemnant(): BodyState {
  return {
    id: 'macro-remnant',
    name: 'remnant',
    color: '#9a765d',
    mass: 0.0027,
    radius: 0.022,
    position: { x: 0.001, y: 0, z: 0 },
    velocity: { x: 0.02, y: 0, z: 0 },
    bodyType: 'moon',
    collisionLineageIds: ['macro-a', 'macro-b'],
  }
}

function makeSpark(id: string, radius: number, x: number, vx: number): BodyState {
  return {
    id,
    name: 'Collision spark',
    color: '#806b5a',
    mass: 0.0001,
    radius,
    position: { x, y: 0.001, z: 0 },
    velocity: { x: vx, y: 0.005, z: 0 },
    bodyType: 'effect',
    age: 0.01,
    lifetime: 0.55,
    collisionLineageIds: ['macro-a', 'macro-b'],
    effectVisual: {
      kind: 'collisionSpark',
      direction: { x: Math.sign(vx) || 1, y: 0, z: 0 },
      sourceMaxRadius: 0.0187,
    },
  }
}

const remnant = makeRemnant()
const largeSpark = makeSpark('macro-spark-large', 0.008, 0.031, 0.22)
const smallSpark = makeSpark('macro-spark-small', 0.0065, -0.029, -0.18)
const physical = [remnant, largeSpark, smallSpark]
const physicalSnapshot = JSON.stringify(physical)
const proxies = getCollisionMacroFragmentRenderBodies(physical)

assert(proxies.length === 2, 'collapsed 2->1 spark-only ejecta must expose macro fragment continuity')
assert(JSON.stringify(physical) === physicalSnapshot, 'macro fragment continuity must not mutate physical state')
assert(proxies.every(isCollisionMacroFragmentRenderBody), 'continuity bodies must be explicitly renderer-only')
assert(proxies.every((proxy) => proxy.bodyType === 'fragment'), 'continuity proxies must use irregular fragment geometry')
assert(proxies.every((proxy) => proxy.mass === 0), 'renderer-only proxies must not duplicate physical ejecta mass')
assert(proxies.every((proxy) => !proxy.collisionLineageIds && !proxy.trackingContinuationIds),
  'renderer-only proxies must not participate in collision/tracking lineage')

proxies.forEach((proxy) => {
  const physicalId = getCollisionMacroFragmentPhysicalId(proxy)
  const source = physical.find((body) => body.id === physicalId)
  assert(source, `proxy ${proxy.id} must map to a real physical ejecta body`)
  assert(proxy.radius === source.radius, 'macro fragment radius must inherit the real ejecta radius exactly')
  assert(
    proxy.position.x === source.position.x &&
    proxy.position.y === source.position.y &&
    proxy.position.z === source.position.z,
    'macro fragment position must inherit the real ejecta position exactly',
  )
  assert(
    proxy.velocity.x === source.velocity.x &&
    proxy.velocity.y === source.velocity.y &&
    proxy.velocity.z === source.velocity.z,
    'macro fragment velocity must inherit the real ejecta velocity exactly',
  )
})

const rendered = appendCollisionMacroFragmentRenderBodies([remnant], physical)
assert(rendered.length === 3, 'first post-solver render state must include remnant plus visible macro fragments')

const physicalFragment: BodyState = {
  ...largeSpark,
  id: 'macro-real-fragment',
  name: 'Debris',
  bodyType: 'fragment',
  effectVisual: undefined,
}
assert(
  getCollisionMacroFragmentRenderBodies([remnant, largeSpark, physicalFragment]).length === 0,
  'existing persistent physical fragments must retain visual ownership without duplicate proxies',
)

const hitRunA: BodyState = {
  ...remnant,
  id: 'macro-a',
  collisionLineageIds: ['macro-a'],
}
const hitRunB: BodyState = {
  ...remnant,
  id: 'macro-b',
  collisionLineageIds: ['macro-b'],
}
assert(
  getCollisionMacroFragmentRenderBodies([hitRunA, hitRunB, largeSpark]).length === 0,
  'two surviving solids must not receive 2->1 macro-fragment continuity proxies',
)

console.log('collision macro fragment continuity regression passed')
