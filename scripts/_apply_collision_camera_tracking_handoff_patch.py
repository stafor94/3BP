from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'expected snippet not found in {relative_path}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def write(relative_path: str, content: str) -> None:
    path = ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')


write('src/rendering/trackingCameraHandoff.ts', r'''export type CameraMode = 'collision' | 'tracking' | 'preserve'

export function isCollisionCameraJustReleased(
  wasCollisionCameraFocused: boolean,
  collisionCameraFocused: boolean,
  hasTrackedBody: boolean,
) {
  return wasCollisionCameraFocused && !collisionCameraFocused && hasTrackedBody
}

export function shouldResetTrackingFocus(
  selectionChanged: boolean,
  collisionCameraJustReleased: boolean,
) {
  return selectionChanged || collisionCameraJustReleased
}

export function resolveCameraMode(
  collisionCameraFocused: boolean,
  hasTrackedBody: boolean,
): CameraMode {
  if (collisionCameraFocused) return 'collision'
  if (hasTrackedBody) return 'tracking'
  return 'preserve'
}
''')

replace_exact(
    'src/rendering/simulationRenderer.ts',
    "import { createFragmentGeometry } from './fragmentGeometry'\n",
    "import { createFragmentGeometry } from './fragmentGeometry'\nimport {\n  isCollisionCameraJustReleased,\n  resolveCameraMode,\n  shouldResetTrackingFocus,\n  type CameraMode,\n} from './trackingCameraHandoff'\n",
)

replace_exact(
    'src/rendering/simulationRenderer.ts',
    '''export type SimulationRenderState = {\n  bodies: BodyState[]\n  simulationTime: number\n  trailVersion: number\n  trailEnabled: boolean\n  trailDuration: number\n  trailSampleBatch: TrailSampleBatch\n  trackedBodyId: string | null\n  collisionCameraFocus: CollisionCameraFocus | null\n}\n''',
    '''export type SimulationRenderState = {\n  bodies: BodyState[]\n  simulationTime: number\n  trailVersion: number\n  trailEnabled: boolean\n  trailDuration: number\n  trailSampleBatch: TrailSampleBatch\n  trackedBodyId: string | null\n  collisionCameraFocus: CollisionCameraFocus | null\n}\n\nexport type SimulationCameraTelemetry = {\n  nowMs: number\n  mode: CameraMode\n  trackedBodyId: string | null\n  resolvedTrackedBodyId: string | null\n  collisionCameraFocused: boolean\n  collisionCameraJustReleased: boolean\n  trackingFocusNeedsReset: boolean\n  trackingFocusSettleFrames: number\n  cameraPosition: { x: number; y: number; z: number }\n  controlsTarget: { x: number; y: number; z: number }\n  trackedBodyPosition: { x: number; y: number; z: number } | null\n  trackedBodyNdc: { x: number; y: number; z: number } | null\n  cameraDistanceToTrackedBody: number | null\n  desiredCameraDistance: number | null\n  targetErrorToTrackedBody: number | null\n}\n\nexport type SimulationRendererOptions = {\n  onCameraTelemetry?: (telemetry: SimulationCameraTelemetry) => void\n}\n''',
)

replace_exact(
    'src/rendering/simulationRenderer.ts',
    'export function createSimulationRenderer(host: HTMLDivElement, getState: () => SimulationRenderState) {\n',
    '''export function createSimulationRenderer(\n  host: HTMLDivElement,\n  getState: () => SimulationRenderState,\n  options: SimulationRendererOptions = {},\n) {\n''',
)

replace_exact(
    'src/rendering/simulationRenderer.ts',
    '''  let trackingFocusSettleFrames = 0\n  let wasTrackingBody = false\n''',
    '''  let trackingFocusSettleFrames = 0\n  let wasTrackingBody = false\n  let wasCollisionCameraFocused = false\n''',
)

