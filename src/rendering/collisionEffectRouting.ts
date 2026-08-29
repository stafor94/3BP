
import type { BodyState } from '../types'
import { getCollisionPresentationContactBodies } from './collisionPresentationContact'
import { applyCollisionFragmentVisualMotion } from './fragmentVisualMotion'
import { getCollisionSolidHandoffRenderBodies } from './collisionSolidHandoff'

/**
 * Collision effect bodies are render instructions for the dedicated VFX layers.
 * Sending them through the ordinary celestial-body renderer gives them sphere
 * geometry and body glows, which makes a transient impact read like a newly
 * spawned celestial object.
 *
 * Keep the physical simulation state untouched and expose only physical bodies
 * (including real collision fragments) to the ordinary body renderer. Transient
 * fragment motion is presentation-only: it reads the matching contact flash and
 * returns render clones with a short normal-biased burst without changing the
 * simulation positions, velocities, momentum, or collision decisions. The
 * collision solid handoff may add presentation-only source silhouettes after a
 * physical 2->1 merge; those never re-enter the simulation/physics body array.
 */
export function getCelestialBodyRenderBodies(bodies: BodyState[]) {
  const solidRenderBodies = getCollisionSolidHandoffRenderBodies(
    getCollisionPresentationContactBodies(
      bodies.filter((body) => body.bodyType !== 'effect'),
    ),
  )
  return applyCollisionFragmentVisualMotion(solidRenderBodies, bodies)
}
