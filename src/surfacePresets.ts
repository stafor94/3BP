import type { AtmospherePresetId, BodyState, BodyType, SurfacePresetId } from './types'

export type SurfacePresetProfile = {
  id: SurfacePresetId
  category: 'planet' | 'moon' | 'fragment'
  nameKo: string
  nameEn: string
  baseColor: string
  secondaryColor: string
  polarTint: string
  detailStrength: number
  bandStrength: number
  craterStrength: number
  cloudStrength: number
  specularStrength: number
  specularPower: number
  ambientStrength: number
  terminatorPower: number
  atmosphereStrength: number
  defaultAtmosphere: AtmospherePresetId
}

export type AtmospherePresetProfile = {
  id: AtmospherePresetId
  nameKo: string
  nameEn: string
  strengthMultiplier: number
}

export const SURFACE_PRESETS: readonly SurfacePresetProfile[] = [
  { id: 'rockyMercuryLike', category: 'planet', nameKo: '수성형 암석', nameEn: 'Mercury-like rocky', baseColor: '#8e8378', secondaryColor: '#5f5954', polarTint: '#aca297', detailStrength: 1.15, bandStrength: 0.02, craterStrength: 0.82, cloudStrength: 0, specularStrength: 0.02, specularPower: 22, ambientStrength: 0.038, terminatorPower: 1.08, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'venusLike', category: 'planet', nameKo: '금성형 황색 구름', nameEn: 'Venus-like', baseColor: '#d7a95a', secondaryColor: '#9d6f36', polarTint: '#ead4a0', detailStrength: 0.82, bandStrength: 0.32, craterStrength: 0.04, cloudStrength: 0.62, specularStrength: 0.055, specularPower: 34, ambientStrength: 0.06, terminatorPower: 0.86, atmosphereStrength: 0.12, defaultAtmosphere: 'venusHaze' },
  { id: 'earthLike', category: 'planet', nameKo: '지구형 해양·대륙', nameEn: 'Earth-like', baseColor: '#1e5f91', secondaryColor: '#4f7d3f', polarTint: '#e8edf1', detailStrength: 1.0, bandStrength: 0.08, craterStrength: 0.03, cloudStrength: 0.52, specularStrength: 0.14, specularPower: 46, ambientStrength: 0.055, terminatorPower: 0.9, atmosphereStrength: 0.1, defaultAtmosphere: 'earthLike' },
  { id: 'marsLike', category: 'planet', nameKo: '화성형 적갈색', nameEn: 'Mars-like', baseColor: '#a84f2f', secondaryColor: '#d28a54', polarTint: '#e4d4c3', detailStrength: 1.12, bandStrength: 0.06, craterStrength: 0.38, cloudStrength: 0.02, specularStrength: 0.018, specularPower: 20, ambientStrength: 0.04, terminatorPower: 1.02, atmosphereStrength: 0.018, defaultAtmosphere: 'thin' },
  { id: 'gasGiantJupiterLike', category: 'planet', nameKo: '목성형 가스 거성', nameEn: 'Jupiter-like gas giant', baseColor: '#d7b184', secondaryColor: '#995f3d', polarTint: '#ead8b8', detailStrength: 0.78, bandStrength: 0.92, craterStrength: 0, cloudStrength: 0.34, specularStrength: 0.05, specularPower: 30, ambientStrength: 0.06, terminatorPower: 0.82, atmosphereStrength: 0.08, defaultAtmosphere: 'gasGiant' },
  { id: 'gasGiantSaturnLike', category: 'planet', nameKo: '토성형 가스 거성', nameEn: 'Saturn-like gas giant', baseColor: '#d8c18c', secondaryColor: '#ad8c59', polarTint: '#ece1bd', detailStrength: 0.68, bandStrength: 0.74, craterStrength: 0, cloudStrength: 0.24, specularStrength: 0.045, specularPower: 28, ambientStrength: 0.062, terminatorPower: 0.82, atmosphereStrength: 0.075, defaultAtmosphere: 'gasGiant' },
  { id: 'iceGiantUranusLike', category: 'planet', nameKo: '천왕성형 얼음 거성', nameEn: 'Uranus-like ice giant', baseColor: '#86c9ca', secondaryColor: '#6da7b0', polarTint: '#c5e6e5', detailStrength: 0.52, bandStrength: 0.24, craterStrength: 0, cloudStrength: 0.13, specularStrength: 0.055, specularPower: 34, ambientStrength: 0.062, terminatorPower: 0.84, atmosphereStrength: 0.085, defaultAtmosphere: 'iceGiant' },
  { id: 'iceGiantNeptuneLike', category: 'planet', nameKo: '해왕성형 얼음 거성', nameEn: 'Neptune-like ice giant', baseColor: '#285ea8', secondaryColor: '#477fd0', polarTint: '#8db8e7', detailStrength: 0.7, bandStrength: 0.4, craterStrength: 0, cloudStrength: 0.22, specularStrength: 0.06, specularPower: 36, ambientStrength: 0.055, terminatorPower: 0.88, atmosphereStrength: 0.09, defaultAtmosphere: 'iceGiant' },
  { id: 'lavaWorld', category: 'planet', nameKo: '용암 세계', nameEn: 'Lava world', baseColor: '#4e211d', secondaryColor: '#d95021', polarTint: '#7d3326', detailStrength: 1.18, bandStrength: 0.03, craterStrength: 0.26, cloudStrength: 0, specularStrength: 0.035, specularPower: 24, ambientStrength: 0.048, terminatorPower: 1.0, atmosphereStrength: 0.025, defaultAtmosphere: 'thin' },
  { id: 'desertWorld', category: 'planet', nameKo: '사막 세계', nameEn: 'Desert world', baseColor: '#bd8c4d', secondaryColor: '#e0bd78', polarTint: '#d8c7a1', detailStrength: 1.0, bandStrength: 0.08, craterStrength: 0.18, cloudStrength: 0.03, specularStrength: 0.02, specularPower: 22, ambientStrength: 0.045, terminatorPower: 1, atmosphereStrength: 0.025, defaultAtmosphere: 'thin' },
  { id: 'oceanWorld', category: 'planet', nameKo: '해양 세계', nameEn: 'Ocean world', baseColor: '#174d7d', secondaryColor: '#267ca6', polarTint: '#d7eff4', detailStrength: 0.76, bandStrength: 0.1, craterStrength: 0, cloudStrength: 0.46, specularStrength: 0.18, specularPower: 54, ambientStrength: 0.052, terminatorPower: 0.9, atmosphereStrength: 0.09, defaultAtmosphere: 'earthLike' },
  { id: 'iceWorld', category: 'planet', nameKo: '얼음 세계', nameEn: 'Ice world', baseColor: '#9fc7d2', secondaryColor: '#6b94a8', polarTint: '#eef7f8', detailStrength: 0.9, bandStrength: 0.05, craterStrength: 0.34, cloudStrength: 0.04, specularStrength: 0.1, specularPower: 42, ambientStrength: 0.05, terminatorPower: 0.98, atmosphereStrength: 0.025, defaultAtmosphere: 'thin' },
  { id: 'lunarGray', category: 'moon', nameKo: '달형 회색', nameEn: 'Lunar gray', baseColor: '#8d8982', secondaryColor: '#625f5b', polarTint: '#aaa59e', detailStrength: 1.2, bandStrength: 0, craterStrength: 0.92, cloudStrength: 0, specularStrength: 0.015, specularPower: 18, ambientStrength: 0.035, terminatorPower: 1.08, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'ioVolcanic', category: 'moon', nameKo: '이오형 화산', nameEn: 'Io volcanic', baseColor: '#d4b33d', secondaryColor: '#9b4b2c', polarTint: '#efe094', detailStrength: 1.05, bandStrength: 0.05, craterStrength: 0.18, cloudStrength: 0, specularStrength: 0.018, specularPower: 18, ambientStrength: 0.04, terminatorPower: 1.04, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'europaIcy', category: 'moon', nameKo: '유로파형 얼음', nameEn: 'Europa icy', baseColor: '#c6b89a', secondaryColor: '#8b7665', polarTint: '#edf1e9', detailStrength: 0.98, bandStrength: 0.04, craterStrength: 0.18, cloudStrength: 0, specularStrength: 0.065, specularPower: 34, ambientStrength: 0.042, terminatorPower: 1, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'ganymedeMixed', category: 'moon', nameKo: '가니메데형 혼합 지형', nameEn: 'Ganymede mixed', baseColor: '#83796d', secondaryColor: '#b0a28d', polarTint: '#cbc6ba', detailStrength: 1.16, bandStrength: 0.02, craterStrength: 0.68, cloudStrength: 0, specularStrength: 0.02, specularPower: 20, ambientStrength: 0.038, terminatorPower: 1.06, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'callistoCratered', category: 'moon', nameKo: '칼리스토형 충돌구', nameEn: 'Callisto cratered', baseColor: '#5c5148', secondaryColor: '#8b7b68', polarTint: '#9f9688', detailStrength: 1.25, bandStrength: 0, craterStrength: 1, cloudStrength: 0, specularStrength: 0.012, specularPower: 16, ambientStrength: 0.032, terminatorPower: 1.1, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'titanHazy', category: 'moon', nameKo: '타이탄형 안개', nameEn: 'Titan hazy', baseColor: '#b8732f', secondaryColor: '#d49a47', polarTint: '#e0b46a', detailStrength: 0.6, bandStrength: 0.18, craterStrength: 0.04, cloudStrength: 0.3, specularStrength: 0.025, specularPower: 24, ambientStrength: 0.05, terminatorPower: 0.92, atmosphereStrength: 0.11, defaultAtmosphere: 'titanHaze' },
  { id: 'enceladusBrightIce', category: 'moon', nameKo: '엔셀라두스형 밝은 얼음', nameEn: 'Enceladus bright ice', baseColor: '#d9e4e5', secondaryColor: '#a6c1c8', polarTint: '#f6fbfb', detailStrength: 0.92, bandStrength: 0.02, craterStrength: 0.38, cloudStrength: 0, specularStrength: 0.11, specularPower: 44, ambientStrength: 0.05, terminatorPower: 0.98, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'rockyBrown', category: 'moon', nameKo: '갈색 암석 위성', nameEn: 'Rocky brown', baseColor: '#735944', secondaryColor: '#9b7758', polarTint: '#aa9279', detailStrength: 1.18, bandStrength: 0, craterStrength: 0.74, cloudStrength: 0, specularStrength: 0.014, specularPower: 17, ambientStrength: 0.034, terminatorPower: 1.08, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'charcoalCratered', category: 'moon', nameKo: '숯빛 충돌구 위성', nameEn: 'Charcoal cratered', baseColor: '#403d3b', secondaryColor: '#67615c', polarTint: '#7a7570', detailStrength: 1.28, bandStrength: 0, craterStrength: 1, cloudStrength: 0, specularStrength: 0.01, specularPower: 15, ambientStrength: 0.03, terminatorPower: 1.12, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'darkCarbonaceous', category: 'fragment', nameKo: '탄소질 암흑 파편', nameEn: 'Dark carbonaceous', baseColor: '#332f2b', secondaryColor: '#554a40', polarTint: '#635b54', detailStrength: 1.32, bandStrength: 0, craterStrength: 0.88, cloudStrength: 0, specularStrength: 0.008, specularPower: 12, ambientStrength: 0.024, terminatorPower: 1.14, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'stonySilicate', category: 'fragment', nameKo: '규산염 암석 파편', nameEn: 'Stony silicate', baseColor: '#76685b', secondaryColor: '#9a8570', polarTint: '#a99c8e', detailStrength: 1.3, bandStrength: 0, craterStrength: 0.78, cloudStrength: 0, specularStrength: 0.012, specularPower: 15, ambientStrength: 0.026, terminatorPower: 1.12, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'metallicIron', category: 'fragment', nameKo: '철질 금속 파편', nameEn: 'Metallic iron', baseColor: '#696a6b', secondaryColor: '#9c958c', polarTint: '#b7b2ab', detailStrength: 1.16, bandStrength: 0, craterStrength: 0.58, cloudStrength: 0, specularStrength: 0.22, specularPower: 52, ambientStrength: 0.03, terminatorPower: 1.08, atmosphereStrength: 0, defaultAtmosphere: 'none' },
  { id: 'icyDebris', category: 'fragment', nameKo: '얼음 파편', nameEn: 'Icy debris', baseColor: '#a8c6cf', secondaryColor: '#d7e5e8', polarTint: '#eff7f8', detailStrength: 1.1, bandStrength: 0, craterStrength: 0.5, cloudStrength: 0, specularStrength: 0.14, specularPower: 46, ambientStrength: 0.034, terminatorPower: 1.04, atmosphereStrength: 0, defaultAtmosphere: 'none' },
] as const

