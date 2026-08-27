import type { BodyState } from './types'

export function selectCollisionPrimary(a: BodyState, b: BodyState) {
  return a.mass > b.mass || (a.mass === b.mass && a.radius >= b.radius) ? a : b
}

export function mergeCollisionLineageIds(a: BodyState, b: BodyState) {
  return Array.from(new Set([
    ...(a.collisionLineageIds ?? []),
    a.id,
    ...(b.collisionLineageIds ?? []),
    b.id,
  ]))
}

function getAtomicLineageIds(ids: string[]) {
  return new Set(ids.flatMap((id) => [
    id,
    ...id.split('+').map((part) => part.trim()).filter(Boolean),
  ]))
}

export function bodyCarriesCollisionLineage(body: BodyState, sourceId: string) {
  if (body.id === sourceId) return true

  const bodyLineage = getAtomicLineageIds([
    body.id,
    ...(body.collisionLineageIds ?? []),
  ])
  const sourceLineage = getAtomicLineageIds([sourceId])
  return [...sourceLineage].every((id) => bodyLineage.has(id))
}
