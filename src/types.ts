export type Vec3 = { x: number; y: number; z: number }

export type BodyState = {
  id: string
  name: string
  color: string
  mass: number
  radius: number
  position: Vec3
  velocity: Vec3
}

export type SimulationSnapshot = {
  bodies: BodyState[]
  time: number
}

export type PresetId = 'figure8' | 'triangle' | 'random'
