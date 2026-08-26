import { getStellarComputedProperties } from '../src/starColors'
import { getStellarRenderProfile } from '../src/rendering/stellarRenderProfile'
import type { BodyState, StellarEvolutionStage } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeStar(
  mass: number,
  stage: StellarEvolutionStage = 'mainSequence',
  phase01 = 0.5,
): BodyState {
  return {
    id: `${stage}-${mass}-${phase01}`,
    name: 'Stellar render regression',
    color: '#ffffff',
    mass,
    radius: 0.075,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'star',
    stellarEvolutionStage: stage,
    stellarEvolutionPhase01: phase01,
    stellarRadiusScale: 1,
  }
}

function renderProfile(body: BodyState) {
  const stellar = getStellarComputedProperties(body)
  return {
    stellar,
    render: getStellarRenderProfile(stellar.luminositySolar, stellar.surfaceTemperatureK),
  }
}

function testRepresentativeStarsStayVisuallyDistinct() {
  const cool = renderProfile(makeStar(0.35))
  const solar = renderProfile(makeStar(1))
  const hot = renderProfile(makeStar(8))
  const giant = renderProfile(makeStar(1, 'giant', 0.72))
  const dwarf = renderProfile(makeStar(0.7, 'whiteDwarf', 0.2))

  const colors = new Set([
    cool.stellar.displayColor,
    solar.stellar.displayColor,
    hot.stellar.displayColor,
    giant.stellar.displayColor,
    dwarf.stellar.displayColor,
  ])
  assert(colors.size >= 4, 'representative stellar stages/masses must not collapse to one display color')
  assert(cool.stellar.surfaceTemperatureK < solar.stellar.surfaceTemperatureK, 'cool star must remain cooler than solar')
  assert(hot.stellar.surfaceTemperatureK > solar.stellar.surfaceTemperatureK, 'massive star must remain hotter than solar')
  assert(giant.stellar.surfaceTemperatureK < solar.stellar.surfaceTemperatureK, 'evolved giant must remain cooler than solar')
  assert(dwarf.stellar.surfaceTemperatureK > solar.stellar.surfaceTemperatureK, 'hot compact stage must remain hotter than solar')
}

function testLuminosityIsCompressedForDisplay() {
  const cool = renderProfile(makeStar(0.25))
  const hot = renderProfile(makeStar(15))
  const physicalRatio = hot.stellar.luminositySolar / cool.stellar.luminositySolar
  const photosphereRatio = hot.render.photosphereIntensity / cool.render.photosphereIntensity

  assert(physicalRatio > 1000, 'regression pair must span several orders of physical luminosity')
  assert(photosphereRatio < 1.25, 'photosphere luminance must compress physical luminosity instead of scaling linearly')
  assert(hot.render.innerGlowOpacity > cool.render.innerGlowOpacity, 'higher luminosity must still read through stronger inner glow')
  assert(hot.render.outerGlowScale > cool.render.outerGlowScale, 'higher luminosity must still read through a larger halo')
}

function testCoreAndHaloHierarchy() {
  const samples = [
    makeStar(0.3),
    makeStar(1),
    makeStar(10),
    makeStar(1, 'giant', 0.8),
    makeStar(0.65, 'whiteDwarf', 0.1),
  ].map(renderProfile)

  samples.forEach(({ render }) => {
    assert(render.photosphereIntensity >= 0.9 && render.photosphereIntensity <= 1.1, 'photosphere must stay in the hue-preserving luminance shoulder')
    assert(render.whiteHotMix <= 0.06, 'white-hot treatment must remain confined to a small center contribution')
    assert(render.innerGlowOpacity < 0.5, 'inner glow must not become an opaque white disc')
    assert(render.outerGlowOpacity < render.innerGlowOpacity, 'outer halo must remain weaker than inner glow')
    assert(render.outerGlowScale > render.innerGlowScale, 'outer halo must remain spatially outside inner glow')
    assert(render.outerHaloWhiteMix <= 0.1, 'outer halo desaturation must remain subtle')
  })
}

function testMassChangesImmediatelyChangeRenderInputs() {
  const before = renderProfile(makeStar(1))
  const gainedMass = renderProfile(makeStar(2.4))
  const stripped = renderProfile(makeStar(0.55))

  assert(gainedMass.stellar.displayColor !== before.stellar.displayColor, 'mass gain must immediately change equilibrium display color')
  assert(stripped.stellar.displayColor !== before.stellar.displayColor, 'mass stripping must immediately change equilibrium display color')
  assert(gainedMass.render.innerGlowOpacity !== before.render.innerGlowOpacity, 'mass gain must immediately change luminosity-driven glow')
  assert(stripped.render.innerGlowOpacity !== before.render.innerGlowOpacity, 'mass stripping must immediately change luminosity-driven glow')
}

const tests = [
  testRepresentativeStarsStayVisuallyDistinct,
  testLuminosityIsCompressedForDisplay,
  testCoreAndHaloHierarchy,
  testMassChangesImmediatelyChangeRenderInputs,
]

for (const test of tests) test()
console.log(`stellar rendering regression checks passed (${tests.length})`)