replace_exact(
    'src/rendering/simulationRenderer.ts',
    '''  const applyAutoDistanceLimits = (body: BodyState) => {\n    const renderRadius = getRenderedBodyRadius(body.radius, RENDER_TUNING.body.minRenderRadius)\n    controls.minDistance = Math.max(camera.near * 2, renderRadius * 1.01)\n    controls.maxDistance = Math.min(RENDER_TUNING.camera.maxDistance, camera.far * 0.9)\n  }\n''',
    '''  const applyAutoDistanceLimits = (body: BodyState) => {\n    const renderRadius = getRenderedBodyRadius(body.radius, RENDER_TUNING.body.minRenderRadius)\n    controls.minDistance = Math.max(camera.near * 2, renderRadius * 1.01)\n    controls.maxDistance = Math.min(RENDER_TUNING.camera.maxDistance, camera.far * 0.9)\n  }\n\n  const emitCameraTelemetry = (\n    state: SimulationRenderState,\n    trackedBody: BodyState | undefined,\n    mode: CameraMode,\n    collisionCameraFocused: boolean,\n    collisionCameraJustReleased: boolean,\n    trackingFocusNeedsReset: boolean,\n  ) => {\n    const callback = options.onCameraTelemetry\n    if (!callback) return\n\n    const trackedPosition = trackedBody\n      ? new THREE.Vector3(trackedBody.position.x, trackedBody.position.y, trackedBody.position.z)\n      : null\n    const trackedBodyNdc = trackedPosition ? trackedPosition.clone() : null\n    if (trackedBodyNdc) {\n      camera.updateMatrixWorld()\n      trackedBodyNdc.project(camera)\n    }\n\n    callback({\n      nowMs: performance.now(),\n      mode,\n      trackedBodyId: state.trackedBodyId,\n      resolvedTrackedBodyId: trackedBody?.id ?? null,\n      collisionCameraFocused,\n      collisionCameraJustReleased,\n      trackingFocusNeedsReset,\n      trackingFocusSettleFrames,\n      cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },\n      controlsTarget: { x: controls.target.x, y: controls.target.y, z: controls.target.z },\n      trackedBodyPosition: trackedPosition\n        ? { x: trackedPosition.x, y: trackedPosition.y, z: trackedPosition.z }\n        : null,\n      trackedBodyNdc: trackedBodyNdc\n        ? { x: trackedBodyNdc.x, y: trackedBodyNdc.y, z: trackedBodyNdc.z }\n        : null,\n      cameraDistanceToTrackedBody: trackedPosition\n        ? camera.position.distanceTo(trackedPosition)\n        : null,\n      desiredCameraDistance: trackedBody ? getAutoCameraDistance(trackedBody) : null,\n      targetErrorToTrackedBody: trackedPosition\n        ? controls.target.distanceTo(trackedPosition)\n        : null,\n    })\n  }\n''',
)

replace_exact(
    'src/rendering/simulationRenderer.ts',
    '''    const trackedBody = getTrackedBody(current, state.trackedBodyId)\n    const trackingSelectionChanged = isTrackingSelectionChanged(state.trackedBodyId)\n    const collisionCameraFocused = applyCollisionCameraFocus(state)\n\n    if (!collisionCameraFocused && trackedBody) {\n      applyTrackingCameraFocus(trackedBody, trackingSelectionChanged)\n    } else if (!collisionCameraFocused && (wasTrackingBody || trackingSelectionChanged)) {\n      resetAutoDistanceLimits()\n      trackingFocusSettleFrames = 0\n      wasTrackingBody = false\n    }\n    observedTrackedBodyId = state.trackedBodyId\n''',
    '''    const trackedBody = getTrackedBody(current, state.trackedBodyId)\n    const trackingSelectionChanged = isTrackingSelectionChanged(state.trackedBodyId)\n    const collisionCameraFocused = applyCollisionCameraFocus(state)\n    const collisionCameraJustReleased = isCollisionCameraJustReleased(\n      wasCollisionCameraFocused,\n      collisionCameraFocused,\n      trackedBody !== undefined,\n    )\n    const trackingFocusNeedsReset = shouldResetTrackingFocus(\n      trackingSelectionChanged,\n      collisionCameraJustReleased,\n    )\n    const cameraMode = resolveCameraMode(collisionCameraFocused, trackedBody !== undefined)\n\n    if (cameraMode === 'tracking' && trackedBody) {\n      applyTrackingCameraFocus(trackedBody, trackingFocusNeedsReset)\n    } else if (cameraMode === 'preserve' && (wasTrackingBody || trackingSelectionChanged)) {\n      resetAutoDistanceLimits()\n      trackingFocusSettleFrames = 0\n      wasTrackingBody = false\n    }\n    observedTrackedBodyId = state.trackedBodyId\n    wasCollisionCameraFocused = collisionCameraFocused\n''',
)

