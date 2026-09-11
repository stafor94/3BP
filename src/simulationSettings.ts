import { DEFAULT_PRESET_BY_BODY_COUNT, PRESETS_BY_BODY_COUNT, getPresetBodyCount } from './presets'
import type { BodyCount, PresetId, SpaceMode } from './types'

export const BODY_SCALE_OPTIONS = [
  0.25,
  0.5,
  0.75,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  2,
  3,
  5,
] as const

export const TRAIL_DURATION_MIN = 1
export const TRAIL_DURATION_MAX = 20
export const DEFAULT_TRAIL_DURATION = 10

export const INITIAL_SETTINGS_STORAGE_KEYS = {
  trailEnabled: '3bp-trail-enabled',
  trailDuration: '3bp-trail-duration',
  spaceMode: '3bp-space-mode',
  bodyCount: '3bp-body-count',
  preset: '3bp-preset',
} as const

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type StoredInitialSetup = {
  spaceMode: SpaceMode
  bodyCount: BodyCount
  preset: PresetId
  trailEnabled: boolean
  trailDuration: number
}

function isBodyCount(value: number): value is BodyCount {
  return Number.isInteger(value) && value >= 1 && value <= 6
}

function isPresetId(value: string | null): value is PresetId {
  if (!value) return false
  return Object.values(PRESETS_BY_BODY_COUNT).some((items) =>
    items.some((preset) => preset === value),
  )
}

export function normalizeTrailDuration(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_TRAIL_DURATION
  return Math.min(TRAIL_DURATION_MAX, Math.max(TRAIL_DURATION_MIN, Math.round(value)))
}

export function normalizeBodyScale(value: number) {
  if (!Number.isFinite(value)) return 1

  return BODY_SCALE_OPTIONS.reduce((closest, option) =>
    Math.abs(option - value) < Math.abs(closest - value) ? option : closest,
  )
}

export function getStoredInitialSetup(storage: StorageLike = localStorage): StoredInitialSetup {
  const spaceMode: SpaceMode = storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.spaceMode) === '2d'
    ? '2d'
    : '3d'

  const savedPresetValue = storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.preset)
  const savedPreset = isPresetId(savedPresetValue) ? savedPresetValue : null

  const savedBodyCount = Number(storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.bodyCount))
  const bodyCount: BodyCount = isBodyCount(savedBodyCount)
    ? savedBodyCount
    : savedPreset
      ? getPresetBodyCount(savedPreset)
      : 3

  const preset = savedPreset && getPresetBodyCount(savedPreset) === bodyCount
    ? savedPreset
    : DEFAULT_PRESET_BY_BODY_COUNT[bodyCount]

  const trailEnabled = storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.trailEnabled) !== 'false'
  const rawTrailDuration = storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.trailDuration)
  const trailDuration = rawTrailDuration === null
    ? DEFAULT_TRAIL_DURATION
    : normalizeTrailDuration(Number(rawTrailDuration))

  return {
    spaceMode,
    bodyCount,
    preset,
    trailEnabled,
    trailDuration,
  }
}

export function persistInitialSetup(
  setup: Pick<StoredInitialSetup, 'spaceMode' | 'bodyCount' | 'preset'>,
  storage: StorageLike = localStorage,
) {
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.spaceMode, setup.spaceMode)
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.bodyCount, String(setup.bodyCount))
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.preset, setup.preset)
}
