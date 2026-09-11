import {
  BODY_SCALE_OPTIONS,
  DEFAULT_TRAIL_DURATION,
  INITIAL_SETTINGS_STORAGE_KEYS,
  getStoredInitialSetup,
  normalizeBodyScale,
  normalizeTrailDuration,
  persistInitialSetup,
} from '../src/simulationSettings'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createMemoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

function testDefaults() {
  const storage = createMemoryStorage()
  const setup = getStoredInitialSetup(storage)

  assert(setup.spaceMode === '3d', 'default space mode must remain 3D')
  assert(setup.bodyCount === 3, 'default body count must remain 3')
  assert(setup.preset === 'figure8', 'default preset must remain figure8')
  assert(setup.trailEnabled, 'trail must be enabled by default')
  assert(setup.trailDuration === DEFAULT_TRAIL_DURATION, 'trail default must be 10 seconds')
}

function testStoredSetupRestoresTogether() {
  const storage = createMemoryStorage()
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.spaceMode, '2d')
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.bodyCount, '5')
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.preset, 'pentaCrossed')
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.trailEnabled, 'false')
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.trailDuration, '17')

  const setup = getStoredInitialSetup(storage)
  assert(setup.spaceMode === '2d', 'stored 2D mode must restore')
  assert(setup.bodyCount === 5, 'stored body count must restore')
  assert(setup.preset === 'pentaCrossed', 'stored compatible preset must restore')
  assert(!setup.trailEnabled, 'stored trail visibility must restore')
  assert(setup.trailDuration === 17, 'stored trail duration must restore')
}

function testInvalidStoredValuesAreNormalized() {
  const storage = createMemoryStorage()
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.bodyCount, '4')
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.preset, 'binaryOrbit')
  storage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.trailDuration, '60')

  const setup = getStoredInitialSetup(storage)
  assert(setup.bodyCount === 4, 'valid stored body count must be kept')
  assert(setup.preset === 'quadCrown', 'preset incompatible with body count must fall back safely')
  assert(setup.trailDuration === 20, 'legacy trail durations above 20 seconds must clamp to 20')
}

function testScaleOptionsAndSnapping() {
  const expected = [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 5]
  assert(BODY_SCALE_OPTIONS.length === expected.length, 'body scale option count must stay fixed')
  expected.forEach((value, index) => {
    assert(BODY_SCALE_OPTIONS[index] === value, `body scale option ${index} must be ${value}`)
  })
  assert(normalizeBodyScale(0.88) === 0.9, 'body scale must snap to the nearest allowed option')
  assert(normalizeBodyScale(4.4) === 5, 'body scale above midpoint must snap to 5x')
  assert(normalizeBodyScale(Number.NaN) === 1, 'invalid body scale must fall back to 1x')
}

function testTrailNormalizationAndPersistence() {
  assert(normalizeTrailDuration(0) === 1, 'trail duration must clamp to 1 second')
  assert(normalizeTrailDuration(21) === 20, 'trail duration must clamp to 20 seconds')
  assert(normalizeTrailDuration(10.4) === 10, 'trail duration must use whole seconds')

  const storage = createMemoryStorage()
  persistInitialSetup({ spaceMode: '2d', bodyCount: 6, preset: 'hexaNested' }, storage)
  assert(storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.spaceMode) === '2d', 'space mode must persist')
  assert(storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.bodyCount) === '6', 'body count must persist')
  assert(storage.getItem(INITIAL_SETTINGS_STORAGE_KEYS.preset) === 'hexaNested', 'preset must persist')
}

testDefaults()
testStoredSetupRestoresTogether()
testInvalidStoredValuesAreNormalized()
testScaleOptionsAndSnapping()
testTrailNormalizationAndPersistence()

console.log('Simulation settings regression checks passed.')