replace_exact(
    'src/rendering/simulationRenderer.ts',
    '''    controls.update()\n    renderer.render(scene, camera)\n''',
    '''    controls.update()\n    emitCameraTelemetry(\n      state,\n      trackedBody,\n      cameraMode,\n      collisionCameraFocused,\n      collisionCameraJustReleased,\n      trackingFocusNeedsReset,\n    )\n    renderer.render(scene, camera)\n''',
)

replace_exact(
    'scripts/trackingRegression.ts',
    "import { stepBodies } from '../src/physics/fragmentAwareEngine'\n",
    "import { stepBodies } from '../src/physics/fragmentAwareEngine'\nimport {\n  isCollisionCameraJustReleased,\n  shouldResetTrackingFocus,\n} from '../src/rendering/trackingCameraHandoff'\n",
)

replace_exact(
    'scripts/trackingRegression.ts',
    '''function testBodyScaleEquivalentMassKeepsSameEligibilityRatio() {\n  assert(\n    isTrackingMassEligible(1.0, 2.0),\n    'scaling both the live candidate and captured baseline equally must preserve the 50% boundary',\n  )\n  assert(\n    !isTrackingMassEligible(0.98, 2.0),\n    'bodyScale must not reset the captured baseline to the current descendant mass',\n  )\n}\n''',
    '''function testBodyScaleEquivalentMassKeepsSameEligibilityRatio() {\n  assert(\n    isTrackingMassEligible(1.0, 2.0),\n    'scaling both the live candidate and captured baseline equally must preserve the 50% boundary',\n  )\n  assert(\n    !isTrackingMassEligible(0.98, 2.0),\n    'bodyScale must not reset the captured baseline to the current descendant mass',\n  )\n}\n\nfunction testCollisionCameraReleaseForcesExistingTrackingFocusReset() {\n  const initialMass = 1\n  const trackedBodyId = 'Alpha'\n  const remnant = makeBody('Alpha+Beta', 'planet', 0.72, 0.18)\n  remnant.trackingContinuationIds = [trackedBodyId]\n  const candidate = findTrackingCandidate([remnant], trackedBodyId)\n\n  assert(candidate?.id === remnant.id, 'collision result must expose the authorized Alpha continuation')\n  assert(\n    isTrackingMassEligible(candidate.mass, initialMass),\n    'fixture continuation must pass the original 50% tracking mass gate',\n  )\n\n  const collisionCameraJustReleased = isCollisionCameraJustReleased(true, false, true)\n  assert(collisionCameraJustReleased, 'collision camera release must be detected while tracking remains valid')\n  assert(\n    shouldResetTrackingFocus(false, collisionCameraJustReleased),\n    'same trackedBodyId must still restart tracking focus after collision-camera release',\n  )\n  assert(trackedBodyId === 'Alpha', 'camera handoff must not rewrite the user-selected source id')\n  assert(initialMass === 1, 'camera handoff must not rewrite the captured tracking baseline mass')\n}\n\nfunction testCollisionCameraReleaseDoesNotReviveBelowHalfTracking() {\n  const initialMass = 1\n  const trackedBodyId = 'Alpha'\n  const remnant = makeBody('Alpha+Beta', 'planet', 0.49, 0.14)\n  remnant.trackingContinuationIds = [trackedBodyId]\n  const candidate = findTrackingCandidate([remnant], trackedBodyId)\n\n  assert(candidate?.id === remnant.id, 'fixture must expose a continuation before the mass gate')\n  assert(\n    !isTrackingMassEligible(candidate.mass, initialMass),\n    'continuation below 50% must remain ineligible for ordinary tracking',\n  )\n  assert(\n    !isCollisionCameraJustReleased(true, false, false),\n    'camera handoff must not restart tracking after the mass gate has cleared the tracked body',\n  )\n}\n''',
)

replace_exact(
    'scripts/trackingRegression.ts',
    '''  testBelowHalfMassCannotUseAuthorizedDescendant,\n  testBodyScaleEquivalentMassKeepsSameEligibilityRatio,\n]\n''',
    '''  testBelowHalfMassCannotUseAuthorizedDescendant,\n  testBodyScaleEquivalentMassKeepsSameEligibilityRatio,\n  testCollisionCameraReleaseForcesExistingTrackingFocusReset,\n  testCollisionCameraReleaseDoesNotReviveBelowHalfTracking,\n]\n''',
)