export const ATMOSPHERE_PRESETS: readonly AtmospherePresetProfile[] = [
  { id: 'none', nameKo: '없음', nameEn: 'None', strengthMultiplier: 0 },
  { id: 'thin', nameKo: '희박 대기', nameEn: 'Thin', strengthMultiplier: 0.55 },
  { id: 'earthLike', nameKo: '지구형 대기', nameEn: 'Earth-like', strengthMultiplier: 1 },
  { id: 'venusHaze', nameKo: '금성형 두꺼운 안개', nameEn: 'Venus haze', strengthMultiplier: 1.35 },
  { id: 'titanHaze', nameKo: '타이탄형 안개', nameEn: 'Titan haze', strengthMultiplier: 1.2 },
  { id: 'gasGiant', nameKo: '가스 거성 상층', nameEn: 'Gas giant', strengthMultiplier: 0.9 },
  { id: 'iceGiant', nameKo: '얼음 거성 상층', nameEn: 'Ice giant', strengthMultiplier: 1 },
] as const

const SURFACE_PRESET_BY_ID = Object.fromEntries(
  SURFACE_PRESETS.map((preset) => [preset.id, preset]),
) as Record<SurfacePresetId, SurfacePresetProfile>

const ATMOSPHERE_PRESET_BY_ID = Object.fromEntries(
  ATMOSPHERE_PRESETS.map((preset) => [preset.id, preset]),
) as Record<AtmospherePresetId, AtmospherePresetProfile>

