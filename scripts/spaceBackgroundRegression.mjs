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
const deepFieldStarCount = readNumericConstant('DEEP_FIELD_STAR_COUNT')
const midFaintStarCount = readNumericConstant('MID_FAINT_STAR_COUNT')
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
  spaceBaseRed >= 3 && spaceBaseGreen >= 4 && spaceBaseBlue >= 8,
  `OLED black floor regressed: ${spaceBaseRed}/${spaceBaseGreen}/${spaceBaseBlue}`,
)
requireCondition(
  spaceBaseRed <= 4 && spaceBaseGreen <= 5 && spaceBaseBlue <= 10,
  `space black floor became too prominent: ${spaceBaseRed}/${spaceBaseGreen}/${spaceBaseBlue}`,
)

const starLayerBlocks = [...rendererSource.matchAll(/createSpaceStarLayer\(\{([\s\S]*?)\}\)/g)].map((match) => match[1])
requireCondition(starLayerBlocks.length === 3, 'expected exactly three foreground THREE.Points star layers')

const starCounts = starLayerBlocks.map((block) => readOption(block, 'count'))
const maxBrightnesses = starLayerBlocks.map((block) => readOption(block, 'maxBrightness'))
const follows = starLayerBlocks.map((block) => readOption(block, 'follow'))
const baseStars = starCounts.reduce((sum, count) => sum + count, 0)
const backgroundStars = deepFieldStarCount + midFaintStarCount
const totalStars = baseStars + backgroundStars
const depthResponses = follows.map((follow) => follow * parallaxScale)

requireCondition(baseStars === 1000, `expected the established 1000-star foreground hierarchy, found ${baseStars}`)
requireCondition(totalStars >= 2500 && totalStars <= 3000, `visible deep-space population must stay within 2500–3000 stars, found ${totalStars}`)
requireCondition(deepFieldStarCount > baseStars, 'deep field must remain the dominant faint background population')
requireCondition(midFaintStarCount >= 150 && midFaintStarCount <= 350, `mid-faint fill layer escaped restrained budget: ${midFaintStarCount}`)
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

const deepFieldMatch = backgroundSource.match(/const deepFieldLayer = createSpaceStarLayer\(\{([\s\S]*?)\}\)/)
requireCondition(deepFieldMatch, 'missing dedicated deep-field star layer')
const deepFieldBlock = deepFieldMatch[1]
const deepSize = readOption(deepFieldBlock, 'size')
const deepOpacity = readOption(deepFieldBlock, 'opacity')
const deepMaxBrightness = readOption(deepFieldBlock, 'maxBrightness')
requireCondition(deepSize >= 0.95 && deepSize <= 1.2, `deep-field size must remain faint-but-visible, found ${deepSize}`)
requireCondition(deepOpacity >= 0.62 && deepOpacity <= 0.78, `deep-field opacity must remain faint-but-visible, found ${deepOpacity}`)
requireCondition(deepMaxBrightness >= 0.48 && deepMaxBrightness <= 0.60, `deep-field max brightness must remain visible but restrained, found ${deepMaxBrightness}`)
requireCondition(deepMaxBrightness < maxBrightnesses[0], 'deep-field maximum brightness must stay below the far foreground layer')
requireCondition(readOption(deepFieldBlock, 'follow') * parallaxScale < depthResponses[0], 'deep field must remain more distant than the far foreground layer')

const midFaintMatch = backgroundSource.match(/const midFaintLayer = createSpaceStarLayer\(\{([\s\S]*?)\}\)/)
requireCondition(midFaintMatch, 'missing full-sky mid-faint fill layer')
const midFaintBlock = midFaintMatch[1]
const midFaintSize = readOption(midFaintBlock, 'size')
const midFaintOpacity = readOption(midFaintBlock, 'opacity')
const midFaintMaxBrightness = readOption(midFaintBlock, 'maxBrightness')
const midFaintDepthResponse = readOption(midFaintBlock, 'follow') * parallaxScale
requireCondition(midFaintSize >= 1.0 && midFaintSize <= 1.3, `mid-faint star size escaped restrained range: ${midFaintSize}`)
requireCondition(midFaintOpacity >= 0.64 && midFaintOpacity <= 0.78, `mid-faint opacity escaped restrained range: ${midFaintOpacity}`)
requireCondition(midFaintMaxBrightness >= 0.50 && midFaintMaxBrightness <= 0.64, `mid-faint max brightness escaped restrained range: ${midFaintMaxBrightness}`)
requireCondition(midFaintMaxBrightness < maxBrightnesses[0], 'mid-faint stars must remain below the far foreground maximum brightness')
requireCondition(midFaintDepthResponse > readOption(deepFieldBlock, 'follow') * parallaxScale, 'mid-faint layer should sit perceptually in front of deep field')
requireCondition(midFaintDepthResponse < depthResponses[0], 'mid-faint layer must remain behind the established far foreground layer')

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
  backgroundSource.includes('const dustSuppression = dustLane * (0.30 + innerBand * 0.55)'),
  'dust lane suppression must stay below the previous full-strength blackening budget',
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
for (const layerName of ['deepFieldLayer', 'midFaintLayer']) {
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
  `space background regression ok: ${totalStars} stars (${deepFieldStarCount} deep-field + ${midFaintStarCount} mid-faint), ` +
    `${galaxySpecs.length} galaxies / ${clusterCount} cluster regions, ${textureSize}x${textureSize} shared point texture, ` +
    `OLED floor ${spaceBaseRed}/${spaceBaseGreen}/${spaceBaseBlue}, ` +
    `depth responses ${depthResponses.map((value) => (value * 100).toFixed(3)).join('% / ')}%, ` +
    `max angular displacement ${maxParallaxAngle.toFixed(2)}°`,
)