write('scripts/collisionCameraTrackingHandoffRegression.ts', r'''import { calculatePerspectiveBodyDistance, COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION } from '../src/rendering/cameraFraming'
import {
  isCollisionCameraJustReleased,
  resolveCameraMode,
  shouldResetTrackingFocus,
} from '../src/rendering/trackingCameraHandoff'
import { isTrackingMassEligible } from '../src/trackingMassPolicy'
import { findTrackingCandidate } from '../src/trackingSelection'
import type { BodyState } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makeBody(id: string, mass: number, radius: number): BodyState {
  return {
    id,
    name: id,
    color: '#ffffff',
    mass,
    radius,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    bodyType: 'planet',
  }
}

function testSameSelectionUsesCameraModeHandoff() {
  const trackedBodyId = 'A'
  const trackingBaseline = { sourceId: trackedBodyId, initialMass: 1 }
  const continuation = makeBody('A+B', 0.76, 0.3)
  continuation.trackingContinuationIds = [trackedBodyId]
  const trackedBody = findTrackingCandidate([continuation], trackedBodyId)

  assert(trackedBody?.id === continuation.id, 'authorized collision continuation must remain resolvable')
  assert(
    isTrackingMassEligible(trackedBody.mass, trackingBaseline.initialMass),
    'authorized continuation must pass the captured 50% mass baseline',
  )

  const selectionChanged = false
  const justReleased = isCollisionCameraJustReleased(true, false, trackedBody !== null)
  assert(justReleased, 'true -> false collision-camera transition must be observable')
  assert(
    shouldResetTrackingFocus(selectionChanged, justReleased),
    'camera-mode release must reset tracking focus even when the selection id is unchanged',
  )
  assert(
    resolveCameraMode(false, trackedBody !== null) === 'tracking',
    'release frame with a valid tracked body must go directly to tracking mode',
  )
  assert(trackingBaseline.sourceId === trackedBodyId, 'camera handoff must preserve tracking baseline source id')
  assert(trackingBaseline.initialMass === 1, 'camera handoff must preserve tracking baseline mass')
}

function testTrackingSettleConvergesWithoutDistanceOvershoot() {
  const viewportWidth = 900
  const viewportHeight = 700
  const radius = 0.3
  const verticalFovDegrees = 55
  const collisionDistance = calculatePerspectiveBodyDistance({
    bodyRadius: radius,
    minRenderRadius: 0.025,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
    targetRadiusFraction: COLLISION_TARGET_BODY_RADIUS_SCREEN_FRACTION,
  })
  const trackingDistance = calculatePerspectiveBodyDistance({
    bodyRadius: radius,
    minRenderRadius: 0.025,
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  })

  assert(trackingDistance > collisionDistance, 'fixture must require a collision-to-tracking distance handoff')

  let distance = collisionDistance
  let previousError = Math.abs(distance - trackingDistance)
  for (let frame = 0; frame < 18; frame += 1) {
    const next = distance + (trackingDistance - distance) * 0.16
    const error = Math.abs(next - trackingDistance)
    const relativeStep = Math.abs(next - distance) / Math.max(distance, 1e-9)
    assert(error <= previousError + 1e-12, 'tracking handoff distance error must decrease every settle frame')
    assert(relativeStep <= 0.25, 'tracking handoff must not produce a one-frame distance jump')
    assert(next <= trackingDistance + 1e-12, 'tracking handoff must not overshoot the auto-distance target')
    distance = next
    previousError = error
  }

  assert(
    previousError / trackingDistance < 0.05,
    '18-frame tracking settle must converge close to the tracked-body auto distance',
  )
}

function testBelowHalfContinuationStaysReleased() {
  const continuation = makeBody('A+B', 0.49, 0.2)
  continuation.trackingContinuationIds = ['A']
  const candidate = findTrackingCandidate([continuation], 'A')
  assert(candidate?.id === continuation.id, 'fixture must resolve the explicit continuation before the mass gate')
  assert(!isTrackingMassEligible(candidate.mass, 1), 'below-half continuation must remain rejected')
  assert(
    resolveCameraMode(false, false) === 'preserve',
    'when tracking is genuinely released, camera mode must preserve the existing view instead of reviving tracking',
  )
  assert(
    !isCollisionCameraJustReleased(true, false, false),
    'collision-camera release must not synthesize a tracking handoff without a valid tracked body',
  )
}

const tests = [
  testSameSelectionUsesCameraModeHandoff,
  testTrackingSettleConvergesWithoutDistanceOvershoot,
  testBelowHalfContinuationStaysReleased,
]

for (const test of tests) test()
console.log(`collision camera tracking handoff regression checks passed (${tests.length})`)
''')

