import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getStellarComputedProperties } from '../src/starColors'
import { getStellarRenderProfile } from '../src/rendering/stellarRenderProfile'
import type { BodyState, StellarEvolutionStage } from '../src/types'

const bodyLightingSource = readFileSync(resolve(process.cwd(), 'src/rendering/bodyLighting.ts'), 'utf8')
const stellarMaterialSource = readFileSync(
  resolve(process.cwd(), 'src/rendering/stellarPhotosphereMaterial.ts'),
  'utf8',
)
const stellarCoronaSource = readFileSync(
  resolve(process.cwd(), 'src/rendering/stellarCoronaMaterial.ts'),
  'utf8',
)
const simulationRendererSource = readFileSync(
  resolve(process.cwd(), 'src/rendering/simulationRenderer.ts'),
  'utf8',
)

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
  assert(hot.render.coronaOpacity > cool.render.coronaOpacity, 'higher luminosity must still read through a slightly stronger compact corona')
  assert(hot.render.coronaScale > cool.render.coronaScale, 'higher luminosity may still read through a subtly larger compact corona')
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
    assert(render.coronaScale >= 2.7 && render.coronaScale <= 3.0, 'single corona carrier must remain compact around the photosphere')
    assert(render.coronaOpacity < 0.35, 'compact corona must stay subordinate to the photosphere')
    assert(render.coronaOuterWhiteMix <= 0.035, 'outer corona desaturation must remain very subtle')
  })
}

function testMassChangesImmediatelyChangeRenderInputs() {
  const before = renderProfile(makeStar(1))
  const gainedMass = renderProfile(makeStar(2.4))
  const stripped = renderProfile(makeStar(0.55))

  assert(gainedMass.stellar.displayColor !== before.stellar.displayColor, 'mass gain must immediately change equilibrium display color')
  assert(stripped.stellar.displayColor !== before.stellar.displayColor, 'mass stripping must immediately change equilibrium display color')
  assert(gainedMass.render.coronaOpacity !== before.render.coronaOpacity, 'mass gain must immediately change luminosity-driven corona')
  assert(stripped.render.coronaOpacity !== before.render.coronaOpacity, 'mass stripping must immediately change luminosity-driven corona')
}

function testDedicatedStellarMaterialPathIsStructurallySeparated() {
  assert(
    stellarMaterialSource.includes("export const STELLAR_PHOTOSPHERE_RENDER_PATH = 'stellar-photosphere'"),
    'stellar photosphere must expose a dedicated material path identity',
  )
  assert(
    stellarMaterialSource.includes('fragmentShader: stellarPhotosphereFragmentShader'),
    'stellar material creation must select its own fragment shader program',
  )
  assert(
    bodyLightingSource.includes('fragmentShader: litGenericBodyFragmentShader'),
    'generic body material creation must select the non-stellar fragment shader program',
  )
  assert(
    bodyLightingSource.includes('createStellarPhotosphereMaterialValues(values)'),
    'body material installation must route star creation into the stellar material module',
  )
  assert(
    bodyLightingSource.includes("getEffectiveBodyType(body) === 'star'"),
    'material routing must use the resolved body type instead of a shader-time luminous branch',
  )
  assert(
    !bodyLightingSource.includes('uSelfLuminous'),
    'generic body rendering must not retain the old self-luminous star/effect branch uniform',
  )
  assert(
    !stellarMaterialSource.includes('uniform vec3 uLightPositions'),
    'stellar photosphere shader must not carry generic planet lighting arrays',
  )
}

