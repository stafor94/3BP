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
  return [a[0] + b[0], a[1] + b[1], 0]
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
    position: { x: position[0], y: position[1], z: 0 },
    velocity: { x: velocity[0], y: velocity[1], z: 0 },
  }
}

function orbitalPosition(radius: number, angle: number): VecTuple {
  return [radius * Math.cos(angle), radius * Math.sin(angle), 0]
}

function orbitalVelocity(speed: number, angle: number): VecTuple {
  return [-speed * Math.sin(angle), speed * Math.cos(angle), 0]
}

function centerSystem(input: BodyState[]): BodyState[] {
  const totalMass = input.reduce((sum, item) => sum + item.mass, 0)
  const centerPosition = input.reduce(
    (sum, item) => ({
      x: sum.x + item.position.x * item.mass,
      y: sum.y + item.position.y * item.mass,
      z: 0,
    }),
    { x: 0, y: 0, z: 0 },
  )
  const centerVelocity = input.reduce(
    (sum, item) => ({
      x: sum.x + item.velocity.x * item.mass,
      y: sum.y + item.velocity.y * item.mass,
      z: 0,
    }),
    { x: 0, y: 0, z: 0 },
  )

  return input.map((item) => ({
    ...item,
    position: {
      x: item.position.x - centerPosition.x / totalMass,
      y: item.position.y - centerPosition.y / totalMass,
      z: 0,
    },
    velocity: {
      x: item.velocity.x - centerVelocity.x / totalMass,
      y: item.velocity.y - centerVelocity.y / totalMass,
      z: 0,
    },
  }))
}

function weightedCenter(localBodies: LocalBody[], key: 'position' | 'velocity'): VecTuple {
  const totalMass = localBodies.reduce((sum, item) => sum + item.mass, 0)
  return [
    localBodies.reduce((sum, item) => sum + item[key][0] * item.mass, 0) / totalMass,
    localBodies.reduce((sum, item) => sum + item[key][1] * item.mass, 0) / totalMass,
    0,
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
      0,
    ]
    const centeredVelocity: VecTuple = [
      item.velocity[0] - localCenterVelocity[0],
      item.velocity[1] - localCenterVelocity[1],
      0,
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
  const barycenterPosition = orbitalPosition(orbitRadius, orbitAngle)
  const barycenterVelocity = orbitalVelocity(Math.sqrt((STAR_MASS + planetMass) / orbitRadius), orbitAngle)

  const moonOneMass = 0.002
  const moonOneRadius = 0.18
  const moonOneAngle = 0.6
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
      position: orbitalPosition(moonOneRadius, moonOneAngle),
      velocity: orbitalVelocity(Math.sqrt((planetMass + moonOneMass) / moonOneRadius), moonOneAngle),
      color: STELLAR_COLOR_BY_CLASS.A,
    },
  ]

  if (twoMoons) {
    const moonTwoMass = 0.001
    const moonTwoRadius = 0.34
    const moonTwoAngle = 3
    localBodies.push({
      id: 'd',
      name: 'Nyx',
      mass: moonTwoMass,
      radius: 0.018,
      position: orbitalPosition(moonTwoRadius, moonTwoAngle),
      velocity: orbitalVelocity(Math.sqrt((planetMass + moonTwoMass) / moonTwoRadius), moonTwoAngle),
      color: STELLAR_COLOR_BY_CLASS.B,
    })
  }

  return placeSubsystem(barycenterPosition, barycenterVelocity, localBodies)
}

function createOuterPlanet(id: string): BodyState {
  const mass = 0.05
  const orbitRadius = 4.45
  const angle = Math.PI
  return body(
    id,
    'Ember',
    mass,
    0.04,
    orbitalPosition(orbitRadius, angle),
    orbitalVelocity(Math.sqrt(STAR_MASS / orbitRadius), angle),
    STELLAR_COLOR_BY_CLASS.M,
  )
}

function createBorealSubsystem(): BodyState[] {
  const planetMass = 0.35
  const orbitRadius = 4.55
  const orbitAngle = Math.PI
  const barycenterPosition = orbitalPosition(orbitRadius, orbitAngle)
  const barycenterVelocity = orbitalVelocity(Math.sqrt((STAR_MASS + planetMass) / orbitRadius), orbitAngle)

  const moonMass = 0.001
  const moonRadius = 0.22
  const moonAngle = 2
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
      position: orbitalPosition(moonRadius, moonAngle),
      velocity: orbitalVelocity(Math.sqrt((planetMass + moonMass) / moonRadius), moonAngle),
      color: STELLAR_COLOR_BY_CLASS.F,
    },
  ])
}

