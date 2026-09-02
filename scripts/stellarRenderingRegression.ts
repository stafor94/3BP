import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getStellarComputedProperties } from '../src/starColors'
import { getStellarRenderProfile } from '../src/rendering/stellarRenderProfile'
import type { BodyState, StellarEvolutionStage } from '../src/types'

const bodyLightingSource = readFileSync(resolve(process.cwd(), 'src/rendering/bodyLighting.ts'), 'utf8')

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

function testPhotosphereUsesSubtleMultiScaleTimeVaryingGranulation() {
  assert(bodyLightingSource.includes('uniform float uTime;'), 'stellar photosphere shader must expose a time uniform')
  assert(bodyLightingSource.includes('float drawStellarGranulation(vec3 objectNormal)'), 'stellar photosphere must use a dedicated granulation function')
  assert(bodyLightingSource.includes('objectNormal * 4.2'), 'stellar granulation must retain a broad convection-cell scale')
  assert(bodyLightingSource.includes('objectNormal * 15.5'), 'stellar granulation must retain a smaller granular scale')
  assert(bodyLightingSource.includes('objectNormal * 31.0'), 'stellar granulation must include subtle micro-scale breakup')
  assert(bodyLightingSource.includes('vec3 convectionDrift = vec3(0.15, -0.10, 0.08) * slowTime;'), 'stellar convection cells must drift slowly instead of rotating as a rigid texture')
  assert(bodyLightingSource.includes('vec3 granuleDrift = vec3(-0.08, 0.13, -0.11) * slowTime;'), 'stellar granules must evolve independently from broad convection cells')
  assert(bodyLightingSource.includes('material.uniforms.uTime.value = isStar ? renderTimeSeconds : 0'), 'time animation must stay isolated to stellar body rendering')
  assert(bodyLightingSource.includes('float limbDarkening = 0.74 + 0.26 * pow(limb, 0.52);'), 'stellar limb darkening must retain the stronger edge falloff')
  assert(bodyLightingSource.includes('float granulationContrast = clamp((granulation - 1.0) * 1.75, -0.055, 0.055);'), 'stellar granulation must retain a tightly bounded post-tone-map contrast signal')
  assert(bodyLightingSource.includes('#include <tonemapping_fragment>\n    if (uSelfLuminous > 0.5) {\n      gl_FragColor.rgb *= stellarSurfaceModulation;'), 'stellar granulation must survive the renderer tone-mapping shoulder without affecting non-stellar bodies')
}

function testCoronaUsesSubtleShaderBasedAsymmetry() {
  assert(bodyLightingSource.includes('uStellarGlowTime'), 'stellar glow shader must receive a slow time input')
  assert(bodyLightingSource.includes('uStellarGlowSeed'), 'stellar glow asymmetry must remain deterministic per body')
  assert(bodyLightingSource.includes('stellarAngularA * 0.065 + stellarAngularB * 0.035'), 'outer corona variation must stay subtle rather than flare-like')
  assert(bodyLightingSource.includes("configureStellarGlowMaterial(glowInner.material, 'inner'"), 'inner stellar glow must use the shader customization')
  assert(bodyLightingSource.includes("configureStellarGlowMaterial(glowOuter.material, 'outer'"), 'outer stellar corona must use the shader customization')
  assert(!bodyLightingSource.includes('new THREE.CanvasTexture'), 'stellar visual refinement must not add a new per-body texture path')
}

function testNonStellarSurfacePathRemainsSeparated() {
  assert(bodyLightingSource.includes("if (bodyType === 'planet' || bodyType === 'moon' || bodyType === 'fragment')"), 'non-stellar surface profiles must keep their dedicated routing')
  assert(bodyLightingSource.includes('float surfaceDetail = drawBodySurfaceDetail(objectNormal);\n      vec3 albedo = drawNonStellarAlbedo(objectNormal, surfaceDetail);'), 'planet/moon/fragment shading must continue using the existing non-stellar detail path')
}

const tests = [
  testRepresentativeStarsStayVisuallyDistinct,
  testLuminosityIsCompressedForDisplay,
  testCoreAndHaloHierarchy,
  testMassChangesImmediatelyChangeRenderInputs,
  testPhotosphereUsesSubtleMultiScaleTimeVaryingGranulation,
  testCoronaUsesSubtleShaderBasedAsymmetry,
  testNonStellarSurfacePathRemainsSeparated,
]

for (const test of tests) test()
console.log(`stellar rendering regression checks passed (${tests.length})`)