function testPhotosphereUsesCellularGranulationTopology() {
  assert(stellarMaterialSource.includes('uniform float uTime;'), 'stellar photosphere shader must expose a time uniform')
  assert(stellarMaterialSource.includes('const float STELLAR_CONVECTION_FREQUENCY = 2.7;'), 'large convection frequency must remain stable')
  assert(stellarMaterialSource.includes('const float STELLAR_GRANULE_FREQUENCY = 7.2;'), 'primary granule frequency must remain stable')
  assert(stellarMaterialSource.includes('const float STELLAR_FINE_FREQUENCY = 21.0;'), 'fine breakup frequency must remain subordinate to primary cells')
  assert(stellarMaterialSource.includes('vec4 sampleStellarCellular(vec3 p, vec3 seedOffset)'), 'stellar photosphere must use the Pass 2 cellular distance field')
  assert(stellarMaterialSource.includes('for (int z = -1; z <= 1; z++)'), 'cellular search must use a bounded 3x3x3 neighborhood')
  assert(stellarMaterialSource.includes('float cellSizeScale = 0.88 + heat * 0.28;'), 'cellular granules must retain Pass 2 cell-size variation')
  assert(stellarMaterialSource.includes('sqrt(nearestDistanceSq)'), 'cellular field must expose nearest-cell distance')
  assert(stellarMaterialSource.includes('sqrt(secondDistanceSq)'), 'cellular field must expose second-nearest-cell distance')
  assert(stellarMaterialSource.includes('float drawIntergranularLane(vec4 cellular, float laneLod)'), 'stellar photosphere must explicitly anti-alias intergranular lanes')
  assert(stellarMaterialSource.includes('float boundaryDistance = max(cellular.y - cellular.x, 0.0);'), 'lane topology must remain derived from nearest/second-nearest cell separation')
  assert(stellarMaterialSource.includes('float lanePixelWidth = min(fwidth(boundaryDistance) * 0.35, 0.035);'), 'lane edge width must respond to screen-space derivatives')
  assert(stellarMaterialSource.includes('return lane * mix(1.0, 0.20, mergeAffinity) * laneLod;'), 'thermally similar boundaries and unresolved lanes must be suppressed without changing topology')
  assert(stellarMaterialSource.includes('intergranularLane * 0.075'), 'resolved intergranular lanes must retain the Pass 2 contrast budget')
  assert(stellarMaterialSource.includes('granuleCenter * 0.016'), 'granule interiors must retain a subtle hotter center lift')
  assert(stellarMaterialSource.includes('(convection - 0.5) * 0.035'), 'large convection modulation must remain lower contrast than primary cells')
  assert(stellarMaterialSource.includes('(fineBreakup - 0.5) * 0.008'), 'fine breakup must stay subordinate to cellular topology')
  assert(stellarMaterialSource.includes('uSurfaceSeed * 0.051'), 'cellular photosphere must remain deterministic per stellar surface seed')
  assert(stellarMaterialSource.includes('material.uniforms.uTime.value = frame.animationTimeSeconds'), 'animation time must be updated only through the stellar material contract')
  assert(stellarMaterialSource.includes('float granulationContrast = clamp((granulation - 1.0) * 1.30, -0.070, 0.047);'), 'cellular topology must survive tone mapping through the existing bounded stellar-only modulation')
  assert(stellarMaterialSource.includes('#include <tonemapping_fragment>\n    gl_FragColor.rgb *= stellarSurfaceModulation;'), 'stellar surface topology must remain visible after tone mapping')
  assert(!stellarMaterialSource.includes('objectNormal * 15.5'), 'legacy smooth value-noise primary granulation must remain removed')
  assert(!stellarMaterialSource.includes('granuleDrift'), 'legacy texture-like granule drift must remain removed')
}

