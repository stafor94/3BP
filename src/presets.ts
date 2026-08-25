import { STELLAR_COLOR_BY_CLASS } from './starColors'
import type { BodyCount, BodyState, PresetId } from './types'

const colors = [
  STELLAR_COLOR_BY_CLASS.K,
  STELLAR_COLOR_BY_CLASS.B,
  STELLAR_COLOR_BY_CLASS.M,
  STELLAR_COLOR_BY_CLASS.A,
  STELLAR_COLOR_BY_CLASS.G,
  STELLAR_COLOR_BY_CLASS.O,
  STELLAR_COLOR_BY_CLASS.F,
]

const showcaseNames = ['Helios', 'Aster', 'Boreal', 'Crimson', 'Ivory', 'Nova']
const showcaseIds = ['a', 'b', 'c', 'd', 'e', 'f']

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

function tiltedPosition(radius: number, angle: number, inclination: number): [number, number, number] {
  return [
    radius * Math.cos(angle),
    radius * Math.sin(angle) * Math.cos(inclination),
    radius * Math.sin(angle) * Math.sin(inclination),
  ]
}

function tiltedVelocity(speed: number, angle: number, inclination: number): [number, number, number] {
  return [
    -speed * Math.sin(angle),
    speed * Math.cos(angle) * Math.cos(inclination),
    speed * Math.cos(angle) * Math.sin(inclination),
  ]
}

