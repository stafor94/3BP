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

export type TrailSample = {
  bodyId: string
  color: string
  position: Vec3
  simulatedAt: number
}

export type TrailSampleBatch = {
  sequence: number
  samples: TrailSample[]
}

export type SimulationSnapshot = {
  bodies: BodyState[]
  time: number
}

export type BodyCount = 1 | 2 | 3 | 4 | 5 | 6
export type SpaceMode = '2d' | '3d'

export type PresetId =
  | 'singleStill'
  | 'singleDrift'
  | 'singleFast'
  | 'single3d'
  | 'binaryOrbit'
  | 'binaryEllipse'
  | 'binaryUnequal'
  | 'binaryWide'
  | 'binaryInclined'
  | 'binaryTight'
  | 'figure8'
  | 'hierarchical'
  | 'circumbinary'
  | 'trojan'
  | 'planetary'
  | 'random'
  | 'quadCrown'
  | 'quadNested'
  | 'quadCrossed'
  | 'quadDance'
  | 'pentaCrown'
  | 'pentaNested'
  | 'pentaCrossed'
  | 'pentaDance'
  | 'hexaCrown'
  | 'hexaNested'
  | 'hexaCrossed'
  | 'hexaDance'
