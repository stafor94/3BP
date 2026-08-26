from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, got {count}')
    write(path, text.replace(old, new, 1))


replace_once('package.json', '"version": "0.19.5"', '"version": "0.19.6"')

changelog = read('CHANGELOG.md')
marker = '## [0.19.5] - 2026-08-27\n'
entry = (
    '## [0.19.6] - 2026-08-27\n\n'
    '### Fixed\n'
    '- 동일 질량 또는 일반 merge 충돌에서 두 원본 천체 모두 remnant의 명시적 tracking continuation으로 연결해, 기존 50% initial-mass rule을 통과하는 추적이 collision camera 종료 뒤에도 유지되도록 수정했습니다.\n'
    '- collision camera가 merge 이후 이미 해제된 tracking 상태를 잠시 가리고 있다가 종료 순간 천체가 화면 밖으로 이동하던 실제 원인을 수정했습니다.\n'
    '- merge로 원본 body id가 사라질 때 renderer가 해당 body의 과거 궤적까지 즉시 폐기하던 문제를 수정하고, 기존 trail duration이 끝날 때까지 충돌 전 궤적을 trail-only 상태로 유지하도록 했습니다.\n\n'
    '### Added\n'
    '- 실제 equal-mass planet merge를 통과시켜 양쪽 source tracking continuation과 50% mass gate를 검증하는 회귀 테스트를 추가했습니다.\n'
    '- collision-camera handoff 브라우저 regression에 source body가 remnant로 교체된 뒤에도 충돌 전 source trail이 retained 상태로 남는 renderer telemetry 검증을 추가했습니다.\n\n'
)
if marker not in changelog:
    raise SystemExit('CHANGELOG marker missing')
write('CHANGELOG.md', changelog.replace(marker, entry + marker, 1))

path = 'src/physics/fragmentAwareEngine.ts'
text = read(path)
old_call = 'attachAbsorptionTrackingContinuity(input, withMassCorrection, dt)'
if text.count(old_call) != 1:
    raise SystemExit('fragmentAwareEngine continuation call mismatch')
text = text.replace(old_call, 'attachCollisionTrackingContinuity(input, withMassCorrection, dt)', 1)
start = text.index('function attachAbsorptionTrackingContinuity(')
end = text.index('\nfunction smoothstep01', start)
new_function = """function attachCollisionTrackingContinuity(
  input: BodyState[],
  stepped: BodyState[],
  dt: number,
) {
  const collisionPair = findNewCollisionPair(input, stepped, dt)
  if (!collisionPair) return stepped

  const { bodyA, bodyB } = collisionPair
  const mode = inferCollisionPresentationMode(stepped, bodyA, bodyB)
  if (mode !== 'merge') return stepped

  const remnant = stepped.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.id !== bodyA.id &&
    body.id !== bodyB.id &&
    isBodyDescendedFrom(body.id, bodyA.id) &&
    isBodyDescendedFrom(body.id, bodyB.id),
  )
  if (!remnant) return stepped

  let continuationSources: BodyState[]
  if (isAbsorptionCollision(bodyA, bodyB, mode)) {
    // Absorption is identity-asymmetric: only the dominant absorber keeps
    // ordinary user tracking. The absorbed source must not jump to it.
    const larger = bodyA.mass > bodyB.mass
      ? bodyA
      : bodyB.mass > bodyA.mass
        ? bodyB
        : null
    if (!larger) return stepped
    continuationSources = [larger]
  } else {
    // A true merge produces one body from both physical sources. Carry both
    // explicit source lineages; App.tsx still applies the captured initial-mass
    // 50% gate before ordinary tracking can continue.
    continuationSources = [bodyA, bodyB]
  }

  const continuationIds = Array.from(new Set(
    continuationSources.flatMap((source) => [
      ...(source.trackingContinuationIds ?? []),
      source.id,
    ]),
  ))

  return stepped.map((body) => (
    body === remnant
      ? { ...body, trackingContinuationIds: continuationIds }
      : body
  ))
}
"""
text = text[:start] + new_function + text[end:]
write(path, text)

replace_once(
    'src/types.ts',
    """  /**
   * Source body ids whose ordinary camera tracking may continue onto this body.
   * This is intentionally narrower than collision lineage: only the strictly
   * larger body in an `absorb` collision contributes continuity ids.
   */""",
    """  /**
   * Source body ids whose ordinary camera tracking may continue onto this body.
   * This is intentionally narrower than generic collision lineage: absorption
   * carries only the dominant absorber, while a true merge may carry both merged
   * physical source lineages. The captured initial-mass gate still applies.
   */""",
)

