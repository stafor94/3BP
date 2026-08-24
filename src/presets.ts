import { STELLAR_COLOR_BY_CLASS } from './starColors'
import type { BodyCount, BodyState, PresetId } from './types'

const colors = [STELLAR_COLOR_BY_CLASS.K, STELLAR_COLOR_BY_CLASS.B, STELLAR_COLOR_BY_CLASS.M]

const body = (
  id: string,
  name: string,
  mass: number,
  radius: number,
  position: [number, number, number],
  velocity: [number, number, number],
  color: string,
): BodyState => ({
  id,
  name,
  mass,
  radius,
  color,
  position: { x: position[0], y: position[1], z: position[2] },
  velocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
})

function centerSystem(input: BodyState[]): BodyState[] {
  const totalMass = input.reduce((sum, item) => sum + item.mass, 0)
  const centerPosition = input.reduce(
    (sum, item) => ({
      x: sum.x + item.position.x * item.mass,
      y: sum.y + item.position.y * item.mass,
      z: sum.z + item.position.z * item.mass,
    }),
    { x: 0, y: 0, z: 0 },
  )
  const centerVelocity = input.reduce(
    (sum, item) => ({
      x: sum.x + item.velocity.x * item.mass,
      y: sum.y + item.velocity.y * item.mass,
      z: sum.z + item.velocity.z * item.mass,
    }),
    { x: 0, y: 0, z: 0 },
  )

  return input.map((item) => ({
    ...item,
    position: {
      x: item.position.x - centerPosition.x / totalMass,
      y: item.position.y - centerPosition.y / totalMass,
      z: item.position.z - centerPosition.z / totalMass,
    },
    velocity: {
      x: item.velocity.x - centerVelocity.x / totalMass,
      y: item.velocity.y - centerVelocity.y / totalMass,
      z: item.velocity.z - centerVelocity.z / totalMass,
    },
  }))
}

export const PRESETS_BY_BODY_COUNT: Record<BodyCount, PresetId[]> = {
  1: ['singleStill', 'singleDrift', 'singleFast', 'single3d'],
  2: ['binaryOrbit', 'binaryEllipse', 'binaryUnequal', 'binaryWide', 'binaryInclined', 'binaryTight'],
  3: ['figure8', 'hierarchical', 'circumbinary', 'trojan', 'planetary', 'random'],
}

export const DEFAULT_PRESET_BY_BODY_COUNT: Record<BodyCount, PresetId> = {
  1: 'singleStill',
  2: 'binaryOrbit',
  3: 'figure8',
}

export function getPresetBodyCount(id: PresetId): BodyCount {
  if (PRESETS_BY_BODY_COUNT[1].includes(id)) return 1
  if (PRESETS_BY_BODY_COUNT[2].includes(id)) return 2
  return 3
}

export function singleStillPreset(): BodyState[] {
  return [body('a', 'Alpha', 1, 0.09, [0, 0, 0], [0, 0, 0], colors[0])]
}

export function singleDriftPreset(): BodyState[] {
  return [body('a', 'Alpha', 1, 0.09, [-1.2, -0.45, 0], [0.42, 0.16, 0], colors[0])]
}

export function singleFastPreset(): BodyState[] {
  return [body('a', 'Alpha', 1, 0.09, [-1.8, 0.2, 0], [1.1, -0.03, 0], colors[0])]
}

export function single3dPreset(): BodyState[] {
  return [body('a', 'Alpha', 1, 0.09, [-1, -0.7, -0.8], [0.36, 0.24, 0.2], colors[0])]
}

