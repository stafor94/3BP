import { readFileSync } from 'node:fs'

const backgroundSource = readFileSync(new URL('../src/rendering/spaceBackground.ts', import.meta.url), 'utf8')
const rendererSource = readFileSync(new URL('../src/rendering/simulationRenderer.ts', import.meta.url), 'utf8')

function requireCondition(condition, message) {
  if (!condition) throw new Error(`space background regression: ${message}`)
}

function readNumericConstant(name) {
  const match = backgroundSource.match(new RegExp(`const ${name} = ([0-9.]+)`))
  requireCondition(match, `missing ${name}`)
  return Number(match[1])
}

function readOption(block, name) {
  const match = block.match(new RegExp(`${name}:\\s*([0-9.]+)`))
  requireCondition(match, `missing ${name} in generated block`)
  return Number(match[1])
}

const textureSize = readNumericConstant('STAR_POINT_TEXTURE_SIZE')
const brightnessExponent = readNumericConstant('STAR_BRIGHTNESS_EXPONENT')
const parallaxScale = readNumericConstant('STAR_PARALLAX_SCALE')
const maxParallaxAngle = readNumericConstant('STAR_PARALLAX_MAX_ANGLE_DEGREES')
const denseBackgroundStarCount = readNumericConstant('DENSE_BACKGROUND_STAR_COUNT')
const fineBackgroundStarCount = readNumericConstant('FINE_BACKGROUND_STAR_COUNT')
const spaceBaseRed = readNumericConstant('SPACE_BASE_RED')
const spaceBaseGreen = readNumericConstant('SPACE_BASE_GREEN')
const spaceBaseBlue = readNumericConstant('SPACE_BASE_BLUE')
const spaceTextureWidth = readNumericConstant('SPACE_TEXTURE_WIDTH')
const spaceTextureHeight = readNumericConstant('SPACE_TEXTURE_HEIGHT')
const galaxyTextureSize = readNumericConstant('GALAXY_TEXTURE_SIZE')

requireCondition(textureSize >= 16 && textureSize <= 32, 'star point texture must stay within 16–32 px')
requireCondition(brightnessExponent >= 2.35 && brightnessExponent <= 3.0, 'brightness hierarchy drifted outside restrained range')
requireCondition(parallaxScale > 0 && parallaxScale <= 0.05, 'parallax scale exceeds restrained depth budget')
requireCondition(maxParallaxAngle > 0 && maxParallaxAngle <= 0.25, 'parallax angular cap exceeds 0.25 degrees')
requireCondition(spaceTextureWidth <= 512 && spaceTextureHeight <= 256, 'space texture exceeded the 512×256 initialization budget')
requireCondition(galaxyTextureSize <= 64, 'galaxy texture exceeded the 64×64 initialization budget')
requireCondition(
  spaceBaseRed >= 5 && spaceBaseGreen >= 7 && spaceBaseBlue >= 13,
  `OLED black floor regressed: ${spaceBaseRed}/${spaceBaseGreen}/${spaceBaseBlue}`,
)
requireCondition(
  spaceBaseRed <= 7 && spaceBaseGreen <= 10 && spaceBaseBlue <= 17,
  `space black floor became too prominent: ${spaceBaseRed}/${spaceBaseGreen}/${spaceBaseBlue}`,
)

const starLayerBlocks = [...rendererSource.matchAll(/createSpaceStarLayer\(\{([\s\S]*?)\}\)/g)].map((match) => match[1])
requireCondition(starLayerBlocks.length === 3, 'expected exactly three foreground THREE.Points star layers')

const starCounts = starLayerBlocks.map((block) => readOption(block, 'count'))
const maxBrightnesses = starLayerBlocks.map((block) => readOption(block, 'maxBrightness'))
const follows = starLayerBlocks.map((block) => readOption(block, 'follow'))
const baseStars = starCounts.reduce((sum, count) => sum + count, 0)
const backgroundStars = denseBackgroundStarCount + fineBackgroundStarCount
const totalStars = baseStars + backgroundStars
const depthResponses = follows.map((follow) => follow * parallaxScale)

requireCondition(baseStars === 1000, `expected the established 1000-star foreground hierarchy, found ${baseStars}`)
requireCondition(totalStars >= 4500 && totalStars <= 5500, `Pass 5 total star population must stay within 4500–5500 stars, found ${totalStars}`)
requireCondition(denseBackgroundStarCount >= 1800 && denseBackgroundStarCount <= 2600, `dense background escaped visible-density budget: ${denseBackgroundStarCount}`)
requireCondition(fineBackgroundStarCount >= 1300 && fineBackgroundStarCount <= 2200, `fine background escaped fill budget: ${fineBackgroundStarCount}`)
requireCondition(
  maxBrightnesses.join(',') === '0.72,0.86,1',
  `star maximum brightness budget changed: ${maxBrightnesses.join(',')}`,
)
requireCondition(
  depthResponses.every((value) => value <= 0.0035),
  `star depth response exceeds 0.35%: ${depthResponses.join(',')}`,
)
requireCondition(
  depthResponses[0] < depthResponses[1] && depthResponses[1] < depthResponses[2],
  'far/mid/near depth hierarchy must increase monotonically',
)

