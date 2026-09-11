import type { Vec3 } from '../types'

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s })
export const magnitudeSquared = (v: Vec3): number => v.x * v.x + v.y * v.y + v.z * v.z
export const magnitude = (v: Vec3): number => Math.sqrt(magnitudeSquared(v))
