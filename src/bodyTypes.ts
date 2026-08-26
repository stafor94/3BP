import { withComputedStellarState } from './starColors'
import { getResolvedSurfaceProfile } from './surfacePresets'
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

const PRESET_STAR_PHASES: Partial<Record<PresetId, number[]>> = {
  singleDrift: [0.5],
  binaryOrbit: [0.42, 0.58],
  binaryEllipse: [0.35, 0.65],
  binaryUnequal: [0.38, 0.68],
  binaryWide: [0.46, 0.54],
  binaryInclined: [0.44, 0.56],
  binaryTight: [0.4, 0.6],
  figure8: [0.32, 0.5, 0.68],
  hierarchical: [0.48],
  circumbinary: [0.38, 0.62],
  trojan: [0.46],
  planetary: [0.48],
  random: [0.5],
  quadCrown: [0.38, 0.58],
  quadNested: [0.46],
  quadCrossed: [0.5],
  quadDance: [0.28, 0.42, 0.58, 0.72],
  pentaCrown: [0.36, 0.6],
  pentaNested: [0.46],
  pentaCrossed: [0.48],
  pentaDance: [0.24, 0.36, 0.5, 0.64, 0.76],
  hexaCrown: [0.34, 0.6],
  hexaNested: [0.44],
  hexaCrossed: [0.46],
  hexaDance: [0.2, 0.32, 0.44, 0.56, 0.68, 0.8],
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

function defaultStellarPhase(body: BodyState, index: number) {
  if (body.mass >= 8) return 0.34 + (index % 3) * 0.08
  if (body.mass >= 3) return 0.42 + (index % 2) * 0.08
  return 0.5
}

export function normalizeBodyForType(
  body: BodyState,
  type: BodyType,
  stellarPhase01?: number,
): BodyState {
  if (type === 'star') {
    return withComputedStellarState({
      ...body,
      bodyType: 'star',
      stellarEvolutionStage: body.stellarEvolutionStage ?? 'mainSequence',
      stellarEvolutionPhase01: body.stellarEvolutionPhase01 ?? stellarPhase01 ?? 0.5,
      stellarRadiusScale: body.stellarRadiusScale ?? 1,
      surfacePresetId: undefined,
      surfaceVariant01: undefined,
      atmospherePresetId: undefined,
    })
  }

  if (type === 'planet' || type === 'moon' || type === 'fragment') {
    const typedBody: BodyState = {
      ...body,
      bodyType: type,
      stellarEvolutionStage: undefined,
      stellarEvolutionPhase01: undefined,
      stellarRadiusScale: undefined,
      stellarTemperatureK: undefined,
      surfaceVariant01: body.surfaceVariant01 ?? 0.5,
    }
    const profile = getResolvedSurfaceProfile(typedBody, type)
    return {
      ...typedBody,
      color: profile.baseColor,
      surfacePresetId: profile.id,
      atmospherePresetId: type === 'planet'
        ? body.atmospherePresetId ?? profile.defaultAtmosphere
        : profile.defaultAtmosphere,
    }
  }

  return { ...body, bodyType: type }
}

export function hydrateBodyVisualState(body: BodyState): BodyState {
  return normalizeBodyForType(body, getEffectiveBodyType(body))
}

export function applyPresetBodyTypes(id: PresetId, bodies: BodyState[]): BodyState[] {
  const mappedTypes = PRESET_BODY_TYPES[id]
  const starPhases = PRESET_STAR_PHASES[id] ?? []
  let starIndex = 0

  return bodies.map((body, index) => {
    const type = mappedTypes[index] ?? inferUserBodyType(body)
    const phase = type === 'star'
      ? starPhases[starIndex] ?? defaultStellarPhase(body, starIndex)
      : undefined
    if (type === 'star') starIndex += 1
    return normalizeBodyForType(body, type, phase)
  })
}