replace_exact(
    'scripts/runPhysicsRegression.mjs',
    "  { source: 'trackingRegression.ts', output: 'trackingRegression.mjs' },\n",
    "  { source: 'trackingRegression.ts', output: 'trackingRegression.mjs' },\n  { source: 'collisionCameraTrackingHandoffRegression.ts', output: 'collisionCameraTrackingHandoffRegression.mjs' },\n",
)

write('src/visualRegression/TrackingCameraHandoffVisualHarness.tsx', r'''import { useEffect, useRef } from 'react'
import {
  createSimulationRenderer,
  type SimulationCameraTelemetry,
  type SimulationRenderState,
} from '../rendering/simulationRenderer'
import type { BodyState } from '../types'

type HandoffStage = 'tracking' | 'collision' | 'release'
type TimedCameraTelemetry = SimulationCameraTelemetry & { elapsedMs: number }

const SOURCE_ID = 'handoff-a'
const REMNANT_ID = 'handoff-a+handoff-b'

function makeBody(
  id: string,
  mass: number,
  radius: number,
  position: BodyState['position'],
  velocity: BodyState['velocity'],
  color: string,
): BodyState {
  return {
    id,
    name: id,
    mass,
    radius,
    position,
    velocity,
    color,
    bodyType: 'planet',
  }
}

const sourceA = makeBody(
  SOURCE_ID,
  1,
  0.3,
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  '#f0aa68',
)
const sourceB = makeBody(
  'handoff-b',
  0.35,
  0.18,
  { x: 0.58, y: 0.12, z: 0 },
  { x: 0, y: 0.4, z: 0 },
  '#83afff',
)
const remnant = makeBody(
  REMNANT_ID,
  0.76,
  0.31,
  { x: 0.035, y: 0.01, z: 0 },
  { x: 0.02, y: 0, z: 0 },
  '#f0aa68',
)
remnant.trackingContinuationIds = [SOURCE_ID]

function makeState(stage: HandoffStage): SimulationRenderState {
  const common = {
    simulationTime: stage === 'release' ? 1 : 0,
    trailVersion: 0,
    trailEnabled: false,
    trailDuration: 8,
    trailSampleBatch: { sequence: 0, samples: [] },
    trackedBodyId: SOURCE_ID,
  }

  if (stage === 'collision') {
    return {
      ...common,
      bodies: [sourceA, sourceB],
      collisionCameraFocus: {
        pairKey: `${sourceA.id}~${sourceB.id}`,
        bodyAId: sourceA.id,
        bodyBId: sourceB.id,
      },
    }
  }

  return {
    ...common,
    bodies: stage === 'release' ? [remnant] : [sourceA],
    collisionCameraFocus: null,
  }
}

function isHandoffStage(value: string): value is HandoffStage {
  return value === 'tracking' || value === 'collision' || value === 'release'
}

declare global {
  interface Window {
    __setTrackingCameraHandoffStage?: (stage: string) => void
    __trackingCameraHandoffStage?: string
    __trackingCameraHandoffTelemetry?: SimulationCameraTelemetry
    __trackingCameraHandoffSamples?: TimedCameraTelemetry[]
  }
}

export function TrackingCameraHandoffVisualHarness() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let currentState = makeState('tracking')
    let releaseStartedAt: number | null = null
    let releaseArmed = false
    const releaseSamples: TimedCameraTelemetry[] = []

    const dispose = createSimulationRenderer(
      host,
      () => currentState,
      {
        onCameraTelemetry: (telemetry) => {
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
      },
    )

    window.__setTrackingCameraHandoffStage = (nextStage: string) => {
      if (!isHandoffStage(nextStage)) throw new Error(`Unknown tracking handoff visual stage: ${nextStage}`)
      if (nextStage === 'release') {
        releaseStartedAt = null
        releaseArmed = true
        releaseSamples.length = 0
        window.__trackingCameraHandoffSamples = []
      }
      currentState = makeState(nextStage)
      window.__trackingCameraHandoffStage = nextStage
      document.body.dataset.visualStage = nextStage
    }
    window.__setTrackingCameraHandoffStage('tracking')

    return () => {
      dispose()
      delete window.__setTrackingCameraHandoffStage
      delete window.__trackingCameraHandoffStage
      delete window.__trackingCameraHandoffTelemetry
      delete window.__trackingCameraHandoffSamples
      delete document.body.dataset.visualStage
    }
  }, [])

  return (
    <div
      data-visual-regression="tracking-camera-handoff"
      ref={hostRef}
      style={{ position: 'fixed', inset: 0, background: '#03050a', overflow: 'hidden' }}
    />
  )
}
''')

