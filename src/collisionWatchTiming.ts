import type { BodyType } from './types'

export const COLLISION_WATCH_APPROACH_SPEED = 0.1
export const COLLISION_WATCH_IMPACT_SPEED = 0.03
export const COLLISION_WATCH_POST_IMPACT_SPEED = 0.08

export type CollisionWatchPhase = 'approach' | 'impact' | 'postImpact' | 'restoring'
export type CollisionWatchCollisionType = 'stellar' | 'stellarMixed' | 'standard' | 'fragment'

export type CollisionWatchTimingProfile = {
  collisionType: CollisionWatchCollisionType
  isStellarCollision: boolean
  impactHoldMs: number
  postImpactHoldMs: number
  restoreRampMs: number
  cameraHoldMs: number
  infoHoldMs: number
}

// These durations are wall-clock presentation timings. They intentionally do not
// scale with simulation time, and camera/info lifetimes remain independent from speed phases.
export function getCollisionWatchTimingProfile(
  bodyAType: BodyType,
  bodyBType: BodyType,
): CollisionWatchTimingProfile {
  const isStellarCollision = bodyAType === 'star' && bodyBType === 'star'
  if (isStellarCollision) {
    return {
      collisionType: 'stellar',
      isStellarCollision: true,
      impactHoldMs: 850,
      postImpactHoldMs: 1650,
      restoreRampMs: 700,
      cameraHoldMs: 2800,
      infoHoldMs: 2500,
    }
  }

  const hasFragment = bodyAType === 'fragment' || bodyBType === 'fragment'
  if (hasFragment) {
    return {
      collisionType: 'fragment',
      isStellarCollision: false,
      impactHoldMs: 425,
      postImpactHoldMs: 800,
      restoreRampMs: 550,
      cameraHoldMs: 1450,
      infoHoldMs: 1300,
    }
  }

  const hasStar = bodyAType === 'star' || bodyBType === 'star'
  if (hasStar) {
    return {
      collisionType: 'stellarMixed',
      isStellarCollision: false,
      impactHoldMs: 700,
      postImpactHoldMs: 1400,
      restoreRampMs: 750,
      cameraHoldMs: 2850,
      infoHoldMs: 2600,
    }
  }

  return {
    collisionType: 'standard',
    isStellarCollision: false,
    impactHoldMs: 1200,
    postImpactHoldMs: 2500,
    restoreRampMs: 1000,
    cameraHoldMs: 5000,
    infoHoldMs: 4600,
  }
}

export function getCollisionWatchRestoreSpeed(
  startSpeed: number,
  targetSpeed: number,
  elapsedMs: number,
  durationMs: number,
) {
  if (durationMs <= 0) return targetSpeed
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs))
  const eased = 1 - Math.pow(1 - t, 3)
  return startSpeed + (targetSpeed - startSpeed) * eased
}
