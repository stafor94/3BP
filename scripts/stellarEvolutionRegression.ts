import { applyPresetBodyTypes, getEffectiveBodyType, normalizeBodyForType } from '../src/bodyTypes'
import { getOrbital2dPresetOverride } from '../src/orbital2dPresets'
import { getOrbital3dPresetOverride } from '../src/orbital3dPresets'
import { getPreset, PRESETS_BY_BODY_COUNT } from '../src/presets'
import {
  getStellarComputedProperties,
  getStellarDisplayColorFromBody,
  getStellarLuminosityFromEvolution,
  getStellarRadiusFromEvolution,
} from '../src/starColors'
import { SURFACE_PRESETS, getResolvedSurfaceProfile } from '../src/surfacePresets'
import type { BodyState, PresetId } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeStar(overrides: Partial<BodyState> = {}): BodyState {
  return {
    id: 'star',
    name: 'Regression Star',
    color: '#ff0000',
    mass: 1,
    radius: 0.075,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
    ...overrides,
  }
}

function testMassDrivesMainSequenceAppearance() {
  const cool = getStellarComputedProperties(makeStar({ mass: 0.5, stellarEvolutionStage: 'mainSequence' }))
  const hot = getStellarComputedProperties(makeStar({ mass: 5, stellarEvolutionStage: 'mainSequence' }))
  assert(hot.luminositySolar > cool.luminositySolar * 100, 'higher-mass main-sequence stars must be much more luminous')
  assert(hot.surfaceTemperatureK > cool.surfaceTemperatureK, 'higher-mass main-sequence stars must be hotter')
  assert(hot.displayColor !== cool.displayColor, 'mass change must alter automatic display color')
}

function testEvolutionStagesAreVisuallyDistinct() {
  const main = getStellarComputedProperties(makeStar({ stellarEvolutionStage: 'mainSequence', stellarEvolutionPhase01: 0.5 }))
  const giant = getStellarComputedProperties(makeStar({ stellarEvolutionStage: 'giant', stellarEvolutionPhase01: 0.5 }))
  const dwarf = getStellarComputedProperties(makeStar({ stellarEvolutionStage: 'whiteDwarf', stellarEvolutionPhase01: 0.5 }))

  assert(giant.radiusSolar > main.radiusSolar * 8, 'giant must be substantially larger than main sequence')
  assert(giant.surfaceTemperatureK < main.surfaceTemperatureK, 'solar-mass giant must have a cooler photosphere')
  assert(giant.displayColor !== main.displayColor, 'giant color must differ from main sequence')
  assert(dwarf.radiusSolar < 0.03, 'white dwarf radius must remain compact')
  assert(dwarf.surfaceTemperatureK > main.surfaceTemperatureK * 2, 'mid-phase white dwarf must be hot and blue-white')
}

function testPhaseEvolutionChangesRadiusAndLuminosity() {
  const earlyRadius = getStellarRadiusFromEvolution(1, 'mainSequence', 0.05)
  const lateRadius = getStellarRadiusFromEvolution(1, 'mainSequence', 0.95)
  const earlyLuminosity = getStellarLuminosityFromEvolution(1, 'mainSequence', 0.05)
  const lateLuminosity = getStellarLuminosityFromEvolution(1, 'mainSequence', 0.95)
  assert(lateRadius > earlyRadius, 'main-sequence radius should gently increase with phase')
  assert(lateLuminosity > earlyLuminosity, 'main-sequence luminosity should gently increase with phase')

  const blueSupergiant = getStellarComputedProperties(makeStar({
    mass: 12,
    stellarEvolutionStage: 'supergiant',
    stellarEvolutionPhase01: 0.1,
  }))
  const lateSupergiant = getStellarComputedProperties(makeStar({
    mass: 12,
    stellarEvolutionStage: 'supergiant',
    stellarEvolutionPhase01: 0.9,
  }))
  assert(
    blueSupergiant.surfaceTemperatureK > lateSupergiant.surfaceTemperatureK,
    'massive supergiant must support an early blue-white state and cooler late state',
  )
}

