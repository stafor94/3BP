import type { BodyState } from '../types'

const FIXTURE_QUERY_VALUE = 'fast-moving-remnant'
const STELLAR_FIXTURE_QUERY = 'production-stellar-fixture'

const STELLAR_FIXTURES = {
  cool: { mass: 0.35, name: 'Pass 5 Cool Star' },
  solar: { mass: 1, name: 'Pass 5 Solar Star' },
  hot: { mass: 8, name: 'Pass 5 Hot Star' },
} as const

type StellarFixtureKey = keyof typeof STELLAR_FIXTURES

function makeBody(
  id: string,
  name: string,
  positionX: number,
  velocityX: number,
  color: string,
): BodyState {
  return {
    id,
    name,
    mass: 0.4013,
    radius: 0.0754,
    position: { x: positionX, y: 0, z: 0 },
    velocity: { x: velocityX, y: 0, z: 0 },
    color,
    bodyType: 'planet',
  }
}

function isStellarFixtureKey(value: string | null): value is StellarFixtureKey {
  return value === 'cool' || value === 'solar' || value === 'hot'
}

function makeProductionStellarFixture(key: StellarFixtureKey): BodyState {
  const fixture = STELLAR_FIXTURES[key]
  return {
    id: `pass5-star-${key}`,
    name: fixture.name,
    mass: fixture.mass,
    // Match the ordinary single-body production preset radius. Tracking-camera
    // framing then determines screen size exactly as it does in normal play.
    radius: 0.09,
    position: { x: -1.2, y: -0.45, z: 0 },
    velocity: { x: 0.42, y: 0.16, z: 0 },
    color: '#ffffff',
    bodyType: 'star',
  }
}

export function getProductionCameraHandoffFixture(): BodyState[] | null {
  const query = new URLSearchParams(window.location.search)
  const stellarFixture = query.get(STELLAR_FIXTURE_QUERY)
  if (isStellarFixtureKey(stellarFixture)) {
    // Test setup only: the real App, SimulationView, renderer, tracking rail and
    // OrbitControls remain in use. No alternate stellar rendering path exists.
    return [makeProductionStellarFixture(stellarFixture)]
  }

  if (query.get('production-camera-fixture') !== FIXTURE_QUERY_VALUE) return null

  // Equal masses preserve both source tracking continuations. The shared +X
  // velocity makes the real merged remnant continue moving while the App's
  // collision-watch timers release the camera and restore the requested 3x speed.
  return [
    makeBody('handoff-a', 'Handoff A', -1.15, 3.35, '#f0aa68'),
    makeBody('handoff-b', 'Handoff B', 1.15, 2.65, '#83afff'),
  ]
}
