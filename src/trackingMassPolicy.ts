export const TRACKING_MIN_MASS_RATIO = 0.5
const TRACKING_MASS_EPSILON = 1e-12

export function isTrackingMassEligible(currentMass: number, initialMass: number) {
  const safeCurrentMass = Math.max(0, currentMass)
  const safeInitialMass = Math.max(0, initialMass)
  return safeCurrentMass + TRACKING_MASS_EPSILON >= safeInitialMass * TRACKING_MIN_MASS_RATIO
}