replace_exact(
    'src/main.tsx',
    '''} else if (visualRegression === 'absorption-continuity') {\n  void import('./visualRegression/AbsorptionContinuityVisualHarness').then(({ AbsorptionContinuityVisualHarness }) => {\n    root.render(<AbsorptionContinuityVisualHarness />)\n  })\n} else {\n''',
    '''} else if (visualRegression === 'absorption-continuity') {\n  void import('./visualRegression/AbsorptionContinuityVisualHarness').then(({ AbsorptionContinuityVisualHarness }) => {\n    root.render(<AbsorptionContinuityVisualHarness />)\n  })\n} else if (visualRegression === 'tracking-camera-handoff') {\n  void import('./visualRegression/TrackingCameraHandoffVisualHarness').then(({ TrackingCameraHandoffVisualHarness }) => {\n    root.render(<TrackingCameraHandoffVisualHarness />)\n  })\n} else {\n''',
)

write('scripts/collisionCameraTrackingHandoffVisualRegression.py', r'''#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-camera-tracking-handoff-artifacts')
URL = os.environ.get(
    'COLLISION_CAMERA_TRACKING_HANDOFF_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=tracking-camera-handoff',
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=900,700')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--ignore-gpu-blocklist')
    options.add_argument('--enable-webgl')
    options.add_argument('--enable-unsafe-swiftshader')
    options.add_argument('--use-gl=angle')
    options.add_argument('--use-angle=swiftshader')
    options.add_argument('--hide-scrollbars')

    chrome_binary = (
        shutil.which('google-chrome')
        or shutil.which('google-chrome-stable')
        or shutil.which('chromium')
        or shutil.which('chromium-browser')
    )
    if chrome_binary:
        options.binary_location = chrome_binary

    driver_binary = shutil.which('chromedriver')
    if driver_binary:
        return webdriver.Chrome(service=Service(driver_binary), options=options)
    return webdriver.Chrome(options=options)


def set_stage(driver: webdriver.Chrome, stage: str) -> None:
    driver.execute_async_script(
        """
        const stage = arguments[0];
        const done = arguments[arguments.length - 1];
        window.__setTrackingCameraHandoffStage(stage);
        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== stage) {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(done));
        };
        requestAnimationFrame(waitForCommit);
        """,
        stage,
    )


def screenshot_canvas(driver: webdriver.Chrome, name: str) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="tracking-camera-handoff"] canvas')
    path = OUTPUT_DIR / f'{name}.png'
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {name}')


def nearest_sample(samples: list[dict[str, object]], elapsed_ms: float) -> dict[str, object]:
    return min(samples, key=lambda sample: abs(float(sample['elapsedMs']) - elapsed_ms))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    payload: dict[str, object] = {}

    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__setTrackingCameraHandoffStage === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(
                By.CSS_SELECTOR,
                '[data-visual-regression="tracking-camera-handoff"] canvas',
            )) == 1
        )

        time.sleep(0.45)
        tracking = driver.execute_script('return window.__trackingCameraHandoffTelemetry')
        require(tracking and tracking['mode'] == 'tracking', 'fixture must begin in ordinary tracking mode')
        require(tracking['trackedBodyId'] == 'handoff-a', 'initial tracking source id must stay selected')

        set_stage(driver, 'collision')
        time.sleep(0.75)
        before_release = driver.execute_script('return window.__trackingCameraHandoffTelemetry')
        require(before_release and before_release['mode'] == 'collision', 'collision camera must own the frame before release')
        require(before_release['trackedBodyId'] == 'handoff-a', 'collision camera must not clear the tracking selection')
        screenshot_canvas(driver, '01-before-release')

        set_stage(driver, 'release')
        WebDriverWait(driver, 10, poll_frequency=0.02).until(
            lambda browser: browser.execute_script(
                '''
                const samples = window.__trackingCameraHandoffSamples || [];
                return samples.length > 0 && samples[samples.length - 1].elapsedMs >= 650;
                '''
            )
        )
        samples = driver.execute_script('return window.__trackingCameraHandoffSamples')
        require(isinstance(samples, list) and len(samples) >= 4, 'release telemetry must contain multiple renderer frames')

        first = samples[0]
        require(float(first['elapsedMs']) <= 50, 'first release telemetry must represent the immediate handoff frame')
        require(first['mode'] == 'tracking', 'release frame must go directly from collision mode to tracking mode')
        require(bool(first['collisionCameraJustReleased']), 'release frame must explicitly detect the camera-mode transition')
        require(bool(first['trackingFocusNeedsReset']), 'release frame must restart tracking focus settle')
        require(int(first['trackingFocusSettleFrames']) > 0, 'release frame must have active tracking settle frames')
        require(first['trackedBodyId'] == 'handoff-a', 'tracked source id must remain selected across handoff')
        require(first['resolvedTrackedBodyId'] == 'handoff-a+handoff-b', 'tracking must resolve to the authorized continuation')

        checkpoints = {
            'release_frame': nearest_sample(samples, 0),
            'plus_100ms': nearest_sample(samples, 100),
            'plus_300ms': nearest_sample(samples, 300),
            'plus_600ms': nearest_sample(samples, 600),
        }
        payload['before_release'] = before_release
        payload['checkpoints'] = checkpoints

        previous_error = None
        previous_distance = None
        max_relative_step = 0.0
        for sample in samples:
            if sample['mode'] != 'tracking':
                continue
            distance = float(sample['cameraDistanceToTrackedBody'])
            desired = float(sample['desiredCameraDistance'])
            error = abs(distance - desired)
            if previous_error is not None and int(sample['trackingFocusSettleFrames']) > 0:
                require(
                    error <= previous_error + 1e-5,
                    f'tracking distance error must decrease continuously during settle: {error} > {previous_error}',
                )
            if previous_distance is not None:
                relative_step = abs(distance - previous_distance) / max(abs(previous_distance), 1e-9)
                max_relative_step = max(max_relative_step, relative_step)
            previous_error = error
            previous_distance = distance

        require(max_relative_step <= 0.25, f'camera distance changed too abruptly in one frame: {max_relative_step:.4f}')
        payload['max_relative_distance_step'] = max_relative_step

        checkpoint_errors: list[float] = []
        checkpoint_target_errors: list[float] = []
        for name, sample in checkpoints.items():
            require(sample['mode'] == 'tracking', f'{name} must remain in tracking camera mode')
            require(sample['trackedBodyId'] == 'handoff-a', f'{name} must keep the tracking UI source id')
            require(sample['resolvedTrackedBodyId'] == 'handoff-a+handoff-b', f'{name} must keep the continuation target')
            ndc = sample['trackedBodyNdc']
            require(ndc is not None, f'{name} must expose tracked-body viewport telemetry')
            require(abs(float(ndc['x'])) <= 0.08 and abs(float(ndc['y'])) <= 0.08, f'{name} tracked body left viewport center: {ndc}')
            require(-1.0 <= float(ndc['z']) <= 1.0, f'{name} tracked body left camera depth range: {ndc}')
            target_error = float(sample['targetErrorToTrackedBody'])
            require(target_error <= 0.03, f'{name} controls target drifted away from tracked body: {target_error}')
            checkpoint_target_errors.append(target_error)
            distance = float(sample['cameraDistanceToTrackedBody'])
            desired = float(sample['desiredCameraDistance'])
            checkpoint_errors.append(abs(distance - desired))

        require(
            all(checkpoint_errors[index] <= checkpoint_errors[index - 1] + 1e-4 for index in range(1, len(checkpoint_errors))),
            f'checkpoint camera-distance error must not increase: {checkpoint_errors}',
        )
        require(
            checkpoint_errors[-1] / max(float(checkpoints['plus_600ms']['desiredCameraDistance']), 1e-9) <= 0.08,
            f'camera must converge close to tracked-body distance by +600ms: {checkpoint_errors[-1]}',
        )
        require(
            all(error <= checkpoint_target_errors[0] + 1e-5 for error in checkpoint_target_errors[1:]),
            f'camera target error must stay non-increasing after release: {checkpoint_target_errors}',
        )

        time.sleep(0.05)
        screenshot_canvas(driver, '02-after-release')
        (OUTPUT_DIR / 'metrics.json').write_text(
            json.dumps(payload, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        print('collision camera tracking handoff browser regression passed')
    finally:
        driver.quit()


if __name__ == '__main__':
    main()
''')

