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

function testLuminosityAndHaloContractsStayBounded() {
  const cool = renderProfile(makeStar(0.25))
  const hot = renderProfile(makeStar(15))
  assert(hot.stellar.luminositySolar / cool.stellar.luminositySolar > 1000, 'fixture must span physical luminosities')
  assert(hot.render.photosphereIntensity / cool.render.photosphereIntensity < 1.25, 'SDR brightness must compress physical luminosity')
  assert(hot.render.coronaOpacity > cool.render.coronaOpacity, 'luminosity must still affect halo brightness')
  for (const mass of [0.1, 0.35, 1, 8, 30]) {
    const { render } = renderProfile(makeStar(mass))
    assert(render.photosphereIntensity > 1 && render.photosphereIntensity < 1.35, 'photosphere emission must stay below the ACES white shoulder')
    assert(render.centerHighlightStrength >= 0.75 && render.centerHighlightStrength <= 1.0, 'white-hot highlight must remain compact and bounded')
    assert(render.coronaScale >= 6 && render.coronaScale <= 10, 'carrier must fit a diffuse halo without unbounded fill cost')
    assert(render.coronaOpacity > 0 && render.coronaOpacity <= 1, 'halo opacity must be valid')
  }
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
  for (const forbidden of ['nearestDistanceSq', 'secondDistanceSq', 'boundaryDistance', 'intergranularLane', 'granuleCenter', 'distanceToCellEdge', 'polygonEdge', 'primaryGranulation', 'fineBreakup', 'resolvedGranulationBoost']) {
    assert(!stellarMaterialSource.includes(forbidden), `surface topology/contrast amplification must remain absent: ${forbidden}`)
  }
  assert(!stellarMaterialSource.includes('sampler2D'), 'photosphere must not introduce surface textures')
  const noiseCalls = stellarMaterialSource.match(/valueNoise\(/g) ?? []
  assert(noiseCalls.length <= 2, 'only one broad variation sample is needed')
}

function testPhotosphereUsesScreenSpaceSurfaceLod() {
  assert(stellarMaterialSource.includes('fwidth(objectNormal)'), 'faint variation must fade continuously with actual pixel footprint')
  assert(!stellarMaterialSource.includes('uCameraDistance'), 'no world-distance LOD switch')
  assert(!stellarMaterialSource.includes('uScreenRadius'), 'no CPU screen-size plumbing')
}

function testPhotosphereTimeEvolutionDoesNotSlideSurfaceCoordinates() {
  assert(!stellarMaterialSource.includes('objectNormal + uTime'), 'time must not translate surface coordinates')
  assert(stellarMaterialSource.includes('material.uniforms.uTime.value = frame.animationTimeSeconds'), 'time uses the existing frame contract')
}

function testPhotosphereUsesLuminousCenterToLimbResponse() {
  assert(stellarMaterialSource.includes('drawStellarEmission(viewMu) * uEmissionStrength'), 'stellar HDR emission remains before tone mapping')
  assert(stellarMaterialSource.includes('vec3 coloredEmission = uIdentityColor * linearIntensity'), 'temperature identity must remain the base photosphere emission')
  assert(stellarMaterialSource.includes('uCenterHighlightStrength * centerHighlightMask'), 'white highlight must be added separately near the center')
  assert(!stellarMaterialSource.includes('neutralHue01'), 'do not lower neutral-star highlights to reveal granulation')
}

function testPhotosphereUsesSoftStellarLimbAndCoverage() {
  assert(stellarMaterialSource.includes('fwidth(viewMu)'), 'edge must remain pixel-aware')
  assert(stellarMaterialSource.includes('uOpacity * edgeCoverage'), 'photosphere must feather coverage')
  assert(stellarMaterialSource.includes('alphaToCoverage: true'), 'creation must keep MSAA coverage')
  assert(stellarMaterialSource.includes('material.alphaToCoverage = true'), 'conversion must keep MSAA coverage')
}

function testPhotosphereUsesSingleLinearHdrToneMappingPath() {
  const chunks = stellarMaterialSource.match(/#include <tonemapping_fragment>/g) ?? []
  assert(chunks.length === 1, 'exactly one renderer tone mapping operation')
  assert(stellarMaterialSource.includes('#include <tonemapping_fragment>\n    #include <colorspace_fragment>'), 'no post-tonemap surface contrast injection')
  assert(stellarMaterialSource.includes('toneMapped: true'), 'stellar material opts into ACES')
  assert(stellarMaterialSource.includes('material.toneMapped = true'), 'stellar conversion opts into ACES')
  assert(simulationRendererSource.includes('renderer.toneMapping = THREE.ACESFilmicToneMapping'), 'global ACES policy is unchanged')
  assert(simulationRendererSource.includes('renderer.toneMappingExposure = 1'), 'global exposure is unchanged')
  assert(simulationRendererSource.includes('fragmentShader: bodyFragmentShader,\n    toneMapped: false,'), 'generic material policy is unchanged')
}

function testStellarOnlySurfaceLogicDoesNotLeakIntoGenericShader() {
  assert(!bodyLightingSource.includes('uniform float uTime;'), 'generic body shader must not expose stellar animation time')
  assert(!bodyLightingSource.includes('uniform float uEmissionStrength;'), 'generic body shader must not expose stellar emission strength')
  assert(!bodyLightingSource.includes('uniform float uCenterHighlightStrength;'), 'generic body shader must not expose stellar center highlight control')
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

function testCoronaRestoresEmissiveReadWithoutASeparateHalo() {
  assert(stellarCoronaSource.includes('THREE.AdditiveBlending'), 'corona adds light without darkening the background')
  assert(!stellarCoronaSource.includes('coronaOutsideMask'), 'outside-only mask must not reopen the dark seam')
  assert(!stellarCoronaSource.includes('diskOverlapEnergy'), 'corona must not gate RGB through an annular overlap band')
  assert(stellarCoronaSource.includes('float clampedRadius = min(radiusInPhotospheres, 1.0);'), 'corona handoff must use projected photosphere radius')
  assert(stellarCoronaSource.includes('float diskViewMu = sqrt(max(1.0 - clampedRadius * clampedRadius, 0.0));'), 'corona handoff must restore projected sphere viewMu')
  assert(stellarCoronaSource.includes('float handoffFeather = max(0.34, fwidth(diskViewMu) * 1.25);'), 'corona handoff must mirror photosphere pixel-aware feathering')
  assert(stellarCoronaSource.includes('float photosphereCoverage = smoothstep(0.0, handoffFeather, diskViewMu);'), 'corona handoff must derive from photosphere coverage')
  assert(stellarCoronaSource.includes('float coronaHandoff = 1.0 - photosphereCoverage;'), 'corona handoff must complement photosphere coverage')
  assert(stellarCoronaSource.includes('* coronaHandoff;'), 'corona handoff must modulate corona alpha')
  assert(stellarCoronaSource.includes('diffuseColor.rgb = coronaColor;'), 'temperature color must not be enabled through a limb-only RGB annulus')
  assert(bodyLightingSource.includes('configureStellarCoronaMaterial(glowInner.material'), 'one existing sprite carries all stellar glow')
  assert(bodyLightingSource.includes('glowOuter.visible = false\n    glowOuter.material.opacity = 0'), 'second stellar sprite stays disabled')
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
  testCoronaRestoresEmissiveReadWithoutASeparateHalo,
  testNonStellarSurfacePathRemainsSeparated,
]

for (const test of tests) test()
console.log(`stellar rendering regression checks passed (${tests.length})`)
