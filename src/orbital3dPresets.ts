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

type OrbitPlane = {
  inclination: number
  ascendingNode: number
}

const STAR_MASS = 7
const DEG = Math.PI / 180

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

function orbitPosition(radius: number, phase: number, plane: OrbitPlane): VecTuple {
  const cosNode = Math.cos(plane.ascendingNode)
  const sinNode = Math.sin(plane.ascendingNode)
  const cosPhase = Math.cos(phase)
  const sinPhase = Math.sin(phase)
  const cosInclination = Math.cos(plane.inclination)
  const sinInclination = Math.sin(plane.inclination)

  return [
    radius * (cosNode * cosPhase - sinNode * sinPhase * cosInclination),
    radius * (sinNode * cosPhase + cosNode * sinPhase * cosInclination),
    radius * sinPhase * sinInclination,
  ]
}

function orbitVelocity(speed: number, phase: number, plane: OrbitPlane): VecTuple {
  const cosNode = Math.cos(plane.ascendingNode)
  const sinNode = Math.sin(plane.ascendingNode)
  const cosPhase = Math.cos(phase)
  const sinPhase = Math.sin(phase)
  const cosInclination = Math.cos(plane.inclination)
  const sinInclination = Math.sin(plane.inclination)

  return [
    speed * (-cosNode * sinPhase - sinNode * cosPhase * cosInclination),
    speed * (-sinNode * sinPhase + cosNode * cosPhase * cosInclination),
    speed * cosPhase * sinInclination,
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
  const orbitRadius = 2.65
  const planetPlane: OrbitPlane = { inclination: 31 * DEG, ascendingNode: 38 * DEG }
  const barycenterPosition = orbitPosition(orbitRadius, 0.25, planetPlane)
  const barycenterVelocity = orbitVelocity(
    Math.sqrt((STAR_MASS + planetMass) / orbitRadius),
    0.25,
    planetPlane,
  )

  const moonOneMass = 0.002
  const moonOneRadius = 0.19
  const moonOnePlane: OrbitPlane = { inclination: 72 * DEG, ascendingNode: 138 * DEG }
  const moonOnePhase = 0.8
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
      position: orbitPosition(moonOneRadius, moonOnePhase, moonOnePlane),
      velocity: orbitVelocity(
        Math.sqrt((planetMass + moonOneMass) / moonOneRadius),
        moonOnePhase,
        moonOnePlane,
      ),
      color: STELLAR_COLOR_BY_CLASS.A,
    },
  ]

  if (twoMoons) {
    const moonTwoMass = 0.001
    const moonTwoRadius = 0.36
    const moonTwoPlane: OrbitPlane = { inclination: 128 * DEG, ascendingNode: 252 * DEG }
    const moonTwoPhase = 2.7
    localBodies.push({
      id: 'd',
      name: 'Nyx',
      mass: moonTwoMass,
      radius: 0.018,
      position: orbitPosition(moonTwoRadius, moonTwoPhase, moonTwoPlane),
      velocity: orbitVelocity(
        Math.sqrt((planetMass + moonTwoMass) / moonTwoRadius),
        moonTwoPhase,
        moonTwoPlane,
      ),
      color: STELLAR_COLOR_BY_CLASS.B,
    })
  }

  return placeSubsystem(barycenterPosition, barycenterVelocity, localBodies)
}

function createOuterPlanet(id: string): BodyState {
  const mass = 0.05
  const orbitRadius = 4.8
  const phase = 3.6
  const plane: OrbitPlane = { inclination: 63 * DEG, ascendingNode: 208 * DEG }
  return body(
    id,
    'Ember',
    mass,
    0.04,
    orbitPosition(orbitRadius, phase, plane),
    orbitVelocity(Math.sqrt(STAR_MASS / orbitRadius), phase, plane),
    STELLAR_COLOR_BY_CLASS.M,
  )
}

