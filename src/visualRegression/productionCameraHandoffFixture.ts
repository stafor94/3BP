import type { BodyState } from '../types'

const FIXTURE_QUERY_VALUE = 'fast-moving-remnant'

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

export function getProductionCameraHandoffFixture(): BodyState[] | null {
  const query = new URLSearchParams(window.location.search)
  if (query.get('production-camera-fixture') !== FIXTURE_QUERY_VALUE) return null

  // Equal masses preserve both source tracking continuations. The shared +X
  // velocity makes the real merged remnant continue moving while the App's
  // collision-watch timers release the camera and restore the requested 3x speed.
  return [
    makeBody('handoff-a', 'Handoff A', -1.15, 3.35, '#f0aa68'),
    makeBody('handoff-b', 'Handoff B', 1.15, 2.65, '#83afff'),
  ]
}