replace_exact(
    '.github/workflows/ci.yml',
    '''      - name: Collision watch browser visual regression\n        run: python scripts/collisionWatchVisualRegression.py\n      - name: Non-stellar destruction browser visual regression\n''',
    '''      - name: Collision watch browser visual regression\n        run: python scripts/collisionWatchVisualRegression.py\n      - name: Collision camera tracking handoff browser regression\n        run: python scripts/collisionCameraTrackingHandoffVisualRegression.py\n      - name: Non-stellar destruction browser visual regression\n''',
)

replace_exact(
    '.github/workflows/ci.yml',
    '''      - name: Upload collision watch visual captures\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: collision-watch-visual-regression\n          path: collision-watch-visual-artifacts\n          if-no-files-found: warn\n          retention-days: 7\n      - name: Upload non-stellar destruction visual captures\n''',
    '''      - name: Upload collision watch visual captures\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: collision-watch-visual-regression\n          path: collision-watch-visual-artifacts\n          if-no-files-found: warn\n          retention-days: 7\n      - name: Upload collision camera tracking handoff captures\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: collision-camera-tracking-handoff-regression\n          path: collision-camera-tracking-handoff-artifacts\n          if-no-files-found: warn\n          retention-days: 7\n      - name: Upload non-stellar destruction visual captures\n''',
)

