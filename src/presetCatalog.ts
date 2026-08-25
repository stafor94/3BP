import { DEFAULT_PRESET_BY_BODY_COUNT, PRESETS_BY_BODY_COUNT } from './presets'

/**
 * Keep the user-facing preset catalog focused on meaningful observable motion.
 * The underlying legacy preset constructors remain internal so old code/data does
 * not break, but they are no longer selectable or used as defaults.
 */
export function configurePresetCatalog() {
  PRESETS_BY_BODY_COUNT[1] = ['singleDrift']
  DEFAULT_PRESET_BY_BODY_COUNT[1] = 'singleDrift'
}