path = 'src/rendering/simulationRenderer.ts'
text = read(path)
old_options = """export type SimulationRendererOptions = {
  onCameraTelemetry?: (telemetry: SimulationCameraTelemetry) => void
}
"""
new_options = """export type SimulationTrailTelemetry = {
  retainedTrailIds: string[]
}

export type SimulationRendererOptions = {
  onCameraTelemetry?: (telemetry: SimulationCameraTelemetry) => void
  onTrailTelemetry?: (telemetry: SimulationTrailTelemetry) => void
}
"""
if text.count(old_options) != 1:
    raise SystemExit('simulationRenderer options block mismatch')
text = text.replace(old_options, new_options, 1)
old_removal = """    Array.from(visuals.entries()).forEach(([id]) => {
      if (currentIds.has(id)) return
      removeVisual(id)
    })
"""
new_removal = """    const retainedTrailIds: string[] = []
    Array.from(visuals.entries()).forEach(([id, visual]) => {
      if (currentIds.has(id)) return

      visual.mesh.visible = false
      visual.glowInner.visible = false
      visual.glowOuter.visible = false
      while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) visual.points.shift()

      if (trailEnabledNow && visual.points.length > 0) {
        retainedTrailIds.push(id)
        updateTrailVisual(
          visual,
          simulationTimeNow,
          trailDurationNow,
          true,
        )
        return
      }

      removeVisual(id)
    })
"""
if text.count(old_removal) != 1:
    raise SystemExit('simulationRenderer removal block mismatch')
text = text.replace(old_removal, new_removal, 1)
needle = """    })

    controls.update()
    emitCameraTelemetry(
      state,
"""
replacement = """    })

    options.onTrailTelemetry?.({ retainedTrailIds: [...retainedTrailIds] })
    controls.update()
    emitCameraTelemetry(
      state,
"""
if text.count(needle) != 1:
    raise SystemExit(f'simulationRenderer telemetry insertion mismatch: {text.count(needle)}')
text = text.replace(needle, replacement, 1)
write(path, text)

path = 'scripts/trackingRegression.ts'
text = read(path)
insert_before = 'function testDestroyedBodyNeverFallsBackToFragments() {'
test_fn = """function testEqualMassMergeGetsExplicitPhysicsContinuation() {
  const atlas = makeBody('Atlas', 'planet', 0.4013, 0.0754)
  const selene = makeBody('Selene', 'planet', 0.4013, 0.0754)
  atlas.position = { x: -0.073, y: 0, z: 0 }
  selene.position = { x: 0.073, y: 0, z: 0 }

  let after: BodyState[] = [atlas, selene]
  for (let step = 0; step < 24; step += 1) {
    after = stepBodies(after, 0.0015)
  }

  const remnant = after.find((body) =>
    body.bodyType !== 'effect' &&
    body.bodyType !== 'fragment' &&
    body.id.includes('Atlas') &&
    body.id.includes('Selene'),
  )

  assert(remnant, 'equal-mass planet merge must produce one physical remnant')
  assert(
    remnant.trackingContinuationIds?.includes('Atlas') === true &&
      remnant.trackingContinuationIds?.includes('Selene') === true,
    'a true equal-mass merge must explicitly continue both merged source ids',
  )
  assert(
    findTrackingCandidate(after, 'Atlas')?.id === remnant.id,
    'Atlas tracking must resolve to the equal-mass merge remnant',
  )
  assert(
    findTrackingCandidate(after, 'Selene')?.id === remnant.id,
    'Selene tracking must resolve to the equal-mass merge remnant',
  )
  assert(
    isTrackingMassEligible(remnant.mass, atlas.mass) &&
      isTrackingMassEligible(remnant.mass, selene.mass),
    'the equal-mass merge continuation must remain subject to and pass the existing 50% initial-mass gate',
  )
}

"""
if text.count(insert_before) != 1:
    raise SystemExit('tracking regression insertion point mismatch')
text = text.replace(insert_before, test_fn + insert_before, 1)
list_needle = '  testOnlyLargerAbsorberGetsPhysicsContinuation,\n  testDestroyedBodyNeverFallsBackToFragments,'
list_replacement = '  testOnlyLargerAbsorberGetsPhysicsContinuation,\n  testEqualMassMergeGetsExplicitPhysicsContinuation,\n  testDestroyedBodyNeverFallsBackToFragments,'
if text.count(list_needle) != 1:
    raise SystemExit('tracking regression list mismatch')
text = text.replace(list_needle, list_replacement, 1)
write(path, text)

