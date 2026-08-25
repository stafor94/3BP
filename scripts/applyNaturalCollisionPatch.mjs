import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, content) {
  fs.writeFileSync(path, content)
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before)
  if (first < 0) throw new Error(`Missing patch target: ${label}`)
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch target is not unique: ${label}`)
  }
  return content.slice(0, first) + after + content.slice(first + before.length)
}

// Ordinary body tracking and collision-watch lineage are separate lifecycles.
{
  const path = 'src/trackingSelection.ts'
  let content = read(path)
  content = replaceOnce(
    content,
    `/**\n * Ordinary tracking is deliberately stricter than collision-watch lineage.\n * Prefer the exact same body id. If it disappeared, only a remnant that the\n * physics layer explicitly marked as the larger body's absorption successor may\n * inherit tracking. Merely sharing \`Alpha\` inside \`Alpha+Beta\` is not enough.\n */\nexport function findTrackingCandidate(bodies: BodyState[], sourceId: string) {\n  const exact = findDirectTrackingCandidate(bodies, sourceId)\n  if (exact) return exact\n\n  return bodies.find((body) =>\n    isTrackablePhysicalBody(body) &&\n    body.trackingContinuationIds?.includes(sourceId),\n  ) ?? null\n}\n`,
    `/**\n * Ordinary/manual tracking follows only the exact selected physical body.\n * Collision-watch lineage is intentionally handled elsewhere; an absorbed or\n * destroyed body never transfers ordinary tracking to a remnant or fallback.\n */\nexport function findTrackingCandidate(bodies: BodyState[], sourceId: string) {\n  return findDirectTrackingCandidate(bodies, sourceId)\n}\n`,
    'tracking selection semantics',
  )
  write(path, content)
}

// App: keep collision watch independent from manual tracking and hold the impact
// in true slow motion through the post-impact observation window.
{
  const path = 'src/App.tsx'
  let content = read(path)

  content = replaceOnce(
    content,
    `import { DEFAULT_PRESET_BY_BODY_COUNT, getPreset, getPresetBodyCount } from './presets'\nimport type { BodyCount, BodyState, BodyType, PresetId, SpaceMode, TrailSample, TrailSampleBatch } from './types'`,
    `import { DEFAULT_PRESET_BY_BODY_COUNT, getPreset, getPresetBodyCount } from './presets'\nimport { findTrackingCandidate } from './trackingSelection'\nimport type { BodyCount, BodyState, BodyType, PresetId, SpaceMode, TrailSample, TrailSampleBatch } from './types'`,
    'App tracking import',
  )

  content = replaceOnce(
    content,
    `const COLLISION_WATCH_POST_IMPACT_LOCK_MS = 2000\nconst COLLISION_WATCH_INFO_POST_IMPACT_MS = 2000`,
    `const COLLISION_WATCH_POST_IMPACT_LOCK_MS = 3000\nconst COLLISION_WATCH_INFO_POST_IMPACT_MS = 3000`,
    'post-impact hold duration',
  )

  content = replaceOnce(
    content,
    `    const target = resolveBodyDescendant(bodiesRef.current, bodyId)`,
    `    const target = findTrackingCandidate(bodiesRef.current, bodyId)`,
    'manual tracking selection',
  )

  content = replaceOnce(
    content,
    `      const candidate = resolveBodyDescendant(bodies, current)`,
    `      const candidate = findTrackingCandidate(bodies, current)`,
    'manual tracking validation',
  )

  content = replaceOnce(
    content,
    `    const bodyA = resolveBodyDescendant(watchBodies, prediction.bodyAId)\n    const bodyB = resolveBodyDescendant(watchBodies, prediction.bodyBId)\n    const target = bodyA && bodyB\n      ? (bodyA.mass > bodyB.mass || (bodyA.mass === bodyB.mass && bodyA.radius >= bodyB.radius) ? bodyA : bodyB)\n      : bodyA ?? bodyB\n    if (target) changeTrackedBody(target.id)\n\n`,
    ``,
    'manual watch must not steal ordinary tracking',
  )

  content = replaceOnce(
    content,
    `  }, [applyCollisionWatchSpeed, beginCollisionWatchInfo, changeTrackedBody, resetTrailSampling])`,
    `  }, [applyCollisionWatchSpeed, beginCollisionWatchInfo, resetTrailSampling])`,
    'manual watch callback dependencies',
  )

  content = replaceOnce(
    content,
    `              const bodyA = resolveBodyDescendant(bodiesRef.current, upcoming.bodyAId)\n              const bodyB = resolveBodyDescendant(bodiesRef.current, upcoming.bodyBId)\n              const target = bodyA && bodyB\n                ? (bodyA.mass > bodyB.mass || (bodyA.mass === bodyB.mass && bodyA.radius >= bodyB.radius) ? bodyA : bodyB)\n                : bodyA ?? bodyB\n\n              beginCollisionWatchInfo(upcoming, bodiesRef.current)\n              if (target) changeTrackedBody(target.id)\n              autoCollisionWatchPairRef.current = upcoming.pairKey`,
    `              beginCollisionWatchInfo(upcoming, bodiesRef.current)\n              autoCollisionWatchPairRef.current = upcoming.pairKey`,
    'auto watch must not steal ordinary tracking',
  )

  content = replaceOnce(
    content,
    `            applyCollisionWatchSpeed(COLLISION_WATCH_APPROACH_SPEED)`,
    `            applyCollisionWatchSpeed(COLLISION_WATCH_IMPACT_SPEED)`,
    'post-impact speed must stay slow',
  )

  content = replaceOnce(
    content,
    `  }, [applyCollisionWatchSpeed, beginCollisionWatchInfo, changeTrackedBody])`,
    `  }, [applyCollisionWatchSpeed, beginCollisionWatchInfo])`,
    'animation effect dependencies',
  )

  write(path, content)
}

// Renderer: collision observation owns its camera independently, and resolving two
// colliders into one remnant must not trigger a second zoom/reframe on that frame.
{
  const path = 'src/rendering/simulationRenderer.ts'
  let content = read(path)

  content = replaceOnce(
    content,
    `import { isBodyDescendedFrom, resolveBodyDescendant } from '../collisionWatch'\nimport { FRAGMENT_TRAIL_TIME, getFragmentOpacity } from '../fragmentLifecycle'`,
    `import { resolveBodyDescendant } from '../collisionWatch'\nimport { FRAGMENT_TRAIL_TIME, getFragmentOpacity } from '../fragmentLifecycle'\nimport { findTrackingCandidate } from '../trackingSelection'`,
    'renderer tracking imports',
  )

  content = replaceOnce(
    content,
    `    collisionTransition: 0.12,`,
    `    collisionTransition: 0.075,`,
    'gentler collision reframe',
  )

  content = replaceOnce(
    content,
    `  let collisionCameraSuppressedPairKey: string | null = null\n  let collisionTrackingEstablished = false\n`,
    ``,
    'remove collision/manual tracking coupling state',
  )

  content = replaceOnce(
    content,
    `  const getTrackedBody = (current: BodyState[], trackedBodyId: string | null) => {\n    if (!trackedBodyId) return undefined\n    return resolveBodyDescendant(current, trackedBodyId)\n  }`,
    `  const getTrackedBody = (current: BodyState[], trackedBodyId: string | null) => {\n    if (!trackedBodyId) return undefined\n    return findTrackingCandidate(current, trackedBodyId) ?? undefined\n  }`,
    'renderer exact ordinary tracking',
  )

  content = replaceOnce(
    content,
    `    collisionCameraSuppressedPairKey = null\n    collisionTrackingEstablished = false\n`,
    ``,
    'clear collision camera coupling state',
  )

  content = replaceOnce(
    content,
    `      collisionCameraSuppressedPairKey = null\n      collisionTrackingEstablished = Boolean(\n        state.trackedBodyId && isBodyDescendedFrom(state.trackedBodyId, observedCollisionMainSourceId),\n      )\n      collisionFocusSettleFrames = RENDER_TUNING.camera.focusSettleFrames`,
    `      collisionFocusSettleFrames = RENDER_TUNING.camera.focusSettleFrames`,
    'pair entry collision/manual coupling',
  )

  content = replaceOnce(
    content,
    `    const trackedMainBody = Boolean(\n      state.trackedBodyId && isBodyDescendedFrom(state.trackedBodyId, mainSourceId),\n    )\n    if (!collisionTrackingEstablished && trackedMainBody) {\n      collisionTrackingEstablished = true\n    } else if (collisionTrackingEstablished && !trackedMainBody) {\n      collisionCameraSuppressedPairKey = focus.pairKey\n    }\n    if (collisionCameraSuppressedPairKey === focus.pairKey) {\n      resetAutoDistanceLimits()\n      return false\n    }\n\n`,
    ``,
    'collision camera suppression tied to manual tracking',
  )

  content = replaceOnce(
    content,
    `    const primaryChanged = observedCollisionPrimaryId !== primary.id\n    const shouldReframe = pairChanged || primaryChanged ||\n      radiusChangeRatio >= RENDER_TUNING.camera.radiusReframeThreshold\n\n    if (shouldReframe) {\n      observedCollisionPrimaryId = primary.id\n      observedCollisionPrimaryRadius = renderedRadius\n      collisionFocusSettleFrames = RENDER_TUNING.camera.focusSettleFrames\n    }`,
    `    const primaryChanged = observedCollisionPrimaryId !== primary.id\n    const targetLineagesMerged = bodyA.id === bodyB.id\n    const shouldReframe = pairChanged || (!targetLineagesMerged && (\n      primaryChanged || radiusChangeRatio >= RENDER_TUNING.camera.radiusReframeThreshold\n    ))\n\n    // On the exact merge-resolution frame, keep the camera-to-target offset and\n    // distance unchanged. moveCameraTargetTo() already follows the remnant by\n    // translating camera and target together, so a fresh zoom would read as a cut.\n    if (targetLineagesMerged && primaryChanged) {\n      observedCollisionPrimaryId = primary.id\n      observedCollisionPrimaryRadius = renderedRadius\n      collisionFocusSettleFrames = 0\n    } else if (shouldReframe) {\n      observedCollisionPrimaryId = primary.id\n      observedCollisionPrimaryRadius = renderedRadius\n      collisionFocusSettleFrames = RENDER_TUNING.camera.focusSettleFrames\n    }`,
    'merge-resolution camera continuity',
  )

  content = replaceOnce(
    content,
    `  const isTrackingSelectionChanged = (nextTrackedBodyId: string | null) => {\n    if (observedTrackedBodyId === nextTrackedBodyId) return false\n    if (!observedTrackedBodyId || !nextTrackedBodyId) return true\n    return !(\n      isBodyDescendedFrom(nextTrackedBodyId, observedTrackedBodyId) ||\n      isBodyDescendedFrom(observedTrackedBodyId, nextTrackedBodyId)\n    )\n  }`,
    `  const isTrackingSelectionChanged = (nextTrackedBodyId: string | null) => (\n    observedTrackedBodyId !== nextTrackedBodyId\n  )`,
    'exact manual tracking selection identity',
  )

  write(path, content)
}

