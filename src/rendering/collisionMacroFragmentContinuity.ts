import { bodyCarriesCollisionLineage } from '../collisionIdentity'
import type { BodyState } from '../types'

export const COLLISION_MACRO_FRAGMENT_RENDER_PREFIX = 'collision-macro-fragment:'
const MAX_MACRO_FRAGMENTS_PER_COLLISION = 2

function isPhysicalSolid(body: BodyState) {
  return body.bodyType !== 'effect' && body.bodyType !== 'fragment'
}

function getLineageIds(body: BodyState) {
  return Array.from(new Set(body.collisionLineageIds ?? [])).sort()
}

function lineageSignature(lineageIds: string[]) {
  return lineageIds.join('\u0000')
}

function carriesAllLineages(body: BodyState, lineageIds: string[]) {
  return lineageIds.every((sourceId) => bodyCarriesCollisionLineage(body, sourceId))
}

function isMassBearingCollisionSpark(body: BodyState) {
  return body.bodyType === 'effect' &&
    body.name === 'Collision spark' &&
    body.mass > 1e-12 &&
    body.radius > 1e-12 &&
    body.effectVisual?.sourceMaxRadius !== undefined &&
    getLineageIds(body).length >= 2
}

function makeMacroFragmentProxy(spark: BodyState): BodyState {
  return {
    ...spark,
    id: `${COLLISION_MACRO_FRAGMENT_RENDER_PREFIX}${spark.id}`,
    name: 'Debris',
    // This body exists only in the renderer. The represented mass already lives
    // on the physical spark BodyState, so keep the render proxy massless and
    // strip collision/tracking lineage to prevent double-counting or handoff.
    mass: 0,
    bodyType: 'fragment',
    age: undefined,
    lifetime: undefined,
    collisionCooldown: undefined,
    effectVisual: undefined,
    collisionLineageIds: undefined,
    trackingContinuationIds: undefined,
    position: { ...spark.position },
    velocity: { ...spark.velocity },
  }
}

export function isCollisionMacroFragmentRenderBody(body: BodyState) {
  return body.id.startsWith(COLLISION_MACRO_FRAGMENT_RENDER_PREFIX)
}

export function getCollisionMacroFragmentPhysicalId(body: BodyState) {
  return isCollisionMacroFragmentRenderBody(body)
    ? body.id.slice(COLLISION_MACRO_FRAGMENT_RENDER_PREFIX.length)
    : null
}

/**
 * Small 2→1 solid collisions can conserve ejecta mass entirely in short-lived
 * `Collision spark` effect bodies. Dedicated VFX renders those sparks, but the
 * ordinary solid renderer filters effects, leaving no trackable chunk between
 * the source sphere and the remnant.
 *
 * Promote at most two of the largest existing mass-bearing sparks to massless
 * renderer-only fragment meshes when the same collision has already collapsed
 * to one lineage-carrying solid and has no physical persistent fragment. The
 * proxy inherits the real ejecta radius/position/velocity exactly; no physics
 * state, ejecta direction, speed or particle count is changed.
 */
export function getCollisionMacroFragmentRenderBodies(physicalBodies: BodyState[]) {
  const groups = new Map<string, { lineageIds: string[]; sparks: BodyState[] }>()

  physicalBodies.forEach((body) => {
    if (!isMassBearingCollisionSpark(body)) return
    const lineageIds = getLineageIds(body)
    const signature = lineageSignature(lineageIds)
    const existing = groups.get(signature)
    if (existing) existing.sparks.push(body)
    else groups.set(signature, { lineageIds, sparks: [body] })
  })

  const proxies: BodyState[] = []
  groups.forEach(({ lineageIds, sparks }) => {
    const hasCollapsedSolid = physicalBodies.some((body) =>
      isPhysicalSolid(body) && carriesAllLineages(body, lineageIds),
    )
    if (!hasCollapsedSolid) return

    const hasPersistentFragment = physicalBodies.some((body) =>
      body.bodyType === 'fragment' &&
      body.mass > 1e-12 &&
      carriesAllLineages(body, lineageIds),
    )
    if (hasPersistentFragment) return

    sparks
      .slice()
      .sort((a, b) =>
        b.radius - a.radius ||
        b.mass - a.mass ||
        a.id.localeCompare(b.id),
      )
      .slice(0, MAX_MACRO_FRAGMENTS_PER_COLLISION)
      .forEach((spark) => proxies.push(makeMacroFragmentProxy(spark)))
  })

  return proxies
}

export function appendCollisionMacroFragmentRenderBodies(
  renderBodies: BodyState[],
  physicalBodies: BodyState[],
) {
  const result = [...renderBodies]
  const existingIds = new Set(result.map((body) => body.id))
  getCollisionMacroFragmentRenderBodies(physicalBodies).forEach((proxy) => {
    if (existingIds.has(proxy.id)) return
    existingIds.add(proxy.id)
    result.push(proxy)
  })
  return result
}