path = 'src/visualRegression/TrackingCameraHandoffVisualHarness.tsx'
text = read(path)
insert_marker = 'function makeState(stage: HandoffStage): SimulationRenderState {'
trail_helper = """function makeTrailBatch(stage: HandoffStage): SimulationRenderState['trailSampleBatch'] {
  if (stage === 'tracking') return { sequence: 0, samples: [] }
  if (stage === 'collision') {
    return {
      sequence: 1,
      samples: [
        { bodyId: sourceA.id, color: sourceA.color, position: { x: -0.9, y: -0.08, z: 0 }, simulatedAt: 0.1 },
        { bodyId: sourceA.id, color: sourceA.color, position: { x: -0.6, y: -0.05, z: 0 }, simulatedAt: 0.2 },
        { bodyId: sourceA.id, color: sourceA.color, position: { x: -0.3, y: -0.02, z: 0 }, simulatedAt: 0.3 },
        { bodyId: sourceB.id, color: sourceB.color, position: { x: 1.1, y: 0.28, z: 0 }, simulatedAt: 0.1 },
        { bodyId: sourceB.id, color: sourceB.color, position: { x: 0.9, y: 0.22, z: 0 }, simulatedAt: 0.2 },
        { bodyId: sourceB.id, color: sourceB.color, position: { x: 0.7, y: 0.16, z: 0 }, simulatedAt: 0.3 },
      ],
    }
  }
  return {
    sequence: 2,
    samples: [
      { bodyId: remnant.id, color: remnant.color, position: { ...remnant.position }, simulatedAt: 1 },
    ],
  }
}

"""
if text.count(insert_marker) != 1:
    raise SystemExit('handoff harness makeState marker mismatch')
text = text.replace(insert_marker, trail_helper + insert_marker, 1)
old_trail_state = """    trailEnabled: false,
    trailDuration: 8,
    trailSampleBatch: { sequence: 0, samples: [] },"""
new_trail_state = """    trailEnabled: true,
    trailDuration: 8,
    trailSampleBatch: makeTrailBatch(stage),"""
if text.count(old_trail_state) != 1:
    raise SystemExit('handoff harness trail state mismatch')
text = text.replace(old_trail_state, new_trail_state, 1)
global_needle = '    __trackingCameraHandoffSamples?: TimedCameraTelemetry[]\n'
if text.count(global_needle) != 1:
    raise SystemExit('handoff harness global marker mismatch')
text = text.replace(global_needle, global_needle + '    __trackingCameraHandoffRetainedTrailIds?: string[]\n', 1)
callback_needle = """        onCameraTelemetry: (telemetry) => {
          window.__trackingCameraHandoffTelemetry = telemetry
          if (releaseArmed && telemetry.collisionCameraJustReleased) {
            releaseStartedAt = telemetry.nowMs
            releaseArmed = false
            releaseSamples.length = 0
          }
          if (releaseStartedAt !== null) {
            releaseSamples.push({
              ...telemetry,
              elapsedMs: telemetry.nowMs - releaseStartedAt,
            })
            if (releaseSamples.length > 180) releaseSamples.shift()
            window.__trackingCameraHandoffSamples = [...releaseSamples]
          }
        },
"""
callback_replacement = callback_needle + """        onTrailTelemetry: (telemetry) => {
          window.__trackingCameraHandoffRetainedTrailIds = [...telemetry.retainedTrailIds]
        },
"""
if text.count(callback_needle) != 1:
    raise SystemExit('handoff harness callback mismatch')
text = text.replace(callback_needle, callback_replacement, 1)
cleanup_needle = '      delete window.__trackingCameraHandoffSamples\n'
if text.count(cleanup_needle) != 1:
    raise SystemExit('handoff harness cleanup marker mismatch')
text = text.replace(cleanup_needle, cleanup_needle + '      delete window.__trackingCameraHandoffRetainedTrailIds\n', 1)
write(path, text)

path = 'scripts/collisionCameraTrackingHandoffVisualRegression.py'
text = read(path)
probe_needle = """        samples = driver.execute_script('return window.__trackingCameraHandoffSamples')
        require(isinstance(samples, list) and len(samples) >= 4, 'release telemetry must contain multiple renderer frames')

"""
probe_replacement = probe_needle + """        retained_trail_ids = driver.execute_script(
            'return window.__trackingCameraHandoffRetainedTrailIds || []'
        )
        require(
            'handoff-a' in retained_trail_ids and 'handoff-b' in retained_trail_ids,
            f'collision source trails must remain after merge body-id replacement: {retained_trail_ids}',
        )
        payload['retained_trail_ids'] = retained_trail_ids

"""
if text.count(probe_needle) != 1:
    raise SystemExit('handoff visual regression insertion mismatch')
text = text.replace(probe_needle, probe_replacement, 1)
write(path, text)
