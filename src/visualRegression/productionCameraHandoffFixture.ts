import { getPreset } from '../presets'
import type { BodyState, BodyType } from '../types'

const FIXTURE_QUERY_VALUE = 'fast-moving-remnant'
const STELLAR_FIXTURE_QUERY = 'production-stellar-fixture'
const FINAL_HELIOS_FIXTURE_QUERY_VALUE = 'helios-final'

export const FINAL_HELIOS_VOLUME = 0.017264
export const FINAL_HELIOS_RADIUS = Math.cbrt(FINAL_HELIOS_VOLUME)

const STELLAR_FIXTURES = {
  cool: { mass: 0.35, name: 'Pass 5 Cool Star' },
  solar: { mass: 1, name: 'Pass 5 Solar Star' },
  hot: { mass: 8, name: 'Pass 5 Hot Star' },
} as const

const FINAL_HELIOS_BODY_TYPES: BodyType[] = ['star', 'planet', 'moon', 'planet']

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

function makeFinalHeliosFixture(): BodyState[] {
  // Reuse the real production quadNested initial state so companion IDs/seeds,
  // masses, orbital positions and velocities are not reimplemented in the visual
  // test. Only the Helios radius is replaced with the exact radius represented by
  // the historical issue volume. The physics engine defines volume as radius^3.
  return getPreset('quadNested').map((body, index) => ({
    ...body,
    name: index === 0 ? 'Helios' : body.name,
    radius: index === 0 ? FINAL_HELIOS_RADIUS : body.radius,
    bodyType: FINAL_HELIOS_BODY_TYPES[index],
    position: { ...body.position },
    velocity: { ...body.velocity },
  }))
}

export function getProductionCameraHandoffFixture(): BodyState[] | null {
  const query = new URLSearchParams(window.location.search)
  const stellarFixture = query.get(STELLAR_FIXTURE_QUERY)
  if (stellarFixture === FINAL_HELIOS_FIXTURE_QUERY_VALUE) {
    // Final Pass 6 reproduction: real App/SimulationView/renderer/tracking UI,
    // with the production multi-body orbital preset around the historical 8 M☉
    // Helios radius. No test-only renderer or stellar material is introduced.
    return makeFinalHeliosFixture()
  }
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
