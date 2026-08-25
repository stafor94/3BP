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
      impactHoldMs: 500,
      postImpactHoldMs: 1000,
      restoreRampMs: 600,
      cameraHoldMs: 1750,
      infoHoldMs: 1600,
    }
  }

  return {
    collisionType: 'standard',
    isStellarCollision: false,
    impactHoldMs: 550,
    postImpactHoldMs: 1000,
    restoreRampMs: 600,
    cameraHoldMs: 1800,
    infoHoldMs: 1650,
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
