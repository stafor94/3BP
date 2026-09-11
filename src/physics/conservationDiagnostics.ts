import type { BodyState, Vec3 } from '../types'

export type ConservationSnapshot = {
  totalMass: number
  linearMomentum: Vec3
}

/**
 * Summarize the conserved quantities represented by the current body list.
 *
 * Collision ejecta can be carried by either persistent fragments or transient
 * effect bodies. Count every body's mass here so diagnostics follow the engine's
 * represented collision mass instead of silently dropping mass-carrying effects.
 */
export function getConservationSnapshot(bodies: readonly BodyState[]): ConservationSnapshot {
  return bodies.reduce<ConservationSnapshot>(
    (snapshot, body) => ({
      totalMass: snapshot.totalMass + body.mass,
      linearMomentum: {
        x: snapshot.linearMomentum.x + body.velocity.x * body.mass,
        y: snapshot.linearMomentum.y + body.velocity.y * body.mass,
        z: snapshot.linearMomentum.z + body.velocity.z * body.mass,
      },
    }),
    {
      totalMass: 0,
      linearMomentum: { x: 0, y: 0, z: 0 },
    },
  )
}
