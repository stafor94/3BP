import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bodyLightingSource = readFileSync(resolve(process.cwd(), 'src/rendering/bodyLighting.ts'), 'utf8')
const rendererSource = readFileSync(resolve(process.cwd(), 'src/rendering/simulationRenderer.ts'), 'utf8')
const photosphereSource = readFileSync(resolve(process.cwd(), 'src/rendering/stellarPhotosphereMaterial.ts'), 'utf8')
const coronaSource = readFileSync(resolve(process.cwd(), 'src/rendering/stellarCoronaMaterial.ts'), 'utf8')
const integrationRegressionSource = readFileSync(resolve(process.cwd(), 'scripts/stellarProductionIntegrationVisualRegression.py'), 'utf8')
const radialRegressionSource = readFileSync(resolve(process.cwd(), 'scripts/stellarPhotospherePass3RadialRegression.py'), 'utf8')

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
  assert(photosphereSource.includes('const float STELLAR_PRIMARY_FREQUENCY = 13.0'), 'mobile photosphere must retain mid-scale primary structure')
  assert(integrationRegressionSource.includes("'normal': (0.10, 1.80)"), 'flat normal-view photospheres must fail visual regression')
  assert(integrationRegressionSource.includes('large diffuse halo'), 'large diffuse halos must be an explicit visual-regression failure')
  assert(integrationRegressionSource.includes('neon ring'), 'neon rings must be an explicit visual-regression failure')
  assert(radialRegressionSource.includes('dark outline/ring drop'), 'dark photosphere outlines must be an explicit radial-regression failure')
  assert(photosphereSource.includes('fwidth(viewMu) * 0.82'), 'edge coverage must stay confined to the geometric silhouette')
  assert(photosphereSource.includes('return 0.90 + broadDepth'), 'limb emission floor must prevent a dark photosphere outline')
  assert(coronaSource.includes('smoothstep(0.52, 0.72, warpedDistance01)'), 'corona tail must end shortly beyond the photosphere')
}

const tests = [
  testOnePhotosphereDrawPerStellarBody,
  testOneCoronaDrawPerStellarBody,
  testFinalBaselineDoesNotChangeGlobalRenderingPolicy,
  testPhotosphereCannotRegressToSmoothDiskOrDarkOutline,
]

for (const test of tests) test()
console.log(`stellar final render structure regression checks passed (${tests.length})`)
