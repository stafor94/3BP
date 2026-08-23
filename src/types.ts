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

export type BodyCount = 1 | 2 | 3

export type PresetId =
  | 'singleStill'
  | 'singleDrift'
  | 'singleFast'
  | 'single3d'
  | 'binaryOrbit'
  | 'binaryEllipse'
  | 'binaryUnequal'
  | 'binaryCollision'
  | 'binaryFlyby'
  | 'binaryEscape'
  | 'figure8'
  | 'triangle'
  | 'hierarchical'
  | 'pythagorean'
  | 'tripleCollision'
  | 'random'