function testPhotosphereUsesScreenSpaceGranulationLod() {
  assert(stellarMaterialSource.includes('vec3 normalWidth = fwidth(objectNormal);'), 'granulation LOD must start from the actual screen-space normal footprint')
  assert(stellarMaterialSource.includes('float getStellarFeaturePixels(float normalPixelFootprint, float frequency)'), 'stellar shader must convert derivative footprint into approximate pixels per procedural feature')
  assert(stellarMaterialSource.includes('float granulePixels = getStellarFeaturePixels('), 'primary granule LOD must use screen-space feature coverage')
  assert(stellarMaterialSource.includes('float finePixels = getStellarFeaturePixels('), 'fine breakup LOD must use screen-space feature coverage')
  assert(stellarMaterialSource.includes('float granuleLod = smoothstep(0.90, 2.35, granulePixels);'), 'primary granules must fade continuously rather than pop')
  assert(stellarMaterialSource.includes('float laneLod = smoothstep(1.35, 3.25, granulePixels);'), 'thin lanes must retire before the primary cellular field becomes unresolved')
  assert(stellarMaterialSource.includes('float fineLod = smoothstep(1.15, 2.65, finePixels);'), 'fine breakup must retire first as screen coverage shrinks')
  assert(stellarMaterialSource.includes('0.72,\n      1.0,\n      smoothstep(0.65, 2.40, convectionPixels)'), 'broad convection must retain a nonzero floor for very small stars')
  assert(stellarMaterialSource.includes('* granuleLod - intergranularLane * 0.075;'), 'primary cellular contrast and lane contrast must have separate resolution gates')
  assert(stellarMaterialSource.includes('* 0.008 * fineLod * fineBreath;'), 'fine breakup contrast must be derivative-gated instead of distance-dimmed')

  const cellularOccurrences = stellarMaterialSource.match(/sampleStellarCellular\(/g) ?? []
  assert(cellularOccurrences.length === 2, 'Pass 3 must keep exactly one cellular neighborhood sample per stellar fragment')
  assert(!stellarMaterialSource.includes('uCameraDistance'), 'stellar LOD must not add a world-distance uniform')
  assert(!stellarMaterialSource.includes('uScreenRadius'), 'stellar LOD must not require a CPU-managed screen-radius uniform')
}

function testPhotosphereTimeEvolutionDoesNotSlideTopology() {
  assert(!stellarMaterialSource.includes('convectionWobble'), 'broad convection coordinates must not slide across the sphere')
  assert(!stellarMaterialSource.includes('fineWobble'), 'fine breakup coordinates must not slide across the sphere')
  assert(stellarMaterialSource.includes('uTime * 0.0035 + uSurfaceSeed * 0.009'), 'broad convection must evolve only through a very slow amplitude breathing term')
  assert(stellarMaterialSource.includes('uTime * 0.009 +'), 'cellular granules must use a distinct very slow per-cell thermal phase')
  assert(stellarMaterialSource.includes('uTime * 0.0055 + uSurfaceSeed * 0.013 + 1.1'), 'fine breakup must use a separate very slow amplitude phase')
}

function testPhotosphereUsesSoftStellarLimbAndCoverage() {
  assert(
    stellarMaterialSource.includes('float broadLimb = pow(viewMu, 0.42);'),
    'stellar limb emission must use a broad continuous center-to-edge response',
  )
  assert(
    stellarMaterialSource.includes('return 0.92 + broadLimb * 0.18 + centerLift * 0.16;'),
    'stellar limb must retain a bright edge floor instead of producing a gray or black ring',
  )
  assert(
    stellarMaterialSource.includes('float drawStellarFringe(vec3 worldNormal, vec3 viewDirection)'),
    'stellar photosphere must expose a dedicated thin fringe instead of the generic bright rim',
  )
  assert(
    stellarMaterialSource.includes('float fringeFall = 1.0 - smoothstep(0.94, 0.995, fresnel);'),
    'stellar fringe must fall away at the exact silhouette so it cannot become a visible ring',
  )
  assert(
    stellarMaterialSource.includes('float getStellarEdgeCoverage(vec3 worldNormal, vec3 viewDirection)'),
    'stellar silhouette must derive coverage from the view angle inside the existing sphere draw',
  )
  assert(
    stellarMaterialSource.includes('fwidth(viewMu) * 1.90'),
    'stellar edge feather must be screen-space derivative aware',
  )
  assert(
    stellarMaterialSource.includes('fringe * 0.52'),
    'thin fringe must support the coverage transition without becoming a separate ring',
  )
  assert(
    stellarMaterialSource.includes('gl_FragColor = vec4(color, uOpacity * edgeCoverage);'),
    'stellar fragment alpha must carry only the thin silhouette coverage transition',
  )
  assert(
    stellarMaterialSource.includes('alphaToCoverage: true'),
    'new stellar material creation must enable MSAA alpha-to-coverage without transparent sorting',
  )
  assert(
    stellarMaterialSource.includes('material.alphaToCoverage = true'),
    'runtime stellar-path conversion must also enable alpha-to-coverage',
  )
  assert(
    !stellarMaterialSource.includes('float drawStellarRim('),
    'legacy full Fresnel stellar rim must remain removed',
  )
}

function testStellarOnlyUniformsDoNotLeakIntoGenericShader() {
  assert(!bodyLightingSource.includes('uniform float uTime;'), 'generic body shader must not expose stellar animation time')
  assert(!bodyLightingSource.includes('uniform float uEmissionStrength;'), 'generic body shader must not expose stellar emission strength')
  assert(!bodyLightingSource.includes('uniform float uWhiteHotMix;'), 'generic body shader must not expose stellar white-hot control')
  assert(!bodyLightingSource.includes('drawStellarGranulation'), 'generic body shader must not embed stellar granulation')
  assert(!bodyLightingSource.includes('sampleStellarCellular'), 'generic body shader must not embed stellar cellular topology')
  assert(!bodyLightingSource.includes('drawIntergranularLane'), 'generic body shader must not embed stellar lane topology')
  assert(!bodyLightingSource.includes('toneMapStellarHuePreserving'), 'generic body shader must not embed stellar hue-preserving emission logic')
}

function testStellarUpdateContractOwnsRenderInputs() {
  assert(stellarMaterialSource.includes('export type StellarPhotosphereFrame'), 'stellar module must expose one explicit per-frame update contract')
  assert(stellarMaterialSource.includes('displayColor: string'), 'stellar update contract must carry resolved stellar color')
  assert(stellarMaterialSource.includes('luminositySolar: number'), 'stellar update contract must carry luminosity')
  assert(stellarMaterialSource.includes('surfaceTemperatureK: number'), 'stellar update contract must carry surface temperature')
  assert(stellarMaterialSource.includes('transientHeatStrength: number'), 'stellar update contract must carry collision transient heat')
  assert(stellarMaterialSource.includes('evolutionPhase01: number'), 'stellar update contract must carry stellar evolution phase')
  assert(stellarMaterialSource.includes('animationTimeSeconds: number'), 'stellar update contract must carry animation time')
  assert(stellarMaterialSource.includes('renderProfile: StellarRenderProfile'), 'stellar update contract must carry luminosity/temperature-derived render profile')
  assert(stellarMaterialSource.includes('export function updateStellarPhotosphereMaterial('), 'stellar-only uniforms must be updated in the stellar material module')
}

function testCoronaUsesSubtleShaderBasedAsymmetry() {
  assert(stellarCoronaSource.includes("export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass5'"), 'Pass 5 must use a dedicated compact corona shader customization')
  assert(stellarCoronaSource.includes('uniform float uCoronaTime;'), 'stellar corona shader must receive a slow time input')
  assert(stellarCoronaSource.includes('uniform float uCoronaSeed;'), 'stellar corona asymmetry must remain deterministic per body')
  assert(stellarCoronaSource.includes('float coronaPhase = uCoronaTime * 0.0016;'), 'corona time evolution must remain nearly imperceptible')
  assert(stellarCoronaSource.includes('coronaAngularA * 0.050 + coronaAngularB * 0.024'), 'corona radius variation must stay subtle rather than flare-like')
  assert(stellarCoronaSource.includes('float coronaNearLimb = exp(-pow(warpedDistance01 / 0.14, 2.0));'), 'corona must concentrate a thin near-limb glow immediately outside the photosphere')
  assert(stellarCoronaSource.includes('exp(-warpedDistance01 * 5.4)'), 'outer corona must decay rapidly instead of filling a large radial blur')
  assert(stellarCoronaSource.includes("'#include <map_fragment>'"), 'stellar corona shader must patch the SpriteMaterial map_fragment chunk')
  assert(!stellarCoronaSource.includes('map_particle_fragment'), 'stellar corona shader must not target the Points-only map_particle_fragment chunk')
  assert(stellarCoronaSource.includes('diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);'), 'stellar corona shader must replace the legacy radial texture alpha shape')
  assert(stellarCoronaSource.includes('uCoronaOuterWhiteMix * coronaOuterColorWeight'), 'only the faint outer corona may weakly desaturate')
  assert(bodyLightingSource.includes('configureStellarCoronaMaterial(glowInner.material'), 'existing inner Sprite must be reused as the single corona carrier')
  assert(bodyLightingSource.includes('glowOuter.visible = false\n    glowOuter.material.opacity = 0'), 'legacy outer Sprite must be disabled for stars to remove one draw call')
  assert(simulationRendererSource.includes("if (body.bodyType !== 'star') {\n    visual.glowInner.scale.setScalar("), 'generic renderer must not overwrite stellar corona scale')
  assert(simulationRendererSource.includes("if (body.bodyType !== 'star') {\n    visual.glowInnerMaterial.opacity = innerGlowOpacity"), 'generic renderer must not overwrite stellar corona opacity')
  assert(!bodyLightingSource.includes('configureStellarGlowMaterial'), 'legacy dual-layer stellar glow shader path must be removed')
  assert(!stellarCoronaSource.includes('new THREE.CanvasTexture'), 'Pass 5 must not add a new texture path')
  assert(!stellarCoronaSource.includes('new THREE.Sprite'), 'Pass 5 must not allocate a new sprite')
  assert(!stellarCoronaSource.includes('new THREE.BufferGeometry'), 'Pass 5 must not add geometry')
}

function testNonStellarSurfacePathRemainsSeparated() {
  assert(bodyLightingSource.includes("if (bodyType === 'planet' || bodyType === 'moon' || bodyType === 'fragment')"), 'non-stellar surface profiles must keep their dedicated routing')
  assert(bodyLightingSource.includes('float surfaceDetail = drawBodySurfaceDetail(objectNormal);\n    vec3 albedo = drawNonStellarAlbedo(objectNormal, surfaceDetail);'), 'planet/moon/fragment shading must continue using the existing non-stellar detail path')
  assert(bodyLightingSource.includes('uLightPositions'), 'generic body shader must retain star-light illumination inputs')
}

const tests = [
  testRepresentativeStarsStayVisuallyDistinct,
  testLuminosityIsCompressedForDisplay,
  testCoreAndHaloHierarchy,
  testMassChangesImmediatelyChangeRenderInputs,
  testDedicatedStellarMaterialPathIsStructurallySeparated,
  testPhotosphereUsesCellularGranulationTopology,
  testPhotosphereUsesScreenSpaceGranulationLod,
  testPhotosphereTimeEvolutionDoesNotSlideTopology,
  testPhotosphereUsesSoftStellarLimbAndCoverage,
  testStellarOnlyUniformsDoNotLeakIntoGenericShader,
  testStellarUpdateContractOwnsRenderInputs,
  testCoronaUsesSubtleShaderBasedAsymmetry,
  testNonStellarSurfacePathRemainsSeparated,
]

for (const test of tests) test()
console.log(`stellar rendering regression checks passed (${tests.length})`)