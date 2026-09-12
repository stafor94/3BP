import type { StellarCollisionOutcome } from './types'

export const STELLAR_COLLISION_CONTACT_DURATION_SECONDS = {
  merge: 0.024,
  hitAndRun: 0.018,
  partialDisruption: 0.021,
} as const satisfies Record<StellarCollisionOutcome, number>

export const STELLAR_COLLISION_SETTLE_DURATION_SECONDS = 0.16
export const STELLAR_COLLISION_RELEASE_DURATION_SECONDS = 0.045
export const STELLAR_COLLISION_TRANSFER_SETTLE_SHARE = 0.75
export const STELLAR_COLLISION_TRANSFER_START = 0.14
export const STELLAR_COLLISION_TRANSFER_WINDOW = 0.78

export type StellarCollisionTimelineInput = {
  /** Simulation seconds accumulated from the first staged contact frame. */
  eventAgeSeconds: number
  /** Simulation seconds reserved for the contact/impact presentation bridge. */
  contactDurationSeconds: number
  /** Simulation seconds retained after the solver outcome becomes authoritative. */
  settleDurationSeconds?: number
}

export type StellarCollisionTimeline = {
  eventAgeSeconds: number
  contactDurationSeconds: number
  settleDurationSeconds: number
  totalDurationSeconds: number
  /** Simulation seconds since the authoritative physical result was revealed. */
  settleAgeSeconds: number
  contactProgress: number
  /** Existing transfer clock before the 0.14/0.78 shaping window is applied. */
  transferClockProgress: number
  transferProgress: number
  settleProgress: number
  releaseProgress: number
  isComplete: boolean
}

function finiteNonNegative(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0
  return Math.min(1, Math.max(0, value))
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function intervalProgress(elapsed: number, duration: number) {
  // A zero-length interval is complete at its start boundary. This keeps
  // instantaneous contact/settle configurations deterministic instead of
  // introducing division-by-zero or NaN progress.
  if (duration <= 0) return elapsed >= 0 ? 1 : 0
  return clamp01(elapsed / duration)
}

export function getStellarCollisionContactDurationSeconds(outcome: StellarCollisionOutcome) {
  return STELLAR_COLLISION_CONTACT_DURATION_SECONDS[outcome]
}

export function getStellarCollisionTimeline(
  input: StellarCollisionTimelineInput,
): StellarCollisionTimeline {
  const eventAgeSeconds = finiteNonNegative(input.eventAgeSeconds)
  const contactDurationSeconds = finiteNonNegative(input.contactDurationSeconds)
  const settleDurationSeconds = finiteNonNegative(
    input.settleDurationSeconds ?? STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
    STELLAR_COLLISION_SETTLE_DURATION_SECONDS,
  )
  const totalDurationSeconds = contactDurationSeconds + settleDurationSeconds
  const settleAgeSeconds = Math.max(0, eventAgeSeconds - contactDurationSeconds)
  const contactProgress = intervalProgress(eventAgeSeconds, contactDurationSeconds)
  const settleProgress = smooth01(intervalProgress(settleAgeSeconds, settleDurationSeconds))

  // Preserve the pre-existing envelope transfer timing. Material transfer can
  // begin during late contact and continue into early settle rather than being
  // forced into three strictly sequential phases.
  const transferDurationSeconds = contactDurationSeconds +
    settleDurationSeconds * STELLAR_COLLISION_TRANSFER_SETTLE_SHARE
  const transferClockProgress = intervalProgress(eventAgeSeconds, transferDurationSeconds)
  const transferProgress = smooth01(
    (transferClockProgress - STELLAR_COLLISION_TRANSFER_START) /
      STELLAR_COLLISION_TRANSFER_WINDOW,
  )
  const releaseProgress = smooth01(intervalProgress(
    settleAgeSeconds,
    STELLAR_COLLISION_RELEASE_DURATION_SECONDS,
  ))

  return {
    eventAgeSeconds,
    contactDurationSeconds,
    settleDurationSeconds,
    totalDurationSeconds,
    settleAgeSeconds,
    contactProgress,
    transferClockProgress,
    transferProgress,
    settleProgress,
    releaseProgress,
    isComplete: eventAgeSeconds >= totalDurationSeconds,
  }
}
