export const FRAGMENT_TRAIL_TIME = 2
export const FRAGMENT_FADE_TIME = 3
export const FRAGMENT_LIFETIME = FRAGMENT_TRAIL_TIME + FRAGMENT_FADE_TIME

export function getFragmentOpacity(age = 0) {
  if (age <= FRAGMENT_TRAIL_TIME) return 1
  if (age >= FRAGMENT_LIFETIME) return 0

  const progress = (age - FRAGMENT_TRAIL_TIME) / FRAGMENT_FADE_TIME
  const smoothProgress = progress * progress * (3 - 2 * progress)
  return 1 - smoothProgress
}