function createBorealSubsystem(): BodyState[] {
  const planetMass = 0.35
  const orbitRadius = 4.75
  const planetPhase = 3.25
  const planetPlane: OrbitPlane = { inclination: 58 * DEG, ascendingNode: 214 * DEG }
  const barycenterPosition = orbitPosition(orbitRadius, planetPhase, planetPlane)
  const barycenterVelocity = orbitVelocity(
    Math.sqrt((STAR_MASS + planetMass) / orbitRadius),
    planetPhase,
    planetPlane,
  )

  const moonMass = 0.001
  const moonRadius = 0.23
  const moonPhase = 2.1
  const moonPlane: OrbitPlane = { inclination: 105 * DEG, ascendingNode: 54 * DEG }

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
      position: orbitPosition(moonRadius, moonPhase, moonPlane),
      velocity: orbitVelocity(
        Math.sqrt((planetMass + moonMass) / moonRadius),
        moonPhase,
        moonPlane,
      ),
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
  const separation = 0.82
  const angularSpeed = Math.sqrt(binaryMass / separation ** 3)
  const starOneRadius = separation * starTwoMass / binaryMass
  const starTwoRadius = separation * starOneMass / binaryMass
  const binaryPlane: OrbitPlane = { inclination: 47 * DEG, ascendingNode: 24 * DEG }

  const result: BodyState[] = [
    body(
      'a',
      'Aurelia',
      starOneMass,
      0.075,
      orbitPosition(starOneRadius, Math.PI, binaryPlane),
      orbitVelocity(angularSpeed * starOneRadius, Math.PI, binaryPlane),
      STELLAR_COLOR_BY_CLASS.F,
    ),
    body(
      'b',
      'Vesper',
      starTwoMass,
      0.065,
      orbitPosition(starTwoRadius, 0, binaryPlane),
      orbitVelocity(angularSpeed * starTwoRadius, 0, binaryPlane),
      STELLAR_COLOR_BY_CLASS.M,
    ),
  ]

  const planetMass = 0.28
  const orbitRadius = 3.35
  const planetPhase = 1.35
  const planetPlane: OrbitPlane = { inclination: 21 * DEG, ascendingNode: 128 * DEG }
  const barycenterPosition = orbitPosition(orbitRadius, planetPhase, planetPlane)
  const barycenterVelocity = orbitVelocity(
    Math.sqrt((binaryMass + planetMass) / orbitRadius),
    planetPhase,
    planetPlane,
  )
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
  const firstMoonRadius = 0.19
  const firstMoonPhase = 0.55
  const firstMoonPlane: OrbitPlane = { inclination: 78 * DEG, ascendingNode: 238 * DEG }
  localBodies.push({
    id: 'd',
    name: 'Luna',
    mass: firstMoonMass,
    radius: 0.015,
    position: orbitPosition(firstMoonRadius, firstMoonPhase, firstMoonPlane),
    velocity: orbitVelocity(
      Math.sqrt((planetMass + firstMoonMass) / firstMoonRadius),
      firstMoonPhase,
      firstMoonPlane,
    ),
    color: STELLAR_COLOR_BY_CLASS.A,
  })

  if (totalCount >= 5) {
    const secondMoonMass = 0.0008
    const secondMoonRadius = 0.34
    const secondMoonPhase = 2.9
    const secondMoonPlane: OrbitPlane = { inclination: 137 * DEG, ascendingNode: 64 * DEG }
    localBodies.push({
      id: 'e',
      name: 'Nereid',
      mass: secondMoonMass,
      radius: 0.014,
      position: orbitPosition(secondMoonRadius, secondMoonPhase, secondMoonPlane),
      velocity: orbitVelocity(
        Math.sqrt((planetMass + secondMoonMass) / secondMoonRadius),
        secondMoonPhase,
        secondMoonPlane,
      ),
      color: STELLAR_COLOR_BY_CLASS.B,
    })
  }

  result.push(...placeSubsystem(barycenterPosition, barycenterVelocity, localBodies))

  if (totalCount === 6) {
    const outerMass = 0.035
    const outerRadius = 5.5
    const outerPhase = 3.8
    const outerPlane: OrbitPlane = { inclination: 74 * DEG, ascendingNode: 302 * DEG }
    result.push(
      body(
        'f',
        'Cinder',
        outerMass,
        0.035,
        orbitPosition(outerRadius, outerPhase, outerPlane),
        orbitVelocity(Math.sqrt(binaryMass / outerRadius), outerPhase, outerPlane),
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
  const configurations: Array<[string, string, number, number, number, number, number, string]> = [
    ['b', 'Swift', 0.04, 1.25, 0.15, 18, 20, STELLAR_COLOR_BY_CLASS.B],
    ['c', 'Cobalt', 0.025, 2.5, 2.2, 57, 142, STELLAR_COLOR_BY_CLASS.O],
    ['d', 'Ember', 0.018, 3.85, 4.4, 118, 268, STELLAR_COLOR_BY_CLASS.M],
  ]

  configurations.forEach(([
    id,
    name,
    mass,
    orbitRadius,
    phase,
    inclinationDegrees,
    nodeDegrees,
    color,
  ]) => {
    const plane: OrbitPlane = {
      inclination: inclinationDegrees * DEG,
      ascendingNode: nodeDegrees * DEG,
    }
    result.push(
      body(
        id,
        name,
        mass,
        0.038,
        orbitPosition(orbitRadius, phase, plane),
        orbitVelocity(Math.sqrt(primaryMass / orbitRadius), phase, plane),
        color,
      ),
    )
  })

  return centerSystem(result)
}

function createTrojanMoonSystem(): BodyState[] {
  const primaryMass = 8
  const planetMass = 0.35
  const orbitRadius = 2.7
  const planetPlane: OrbitPlane = { inclination: 34 * DEG, ascendingNode: 68 * DEG }
  const planetPhase = 0.3
  const barycenterPosition = orbitPosition(orbitRadius, planetPhase, planetPlane)
  const barycenterVelocity = orbitVelocity(
    Math.sqrt((primaryMass + planetMass) / orbitRadius),
    planetPhase,
    planetPlane,
  )
  const moonMass = 0.0015
  const moonRadius = 0.18
  const moonPhase = 1.3
  const moonPlane: OrbitPlane = { inclination: 83 * DEG, ascendingNode: 198 * DEG }

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
        position: orbitPosition(moonRadius, moonPhase, moonPlane),
        velocity: orbitVelocity(
          Math.sqrt((planetMass + moonMass) / moonRadius),
          moonPhase,
          moonPlane,
        ),
        color: STELLAR_COLOR_BY_CLASS.A,
      },
    ]),
  ]

  const trojanPhase = planetPhase + Math.PI / 3
  result.push(
    body(
      'd',
      'Trojan',
      0.004,
      0.022,
      orbitPosition(orbitRadius, trojanPhase, planetPlane),
      orbitVelocity(Math.sqrt(primaryMass / orbitRadius), trojanPhase, planetPlane),
      STELLAR_COLOR_BY_CLASS.B,
    ),
  )

  const outerRadius = 4.7
  const outerPhase = 4
  const outerPlane: OrbitPlane = { inclination: 96 * DEG, ascendingNode: 278 * DEG }
  result.push(
    body(
      'e',
      'Ember',
      0.025,
      0.036,
      orbitPosition(outerRadius, outerPhase, outerPlane),
      orbitVelocity(Math.sqrt(primaryMass / outerRadius), outerPhase, outerPlane),
      STELLAR_COLOR_BY_CLASS.M,
    ),
  )

  return centerSystem(result)
}

