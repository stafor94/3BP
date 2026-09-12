import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bodyLightingSource = readFileSync(resolve(process.cwd(), 'src/rendering/bodyLighting.ts'), 'utf8')
const rendererSource = readFileSync(resolve(process.cwd(), 'src/rendering/simulationRenderer.ts'), 'utf8')
const photosphereSource = readFileSync(resolve(process.cwd(), 'src/rendering/stellarPhotosphereMaterial.ts'), 'utf8')
const coronaSource = readFileSync(resolve(process.cwd(), 'src/rendering/stellarCoronaMaterial.ts'), 'utf8')
const photographicRegressionSource = readFileSync(resolve(process.cwd(), 'scripts/stellarPhotographicVisualRegression.py'), 'utf8')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function count(source: string, token: string) {
  return source.split(token).length - 1
}

function testOnePhotosphereDrawPerStellarBody() {
  assert(
    rendererSource.includes('const mesh = new THREE.Mesh(customBodyGeometry ?? sharedBodyGeometry, bodyMaterial)'),
    'each render body must continue to allocate exactly one primary body mesh',
  )
  assert(
    rendererSource.includes('scene.add(trailRibbon.mesh, trailPoints, glowOuter, glowInner, mesh)'),
    'the primary body mesh must be submitted once through the shared VisualBody allocation',
  )
  assert(
    bodyLightingSource.includes('createStellarPhotosphereMaterialValues(values)'),
    'stars must continue to convert the existing primary body material into the stellar photosphere path',
  )
  assert(
    bodyLightingSource.includes("this.userData.bodyRenderPath = useStellarPath\n      ? STELLAR_PHOTOSPHERE_RENDER_PATH"),
    'the shared primary mesh must retain the dedicated stellar photosphere material identity',
  )
  assert(!rendererSource.includes('photosphereMesh'), 'stellar rendering must not allocate a second photosphere mesh')
  assert(!rendererSource.includes('stellarMesh'), 'stellar rendering must not allocate a parallel stellar mesh')
  assert(!photosphereSource.includes('sampler2D'), 'photosphere must remain procedural without an extra texture-backed draw path')
}

function testOneCoronaDrawPerStellarBody() {
  assert(
    count(bodyLightingSource, 'configureStellarCoronaMaterial(glowInner.material') === 1,
    'stellar corona configuration must continue to target exactly one existing inner Sprite carrier',
  )
  assert(
    bodyLightingSource.includes('glowInner.visible = true'),
    'the single stellar corona carrier must remain visible for stars',
  )
  assert(
    bodyLightingSource.includes('glowOuter.visible = false\n    glowOuter.material.opacity = 0'),
    'the legacy second glow Sprite must remain disabled for stars',
  )
  assert(
    !bodyLightingSource.includes('configureStellarCoronaMaterial(glowOuter.material'),
    'the legacy outer Sprite must never become a second stellar corona draw',
  )
  assert(
    coronaSource.includes("export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass5'"),
    'the established single-carrier corona shader path must remain unchanged',
  )
}

function testFinalBaselineDoesNotChangeGlobalRenderingPolicy() {
  assert(rendererSource.includes('renderer.toneMapping = THREE.ACESFilmicToneMapping'), 'renderer-owned ACES tone mapping must remain enabled')
  assert(rendererSource.includes('renderer.toneMappingExposure = 1'), 'global exposure must remain at the established value')
  assert(
    bodyLightingSource.includes('// stellar rendering no longer submits the legacy second halo Sprite draw call.'),
    'stellar draw-count intent must remain explicit beside the disabled second Sprite',
  )
}

function testPhotosphereCannotRegressToSmoothDiskOrDarkOutline() {
  // Keep the production halo/edge/noise/temperature gates, but do not require
  // the removed neutral-white center as an acceptance target. The photographic
  // gate must instead verify center-to-mid-disk luminance/chromaticity continuity
  // while retaining an absolute brightness floor so a dark ball cannot pass.
  for (const gate of ['near_glow', 'diffuse_halo', 'dark_outline', 'neon_ring', 'surface_noise', 'temperature_identity']) {
    assert(photographicRegressionSource.includes(gate), `missing photographic production gate: ${gate}`)
  }
  assert(
    photographicRegressionSource.includes('validate_disk_continuity(metrics, name)'),
    'photographic gate must retain center-to-mid-disk continuity validation',
  )
  assert(
    photographicRegressionSource.includes("metrics['core_luma'] >= 0.55"),
    'photographic gate must retain an absolute luminous-photosphere floor',
  )
  assert(
    photographicRegressionSource.includes('center lost temperature identity relative to the mid-disk'),
    'photographic gate must reject a neutral center that loses temperature identity',
  )
  assert(!photosphereSource.includes('primaryGranulation'), 'strong gameplay granulation must not return')
}

const tests = [
  testOnePhotosphereDrawPerStellarBody,
  testOneCoronaDrawPerStellarBody,
  testFinalBaselineDoesNotChangeGlobalRenderingPolicy,
  testPhotosphereCannotRegressToSmoothDiskOrDarkOutline,
]

for (const test of tests) test()
console.log(`stellar final render structure regression checks passed (${tests.length})`)
