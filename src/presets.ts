import type { BodyCount, BodyState, PresetId } from './types'

const colors = ['#ffb347', '#62a9ff', '#ff667f']

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

export const PRESETS_BY_BODY_COUNT: Record<BodyCount, PresetId[]> = {
  1: ['singleStill', 'singleDrift'],
  2: ['binaryOrbit', 'binaryCollision', 'binaryFlyby'],
  3: ['figure8', 'triangle', 'random'],
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

export function binaryOrbitPreset(): BodyState[] {
  // Two equal masses separated by 2 units. For G = 1, each body orbits
  // the barycenter at radius 1 with speed 0.5.
  return [
    body('a', 'Alpha', 1, 0.075, [-1, 0, 0], [0, -0.5, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [1, 0, 0], [0, 0.5, 0], colors[1]),
  ]
}

export function binaryCollisionPreset(): BodyState[] {
  return [
    body('a', 'Alpha', 1, 0.075, [-1.35, 0, 0], [0.18, 0, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [1.35, 0, 0], [-0.18, 0, 0], colors[1]),
  ]
}

export function binaryFlybyPreset(): BodyState[] {
  return [
    body('a', 'Alpha', 1.25, 0.085, [0, 0, 0], [0, 0, 0], colors[0]),
    body('b', 'Beta', 0.35, 0.06, [-2.4, -0.8, 0], [1.05, 0.27, 0], colors[1]),
  ]
}

export function figure8Preset(): BodyState[] {
  return [
    body('a', 'Alpha', 1, 0.075, [-0.97000436, 0.24308753, 0], [0.466203685, 0.43236573, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [0.97000436, -0.24308753, 0], [0.466203685, 0.43236573, 0], colors[1]),
    body('c', 'Gamma', 1, 0.075, [0, 0, 0], [-0.93240737, -0.86473146, 0], colors[2]),
  ]
}

export function trianglePreset(): BodyState[] {
  const r = 1
  const speed = Math.sqrt(1 / Math.sqrt(3))
  return [
    body('a', 'Alpha', 1, 0.075, [r, 0, 0], [0, speed, 0], colors[0]),
    body('b', 'Beta', 1, 0.075, [-r / 2, (Math.sqrt(3) * r) / 2, 0], [-(Math.sqrt(3) * speed) / 2, -speed / 2, 0], colors[1]),
    body('c', 'Gamma', 1, 0.075, [-r / 2, -(Math.sqrt(3) * r) / 2, 0], [(Math.sqrt(3) * speed) / 2, -speed / 2, 0], colors[2]),
  ]
}

export function randomPreset(): BodyState[] {
  const masses = colors.map(() => 0.82 + Math.random() * 0.36)
  const baseAngle = Math.random() * Math.PI * 2

  const rawPositions = colors.map((_, index) => {
    const angle = baseAngle + index * (Math.PI * 2 / 3) + (Math.random() - 0.5) * 0.34
    const radius = 1.05 + Math.random() * 0.5
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: (Math.random() - 0.5) * 0.18,
    }
  })

  const totalMass = masses.reduce((sum, mass) => sum + mass, 0)
  const centerPosition = rawPositions.reduce(
    (sum, position, index) => ({
      x: sum.x + position.x * masses[index],
      y: sum.y + position.y * masses[index],
      z: sum.z + position.z * masses[index],
    }),
    { x: 0, y: 0, z: 0 },
  )
  centerPosition.x /= totalMass
  centerPosition.y /= totalMass
  centerPosition.z /= totalMass

  const positions = rawPositions.map((position) => ({
    x: position.x - centerPosition.x,
    y: position.y - centerPosition.y,
    z: position.z - centerPosition.z,
  }))

  const meanRadius = positions.reduce((sum, position) => sum + Math.hypot(position.x, position.y), 0) / 3
  const angularSpeed = Math.sqrt(totalMass / Math.max(meanRadius ** 3, 0.25)) * (0.44 + Math.random() * 0.1)
  const direction = Math.random() < 0.5 ? -1 : 1

  const raw = colors.map((color, index) => {
    const position = positions[index]
    const jitter = 0.055
    return body(
      String.fromCharCode(97 + index),
      ['Alpha', 'Beta', 'Gamma'][index],
      masses[index],
      0.065,
      [position.x, position.y, position.z],
      [
        -position.y * angularSpeed * direction + (Math.random() - 0.5) * jitter,
        position.x * angularSpeed * direction + (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * 0.035,
      ],
      color,
    )
  })

  const centerVelocity = raw.reduce(
    (sum, item) => ({
      x: sum.x + item.velocity.x * item.mass,
      y: sum.y + item.velocity.y * item.mass,
      z: sum.z + item.velocity.z * item.mass,
    }),
    { x: 0, y: 0, z: 0 },
  )

  return raw.map((item) => ({
    ...item,
    velocity: {
      x: item.velocity.x - centerVelocity.x / totalMass,
      y: item.velocity.y - centerVelocity.y / totalMass,
      z: item.velocity.z - centerVelocity.z / totalMass,
    },
  }))
}

export function getPreset(id: PresetId): BodyState[] {
  if (id === 'singleStill') return singleStillPreset()
  if (id === 'singleDrift') return singleDriftPreset()
  if (id === 'binaryOrbit') return binaryOrbitPreset()
  if (id === 'binaryCollision') return binaryCollisionPreset()
  if (id === 'binaryFlyby') return binaryFlybyPreset()
  if (id === 'triangle') return trianglePreset()
  if (id === 'random') return randomPreset()
  return figure8Preset()
}