const denseBackgroundMatch = backgroundSource.match(/const denseBackgroundLayer = createSpaceStarLayer\(\{([\s\S]*?)\}\)/)
requireCondition(denseBackgroundMatch, 'missing dense visible background star layer')
const denseBackgroundBlock = denseBackgroundMatch[1]
const denseSize = readOption(denseBackgroundBlock, 'size')
const denseOpacity = readOption(denseBackgroundBlock, 'opacity')
const denseMinBrightness = readOption(denseBackgroundBlock, 'minBrightness')
const denseMaxBrightness = readOption(denseBackgroundBlock, 'maxBrightness')
const denseDepthResponse = readOption(denseBackgroundBlock, 'follow') * parallaxScale
requireCondition(denseSize >= 1.25 && denseSize <= 1.6, `dense background size must stay screen-visible, found ${denseSize}`)
requireCondition(denseOpacity >= 0.74 && denseOpacity <= 0.88, `dense background opacity escaped Pass 5 range: ${denseOpacity}`)
requireCondition(denseMinBrightness >= 0.24 && denseMinBrightness <= 0.34, `dense background minimum brightness is not mobile-visible: ${denseMinBrightness}`)
requireCondition(denseMaxBrightness >= 0.58 && denseMaxBrightness <= 0.68, `dense background max brightness escaped restrained range: ${denseMaxBrightness}`)
requireCondition(denseMaxBrightness < maxBrightnesses[0], 'dense background maximum brightness must stay below the far foreground layer')
requireCondition(denseDepthResponse < depthResponses[0], 'dense background must remain behind the established far foreground layer')
requireCondition(denseBackgroundBlock.includes('fullSkyBaseline: true'), 'dense background must use full-sky baseline distribution')

const fineBackgroundMatch = backgroundSource.match(/const fineBackgroundLayer = createSpaceStarLayer\(\{([\s\S]*?)\}\)/)
requireCondition(fineBackgroundMatch, 'missing fine full-sky background layer')
const fineBackgroundBlock = fineBackgroundMatch[1]
const fineSize = readOption(fineBackgroundBlock, 'size')
const fineOpacity = readOption(fineBackgroundBlock, 'opacity')
const fineMinBrightness = readOption(fineBackgroundBlock, 'minBrightness')
const fineMaxBrightness = readOption(fineBackgroundBlock, 'maxBrightness')
const fineDepthResponse = readOption(fineBackgroundBlock, 'follow') * parallaxScale
requireCondition(fineSize >= 1.0 && fineSize <= 1.3, `fine background size escaped screen-space range: ${fineSize}`)
requireCondition(fineOpacity >= 0.62 && fineOpacity <= 0.78, `fine background opacity escaped Pass 5 range: ${fineOpacity}`)
requireCondition(fineMinBrightness >= 0.16 && fineMinBrightness <= 0.26, `fine background minimum brightness escaped restrained range: ${fineMinBrightness}`)
requireCondition(fineMaxBrightness >= 0.42 && fineMaxBrightness <= 0.52, `fine background max brightness escaped restrained range: ${fineMaxBrightness}`)
requireCondition(fineMaxBrightness < denseMaxBrightness, 'fine background must remain below the dense background brightness ceiling')
requireCondition(fineDepthResponse < depthResponses[0], 'fine background must remain behind the established far foreground layer')
requireCondition(fineBackgroundBlock.includes('fullSkyBaseline: true'), 'fine background must use full-sky baseline distribution')
requireCondition(backgroundSource.includes('function sampleBackgroundStarDirection'), 'Pass 5 full-sky background sampler is missing')

const clusterBlock = backgroundSource.match(/const STAR_CLUSTERS:[\s\S]*?= \[([\s\S]*?)\] as const/)
requireCondition(clusterBlock, 'missing local star cluster specifications')
const clusterCount = [...clusterBlock[1].matchAll(/threshold:/g)].length
requireCondition(clusterCount >= 3 && clusterCount <= 6, `expected a restrained set of local clusters, found ${clusterCount}`)

