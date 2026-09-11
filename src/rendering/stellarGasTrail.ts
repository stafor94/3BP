import * as THREE from 'three'
import type { BodyState } from '../types'

const CAPACITY = 40
type Sample = { age: number; position: THREE.Vector3 }

/** One draw per physical parcel, independent of the number of history samples.
 * History is presentation-only and advances exclusively with physical age. */
export function createStellarGasTrail() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 6), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(CAPACITY * 4), 2))
  const indices: number[] = []
  for (let i = 0; i < CAPACITY - 1; i++) {
    const j = i * 2
    indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2)
  }
  geometry.setIndex(indices)
  return { geometry, samples: [] as Sample[], lastAge: -1 }
}

export function updateStellarGasTrail(trail: ReturnType<typeof createStellarGasTrail>, body: BodyState, camera: THREE.Camera) {
  const age = body.age ?? 0
  const samples = trail.samples
  if (age < trail.lastAge) samples.length = 0
  if (age !== trail.lastAge) {
    const point = { age, position: new THREE.Vector3(body.position.x, body.position.y, body.position.z) }
    // Preserve the launch sample and decimate only the live tip, never invent a
    // backwards ballistic path through a curved trajectory.
    if (samples.length > 1 && age - samples[samples.length - 2].age < .004) samples[samples.length - 1] = point
    else samples.push(point)
    if (samples.length > CAPACITY) samples.shift()
    trail.lastAge = age
  }
  const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute
  const uv = trail.geometry.getAttribute('uv') as THREE.BufferAttribute
  const sourceRadius = body.effectVisual?.sourceMaxRadius ?? body.radius
  const duration = Math.max(body.lifetime ?? 1, 1e-8)
  const view = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3()
  let distance = 0
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const before = samples[Math.max(0, i - 1)].position
    const after = samples[Math.min(samples.length - 1, i + 1)].position
    distance += sample.position.distanceTo(before)
    tangent.copy(after).sub(before).normalize()
    view.copy(camera.position).sub(sample.position).normalize()
    side.crossVectors(tangent, view)
    if (side.lengthSq() < 1e-10) side.setFromMatrixColumn(camera.matrixWorld, 0)
    side.normalize()
    // Expanding low-density wake, with no compact luminous projectile at its tip.
    const width = Math.min(sourceRadius * .65, sourceRadius * (.10 + age / duration * .22) + distance * .20)
    for (let j = 0; j < 2; j++) {
      const sign = j ? 1 : -1
      positions.setXYZ(i * 2 + j, sample.position.x + side.x * width * sign,
        sample.position.y + side.y * width * sign, sample.position.z + side.z * width * sign)
      uv.setXY(i * 2 + j, i / Math.max(1, samples.length - 1), j)
    }
  }
  trail.geometry.setDrawRange(0, Math.max(0, samples.length - 1) * 6)
  positions.needsUpdate = true
  uv.needsUpdate = true
}