function createSixBodyPlanetarySystem(): BodyState[] {
  const primaryMass = 8
  const planetMass = 0.32
  const planetOrbitRadius = 2.4
  const planetPhase = 0.35
  const planetPlane: OrbitPlane = { inclination: 29 * DEG, ascendingNode: 42 * DEG }
  const barycenterPosition = orbitPosition(planetOrbitRadius, planetPhase, planetPlane)
  const barycenterVelocity = orbitVelocity(
    Math.sqrt((primaryMass + planetMass) / planetOrbitRadius),
    planetPhase,
    planetPlane,
  )
  const moonMass = 0.0014
  const moonRadius = 0.14
  const moonPhase = 2
  const moonPlane: OrbitPlane = { inclination: 45 * DEG, ascendingNode: 120 * DEG }

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
        position: orbitPosition(moonRadius, moonPhase, moonPlane),
        velocity: orbitVelocity(
          Math.sqrt((planetMass + moonMass) / moonRadius),
          moonPhase,
          moonPlane,
        ),
        color: STELLAR_COLOR_BY_CLASS.A,
      },
    ]),
  ]

  const configurations: Array<[string, string, number, number, number, number, number, string]> = [
    ['d', 'Swift', 0.028, 1.15, 3.1, 19, 314, STELLAR_COLOR_BY_CLASS.B],
    ['e', 'Cobalt', 0.018, 3.65, 5, 61, 132, STELLAR_COLOR_BY_CLASS.O],
    ['f', 'Ember', 0.012, 5.2, 1.8, 123, 246, STELLAR_COLOR_BY_CLASS.M],
  ]

  configurations.forEach(([
    id,
    name,
    mass,
    orbitRadius,
    phase,
    inclinationDegrees,
    nodeDegrees,
    color,
  ]) => {
    const plane: OrbitPlane = {
      inclination: inclinationDegrees * DEG,
      ascendingNode: nodeDegrees * DEG,
    }
    result.push(
      body(
        id,
        name,
        mass,
        0.036,
        orbitPosition(orbitRadius, phase, plane),
        orbitVelocity(Math.sqrt(primaryMass / orbitRadius), phase, plane),
        color,
      ),
    )
  })

  return centerSystem(result)
}

export function getOrbital3dPresetOverride(id: PresetId): BodyState[] | null {
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
