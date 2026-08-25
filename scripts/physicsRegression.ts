import { getCollisionContactDistance } from '../src/physics/collisionContact'
import { stepBodies as stepCoreBodies } from '../src/physics/engine'
import { stepBodies as stepFragmentAwareBodies } from '../src/physics/fragmentAwareEngine'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function distance(a: BodyState, b: BodyState) {
  return Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  )
}

function testContactDistanceUsesVisibleSurface() {
  const star: BodyState = {
    id: 'surface-star',
    name: 'Surface Star',
    color: '#fff0cc',
    mass: 1,
    radius: 0.5,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
  const planet: BodyState = {
    id: 'surface-planet',
    name: 'Surface Planet',
    color: '#88aaff',
    mass: 0.1,
    radius: 0.2,
    position: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }

  assertClose(
    getCollisionContactDistance(star, planet),
    star.radius + planet.radius,
    1e-12,
    'collision boundary must equal the visible radius sum',
  )
}

function testFlashStartsAtImpactSurface() {
  const star: BodyState = {
    id: 'flash-star',
    name: 'Flash Star',
    color: '#fff0cc',
    mass: 10,
    radius: 1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
  const planet: BodyState = {
    id: 'flash-planet',
    name: 'Flash Planet',
    color: '#88aaff',
    mass: 0.1,
    radius: 0.1,
    position: { x: 1.099999, y: 0, z: 0 },
    velocity: { x: -0.4, y: 0, z: 0 },
    bodyType: 'planet',
  }

  const resolved = stepCoreBodies([star, planet], 1e-8)
  const flash = resolved.find((body) => body.bodyType === 'effect' && body.name === 'Collision flash')
  assert(flash, 'collision must create a flash')

  assertClose(
    flash.position.x,
    1,
    2e-4,
    'extreme mass-ratio flash must start at the impact surface instead of the center of mass',
  )
  assertClose(flash.position.y, 0, 1e-8, 'flash y position must stay on the impact point')
  assertClose(flash.position.z, 0, 1e-8, 'flash z position must stay on the impact point')
}

function testHitAndRunSurvivorsDoNotOverlap() {
  const a: BodyState = {
    id: 'grazing-a',
    name: 'Grazing A',
    color: '#99bbff',
    mass: 0.2,
    radius: 0.2,
    position: { x: -0.1999995, y: 0, z: 0 },
    velocity: { x: 0, y: -0.6, z: 0 },
    bodyType: 'planet',
  }
  const b: BodyState = {
    id: 'grazing-b',
    name: 'Grazing B',
    color: '#ffbb99',
    mass: 0.2,
    radius: 0.2,
    position: { x: 0.1999995, y: 0, z: 0 },
    velocity: { x: 0, y: 0.6, z: 0 },
    bodyType: 'planet',
  }

  const resolved = stepCoreBodies([a, b], 1e-8)
  const survivorA = resolved.find((body) => body.id === a.id)
  const survivorB = resolved.find((body) => body.id === b.id)
  assert(survivorA && survivorB, 'grazing equal-mass collision should retain both hit-and-run survivors')
  assert(
    distance(survivorA, survivorB) + 1e-10 >= survivorA.radius + survivorB.radius,
    'hit-and-run survivors must start fully separated',
  )
}

function testStagedImpactKeepsCollidersVisibleBeforeResolution() {
  const star: BodyState = {
    id: 'stage-star',
    name: 'Stage Star',
    color: '#fff0cc',
    mass: 1,
    radius: 0.3,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
  }
  const planet: BodyState = {
    id: 'stage-planet',
    name: 'Stage Planet',
    color: '#88aaff',
    mass: 0.1,
    radius: 0.1,
    position: { x: 0.4005, y: 0, z: 0 },
    velocity: { x: -1, y: 0, z: 0 },
    bodyType: 'planet',
  }

  const dt = 0.0015
  const contactDistance = getCollisionContactDistance(star, planet)
  let frame = stepFragmentAwareBodies([star, planet], dt)
  let resolved = false
  let contactFrames = 0
  let sawVisibleOverlap = false

  for (let step = 0; step < 48; step += 1) {
    const bodyA = frame.find((body) => body.id === star.id)
    const bodyB = frame.find((body) => body.id === planet.id)

    if (bodyA && bodyB) {
      const flash = frame.find((body) => body.bodyType === 'effect' && body.name === 'Collision flash')
      assert(!flash, 'physical collision flash must not appear before the staged impact resolves')

      const separation = distance(bodyA, bodyB)
      assert(
        separation <= contactDistance + 1e-9,
        'staged impact must begin at contact instead of replaying a long pre-contact approach',
      )
      if (separation < contactDistance - 1e-6) sawVisibleOverlap = true

      contactFrames += 1
      frame = stepFragmentAwareBodies(frame, dt)
      continue
    }

    resolved = true
    const flash = frame.find((body) => body.bodyType === 'effect' && body.name === 'Collision flash')
    assert(flash, 'resolved staged collision must expose its physical flash on the result frame')
    break
  }

  assert(resolved, 'staged collision must resolve within its configured impact window')
  assert(
    contactFrames >= 25,
    'contact must remain visible for most of the 0.045 simulated-second impact window',
  )
  assert(sawVisibleOverlap, 'merge impact staging must visibly compress the colliders after contact')
}

const tests = [
  testContactDistanceUsesVisibleSurface,
  testFlashStartsAtImpactSurface,
  testHitAndRunSurvivorsDoNotOverlap,
  testStagedImpactKeepsCollidersVisibleBeforeResolution,
]

for (const test of tests) test()
console.log(`physics regression checks passed (${tests.length})`)
