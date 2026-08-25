import {
  getCollisionWatchRestoreSpeed,
  getCollisionWatchTimingProfile,
} from '../src/collisionWatchTiming'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const stellar = getCollisionWatchTimingProfile('star', 'star')
assert(stellar.isStellarCollision, 'star-star must use the stellar collision timing profile')
assert(stellar.impactHoldMs >= 800 && stellar.impactHoldMs <= 900, 'stellar impact hold must remain within 800-900ms')
assert(stellar.postImpactHoldMs >= 1500 && stellar.postImpactHoldMs <= 1800, 'stellar post-impact hold must remain within 1500-1800ms')
assert(stellar.cameraHoldMs !== stellar.impactHoldMs, 'camera hold must not be coupled to the impact-speed hold')

const fragment = getCollisionWatchTimingProfile('fragment', 'planet')
assert(fragment.impactHoldMs >= 350 && fragment.impactHoldMs <= 500, 'fragment impact hold must stay short')
assert(fragment.postImpactHoldMs >= 700 && fragment.postImpactHoldMs <= 1000, 'fragment post-impact hold must stay short')

const mixed = getCollisionWatchTimingProfile('star', 'planet')
assert(!mixed.isStellarCollision, 'star-planet must not use the star-star timing profile')
assert(mixed.impactHoldMs < stellar.impactHoldMs, 'star-planet slow motion must be shorter than star-star')

const start = 0.08
const target = 2
const duration = 650
assert(getCollisionWatchRestoreSpeed(start, target, 0, duration) === start, 'restore ramp must start at its captured speed')
const mid = getCollisionWatchRestoreSpeed(start, target, duration / 2, duration)
assert(mid > start && mid < target, 'restore ramp must interpolate instead of jumping')
assert(Math.abs(getCollisionWatchRestoreSpeed(start, target, duration, duration) - target) < 1e-12, 'restore ramp must end at the user speed')

console.log('collision watch timing regression: ok')