// Regression: even an explicitly marked absorption successor must not inherit
// ordinary tracking; collision-watch lineage coverage remains in physicsRegression.
{
  const path = 'scripts/trackingRegression.ts'
  write(path, `import { stepBodies } from '../src/physics/fragmentAwareEngine'\nimport { findDirectTrackingCandidate, findTrackingCandidate } from '../src/trackingSelection'\nimport type { BodyState } from '../src/types'\n\nfunction assert(condition: unknown, message: string): asserts condition {\n  if (!condition) throw new Error(message)\n}\n\nfunction makeBody(\n  id: string,\n  bodyType: BodyState['bodyType'] = 'star',\n  mass = 1,\n  radius = 0.2,\n): BodyState {\n  return {\n    id,\n    name: id,\n    color: '#ffffff',\n    mass,\n    radius,\n    position: { x: 0, y: 0, z: 0 },\n    velocity: { x: 0, y: 0, z: 0 },\n    bodyType,\n  }\n}\n\nfunction testLivingOriginalBodyRemainsTrackable() {\n  const alpha = makeBody('Alpha')\n  const beta = makeBody('Beta')\n  assert(\n    findTrackingCandidate([alpha, beta], 'Alpha')?.id === 'Alpha',\n    'a still-living original body must remain trackable',\n  )\n}\n\nfunction testMergedDescendantNeverInheritsOrdinaryTracking() {\n  const merged = makeBody('Alpha+Beta')\n  merged.trackingContinuationIds = ['Alpha']\n  assert(\n    findDirectTrackingCandidate([merged], 'Alpha') === null,\n    'a merged descendant must not count as the exact original body',\n  )\n  assert(\n    findTrackingCandidate([merged], 'Alpha') === null,\n    'ordinary tracking must ignore absorption-continuity metadata',\n  )\n}\n\nfunction testLargerAbsorberAlsoStopsOrdinaryTracking() {\n  const large = makeBody('Large', 'planet', 1, 0.2)\n  const small = makeBody('Small', 'moon', 0.1, 0.08)\n  large.position = { x: -0.13, y: 0, z: 0 }\n  small.position = { x: 0.13, y: 0, z: 0 }\n\n  const after = stepBodies([large, small], 0.0015)\n  const remnant = after.find((body) =>\n    body.bodyType !== 'effect' &&\n    body.bodyType !== 'fragment' &&\n    body.id.includes('Large') &&\n    body.id.includes('Small'),\n  )\n\n  assert(remnant, 'planet-moon absorption must produce a physical remnant')\n  assert(\n    findTrackingCandidate(after, 'Large') === null,\n    'even the larger absorber must stop ordinary tracking when its exact id disappears',\n  )\n  assert(\n    findTrackingCandidate(after, 'Small') === null,\n    'the absorbed smaller body must stop ordinary tracking',\n  )\n}\n\nfunction testDestroyedBodyDoesNotTransferTrackingToFragment() {\n  const fragment = makeBody('Alpha', 'fragment')\n  assert(\n    findTrackingCandidate([fragment], 'Alpha') === null,\n    'a destroyed body must not keep tracking through a fragment that reuses its id',\n  )\n}\n\nfunction testUnrelatedBodyIsNeverSelectedAsFallback() {\n  const gamma = makeBody('Gamma')\n  assert(\n    findTrackingCandidate([gamma], 'Alpha') === null,\n    'generic tracking must stay empty instead of falling back to an unrelated body',\n  )\n}\n\nconst tests = [\n  testLivingOriginalBodyRemainsTrackable,\n  testMergedDescendantNeverInheritsOrdinaryTracking,\n  testLargerAbsorberAlsoStopsOrdinaryTracking,\n  testDestroyedBodyDoesNotTransferTrackingToFragment,\n  testUnrelatedBodyIsNeverSelectedAsFallback,\n]\n\nfor (const test of tests) test()\nconsole.log(\`tracking regression checks passed (\${tests.length})\`)\n`)
}