function createCentralCrownPreset(totalCount: 4 | 5 | 6): BodyState[] {
  const primaryMass = 8
  const satelliteMass = 0.06
  const ringRadius = 2
  const outerCount = totalCount - 1
  const inclination = (20 * Math.PI) / 180
  let interactionSum = 0

  for (let index = 1; index < outerCount; index += 1) {
    interactionSum += 1 / Math.sin((Math.PI * index) / outerCount)
  }

  const angularSpeed = Math.sqrt(
    primaryMass / ringRadius ** 3 +
    (satelliteMass * interactionSum) / (4 * ringRadius ** 3),
  )
  const orbitalSpeed = angularSpeed * ringRadius
  const result: BodyState[] = [
    body('a', 'Helios', primaryMass, 0.15, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
  ]

  for (let index = 0; index < outerCount; index += 1) {
    const angle = (index / outerCount) * Math.PI * 2
    result.push(
      body(
        showcaseIds[index + 1],
        showcaseNames[index + 1],
        satelliteMass,
        0.045,
        tiltedPosition(ringRadius, angle, inclination),
        tiltedVelocity(orbitalSpeed, angle, inclination),
        colors[(index + 1) % colors.length],
      ),
    )
  }

  return centerSystem(result)
}

function createNestedWorldsPreset(totalCount: 4 | 5 | 6): BodyState[] {
  const primaryMass = 8
  const orbitRadii = [1, 1.55, 2.25, 3.1, 4]
  const satelliteMasses = [0.025, 0.022, 0.019, 0.016, 0.014]
  const angles = [0, 2.4, 4.5, 1.2, 3.6]
  const inclinations = [0, 12, -16, 22, -10].map((degrees) => (degrees * Math.PI) / 180)
  const result: BodyState[] = [
    body('a', 'Helios', primaryMass, 0.15, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
  ]

  for (let index = 0; index < totalCount - 1; index += 1) {
    const orbitRadius = orbitRadii[index]
    const speed = Math.sqrt(primaryMass / orbitRadius)
    result.push(
      body(
        showcaseIds[index + 1],
        showcaseNames[index + 1],
        satelliteMasses[index],
        0.04,
        tiltedPosition(orbitRadius, angles[index], inclinations[index]),
        tiltedVelocity(speed, angles[index], inclinations[index]),
        colors[(index + 1) % colors.length],
      ),
    )
  }

  return centerSystem(result)
}

function createCrossedRingsPreset(totalCount: 4 | 5 | 6): BodyState[] {
  const primaryMass = 9
  const satelliteMass = 0.018
  const configurations: Record<4 | 5 | 6, Array<[number, number, number]>> = {
    4: [
      [1.15, 0, 0],
      [2.5, 0, 42],
      [2.5, Math.PI, 42],
    ],
    5: [
      [1.2, 0, -28],
      [1.2, Math.PI, -28],
      [2.7, Math.PI / 2, 38],
      [2.7, (Math.PI * 3) / 2, 38],
    ],
    6: [
      [1.25, 0, -32],
      [1.25, Math.PI, -32],
      [2.8, 0, 36],
      [2.8, (Math.PI * 2) / 3, 36],
      [2.8, (Math.PI * 4) / 3, 36],
    ],
  }
  const result: BodyState[] = [
    body('a', 'Helios', primaryMass, 0.155, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
  ]

  configurations[totalCount].forEach(([orbitRadius, angle, inclinationDegrees], index) => {
    const inclination = (inclinationDegrees * Math.PI) / 180
    const speed = Math.sqrt(primaryMass / orbitRadius)
    result.push(
      body(
        showcaseIds[index + 1],
        showcaseNames[index + 1],
        satelliteMass,
        0.04,
        tiltedPosition(orbitRadius, angle, inclination),
        tiltedVelocity(speed, angle, inclination),
        colors[(index + 1) % colors.length],
      ),
    )
  })

  return centerSystem(result)
}

function createPolygonDancePreset(totalCount: 4 | 5 | 6): BodyState[] {
  const mass = 1
  const ringRadius = 1.75
  const inclination = (-18 * Math.PI) / 180
  let interactionSum = 0

  for (let index = 1; index < totalCount; index += 1) {
    interactionSum += 1 / Math.sin((Math.PI * index) / totalCount)
  }

  const angularSpeed = Math.sqrt((mass * interactionSum) / (4 * ringRadius ** 3))
  const orbitalSpeed = angularSpeed * ringRadius
  const result: BodyState[] = []

  for (let index = 0; index < totalCount; index += 1) {
    const angle = (index / totalCount) * Math.PI * 2
    result.push(
      body(
        showcaseIds[index],
        showcaseNames[index],
        mass,
        0.055,
        tiltedPosition(ringRadius, angle, inclination),
        tiltedVelocity(orbitalSpeed, angle, inclination),
        colors[index % colors.length],
      ),
    )
  }

  return centerSystem(result)
}

export const PRESETS_BY_BODY_COUNT: Record<BodyCount, PresetId[]> = {
  1: ['singleDrift'],
  2: ['binaryOrbit', 'binaryEllipse', 'binaryUnequal', 'binaryWide', 'binaryInclined', 'binaryTight'],
  3: ['figure8', 'hierarchical', 'circumbinary', 'trojan', 'planetary', 'random'],
  4: ['quadCrown', 'quadNested', 'quadCrossed', 'quadDance'],
  5: ['pentaCrown', 'pentaNested', 'pentaCrossed', 'pentaDance'],
  6: ['hexaCrown', 'hexaNested', 'hexaCrossed', 'hexaDance'],
}

export const DEFAULT_PRESET_BY_BODY_COUNT: Record<BodyCount, PresetId> = {
  1: 'singleDrift',
  2: 'binaryOrbit',
  3: 'figure8',
  4: 'quadCrown',
  5: 'pentaCrown',
  6: 'hexaCrown',
}

export function getPresetBodyCount(id: PresetId): BodyCount {
  if (PRESETS_BY_BODY_COUNT[1].includes(id)) return 1
  if (PRESETS_BY_BODY_COUNT[2].includes(id)) return 2
  if (PRESETS_BY_BODY_COUNT[3].includes(id)) return 3
  if (PRESETS_BY_BODY_COUNT[4].includes(id)) return 4
  if (PRESETS_BY_BODY_COUNT[5].includes(id)) return 5
  return 6
}

export function singleDriftPreset(): BodyState[] {
  return [body('a', 'Alpha', 1, 0.09, [-1.2, -0.45, 0], [0.42, 0.16, 0], colors[0])]
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

export function quadCrownPreset() { return createCentralCrownPreset(4) }
export function quadNestedPreset() { return createNestedWorldsPreset(4) }
export function quadCrossedPreset() { return createCrossedRingsPreset(4) }
export function quadDancePreset() { return createPolygonDancePreset(4) }
export function pentaCrownPreset() { return createCentralCrownPreset(5) }
export function pentaNestedPreset() { return createNestedWorldsPreset(5) }
export function pentaCrossedPreset() { return createCrossedRingsPreset(5) }
export function pentaDancePreset() { return createPolygonDancePreset(5) }
export function hexaCrownPreset() { return createCentralCrownPreset(6) }
export function hexaNestedPreset() { return createNestedWorldsPreset(6) }
export function hexaCrossedPreset() { return createCrossedRingsPreset(6) }
export function hexaDancePreset() { return createPolygonDancePreset(6) }

export function getPreset(id: PresetId): BodyState[] {
  if (id === 'singleDrift') return singleDriftPreset()
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
  if (id === 'quadCrown') return quadCrownPreset()
  if (id === 'quadNested') return quadNestedPreset()
  if (id === 'quadCrossed') return quadCrossedPreset()
  if (id === 'quadDance') return quadDancePreset()
  if (id === 'pentaCrown') return pentaCrownPreset()
  if (id === 'pentaNested') return pentaNestedPreset()
  if (id === 'pentaCrossed') return pentaCrossedPreset()
  if (id === 'pentaDance') return pentaDancePreset()
  if (id === 'hexaCrown') return hexaCrownPreset()
  if (id === 'hexaNested') return hexaNestedPreset()
  if (id === 'hexaCrossed') return hexaCrossedPreset()
  if (id === 'hexaDance') return hexaDancePreset()
  return figure8Preset()
}
