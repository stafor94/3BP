export const TRACKING_MIN_MASS_RATIO = 0.5
const TRACKING_MASS_EPSILON = 1e-12

/**
 * Ordinary user tracking is valid at exactly 50% of the mass captured when the
 * user started tracking. Only values strictly below that boundary disengage.
 */
export function isTrackingMassEligible(currentMass: number, initialMass: number) {
  const safeCurrentMass = Math.max(0, currentMass)
  const safeInitialMass = Math.max(0, initialMass)
  return safeCurrentMass + TRACKING_MASS_EPSILON >= safeInitialMass * TRACKING_MIN_MASS_RATIO
}
