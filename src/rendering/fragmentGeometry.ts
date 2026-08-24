import * as THREE from 'three'

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededValue(seed: string) {
  return hashString(seed) / 4294967295
}

function vertexNoise(id: string, x: number, y: number, z: number) {
  const key = `${id}:${Math.round(x * 10000)}:${Math.round(y * 10000)}:${Math.round(z * 10000)}`
  return seededValue(key)
}

export function createFragmentGeometry(id: string) {
  const source = new THREE.IcosahedronGeometry(1, 1)
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  source.dispose()

  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const stretchX = 0.72 + seededValue(`${id}:stretch-x`) * 0.48
  const stretchY = 0.72 + seededValue(`${id}:stretch-y`) * 0.48
  const stretchZ = 0.72 + seededValue(`${id}:stretch-z`) * 0.48

  const chipDirection = new THREE.Vector3(
    seededValue(`${id}:chip-x`) * 2 - 1,
    seededValue(`${id}:chip-y`) * 2 - 1,
    seededValue(`${id}:chip-z`) * 2 - 1,
  ).normalize()
  const normal = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  const chipDepth = THREE.MathUtils.lerp(0.58, 0.8, seededValue(`${id}:chip-depth`))

  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index)
    normal.copy(vertex).normalize()
    const irregularity = 0.78 + vertexNoise(id, vertex.x, vertex.y, vertex.z) * 0.38
    const chipScale = normal.dot(chipDirection) > 0.48 ? chipDepth : 1

    positions.setXYZ(
      index,
      vertex.x * stretchX * irregularity * chipScale,
      vertex.y * stretchY * irregularity * chipScale,
      vertex.z * stretchZ * irregularity * chipScale,
    )
  }

  positions.needsUpdate = true
  geometry.center()
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const boundingRadius = geometry.boundingSphere?.radius ?? 1
  if (boundingRadius > 1e-9) geometry.scale(1 / boundingRadius, 1 / boundingRadius, 1 / boundingRadius)

  geometry.rotateX(seededValue(`${id}:rotation-x`) * Math.PI * 2)
  geometry.rotateY(seededValue(`${id}:rotation-y`) * Math.PI * 2)
  geometry.rotateZ(seededValue(`${id}:rotation-z`) * Math.PI * 2)
  geometry.computeBoundingSphere()

  return geometry
}