function createPlanetMoonHierarchy(totalCount: 4 | 5 | 6): BodyState[] {
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

function createCircumbinaryFamily(totalCount: 4 | 5 | 6): BodyState[] {
  const starOneMass = 1.5
  const starTwoMass = 1
  const binaryMass = starOneMass + starTwoMass
  const separation = 0.8
  const angularSpeed = Math.sqrt(binaryMass / separation ** 3)
  const starOneRadius = separation * starTwoMass / binaryMass
  const starTwoRadius = separation * starOneMass / binaryMass

  const result: BodyState[] = [
    body(
      'a',
      'Aurelia',
      starOneMass,
      0.075,
      [-starOneRadius, 0, 0],
      [0, -angularSpeed * starOneRadius, 0],
      STELLAR_COLOR_BY_CLASS.F,
    ),
    body(
      'b',
      'Vesper',
      starTwoMass,
      0.065,
      [starTwoRadius, 0, 0],
      [0, angularSpeed * starTwoRadius, 0],
      STELLAR_COLOR_BY_CLASS.M,
    ),
  ]

  const planetMass = 0.28
  const orbitRadius = 3.2
  const orbitAngle = Math.PI / 2
  const barycenterPosition = orbitalPosition(orbitRadius, orbitAngle)
  const barycenterVelocity = orbitalVelocity(Math.sqrt((binaryMass + planetMass) / orbitRadius), orbitAngle)
  const localBodies: LocalBody[] = [
    {
      id: 'c',
      name: 'Janus',
      mass: planetMass,
      radius: 0.055,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      color: STELLAR_COLOR_BY_CLASS.K,
    },
  ]

  const firstMoonMass = 0.0015
  const firstMoonRadius = 0.18
  const firstMoonAngle = 0.4
  localBodies.push({
    id: 'd',
    name: 'Luna',
    mass: firstMoonMass,
    radius: 0.015,
    position: orbitalPosition(firstMoonRadius, firstMoonAngle),
    velocity: orbitalVelocity(Math.sqrt((planetMass + firstMoonMass) / firstMoonRadius), firstMoonAngle),
    color: STELLAR_COLOR_BY_CLASS.A,
  })

  if (totalCount >= 5) {
    const secondMoonMass = 0.0008
    const secondMoonRadius = 0.32
    const secondMoonAngle = 2.8
    localBodies.push({
      id: 'e',
      name: 'Nereid',
      mass: secondMoonMass,
      radius: 0.014,
      position: orbitalPosition(secondMoonRadius, secondMoonAngle),
      velocity: orbitalVelocity(Math.sqrt((planetMass + secondMoonMass) / secondMoonRadius), secondMoonAngle),
      color: STELLAR_COLOR_BY_CLASS.B,
    })
  }

  result.push(...placeSubsystem(barycenterPosition, barycenterVelocity, localBodies))

  if (totalCount === 6) {
    const outerMass = 0.035
    const outerRadius = 5.4
    const outerAngle = Math.PI
    result.push(
      body(
        'f',
        'Cinder',
        outerMass,
        0.035,
        orbitalPosition(outerRadius, outerAngle),
        orbitalVelocity(Math.sqrt(binaryMass / outerRadius), outerAngle),
        STELLAR_COLOR_BY_CLASS.O,
      ),
    )
  }

  return centerSystem(result)
}

function createThreePlanetShowcase(): BodyState[] {
  const primaryMass = 8
  const result: BodyState[] = [
    body('a', 'Helios', primaryMass, 0.16, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
  ]
  const configurations: Array<[string, string, number, number, number, string]> = [
    ['b', 'Swift', 0.04, 1.25, 0, STELLAR_COLOR_BY_CLASS.B],
    ['c', 'Cobalt', 0.025, 2.45, 2.2, STELLAR_COLOR_BY_CLASS.O],
    ['d', 'Ember', 0.018, 3.75, 4.3, STELLAR_COLOR_BY_CLASS.M],
  ]

  configurations.forEach(([id, name, mass, orbitRadius, angle, color]) => {
    result.push(
      body(
        id,
        name,
        mass,
        0.038,
        orbitalPosition(orbitRadius, angle),
        orbitalVelocity(Math.sqrt(primaryMass / orbitRadius), angle),
        color,
      ),
    )
  })

  return centerSystem(result)
}

function createTrojanMoonSystem(): BodyState[] {
  const primaryMass = 8
  const planetMass = 0.35
  const orbitRadius = 2.6
  const barycenterPosition = orbitalPosition(orbitRadius, 0)
  const barycenterVelocity = orbitalVelocity(Math.sqrt((primaryMass + planetMass) / orbitRadius), 0)
  const moonMass = 0.0015
  const moonRadius = 0.17
  const moonAngle = 1.2

  const result: BodyState[] = [
    body('a', 'Helios', primaryMass, 0.16, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
    ...placeSubsystem(barycenterPosition, barycenterVelocity, [
      {
        id: 'b',
        name: 'Atlas',
        mass: planetMass,
        radius: 0.06,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        color: STELLAR_COLOR_BY_CLASS.K,
      },
      {
        id: 'c',
        name: 'Selene',
        mass: moonMass,
        radius: 0.016,
        position: orbitalPosition(moonRadius, moonAngle),
        velocity: orbitalVelocity(Math.sqrt((planetMass + moonMass) / moonRadius), moonAngle),
        color: STELLAR_COLOR_BY_CLASS.A,
      },
    ]),
  ]

  const trojanAngle = Math.PI / 3
  result.push(
    body(
      'd',
      'Trojan',
      0.004,
      0.022,
      orbitalPosition(orbitRadius, trojanAngle),
      orbitalVelocity(Math.sqrt(primaryMass / orbitRadius), trojanAngle),
      STELLAR_COLOR_BY_CLASS.B,
    ),
  )

  const outerRadius = 4.6
  const outerAngle = Math.PI * 1.25
  result.push(
    body(
      'e',
      'Ember',
      0.025,
      0.036,
      orbitalPosition(outerRadius, outerAngle),
      orbitalVelocity(Math.sqrt(primaryMass / outerRadius), outerAngle),
      STELLAR_COLOR_BY_CLASS.M,
    ),
  )

  return centerSystem(result)
}

function createSixBodyPlanetarySystem(): BodyState[] {
  const primaryMass = 8
  const planetMass = 0.32
  const planetOrbitRadius = 2.35
  const planetAngle = 0.3
  const barycenterPosition = orbitalPosition(planetOrbitRadius, planetAngle)
  const barycenterVelocity = orbitalVelocity(
    Math.sqrt((primaryMass + planetMass) / planetOrbitRadius),
    planetAngle,
  )
  const moonMass = 0.0014
  const moonRadius = 0.16
  const moonAngle = 2

  const result: BodyState[] = [
    body('a', 'Helios', primaryMass, 0.16, [0, 0, 0], [0, 0, 0], STELLAR_COLOR_BY_CLASS.G),
    ...placeSubsystem(barycenterPosition, barycenterVelocity, [
      {
        id: 'b',
        name: 'Atlas',
        mass: planetMass,
        radius: 0.06,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        color: STELLAR_COLOR_BY_CLASS.K,
      },
      {
        id: 'c',
        name: 'Selene',
        mass: moonMass,
        radius: 0.016,
        position: orbitalPosition(moonRadius, moonAngle),
        velocity: orbitalVelocity(Math.sqrt((planetMass + moonMass) / moonRadius), moonAngle),
        color: STELLAR_COLOR_BY_CLASS.A,
      },
    ]),
  ]

  const configurations: Array<[string, string, number, number, number, string]> = [
    ['d', 'Swift', 0.028, 1.15, 3.1, STELLAR_COLOR_BY_CLASS.B],
    ['e', 'Cobalt', 0.018, 3.55, 5, STELLAR_COLOR_BY_CLASS.O],
    ['f', 'Ember', 0.012, 5.1, 1.8, STELLAR_COLOR_BY_CLASS.M],
  ]

  configurations.forEach(([id, name, mass, orbitRadius, angle, color]) => {
    result.push(
      body(
        id,
        name,
        mass,
        0.036,
        orbitalPosition(orbitRadius, angle),
        orbitalVelocity(Math.sqrt(primaryMass / orbitRadius), angle),
        color,
      ),
    )
  })

  return centerSystem(result)
}

export function getOrbital2dPresetOverride(id: PresetId): BodyState[] | null {
  if (id === 'quadNested') return createPlanetMoonHierarchy(4)
  if (id === 'quadCrown') return createCircumbinaryFamily(4)
  if (id === 'quadCrossed') return createThreePlanetShowcase()

  if (id === 'pentaNested') return createPlanetMoonHierarchy(5)
  if (id === 'pentaCrown') return createCircumbinaryFamily(5)
  if (id === 'pentaCrossed') return createTrojanMoonSystem()

  if (id === 'hexaNested') return createPlanetMoonHierarchy(6)
  if (id === 'hexaCrown') return createCircumbinaryFamily(6)
  if (id === 'hexaCrossed') return createSixBodyPlanetarySystem()

  return null
}