// Release metadata.
{
  const packagePath = 'package.json'
  const packageJson = JSON.parse(read(packagePath))
  if (packageJson.version !== '0.17.22') {
    throw new Error(`Unexpected package version: ${packageJson.version}`)
  }
  packageJson.version = '0.17.23'
  write(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const changelogPath = 'CHANGELOG.md'
  let changelog = read(changelogPath)
  const marker = '## [0.17.22] - 2026-08-25'
  const release = `## [0.17.23] - 2026-08-26\n\n### Changed\n- 일반 천체 추적과 충돌 관찰 카메라의 수명주기를 분리해 충돌 관찰이 일반 추적 ID를 강제로 선택하거나 승계하지 않도록 변경했습니다.\n- 충돌 직후 관찰 유지 시간을 3초로 늘리고 해당 구간을 0.03x로 유지한 뒤 기존 사용자 속도를 복원하도록 변경했습니다.\n- 충돌 카메라의 일반 반지름 재프레이밍 보간을 완만하게 조정했습니다.\n\n### Fixed\n- 충돌 순간 0.03x에서 0.1x로 즉시 가속되며 합체 잔여체 재프레이밍까지 동시에 발생해 화면이 컷 전환처럼 튀던 문제를 수정했습니다.\n- 충돌 대상 두 계보가 하나의 잔여체로 합쳐지는 해석 프레임에서는 카메라 거리와 시선 오프셋을 그대로 유지해 합체 직후 줌 점프가 발생하지 않도록 했습니다.\n- 추적 중인 천체가 흡수·합체·파괴되면 큰 흡수체 여부와 관계없이 일반 추적을 해제하며, 다른 천체나 합체 후손으로 자동 전환하지 않도록 했습니다. 충돌 관찰의 source-lineage 추적은 별도 경로로 계속 유지됩니다.\n\n`
  if (!changelog.includes(marker)) throw new Error('Missing changelog insertion marker')
  changelog = changelog.replace(marker, release + marker)
  write(changelogPath, changelog)
}

console.log('Applied natural collision continuity patch for v0.17.23')