export function binaryOrbitPreset(): BodyState[] {
  return [
    body('a', 'Alpha', 1, 0.075, [-1, 0, 0], [0, -0.5, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [1, 0, 0], [0, 0.5, 0], colors[1]),
  ]
}

export function binaryEllipsePreset(): BodyState[] {
  return [
    body('a', 'Alpha', 1, 0.075, [-1, 0, 0], [0, -0.34, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [1, 0, 0], [0, 0.34, 0], colors[1]),
  ]
}

export function binaryUnequalPreset(): BodyState[] {
  return [
    body('a', 'Alpha', 1.5, 0.09, [-0.5, 0, 0], [0, -0.25, 0], colors[0]),
    body('b', 'Beta', 0.5, 0.06, [1.5, 0, 0], [0, 0.75, 0], colors[1]),
  ]
}

export function binaryWidePreset(): BodyState[] {
  const separation = 3
  const orbitRadius = separation / 2
  const speed = Math.sqrt(orbitRadius / separation ** 2)
  return [
    body('a', 'Alpha', 1, 0.075, [-orbitRadius, 0, 0], [0, -speed, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [orbitRadius, 0, 0], [0, speed, 0], colors[1]),
  ]
}

export function binaryInclinedPreset(): BodyState[] {
  const tilt = Math.PI / 4
  const ySpeed = 0.5 * Math.cos(tilt)
  const zSpeed = 0.5 * Math.sin(tilt)
  return [
    body('a', 'Alpha', 1, 0.075, [-1, 0, 0], [0, -ySpeed, -zSpeed], colors[0]),
    body('b', 'Beta', 1, 0.075, [1, 0, 0], [0, ySpeed, zSpeed], colors[1]),
  ]
}

export function binaryTightPreset(): BodyState[] {
  const separation = 1.2
  const orbitRadius = separation / 2
  const speed = Math.sqrt(orbitRadius / separation ** 2)
  return [
    body('a', 'Alpha', 1, 0.06, [-orbitRadius, 0, 0], [0, -speed, 0], colors[0]),
    body('b', 'Beta', 1, 0.06, [orbitRadius, 0, 0], [0, speed, 0], colors[1]),
  ]
}

export function figure8Preset(): BodyState[] {
  return [
    body('a', 'Alpha', 1, 0.075, [-0.97000436, 0.24308753, 0], [0.466203685, 0.43236573, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [0.97000436, -0.24308753, 0], [0.466203685, 0.43236573, 0], colors[1]),
    body('c', 'Gamma', 1, 0.075, [0, 0, 0], [-0.93240737, -0.86473146, 0], colors[2]),
  ]
}

export function hierarchicalPreset(): BodyState[] {
  return [
    body('a', 'Primary', 4, 0.11, [0, 0, 0], [0, -0.1293, 0], colors[0]),
    body('b', 'Inner', 0.35, 0.055, [1, 0, 0], [0, 1.92, 0], colors[1]),
    body('c', 'Outer', 0.12, 0.045, [-2.6, 0, 0], [0, -1.29, 0], colors[2]),
  ]
}

export function circumbinaryPreset(): BodyState[] {
  const separation = 1.2
  const starOrbitRadius = separation / 2
  const starSpeed = Math.sqrt(starOrbitRadius / separation ** 2)
  const outerRadius = 3.5
  const outerSpeed = Math.sqrt(2 / outerRadius)

  return centerSystem([
    body('a', 'Star A', 1, 0.08, [-starOrbitRadius, 0, 0], [0, -starSpeed, 0], colors[0]),
    body('b', 'Star B', 1, 0.08, [starOrbitRadius, 0, 0], [0, starSpeed, 0], colors[1]),
    body('c', 'Outer', 0.05, 0.045, [0, outerRadius, 0], [-outerSpeed, 0, 0], colors[2]),
  ])
}

export function trojanPreset(): BodyState[] {
  const side = 2.4
  const masses = [5, 0.2, 0.02]
  const angularSpeed = Math.sqrt(masses.reduce((sum, mass) => sum + mass, 0) / side ** 3)
  const raw = [
    body('a', 'Primary', masses[0], 0.12, [0, 0, 0], [0, 0, 0], colors[0]),
    body('b', 'Planet', masses[1], 0.06, [side, 0, 0], [0, angularSpeed * side, 0], colors[1]),
    body(
      'c',
      'Trojan',
      masses[2],
      0.04,
      [side / 2, (Math.sqrt(3) * side) / 2, 0],
      [-(Math.sqrt(3) * angularSpeed * side) / 2, (angularSpeed * side) / 2, 0],
      colors[2],
    ),
  ]

  return centerSystem(raw)
}

export function planetaryPreset(): BodyState[] {
  const primaryMass = 5
  const innerMass = 0.12
  const outerMass = 0.08
  const innerRadius = 1.15
  const outerRadius = 2.45
  const inclination = (22 * Math.PI) / 180
  const innerSpeed = Math.sqrt(primaryMass / innerRadius)
  const outerSpeed = Math.sqrt(primaryMass / outerRadius)

  return centerSystem([
    body('a', 'Primary', primaryMass, 0.12, [0, 0, 0], [0, 0, 0], colors[0]),
    body('b', 'Inner', innerMass, 0.05, [innerRadius, 0, 0], [0, innerSpeed, 0], colors[1]),
    body(
      'c',
      'Outer',
      outerMass,
      0.045,
      [-outerRadius, 0, 0],
      [0, -outerSpeed * Math.cos(inclination), -outerSpeed * Math.sin(inclination)],
      colors[2],
    ),
  ])
}

export function randomPreset(): BodyState[] {
  // Randomize a star-dominated two-planet system instead of an equal-mass chaotic
  // triangle. This keeps each reset visually different while avoiding the common
  // failure mode where all three bodies merge after only a few seconds.
  const primaryMass = 4.5 + Math.random()
  const innerMass = 0.05 + Math.random() * 0.07
  const outerMass = 0.03 + Math.random() * 0.06
  const innerRadius = 1 + Math.random() * 0.35
  const outerRadius = 2.4 + Math.random() * 0.7
  const innerAngle = Math.random() * Math.PI * 2
  const outerAngle = innerAngle + Math.PI + (Math.random() - 0.5) * 0.5
  const inclination = (Math.random() - 0.5) * ((24 * Math.PI) / 180)
  const innerSpeed = Math.sqrt(primaryMass / innerRadius)
  const outerSpeed = Math.sqrt(primaryMass / outerRadius)

  const innerPosition: [number, number, number] = [
    innerRadius * Math.cos(innerAngle),
    innerRadius * Math.sin(innerAngle),
    0,
  ]
  const outerPosition: [number, number, number] = [
    outerRadius * Math.cos(outerAngle),
    outerRadius * Math.sin(outerAngle) * Math.cos(inclination),
    outerRadius * Math.sin(outerAngle) * Math.sin(inclination),
  ]
  const innerVelocity: [number, number, number] = [
    -innerSpeed * Math.sin(innerAngle),
    innerSpeed * Math.cos(innerAngle),
    0,
  ]
  const outerVelocity: [number, number, number] = [
    -outerSpeed * Math.sin(outerAngle),
    outerSpeed * Math.cos(outerAngle) * Math.cos(inclination),
    outerSpeed * Math.cos(outerAngle) * Math.sin(inclination),
  ]

  return centerSystem([
    body('a', 'Primary', primaryMass, 0.115, [0, 0, 0], [0, 0, 0], colors[0]),
    body('b', 'Inner', innerMass, 0.045, innerPosition, innerVelocity, colors[1]),
    body('c', 'Outer', outerMass, 0.04, outerPosition, outerVelocity, colors[2]),
  ])
}

export function getPreset(id: PresetId): BodyState[] {
  if (id === 'singleStill') return singleStillPreset()
  if (id === 'singleDrift') return singleDriftPreset()
  if (id === 'singleFast') return singleFastPreset()
  if (id === 'single3d') return single3dPreset()
  if (id === 'binaryOrbit') return binaryOrbitPreset()
  if (id === 'binaryEllipse') return binaryEllipsePreset()
  if (id === 'binaryUnequal') return binaryUnequalPreset()
  if (id === 'binaryWide') return binaryWidePreset()
  if (id === 'binaryInclined') return binaryInclinedPreset()
  if (id === 'binaryTight') return binaryTightPreset()
  if (id === 'hierarchical') return hierarchicalPreset()
  if (id === 'circumbinary') return circumbinaryPreset()
  if (id === 'trojan') return trojanPreset()
  if (id === 'planetary') return planetaryPreset()
  if (id === 'random') return randomPreset()
  return figure8Preset()
}
