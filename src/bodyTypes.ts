import type { BodyState, BodyType, PresetId } from './types'

export type UserBodyType = Extract<BodyType, 'star' | 'planet' | 'moon'>

export const USER_BODY_TYPES: UserBodyType[] = ['star', 'planet', 'moon']

const PRESET_BODY_TYPES: Record<PresetId, UserBodyType[]> = {
  singleDrift: ['star'],
  binaryOrbit: ['star', 'star'],
  binaryEllipse: ['star', 'star'],
  binaryUnequal: ['star', 'star'],
  binaryWide: ['star', 'star'],
  binaryInclined: ['star', 'star'],
  binaryTight: ['star', 'star'],
  figure8: ['star', 'star', 'star'],
  hierarchical: ['star', 'planet', 'planet'],
  circumbinary: ['star', 'star', 'planet'],
  trojan: ['star', 'planet', 'moon'],
  planetary: ['star', 'planet', 'planet'],
  random: ['star', 'planet', 'planet'],
  quadCrown: ['star', 'star', 'planet', 'moon'],
  quadNested: ['star', 'planet', 'moon', 'planet'],
  quadCrossed: ['star', 'planet', 'planet', 'planet'],
  quadDance: ['star', 'star', 'star', 'star'],
  pentaCrown: ['star', 'star', 'planet', 'moon', 'moon'],
  pentaNested: ['star', 'planet', 'moon', 'moon', 'planet'],
  pentaCrossed: ['star', 'planet', 'moon', 'moon', 'planet'],
  pentaDance: ['star', 'star', 'star', 'star', 'star'],
  hexaCrown: ['star', 'star', 'planet', 'moon', 'moon', 'planet'],
  hexaNested: ['star', 'planet', 'moon', 'moon', 'planet', 'moon'],
  hexaCrossed: ['star', 'planet', 'moon', 'planet', 'planet', 'planet'],
  hexaDance: ['star', 'star', 'star', 'star', 'star', 'star'],
}

export function inferUserBodyType(body: BodyState): UserBodyType {
  const name = body.name.toLowerCase()
  if (/moon|luna|selene|nereid|echo|trojan|satellite/.test(name)) return 'moon'
  if (/planet|atlas|janus|boreal|swift|cobalt|ember|cinder|inner|outer/.test(name)) return 'planet'
  if (/star|helios|aurelia|vesper|primary/.test(name)) return 'star'
  if (body.mass >= 0.75) return 'star'
  if (body.mass >= 0.01) return 'planet'
  return 'moon'
}

export function getEffectiveBodyType(body: BodyState): BodyType {
  return body.bodyType ?? inferUserBodyType(body)
}

export function applyPresetBodyTypes(id: PresetId, bodies: BodyState[]): BodyState[] {
  const mappedTypes = PRESET_BODY_TYPES[id]
  return bodies.map((body, index) => ({
    ...body,
    bodyType: mappedTypes[index] ?? inferUserBodyType(body),
  }))
}