const galaxyBlock = backgroundSource.match(/const DISTANT_GALAXIES:[\s\S]*?= \[([\s\S]*?)\] as const/)
requireCondition(galaxyBlock, 'missing distant galaxy specifications')
const galaxySpecs = [...galaxyBlock[1].matchAll(/\{([\s\S]*?)seed:\s*(\d+),\s*\}/g)].map((match) => ({
  block: match[1],
  seed: Number(match[2]),
}))
const galaxyKinds = galaxySpecs.map(({ block }) => block.match(/kind:\s*'(spiral|edgeOn|elliptical)'/)?.[1])
const galaxyWidths = galaxySpecs.map(({ block }) => readOption(block, 'width'))
const galaxyOpacities = galaxySpecs.map(({ block }) => readOption(block, 'opacity'))
const faintSmallGalaxies = galaxySpecs.filter((_, index) => galaxyWidths[index] <= 3.0 && galaxyOpacities[index] <= 0.15).length

requireCondition(galaxySpecs.length >= 6 && galaxySpecs.length <= 10, `expected 6–10 distant galaxies, found ${galaxySpecs.length}`)
for (const kind of ['spiral', 'edgeOn', 'elliptical']) {
  requireCondition(galaxyKinds.filter((value) => value === kind).length >= 2, `expected repeated but varied ${kind} galaxy coverage`)
}
requireCondition(new Set(galaxySpecs.map(({ seed }) => seed)).size === galaxySpecs.length, 'galaxy seeds must be unique')
requireCondition(faintSmallGalaxies >= galaxySpecs.length - 3, 'new galaxies must remain mostly small and faint')
requireCondition(backgroundSource.includes('const seedUnit ='), 'galaxy profile must vary deterministically from each seed')

requireCondition(backgroundSource.includes('fineDirectionField(direction'), 'Milky Way stellar grain layer is missing')
requireCondition(backgroundSource.includes('midScaleVariation') && backgroundSource.includes('fineVariation'), 'visible middle/fine sky texture variation is missing')
requireCondition(backgroundSource.includes('dustBranchA') && backgroundSource.includes('dustBranchB'), 'branched dust-lane structure is missing')
requireCondition(
  backgroundSource.includes('const dustSuppression = dustLane * (0.22 + innerBand * 0.38)'),
  'Pass 5 dust lane suppression must avoid black-crushed gaps',
)
requireCondition(
  backgroundSource.includes('cyanHaze') && backgroundSource.includes('magentaHaze') && backgroundSource.includes('neutralHaze'),
  'broad faint nebula haze layers are missing',
)
requireCondition(backgroundSource.includes('STAR_RICH_REGION_CENTER') && backgroundSource.includes('STAR_VOID_CENTER'), 'full-sky asymmetry controls are missing')

requireCondition(
  backgroundSource.includes('map: backdropState.starPointTexture'),
  'star layers must share the backdrop point texture',
)
requireCondition(
  backgroundSource.match(/const starPointTexture = createStarPointTexture\(\)/g)?.length === 1,
  'star point texture must be created exactly once per backdrop',
)
requireCondition(
  backgroundSource.includes('depthWrite: false'),
  'background materials must not write foreground depth',
)
requireCondition(
  backgroundSource.includes('follow: 0,'),
  'legacy target-shift follow must stay neutralized',
)
requireCondition(
  backgroundSource.includes('layer.cameraAnchor).sub(cameraPosition).multiplyScalar(layer.depthResponse)'),
  'star depth update must derive from camera translation',
)
requireCondition(
  backgroundSource.includes('mesh.position.copy(cameraPosition)') &&
    backgroundSource.includes('galaxyGroup.position.copy(cameraPosition)'),
  'sky sphere and distant galaxies must remain exactly camera-centered',
)
for (const layerName of ['denseBackgroundLayer', 'fineBackgroundLayer']) {
  requireCondition(
    backgroundSource.includes(`scene.remove(${layerName}.points)`) &&
      backgroundSource.includes(`${layerName}.geometry.dispose()`) &&
      backgroundSource.includes(`${layerName}.material.dispose()`),
    `${layerName} resources must be removed and disposed with the backdrop`,
  )
}
requireCondition(
  !backgroundSource.includes('requestAnimationFrame') && !backgroundSource.includes('performance.now'),
  'space background must not add time-based animation',
)

console.log(
  `space background regression ok: ${totalStars} stars (${denseBackgroundStarCount} dense + ${fineBackgroundStarCount} fine background), ` +
    `${galaxySpecs.length} galaxies / ${clusterCount} cluster regions, ${textureSize}x${textureSize} shared point texture, ` +
    `OLED floor ${spaceBaseRed}/${spaceBaseGreen}/${spaceBaseBlue}, ` +
    `depth responses ${depthResponses.map((value) => (value * 100).toFixed(3)).join('% / ')}%, ` +
    `max angular displacement ${maxParallaxAngle.toFixed(2)}°`,
)