export function getSurfacePreset(id: SurfacePresetId | undefined) {
  return id ? SURFACE_PRESET_BY_ID[id] : undefined
}

export function getAtmospherePreset(id: AtmospherePresetId | undefined) {
  return id ? ATMOSPHERE_PRESET_BY_ID[id] : ATMOSPHERE_PRESET_BY_ID.none
}

export function getSurfacePresetsForBodyType(type: BodyType) {
  const category = type === 'planet' ? 'planet' : type === 'moon' ? 'moon' : 'fragment'
  return SURFACE_PRESETS.filter((preset) => preset.category === category)
}

export function getDefaultSurfacePresetId(body: Pick<BodyState, 'name' | 'mass'>, type: BodyType): SurfacePresetId {
  const name = body.name.toLowerCase()

  if (type === 'planet') {
    if (/ember|cinder|mars/.test(name)) return 'marsLike'
    if (/cobalt|ocean/.test(name)) return 'oceanWorld'
    if (/boreal|neptune/.test(name)) return 'iceGiantNeptuneLike'
    if (/janus|jupiter/.test(name)) return 'gasGiantJupiterLike'
    if (/atlas|earth|terra/.test(name)) return 'earthLike'
    if (/swift|mercur/.test(name)) return 'rockyMercuryLike'
    if (body.mass >= 0.28) return 'gasGiantJupiterLike'
    if (body.mass >= 0.08) return 'earthLike'
    return 'marsLike'
  }

  if (type === 'moon') {
    if (/echo|europa/.test(name)) return 'europaIcy'
    if (/nereid|encelad/.test(name)) return 'enceladusBrightIce'
    if (/nyx/.test(name)) return 'charcoalCratered'
    if (/titan/.test(name)) return 'titanHazy'
    if (/io/.test(name)) return 'ioVolcanic'
    return 'lunarGray'
  }

  if (/ice|frost/.test(name)) return 'icyDebris'
  if (/metal|iron/.test(name)) return 'metallicIron'
  return 'stonySilicate'
}

export function getResolvedSurfaceProfile(body: BodyState, type: BodyType): SurfacePresetProfile {
  const requested = getSurfacePreset(body.surfacePresetId)
  if (requested && requested.category === (type === 'planet' ? 'planet' : type === 'moon' ? 'moon' : 'fragment')) {
    return requested
  }
  return SURFACE_PRESET_BY_ID[getDefaultSurfacePresetId(body, type)]
}