function testLegacyMigrationAndSurfaceDefaults() {
  const legacyStar = normalizeBodyForType(makeStar({
    stellarEvolutionStage: undefined,
    stellarEvolutionPhase01: undefined,
    stellarRadiusScale: undefined,
    color: '#ff0000',
  }), 'star')
  assert(legacyStar.stellarEvolutionStage === 'mainSequence', 'legacy star must default to mainSequence')
  assert(legacyStar.stellarEvolutionPhase01 === 0.5, 'legacy star phase must default to 0.5')
  assert(legacyStar.stellarRadiusScale === 1, 'legacy star radius scale must default to 1')
  assert(legacyStar.color === getStellarDisplayColorFromBody(legacyStar), 'legacy star color must be replaced by automatic equilibrium color')

  const legacyPlanet = normalizeBodyForType({
    ...makeStar(),
    id: 'planet',
    name: 'Atlas',
    mass: 0.3,
    bodyType: 'planet',
    color: '#123456',
  }, 'planet')
  assert(legacyPlanet.surfacePresetId === 'earthLike', 'Atlas-like legacy planet must receive an Earth-like surface preset')
  assert(legacyPlanet.color === getResolvedSurfaceProfile(legacyPlanet, 'planet').baseColor, 'non-stellar color cache must follow surface preset base color')
}

function testMergedStarInheritsDominantEvolutionState() {
  const dominant = normalizeBodyForType(makeStar({
    id: 'giant-a',
    mass: 2,
    stellarEvolutionStage: 'giant',
    stellarEvolutionPhase01: 0.72,
    stellarRadiusScale: 1.18,
  }), 'star')
  const secondary = normalizeBodyForType(makeStar({
    id: 'star-b',
    mass: 1,
    stellarEvolutionStage: 'mainSequence',
    stellarEvolutionPhase01: 0.2,
  }), 'star')

  getEffectiveBodyType(dominant)
  getEffectiveBodyType(secondary)

  const merged = makeStar({
    id: `${dominant.id}+${secondary.id}`,
    mass: 2.8,
    stellarEvolutionStage: undefined,
    stellarEvolutionPhase01: undefined,
    stellarRadiusScale: undefined,
    stellarCollisionOutcome: 'merge',
  })
  getEffectiveBodyType(merged)

  assert(merged.stellarEvolutionStage === 'giant', 'merged star must inherit the dominant progenitor evolution stage')
  assert(merged.stellarEvolutionPhase01 === dominant.stellarEvolutionPhase01, 'merged star must inherit dominant progenitor phase')
  assert(merged.stellarRadiusScale === dominant.stellarRadiusScale, 'merged star must inherit dominant progenitor radius scale')
}

function validatePresetBodies(id: PresetId, rawBodies: BodyState[], label: string) {
  const hydrated = applyPresetBodyTypes(id, rawBodies)
  hydrated.forEach((body) => {
    if (body.bodyType === 'star') {
      assert(body.stellarEvolutionStage !== undefined, `${label}/${id}/${body.name}: star stage missing`)
      assert(body.stellarEvolutionPhase01 !== undefined, `${label}/${id}/${body.name}: star phase missing`)
      assert(body.stellarRadiusScale !== undefined, `${label}/${id}/${body.name}: star radius scale missing`)
      assert(body.color === getStellarDisplayColorFromBody(body), `${label}/${id}/${body.name}: star color is not automatic`)
    } else if (body.bodyType === 'planet' || body.bodyType === 'moon') {
      assert(body.surfacePresetId !== undefined, `${label}/${id}/${body.name}: surface preset missing`)
    }
  })
}

function testAllPresetFamiliesHydrate() {
  const ids = Object.values(PRESETS_BY_BODY_COUNT).flat()
  ids.forEach((id) => {
    validatePresetBodies(id, getPreset(id), 'base')
    const twoD = getOrbital2dPresetOverride(id)
    if (twoD) validatePresetBodies(id, twoD, '2d')
    const threeD = getOrbital3dPresetOverride(id)
    if (threeD) validatePresetBodies(id, threeD, '3d')
  })
}

function testSurfacePresetInventory() {
  const planetCount = SURFACE_PRESETS.filter((preset) => preset.category === 'planet').length
  const moonCount = SURFACE_PRESETS.filter((preset) => preset.category === 'moon').length
  const fragmentCount = SURFACE_PRESETS.filter((preset) => preset.category === 'fragment').length
  assert(planetCount >= 12, 'planet surface inventory must include the requested first-pass set')
  assert(moonCount >= 9, 'moon surface inventory must include the requested first-pass set')
  assert(fragmentCount >= 4, 'fragment surface inventory must include the requested first-pass set')
}

const tests = [
  testMassDrivesMainSequenceAppearance,
  testEvolutionStagesAreVisuallyDistinct,
  testPhaseEvolutionChangesRadiusAndLuminosity,
  testLegacyMigrationAndSurfaceDefaults,
  testMergedStarInheritsDominantEvolutionState,
  testAllPresetFamiliesHydrate,
  testSurfacePresetInventory,
]

for (const test of tests) test()
console.log(`stellar evolution/surface regression checks passed (${tests.length})`)
