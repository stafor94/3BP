import { FRAGMENT_LIFETIME } from '../fragmentLifecycle'
import type { BodyState } from '../types'
import { stepBodies as stepPhysicsBodies } from './engine'

const COLLISION_SPARK_NAME = 'Collision spark'

export function stepBodies(input: BodyState[], dt: number): BodyState[] {
  const stepped = stepPhysicsBodies(input, dt)

  return stepped
    .map((body) => {
      if (body.bodyType === 'fragment') {
        return {
          ...body,
          age: (body.age ?? 0) + dt,
          lifetime: FRAGMENT_LIFETIME,
        }
      }

      if (body.bodyType === 'effect' && body.name === COLLISION_SPARK_NAME) {
        return {
          ...body,
          lifetime: FRAGMENT_LIFETIME,
        }
      }

      return body
    })
    .filter((body) => body.bodyType !== 'fragment' || (body.age ?? 0) < FRAGMENT_LIFETIME)
}
