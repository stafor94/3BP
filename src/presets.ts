import type { BodyState, PresetId } from './types'

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
  const raw = colors.map((color, index) =>
    body(
      String.fromCharCode(97 + index),
      ['Alpha', 'Beta', 'Gamma'][index],
      0.65 + Math.random() * 0.7,
      0.07,
      [(Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 0.8],
      [(Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.25],
      color,
    ),
  )

  const totalMass = raw.reduce((sum, item) => sum + item.mass, 0)
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
  if (id === 'triangle') return trianglePreset()
  if (id === 'random') return randomPreset()
  return figure8Preset()
}