replace_exact(
    'package.json',
    '  "version": "0.19.4",\n',
    '  "version": "0.19.5",\n',
)

replace_exact(
    'CHANGELOG.md',
    '''> `v0.1.0`부터의 Git 커밋 기록과 `package.json` 버전 전환을 역추적해 복원한 변경 이력입니다. 임시/no-op 커밋과 배포 트리거처럼 사용자 동작에 영향을 주지 않는 내부 작업은 제외했습니다.\n\n## [0.19.4] - 2026-08-27\n''',
    '''> `v0.1.0`부터의 Git 커밋 기록과 `package.json` 버전 전환을 역추적해 복원한 변경 이력입니다. 임시/no-op 커밋과 배포 트리거처럼 사용자 동작에 영향을 주지 않는 내부 작업은 제외했습니다.\n\n## [0.19.5] - 2026-08-27\n\n### Fixed\n- 충돌 관찰 카메라가 종료될 때 `trackedBodyId`가 동일해 일반 tracking의 selection change가 발생하지 않고, collision camera의 마지막 거리/방향이 남은 채 focus settle이 재시작되지 않던 문제를 수정했습니다.\n- collision camera의 `focused → released` 전이를 별도 camera-mode handoff로 감지해 기존 tracking selection·baseline·50% mass rule을 건드리지 않고 같은 tracking focus 초기화 경로에서 view direction과 auto-distance settle을 다시 시작하도록 했습니다.\n- collision camera 종료 프레임에 default composition을 거치거나 카메라를 순간이동하지 않고, 현재 카메라 위치에서 기존 tracking transition으로 유효 continuation을 계속 화면 중앙에 유지하도록 했습니다.\n\n### Added\n- 동일 tracked source의 collision-camera release, 50% mass 경계, release 직후 1 frame 및 +100/+300/+600ms의 viewport 중심·camera distance 수렴을 검증하는 tracking/camera handoff 회귀와 브라우저 renderer telemetry 검증을 추가했습니다.\n\n## [0.19.4] - 2026-08-27\n''',
)

# Remove the temporary patching machinery from the release commit.
for relative_path in (
    'scripts/_apply_collision_camera_tracking_handoff_patch.py',
    '.github/workflows/_apply_collision_camera_tracking_handoff_patch.yml',
):
    path = ROOT / relative_path
    if path.exists():
        path.unlink()
