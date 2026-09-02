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
  requireCondition(match, `missing ${name} in star layer`)
  return Number(match[1])
}

const textureSize = readNumericConstant('STAR_POINT_TEXTURE_SIZE')
const brightnessExponent = readNumericConstant('STAR_BRIGHTNESS_EXPONENT')
const parallaxScale = readNumericConstant('STAR_PARALLAX_SCALE')
const maxParallaxAngle = readNumericConstant('STAR_PARALLAX_MAX_ANGLE_DEGREES')

requireCondition(textureSize >= 16 && textureSize <= 32, 'star point texture must stay within 16–32 px')
requireCondition(brightnessExponent >= 2.35 && brightnessExponent <= 3.0, 'brightness hierarchy drifted outside restrained range')
requireCondition(parallaxScale > 0 && parallaxScale <= 0.05, 'parallax scale exceeds restrained depth budget')
requireCondition(maxParallaxAngle > 0 && maxParallaxAngle <= 0.25, 'parallax angular cap exceeds 0.25 degrees')

const starLayerBlocks = [...rendererSource.matchAll(/createSpaceStarLayer\(\{([\s\S]*?)\}\)/g)].map((match) => match[1])
requireCondition(starLayerBlocks.length === 3, 'expected exactly three THREE.Points star layers')

const starCounts = starLayerBlocks.map((block) => readOption(block, 'count'))
const maxBrightnesses = starLayerBlocks.map((block) => readOption(block, 'maxBrightness'))
const follows = starLayerBlocks.map((block) => readOption(block, 'follow'))
const totalStars = starCounts.reduce((sum, count) => sum + count, 0)
const depthResponses = follows.map((follow) => follow * parallaxScale)

requireCondition(totalStars === 1000, `expected 1000 stars, found ${totalStars}`)
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
requireCondition(
  !backgroundSource.includes('requestAnimationFrame') && !backgroundSource.includes('performance.now'),
  'space background must not add time-based animation',
)

console.log(
  `space background regression ok: ${totalStars} stars, ${textureSize}x${textureSize} shared point texture, ` +
    `depth responses ${depthResponses.map((value) => (value * 100).toFixed(3)).join('% / ')}%, ` +
    `max angular displacement ${maxParallaxAngle.toFixed(2)}°`,
)
