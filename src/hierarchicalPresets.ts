import { STELLAR_COLOR_BY_CLASS } from './starColors'
import type { BodyState, PresetId } from './types'

type VecTuple = [number, number, number]

type LocalBody = {
  id: string
  name: string
  mass: number
  radius: number
  position: VecTuple
  velocity: VecTuple
  color: string
}

const STAR_MASS = 7

function add(a: VecTuple, b: VecTuple): VecTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function body(
  id: string,
  name: string,
  mass: number,
  radius: number,
  position: VecTuple,
  velocity: VecTuple,
  color: string,
): BodyState {
  return {
    id,
    name,
    mass,
    radius,
    color,
    position: { x: position[0], y: position[1], z: position[2] },
    velocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
  }
}

function orbitalPosition(radius: number, angle: number, inclination: number): VecTuple {
  return [
    radius * Math.cos(angle),
    radius * Math.sin(angle) * Math.cos(inclination),
    radius * Math.sin(angle) * Math.sin(inclination),
  ]
}

function orbitalVelocity(speed: number, angle: number, inclination: number): VecTuple {
  return [
    -speed * Math.sin(angle),
    speed * Math.cos(angle) * Math.cos(inclination),
    speed * Math.cos(angle) * Math.sin(inclination),
  ]
}

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

function weightedCenter(localBodies: LocalBody[], key: 'position' | 'velocity'): VecTuple {
  const totalMass = localBodies.reduce((sum, item) => sum + item.mass, 0)
  return [
    localBodies.reduce((sum, item) => sum + item[key][0] * item.mass, 0) / totalMass,
    localBodies.reduce((sum, item) => sum + item[key][1] * item.mass, 0) / totalMass,
    localBodies.reduce((sum, item) => sum + item[key][2] * item.mass, 0) / totalMass,
  ]
}

function placeSubsystem(
  barycenterPosition: VecTuple,
  barycenterVelocity: VecTuple,
  localBodies: LocalBody[],
): BodyState[] {
  const localCenterPosition = weightedCenter(localBodies, 'position')
  const localCenterVelocity = weightedCenter(localBodies, 'velocity')

  return localBodies.map((item) => {
    const centeredPosition: VecTuple = [
      item.position[0] - localCenterPosition[0],
      item.position[1] - localCenterPosition[1],
      item.position[2] - localCenterPosition[2],
    ]
    const centeredVelocity: VecTuple = [
      item.velocity[0] - localCenterVelocity[0],
      item.velocity[1] - localCenterVelocity[1],
      item.velocity[2] - localCenterVelocity[2],
    ]
    return body(
      item.id,
      item.name,
      item.mass,
      item.radius,
      add(barycenterPosition, centeredPosition),
      add(barycenterVelocity, centeredVelocity),
      item.color,
    )
  })
}

function createAtlasSubsystem(twoMoons: boolean): BodyState[] {
  const planetMass = 1
  const orbitRadius = 2.45
  const orbitAngle = 0
  const inclination = (8 * Math.PI) / 180
  const barycenterPosition = orbitalPosition(orbitRadius, orbitAngle, inclination)
  const barycenterVelocity = orbitalVelocity(
    Math.sqrt((STAR_MASS + planetMass) / orbitRadius),
    orbitAngle,
    inclination,
  )

  const moonOneMass = 0.002
  const moonOneRadius = 0.18
  const moonOneAngle = 0.6
  const moonOneSpeed = Math.sqrt((planetMass + moonOneMass) / moonOneRadius)
  const localBodies: LocalBody[] = [
    {
      id: 'b',
      name: 'Atlas',
      mass: planetMass,
      radius: 0.075,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      color: STELLAR_COLOR_BY_CLASS.K,
    },
    {
      id: 'c',
      name: 'Selene',
      mass: moonOneMass,
      radius: 0.018,
      position: orbitalPosition(moonOneRadius, moonOneAngle, inclination),
      velocity: orbitalVelocity(moonOneSpeed, moonOneAngle, inclination),
      color: STELLAR_COLOR_BY_CLASS.A,
    },
  ]

  if (twoMoons) {
    const moonTwoMass = 0.001
    const moonTwoRadius = 0.34
    const moonTwoAngle = 3
    const moonTwoSpeed = Math.sqrt((planetMass + moonTwoMass) / moonTwoRadius)
    localBodies.push({
      id: 'd',
      name: 'Nyx',
      mass: moonTwoMass,
      radius: 0.018,
      position: orbitalPosition(moonTwoRadius, moonTwoAngle, inclination),
      velocity: orbitalVelocity(moonTwoSpeed, moonTwoAngle, inclination),
      color: STELLAR_COLOR_BY_CLASS.B,
    })
  }

  return placeSubsystem(barycenterPosition, barycenterVelocity, localBodies)
}

function createOuterPlanet(id: string): BodyState {
  const mass = 0.05
  const orbitRadius = 4.45
  const angle = Math.PI
  const inclination = (-12 * Math.PI) / 180
  return body(
    id,
    'Ember',
    mass,
    0.04,
    orbitalPosition(orbitRadius, angle, inclination),
    orbitalVelocity(Math.sqrt(STAR_MASS / orbitRadius), angle, inclination),
    STELLAR_COLOR_BY_CLASS.M,
  )
}

function createBorealSubsystem(): BodyState[] {
  const planetMass = 0.35
  const orbitRadius = 4.55
  const orbitAngle = Math.PI
  const inclination = (-10 * Math.PI) / 180
  const barycenterPosition = orbitalPosition(orbitRadius, orbitAngle, inclination)
  const barycenterVelocity = orbitalVelocity(
    Math.sqrt((STAR_MASS + planetMass) / orbitRadius),
    orbitAngle,
    inclination,
  )

  const moonMass = 0.001
  const moonRadius = 0.22
  const moonAngle = 2
  const moonSpeed = Math.sqrt((planetMass + moonMass) / moonRadius)

  return placeSubsystem(barycenterPosition, barycenterVelocity, [
    {
      id: 'e',
      name: 'Boreal',
      mass: planetMass,
      radius: 0.05,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      color: STELLAR_COLOR_BY_CLASS.O,
    },
    {
      id: 'f',
      name: 'Echo',
      mass: moonMass,
      radius: 0.016,
      position: orbitalPosition(moonRadius, moonAngle, inclination),
      velocity: orbitalVelocity(moonSpeed, moonAngle, inclination),
      color: STELLAR_COLOR_BY_CLASS.F,
    },
  ])
}

export function createHierarchicalMoonPreset(totalCount: 4 | 5 | 6): BodyState[] {
  const result: BodyState[] = [
    body('a', 'Helios', STAR_MASS, 0.16, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
  ]

  if (totalCount === 4) {
    result.push(...createAtlasSubsystem(false), createOuterPlanet('d'))
  } else if (totalCount === 5) {
    result.push(...createAtlasSubsystem(true), createOuterPlanet('e'))
  } else {
    result.push(...createAtlasSubsystem(true), ...createBorealSubsystem())
  }

  return centerSystem(result)
}

export function getHierarchicalPresetOverride(id: PresetId): BodyState[] | null {
  if (id === 'quadNested') return createHierarchicalMoonPreset(4)
  if (id === 'pentaNested') return createHierarchicalMoonPreset(5)
  if (id === 'hexaNested') return createHierarchicalMoonPreset(6)
  return null
}
