import type { BodyState } from '../types'

/**
 * Collision effect bodies are render instructions for the dedicated VFX layers.
 * Sending them through the ordinary celestial-body renderer gives them sphere
 * geometry and body glows, which makes a transient impact read like a newly
 * spawned celestial object.
 *
 * Keep the physical simulation state untouched and expose only physical bodies
 * (including real collision fragments) to the ordinary body renderer.
 */
export function getCelestialBodyRenderBodies(bodies: BodyState[]) {
  return bodies.filter((body) => body.bodyType !== 'effect')
}
