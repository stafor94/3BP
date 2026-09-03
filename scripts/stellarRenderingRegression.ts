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

function readShaderConstant(name: string) {
  const match = stellarMaterialSource.match(new RegExp(`const float ${name} = ([0-9.]+);`))
  assert(match, `missing stellar shader constant: ${name}`)
  return Number(match[1])
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

function testLuminosityAndHaloContractsStayBounded() {
  const cool = renderProfile(makeStar(0.25))
  const hot = renderProfile(makeStar(15))
  const physicalRatio = hot.stellar.luminositySolar / cool.stellar.luminositySolar
  const photosphereRatio = hot.render.photosphereIntensity / cool.render.photosphereIntensity

  assert(physicalRatio > 1000, 'regression pair must span several orders of physical luminosity')
  assert(photosphereRatio < 1.25, 'photosphere luminance must compress physical luminosity instead of scaling linearly')
  assert(hot.render.coronaOpacity > cool.render.coronaOpacity, 'higher luminosity must still read through a slightly stronger compact corona')
  assert(hot.render.coronaScale > cool.render.coronaScale, 'higher luminosity may still read through a subtly larger compact corona')

  const samples = [
    makeStar(0.3),
    makeStar(1),
    makeStar(10),
    makeStar(1, 'giant', 0.8),
    makeStar(0.65, 'whiteDwarf', 0.1),
  ].map(renderProfile)

  samples.forEach(({ render }) => {
    assert(render.photosphereIntensity >= 0.9 && render.photosphereIntensity <= 1.1, 'photosphere HDR intensity must stay inside the calibrated stellar range')
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
  assert(!bodyLightingSource.includes('uSelfLuminous'), 'generic rendering must not restore the old self-luminous star branch')
  assert(!stellarMaterialSource.includes('uniform vec3 uLightPositions'), 'stellar shader must not carry generic planet lighting arrays')
}

function testPhotosphereRemovesExplicitCellularTopology() {
  assert(stellarMaterialSource.includes('uniform float uTime;'), 'stellar photosphere shader must retain its slow animation contract')
  assert(stellarMaterialSource.includes('float drawStellarSurfaceVariation(vec3 objectNormal)'), 'stellar photosphere must keep a dedicated procedural surface basis')

  const convectionFrequency = readShaderConstant('STELLAR_CONVECTION_FREQUENCY')
  const warpFrequency = readShaderConstant('STELLAR_WARP_FREQUENCY')
  const primaryFrequency = readShaderConstant('STELLAR_PRIMARY_FREQUENCY')
  const secondaryFrequency = readShaderConstant('STELLAR_PRIMARY_SECONDARY_FREQUENCY')
  const fineFrequency = readShaderConstant('STELLAR_FINE_FREQUENCY')
  assert(convectionFrequency < warpFrequency, 'domain distortion must remain subordinate in scale to broad convection')
  assert(warpFrequency < primaryFrequency, 'primary granulation must be finer than the domain distortion')
  assert(primaryFrequency < secondaryFrequency, 'primary granulation must contain decorrelated nearby scales')
  assert(secondaryFrequency < fineFrequency, 'fine breakup must remain the smallest-scale signal')

  for (const forbidden of [
    'sampleStellarCellular',
    'drawIntergranularLane',
    'nearestDistanceSq',
    'secondDistanceSq',
    'boundaryDistance',
    'intergranularLane',
    'granuleInterior',
    'granuleCenter',
    'cellThermalBias',
    'cellPulse',
    'distanceToCellEdge',
    'polygonEdge',
  ]) {
    assert(!stellarMaterialSource.includes(forbidden), `explicit cellular/Voronoi topology must remain absent: ${forbidden}`)
  }

  assert(!stellarMaterialSource.includes('sampler2D'), 'stellar granulation must not add a texture-backed surface path')
  assert(stellarMaterialSource.includes('vec3 warpedNormal = normalize(objectNormal + warpVector'), 'primary granulation must decorrelate the value-noise lattice with bounded domain distortion')
  assert(stellarMaterialSource.includes('float primaryGranulation ='), 'Pass 2 must provide an explicit primary granulation field')
  assert(stellarMaterialSource.includes('convectionVariation +\n      primaryVariation +\n      fineVariation'), 'surface contrast must preserve broad / primary / fine hierarchy')
  assert(stellarMaterialSource.includes('return clamp(1.0 + variation * uDetailStrength, 0.925, 1.075);'), 'surface variation must stay tightly bounded around mean luminance')

  const noiseCalls = stellarMaterialSource.match(/valueNoise\(/g) ?? []
  assert(noiseCalls.length >= 8, 'Pass 2 must use enough decorrelated samples for multi-scale granulation')
  assert(noiseCalls.length <= 10, 'Pass 2 must keep procedural sampling bounded and avoid cellular-search-level cost')
  assert(stellarMaterialSource.includes('material.uniforms.uTime.value = frame.animationTimeSeconds'), 'animation time must be updated only through the stellar material contract')
}

function testPhotosphereUsesScreenSpaceSurfaceLod() {
  assert(stellarMaterialSource.includes('vec3 normalWidth = fwidth(objectNormal);'), 'surface LOD must start from actual screen-space normal footprint')
  assert(stellarMaterialSource.includes('float getStellarFeaturePixels(float normalPixelFootprint, float frequency)'), 'stellar shader must convert derivative footprint into approximate pixels per feature')
  assert(stellarMaterialSource.includes('float convectionPixels = getStellarFeaturePixels('), 'broad convection must use screen-space coverage')
  assert(stellarMaterialSource.includes('float primaryPixels = getStellarFeaturePixels('), 'primary granulation must use screen-space coverage')
  assert(stellarMaterialSource.includes('float secondaryPixels = getStellarFeaturePixels('), 'secondary primary scale must use screen-space coverage')
  assert(stellarMaterialSource.includes('float finePixels = getStellarFeaturePixels('), 'fine breakup must use screen-space coverage')
  assert(stellarMaterialSource.includes('float primaryLod = smoothstep('), 'primary detail must fade continuously rather than pop')
  assert(stellarMaterialSource.includes('float secondaryLod = smoothstep('), 'secondary granulation must retire independently when unresolved')
  assert(stellarMaterialSource.includes('float fineLod = smoothstep('), 'fine detail must retire before becoming unresolved')
  assert(stellarMaterialSource.includes('float convectionLod = mix('), 'broad convection must retain a nonzero small-star floor')
  assert(!stellarMaterialSource.includes('uCameraDistance'), 'stellar LOD must not add a world-distance uniform')
  assert(!stellarMaterialSource.includes('uScreenRadius'), 'stellar LOD must not require a CPU-managed screen-radius uniform')
}

function testPhotosphereTimeEvolutionDoesNotSlideSurfaceCoordinates() {
  const timeTerms = stellarMaterialSource.match(/uTime \*/g) ?? []
  assert(timeTerms.length === 2, 'surface time must be limited to two slow amplitude-evolution terms')
  assert(stellarMaterialSource.includes('float convectionEvolution = 1.0 +'), 'broad convection may evolve only through slow amplitude change')
  assert(stellarMaterialSource.includes('float primaryEvolution = 1.0 +'), 'primary granulation may evolve independently through slow amplitude change')
  assert(stellarMaterialSource.includes('vec3 warpedNormal = normalize(objectNormal + warpVector'), 'domain distortion must be anchored to object-space surface coordinates')
  assert(!stellarMaterialSource.includes('granuleDrift'), 'legacy texture coordinate drift must remain absent')
  assert(!stellarMaterialSource.includes('convectionWobble'), 'broad texture coordinates must not slide across the sphere')
  assert(!stellarMaterialSource.includes('fineWobble'), 'fine texture coordinates must not slide across the sphere')
  assert(!stellarMaterialSource.includes('uTime + objectNormal'), 'time must not translate object-space coordinates')
  assert(!stellarMaterialSource.includes('objectNormal + uTime'), 'time must not translate object-space coordinates')
}

function testPhotosphereUsesLuminousCenterToLimbResponse() {
  assert(stellarMaterialSource.includes('float drawStellarEmission(float viewMu)'), 'Pass 3 must own a dedicated view-angle emission response')
  assert(stellarMaterialSource.includes('float broadDepth = pow(viewMu, 0.32);'), 'center-to-limb emission must use a broad smooth depth term')
  assert(stellarMaterialSource.includes('float centerDepth = pow(viewMu, 1.35);'), 'center-to-limb emission must include a distributed center lift')
  assert(stellarMaterialSource.includes('return 0.81 + broadDepth * 0.14 + centerDepth * 0.36;'), 'Pass 3 must keep a luminous limb while increasing broad center-to-limb depth without a hotspot')
  assert(stellarMaterialSource.includes('float getStellarDetailEnvelope(float viewMu)'), 'surface detail must have a view-angle response separate from topology generation')
  assert(stellarMaterialSource.includes('return mix(0.18, 1.0, smoothstep(0.20, 0.82, viewMu));'), 'near-limb detail compression must begin broadly, remain continuous, and keep a nonzero texture floor')
  assert(stellarMaterialSource.includes('surfaceVariation *= detailEnvelope;'), 'surface contrast must be compressed only after topology-free surface generation')
}

function testPhotosphereUsesSoftStellarLimbAndCoverage() {
  assert(stellarMaterialSource.includes('float drawStellarFringe(float viewMu)'), 'stellar photosphere must retain the dedicated thin fringe')
  assert(stellarMaterialSource.includes('float fringeRise = smoothstep(0.58, 0.82, fresnel);'), 'fringe must rise gradually before the silhouette')
  assert(stellarMaterialSource.includes('float fringeFall = 1.0 - smoothstep(0.90, 0.985, fresnel);'), 'fringe must fade before it can form an outline')
  assert(stellarMaterialSource.includes('float getStellarEdgeCoverage(float viewMu)'), 'stellar silhouette must derive coverage from view angle')
  assert(stellarMaterialSource.includes('fwidth(viewMu) * 1.55'), 'stellar edge feather must remain derivative aware')
  assert(stellarMaterialSource.includes('max(fwidth(viewMu) * 1.55, 0.035), 0.20'), 'edge coverage must stay narrow at large screen sizes')
  assert(stellarMaterialSource.includes('gl_FragColor = vec4(color, uOpacity * edgeCoverage);'), 'fragment alpha must carry only the thin silhouette coverage transition')
  assert(stellarMaterialSource.includes('alphaToCoverage: true'), 'stellar material creation must keep MSAA alpha-to-coverage')
  assert(stellarMaterialSource.includes('material.alphaToCoverage = true'), 'runtime stellar conversion must keep alpha-to-coverage')
  assert(stellarMaterialSource.includes('material.uniforms.uRimStrength.value = 0.025'), 'photosphere fringe strength must stay subordinate')
}

function testPhotosphereUsesSingleLinearHdrToneMappingPath() {
  assert(stellarMaterialSource.includes('float meanEmission = (emission + fringe * 0.14) * uEmissionStrength;'), 'mean photosphere luminance must remain dominated by smooth emission rather than fringe')
  assert(stellarMaterialSource.includes('float surfaceVariation = clamp((surfaceDetail - 1.0) * 0.92, -0.095, 0.075);'), 'surface contrast must remain bounded independently from mean luminance')
  assert(stellarMaterialSource.includes('float linearIntensity = meanEmission * (1.0 + surfaceVariation);'), 'surface variation must be applied once in linear HDR space')
  assert(stellarMaterialSource.includes('float identityChannelFloor = min(min(uIdentityColor.r, uIdentityColor.g), uIdentityColor.b);'), 'neutral stellar headroom must derive from identity color')
  assert(stellarMaterialSource.includes('float neutralHue01 = smoothstep(0.50, 0.78, identityChannelFloor);'), 'neutral headroom must fade continuously')
  assert(stellarMaterialSource.includes('linearIntensity *= mix(1.0, 0.72, neutralHue01);'), 'near-neutral stars must retain bounded pre-ACES headroom')
  assert(stellarMaterialSource.includes('linearIntensity *= 1.0 + surfaceVariation * 0.08;'), 'surface contrast compensation must remain small and linear before ACES')
  assert(stellarMaterialSource.includes('vec3 color = uIdentityColor * linearIntensity;'), 'temperature identity color must remain unchanged in linear HDR space')
  assert(stellarMaterialSource.includes('float whiteHotCore = pow(viewMu, 22.0) * uWhiteHotMix * 0.72;'), 'white-hot contribution must stay narrow and weaker than the render-profile bound')
  assert(!stellarMaterialSource.includes('toneMapStellarHuePreserving'), 'stellar photosphere must not restore a local shoulder compressor')
  assert(!stellarMaterialSource.includes('stellarSurfaceModulation'), 'stellar photosphere must not restore post-tone-map RGB modulation')
  const toneMappingChunks = stellarMaterialSource.match(/#include <tonemapping_fragment>/g) ?? []
  assert(toneMappingChunks.length === 1, 'stellar photosphere must execute exactly one renderer tone-mapping chunk')
  assert(stellarMaterialSource.includes('#include <tonemapping_fragment>\n    #include <colorspace_fragment>'), 'no stellar RGB modulation may run after renderer tone mapping')
  assert(simulationRendererSource.includes('renderer.toneMapping = THREE.ACESFilmicToneMapping'), 'global renderer tone mapping must remain ACES')
  assert(simulationRendererSource.includes('renderer.toneMappingExposure = 1'), 'stellar Pass 3 must not change global exposure')
}

function testStellarOnlySurfaceLogicDoesNotLeakIntoGenericShader() {
  assert(!bodyLightingSource.includes('uniform float uTime;'), 'generic body shader must not expose stellar animation time')
  assert(!bodyLightingSource.includes('uniform float uEmissionStrength;'), 'generic body shader must not expose stellar emission strength')
  assert(!bodyLightingSource.includes('uniform float uWhiteHotMix;'), 'generic body shader must not expose stellar white-hot control')
  assert(!bodyLightingSource.includes('drawStellarSurfaceVariation'), 'generic body shader must not embed stellar surface variation')
  assert(!bodyLightingSource.includes('sampleStellarCellular'), 'generic body shader must not embed removed cellular topology')
  assert(!bodyLightingSource.includes('drawIntergranularLane'), 'generic body shader must not embed removed lane topology')
}

function testStellarUpdateContractOwnsRenderInputs() {
  assert(stellarMaterialSource.includes('export type StellarPhotosphereFrame'), 'stellar module must expose one explicit per-frame update contract')
  assert(stellarMaterialSource.includes('displayColor: string'), 'stellar update contract must carry resolved stellar color')
  assert(stellarMaterialSource.includes('luminositySolar: number'), 'stellar update contract must carry luminosity')
  assert(stellarMaterialSource.includes('surfaceTemperatureK: number'), 'stellar update contract must carry surface temperature')
  assert(stellarMaterialSource.includes('transientHeatStrength: number'), 'stellar update contract must carry collision transient heat')
  assert(stellarMaterialSource.includes('evolutionPhase01: number'), 'stellar update contract must carry stellar evolution phase')
  assert(stellarMaterialSource.includes('animationTimeSeconds: number'), 'stellar update contract must carry animation time')
  assert(stellarMaterialSource.includes('renderProfile: StellarRenderProfile'), 'stellar update contract must carry render profile')
  assert(stellarMaterialSource.includes('export function updateStellarPhotosphereMaterial('), 'stellar-only uniforms must be updated in the stellar material module')
}

function testCoronaRemainsUnchangedAndSubordinate() {
  assert(stellarCoronaSource.includes("export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass5'"), 'Pass 3 must retain the dedicated compact corona path')
  assert(stellarCoronaSource.includes('float coronaPhase = uCoronaTime * 0.0016;'), 'corona time evolution must remain nearly imperceptible')
  assert(stellarCoronaSource.includes('coronaAngularA * 0.050 + coronaAngularB * 0.024'), 'corona radius variation must stay subtle')
  assert(stellarCoronaSource.includes('float coronaNearLimb = exp(-pow(warpedDistance01 / 0.14, 2.0));'), 'corona must remain concentrated near the photosphere')
  assert(stellarCoronaSource.includes('exp(-warpedDistance01 * 5.4)'), 'outer corona must continue to decay rapidly')
  assert(bodyLightingSource.includes('configureStellarCoronaMaterial(glowInner.material'), 'existing inner Sprite must remain the single corona carrier')
  assert(bodyLightingSource.includes('glowOuter.visible = false\n    glowOuter.material.opacity = 0'), 'legacy outer stellar Sprite must remain disabled')
}

function testNonStellarSurfacePathRemainsSeparated() {
  assert(bodyLightingSource.includes("if (bodyType === 'planet' || bodyType === 'moon' || bodyType === 'fragment')"), 'non-stellar surface profiles must keep their dedicated routing')
  assert(bodyLightingSource.includes('float surfaceDetail = drawBodySurfaceDetail(objectNormal);\n    vec3 albedo = drawNonStellarAlbedo(objectNormal, surfaceDetail);'), 'planet/moon/fragment shading must continue using the existing non-stellar detail path')
  assert(bodyLightingSource.includes('uLightPositions'), 'generic body shader must retain star-light illumination inputs')
}

const tests = [
  testRepresentativeStarsStayVisuallyDistinct,
  testLuminosityAndHaloContractsStayBounded,
  testMassChangesImmediatelyChangeRenderInputs,
  testDedicatedStellarMaterialPathIsStructurallySeparated,
  testPhotosphereRemovesExplicitCellularTopology,
  testPhotosphereUsesScreenSpaceSurfaceLod,
  testPhotosphereTimeEvolutionDoesNotSlideSurfaceCoordinates,
  testPhotosphereUsesLuminousCenterToLimbResponse,
  testPhotosphereUsesSoftStellarLimbAndCoverage,
  testPhotosphereUsesSingleLinearHdrToneMappingPath,
  testStellarOnlySurfaceLogicDoesNotLeakIntoGenericShader,
  testStellarUpdateContractOwnsRenderInputs,
  testCoronaRemainsUnchangedAndSubordinate,
  testNonStellarSurfacePathRemainsSeparated,
]

for (const test of tests) test()
console.log(`stellar rendering regression checks passed (${tests.length})`)