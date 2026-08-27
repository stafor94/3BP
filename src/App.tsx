import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPresetBodyTypes } from './bodyTypes'
import {
  didCollisionWatchTargetImpact,
  hasTargetPairCollisionResult,
  resolveBodyDescendant,
} from './collisionWatch'
import {
  COLLISION_WATCH_APPROACH_SPEED,
  COLLISION_WATCH_IMPACT_SPEED,
  COLLISION_WATCH_POST_IMPACT_SPEED,
  getCollisionWatchRestoreSpeed,
  getCollisionWatchTimingProfile,
  type CollisionWatchPhase,
  type CollisionWatchTimingProfile,
} from './collisionWatchTiming'
import { BodyTrackingRail } from './components/BodyTrackingRail'
import { CollisionAlert } from './components/CollisionAlert'
import {
  CollisionWatchInfo,
  type CollisionWatchBodyInfo,
  type CollisionWatchDetails,
} from './components/CollisionWatchInfo'
import { ControlPanel } from './components/ControlPanel'
import { SimulationView } from './components/SimulationView'
import { ViewportSpeedMenu } from './components/ViewportSpeedMenu'
import { FRAGMENT_TRAIL_TIME } from './fragmentLifecycle'
import { getOrbital2dPresetOverride } from './orbital2dPresets'
import { getOrbital3dPresetOverride } from './orbital3dPresets'
import { translations, type Language } from './i18n'
import {
  predictUpcomingCollision,
  type CollisionPrediction,
} from './physics/collisionPrediction'
import { stepBodies } from './physics/fragmentAwareEngine'
import { DEFAULT_PRESET_BY_BODY_COUNT, getPreset, getPresetBodyCount } from './presets'
import {
  INITIAL_SETTINGS_STORAGE_KEYS,
  getStoredInitialSetup,
  normalizeBodyScale,
  persistInitialSetup,
} from './simulationSettings'
import { isTrackingMassEligible } from './trackingMassPolicy'
import { findTrackingCandidate } from './trackingSelection'
import type { BodyCount, BodyState, BodyType, PresetId, SpaceMode, TrailSample, TrailSampleBatch } from './types'
import { getProductionCameraHandoffFixture } from './visualRegression/productionCameraHandoffFixture'

const PHYSICS_DT = 0.0015
const MAX_STEPS_PER_FRAME = 4000
const TRAIL_SAMPLE_INTERVAL = 0.01
const COLLISION_CHECK_INTERVAL_MS = 60
const COLLISION_ALERT_HOLD_MS = 4200
const COLLISION_MISS_GRACE_MS = 180
const COLLISION_CONFIRMATION_COUNT = 2
const COLLISION_CAMERA_LEAD_TIME = 3
const COLLISION_REPLAY_LEAD_TIME = 0.36
const COLLISION_WATCH_IMPACT_SLOW_TIME = 0.06
const COLLISION_WATCH_MUTE_MS = 650
const LANGUAGE_STORAGE_KEY = '3bp-language'
const COLLISION_WATCH_ENABLED_STORAGE_KEY = '3bp-collision-watch-enabled'
const SHOWCASE_DEFAULT_BY_BODY_COUNT: Partial<Record<BodyCount, PresetId>> = {
  4: 'quadNested',
  5: 'pentaNested',
  6: 'hexaNested',
}

type CollisionReplaySnapshot = {
  pairKey: string
  bodies: BodyState[]
  time: number
}

type CollisionConfirmation = {
  pairKey: string
  count: number
}

type BodyScaleBaseline = {
  mass: number
  radius: number
}

type TrackingBaseline = {
  sourceId: string
  initialMass: number
}

function cloneBodies(input: BodyState[]) {
  return input.map((body) => ({
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity },
  }))
}

function isScalableBody(body: BodyState) {
  return body.bodyType !== 'fragment' && body.bodyType !== 'effect'
}

function createBodyScaleBaseline(input: BodyState[], scale = 1) {
  const safeScale = Math.max(scale, 1e-9)
  return new Map<string, BodyScaleBaseline>(
    input
      .filter(isScalableBody)
      .map((body) => [body.id, { mass: body.mass / safeScale, radius: body.radius / safeScale }]),
  )
}

function getInitialLanguage(): Language {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return saved === 'en' ? 'en' : 'ko'
}

function getInitialCollisionWatchEnabled() {
  return localStorage.getItem(COLLISION_WATCH_ENABLED_STORAGE_KEY) === 'true'
}

function createPresetBodies(preset: PresetId, mode: SpaceMode) {
  const productionRegressionFixture = getProductionCameraHandoffFixture()
  if (productionRegressionFixture) return productionRegressionFixture
  const raw = mode === '3d'
    ? getOrbital3dPresetOverride(preset) ?? getPreset(preset)
    : getOrbital2dPresetOverride(preset) ?? getPreset(preset)
  return applyPresetBodyTypes(preset, raw)
}

function createCollisionWatchBodyInfo(
  bodies: BodyState[],
  sourceId: string,
  sourceName: string,
  fallbackType: BodyType,
): CollisionWatchBodyInfo {
  const body = resolveBodyDescendant(bodies, sourceId)
  return {
    sourceId,
    sourceName,
    id: body?.id ?? sourceId,
    name: body?.name ?? sourceName,
    type: body?.bodyType ?? fallbackType,
    color: body?.color ?? '#dce8ff',
    mass: body?.mass ?? 0,
    radius: body?.radius ?? 0,
  }
}

function refreshCollisionWatchBodyInfo(
  bodyInfo: CollisionWatchBodyInfo,
  bodies: BodyState[],
) {
  const body = resolveBodyDescendant(bodies, bodyInfo.sourceId)
  if (!body) return bodyInfo

  return {
    ...bodyInfo,
    id: body.id,
    name: body.name,
    type: body.bodyType ?? bodyInfo.type,
    color: body.color,
    mass: body.mass,
    radius: body.radius,
  }
}

function refreshCollisionWatchDetails(details: CollisionWatchDetails, bodies: BodyState[]) {
  return {
    ...details,
    bodyA: refreshCollisionWatchBodyInfo(details.bodyA, bodies),
    bodyB: refreshCollisionWatchBodyInfo(details.bodyB, bodies),
  }
}

export default function App() {
  const [initialSetup] = useState(getStoredInitialSetup)
  const [preset, setPreset] = useState<PresetId>(initialSetup.preset)
  const [bodyCount, setBodyCount] = useState<BodyCount>(initialSetup.bodyCount)
  const [spaceMode, setSpaceMode] = useState<SpaceMode>(initialSetup.spaceMode)
  const [bodies, setBodies] = useState<BodyState[]>(() =>
    createPresetBodies(initialSetup.preset, initialSetup.spaceMode),
  )
  const [isRunning, setIsRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [bodyScale, setBodyScale] = useState(1)
  const [time, setTime] = useState(0)
  const [trailVersion, setTrailVersion] = useState(0)
  const [trailEnabled, setTrailEnabled] = useState(initialSetup.trailEnabled)
  const [trailDuration, setTrailDuration] = useState(initialSetup.trailDuration)
  const [trailSampleBatch, setTrailSampleBatch] = useState<TrailSampleBatch>({ sequence: 0, samples: [] })
  const [trackedBodyId, setTrackedBodyId] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>(getInitialLanguage)
  const [collisionPrediction, setCollisionPrediction] = useState<CollisionPrediction | null>(null)
  const [collisionReplayReady, setCollisionReplayReady] = useState(false)
  const [collisionWatchEnabled, setCollisionWatchEnabled] = useState(getInitialCollisionWatchEnabled)
  const [collisionWatchInfo, setCollisionWatchInfo] = useState<CollisionWatchDetails | null>(null)
  const [collisionCameraFocus, setCollisionCameraFocus] = useState<CollisionWatchDetails | null>(null)

  const bodiesRef = useRef(bodies)
  const runningRef = useRef(isRunning)
  const speedRef = useRef(speed)
  const bodyScaleRef = useRef(1)
  const bodyScaleBaselineRef = useRef(createBodyScaleBaseline(bodies))
  const trackingBaselineRef = useRef<TrackingBaseline | null>(null)
  const trailEnabledRef = useRef(trailEnabled)
  const collisionWatchEnabledRef = useRef(collisionWatchEnabled)
  const autoCollisionWatchPairRef = useRef<string | null>(null)
  const simulationTimeRef = useRef(0)
  const nextTrailSampleAtRef = useRef(0)
  const trailSampleQueueRef = useRef<TrailSample[]>([])
  const trailBatchSequenceRef = useRef(0)
  const collisionPredictionRef = useRef<CollisionPrediction | null>(null)
  const collisionConfirmationRef = useRef<CollisionConfirmation | null>(null)
  const collisionReplayRef = useRef<CollisionReplaySnapshot | null>(null)
  const collisionLastSeenAtRef = useRef(0)
  const nextCollisionCheckAtRef = useRef(0)
  const collisionWatchMuteUntilRef = useRef(0)
  const collisionWatchInfoRef = useRef<CollisionWatchDetails | null>(null)
  const collisionCameraFocusRef = useRef<CollisionWatchDetails | null>(null)
  const collisionWatchImpactSimTimeRef = useRef<number | null>(null)
  const collisionWatchRestoreSpeedRef = useRef<number | null>(null)
  const collisionWatchManagedSpeedRef = useRef<number | null>(null)
  const collisionWatchRestoreStartSpeedRef = useRef<number | null>(null)
  const collisionWatchPhaseRef = useRef<CollisionWatchPhase | null>(null)
  const collisionWatchPhaseStartedAtRef = useRef(0)
  const collisionWatchTimingProfileRef = useRef<{
    pairKey: string
    profile: CollisionWatchTimingProfile
  } | null>(null)
  const collisionWatchSpeedOverriddenRef = useRef(false)
  const t = translations[language]

  const applyCollisionWatchSpeed = useCallback((nextSpeed: number) => {
    if (collisionWatchSpeedOverriddenRef.current) return
    collisionWatchManagedSpeedRef.current = nextSpeed
    speedRef.current = nextSpeed
    setSpeed(nextSpeed)
  }, [])

  const restoreCollisionWatchSpeed = useCallback(() => {
    const restoreSpeed = collisionWatchRestoreSpeedRef.current
    const managedSpeed = collisionWatchManagedSpeedRef.current
    if (
      !collisionWatchSpeedOverriddenRef.current &&
      restoreSpeed !== null &&
      managedSpeed !== null &&
      Math.abs(speedRef.current - managedSpeed) <= 1e-9
    ) {
      speedRef.current = restoreSpeed
      setSpeed(restoreSpeed)
    }
    collisionWatchRestoreSpeedRef.current = null
    collisionWatchManagedSpeedRef.current = null
    collisionWatchRestoreStartSpeedRef.current = null
    collisionWatchPhaseRef.current = null
    collisionWatchTimingProfileRef.current = null
    collisionWatchSpeedOverriddenRef.current = false
  }, [])

  const changeTrackedBody = useCallback((bodyId: string | null) => {
    if (!bodyId) {
      trackingBaselineRef.current = null
      setTrackedBodyId(null)
      return
    }

    const target = findTrackingCandidate(bodiesRef.current, bodyId)
    if (!target) {
      trackingBaselineRef.current = null
      setTrackedBodyId(null)
      return
    }

    trackingBaselineRef.current = {
      sourceId: target.id,
      initialMass: Math.max(target.mass, 0),
    }
    setTrackedBodyId(target.id)
  }, [])

  const changeSpeed = useCallback((nextSpeed: number) => {
    if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) return
    if (collisionWatchPhaseRef.current !== null || collisionCameraFocusRef.current !== null) {
      collisionWatchSpeedOverriddenRef.current = true
      collisionWatchRestoreSpeedRef.current = null
      collisionWatchManagedSpeedRef.current = null
      collisionWatchRestoreStartSpeedRef.current = null
    }
    speedRef.current = nextSpeed
    setSpeed(nextSpeed)
  }, [])

  useEffect(() => { bodiesRef.current = bodies }, [bodies])
  useEffect(() => { runningRef.current = isRunning }, [isRunning])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => {
    collisionWatchEnabledRef.current = collisionWatchEnabled
    localStorage.setItem(COLLISION_WATCH_ENABLED_STORAGE_KEY, String(collisionWatchEnabled))
    if (!collisionWatchEnabled) autoCollisionWatchPairRef.current = null
  }, [collisionWatchEnabled])
  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = language === 'ko' ? 'ko' : 'en'
  }, [language])
  useEffect(() => {
    persistInitialSetup({ spaceMode, bodyCount, preset })
  }, [bodyCount, preset, spaceMode])
  useEffect(() => {
    trailEnabledRef.current = trailEnabled
    trailSampleQueueRef.current = []
    nextTrailSampleAtRef.current = simulationTimeRef.current
    localStorage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.trailEnabled, String(trailEnabled))
  }, [trailEnabled])
  useEffect(() => {
    localStorage.setItem(INITIAL_SETTINGS_STORAGE_KEYS.trailDuration, String(trailDuration))
  }, [trailDuration])
  useEffect(() => {
    setTrackedBodyId((current) => {
      if (!current) return null

      const baseline = trackingBaselineRef.current
      if (!baseline) {
        const candidate = findTrackingCandidate(bodies, current)
        if (!candidate) return null
        trackingBaselineRef.current = {
          sourceId: current,
          initialMass: Math.max(candidate.mass, 0),
        }
        return current
      }

      // Always resolve from the original user-selected source id. Descendant ids
      // never become the new baseline, and the mass gate is evaluated before any
      // general-tracking handoff can be committed.
      const candidate = findTrackingCandidate(bodies, baseline.sourceId)
      if (!candidate || !isTrackingMassEligible(candidate.mass, baseline.initialMass)) {
        trackingBaselineRef.current = null
        return null
      }

      return baseline.sourceId
    })
  }, [bodies])
  useEffect(() => {
    const activeInfo = collisionWatchInfo
    if (!activeInfo || activeInfo.impactObservedAt === null) return

    const pairKey = activeInfo.pairKey
    const timingEntry = collisionWatchTimingProfileRef.current
    const profile = timingEntry?.pairKey === pairKey
      ? timingEntry.profile
      : getCollisionWatchTimingProfile(activeInfo.bodyA.type, activeInfo.bodyB.type)
    const remaining = Math.max(
      0,
      profile.infoHoldMs - (performance.now() - activeInfo.impactObservedAt),
    )
    const timer = window.setTimeout(() => {
      if (collisionWatchInfoRef.current?.pairKey !== pairKey) return
      collisionWatchInfoRef.current = null
      setCollisionWatchInfo(null)
    }, remaining)

    return () => window.clearTimeout(timer)
  }, [collisionWatchInfo])

  useEffect(() => {
    const activeFocus = collisionCameraFocus
    if (!activeFocus || activeFocus.impactObservedAt === null) return

    const pairKey = activeFocus.pairKey
    const timingEntry = collisionWatchTimingProfileRef.current
    const profile = timingEntry?.pairKey === pairKey
      ? timingEntry.profile
      : getCollisionWatchTimingProfile(activeFocus.bodyA.type, activeFocus.bodyB.type)
    const remaining = Math.max(
      0,
      profile.cameraHoldMs - (performance.now() - activeFocus.impactObservedAt),
    )
    const timer = window.setTimeout(() => {
      if (collisionCameraFocusRef.current?.pairKey !== pairKey) return
      collisionCameraFocusRef.current = null
      collisionWatchImpactSimTimeRef.current = null
      if (autoCollisionWatchPairRef.current === pairKey) autoCollisionWatchPairRef.current = null
      nextCollisionCheckAtRef.current = 0
      setCollisionCameraFocus(null)
    }, remaining)

    return () => window.clearTimeout(timer)
  }, [collisionCameraFocus])

  const resetTrailSampling = useCallback((startTime: number) => {
    simulationTimeRef.current = startTime
    nextTrailSampleAtRef.current = startTime
    trailSampleQueueRef.current = []
    trailBatchSequenceRef.current += 1
    setTrailSampleBatch({ sequence: trailBatchSequenceRef.current, samples: [] })
  }, [])

  const clearCollisionWarning = useCallback(() => {
    restoreCollisionWatchSpeed()
    collisionPredictionRef.current = null
    collisionConfirmationRef.current = null
    collisionReplayRef.current = null
    collisionLastSeenAtRef.current = 0
    nextCollisionCheckAtRef.current = 0
    collisionWatchMuteUntilRef.current = 0
    autoCollisionWatchPairRef.current = null
    collisionWatchInfoRef.current = null
    collisionCameraFocusRef.current = null
    collisionWatchImpactSimTimeRef.current = null
    setCollisionPrediction(null)
    setCollisionReplayReady(false)
    setCollisionWatchInfo(null)
    setCollisionCameraFocus(null)
  }, [restoreCollisionWatchSpeed])

  const beginCollisionWatchInfo = useCallback((prediction: CollisionPrediction, sourceBodies: BodyState[]) => {
    if (collisionWatchRestoreSpeedRef.current === null) {
      collisionWatchRestoreSpeedRef.current = speedRef.current
      collisionWatchManagedSpeedRef.current = null
    }

    collisionWatchSpeedOverriddenRef.current = false
    collisionWatchRestoreStartSpeedRef.current = null
    collisionWatchPhaseRef.current = 'approach'
    collisionWatchPhaseStartedAtRef.current = performance.now()
    collisionWatchTimingProfileRef.current = {
      pairKey: prediction.pairKey,
      profile: getCollisionWatchTimingProfile(prediction.bodyAType, prediction.bodyBType),
    }

    const details: CollisionWatchDetails = {
      pairKey: prediction.pairKey,
      bodyA: createCollisionWatchBodyInfo(
        sourceBodies,
        prediction.bodyAId,
        prediction.bodyAName,
        prediction.bodyAType,
      ),
      bodyB: createCollisionWatchBodyInfo(
        sourceBodies,
        prediction.bodyBId,
        prediction.bodyBName,
        prediction.bodyBType,
      ),
      closingSpeed: prediction.closingSpeed,
      impactObservedAt: null,
    }
    collisionWatchImpactSimTimeRef.current = simulationTimeRef.current + Math.max(prediction.timeToImpact, 0)
    collisionWatchInfoRef.current = details
    collisionCameraFocusRef.current = details
    setCollisionWatchInfo(details)
    setCollisionCameraFocus(details)
  }, [])

  const loadPreset = useCallback((nextPreset: PresetId, mode: SpaceMode = spaceMode) => {
    setPreset(nextPreset)
    setBodyCount(getPresetBodyCount(nextPreset))
    const next = createPresetBodies(nextPreset, mode)
    bodyScaleRef.current = 1
    bodyScaleBaselineRef.current = createBodyScaleBaseline(next)
    setBodyScale(1)
    bodiesRef.current = next
    setBodies(next)
    const initialTrackedBody = next.length === 1 ? next[0] : null
    trackingBaselineRef.current = initialTrackedBody
      ? { sourceId: initialTrackedBody.id, initialMass: initialTrackedBody.mass }
      : null
    setTrackedBodyId(initialTrackedBody?.id ?? null)
    setTime(0)
    setIsRunning(false)
    resetTrailSampling(0)
    clearCollisionWarning()
    setTrailVersion((v) => v + 1)
  }, [clearCollisionWarning, resetTrailSampling, spaceMode])

  const changeSpaceMode = useCallback((mode: SpaceMode) => {
    if (mode === spaceMode) return
    setSpaceMode(mode)
    loadPreset(preset, mode)
  }, [loadPreset, preset, spaceMode])

  const changeBodyCount = useCallback((count: BodyCount) => {
    loadPreset(SHOWCASE_DEFAULT_BY_BODY_COUNT[count] ?? DEFAULT_PRESET_BY_BODY_COUNT[count])
  }, [loadPreset])

  const reset = useCallback(() => loadPreset(preset), [loadPreset, preset])

  const updateBody = useCallback((id: string, next: BodyState) => {
    setIsRunning(false)
    if (isScalableBody(next)) {
      const scale = Math.max(bodyScaleRef.current, 1e-9)
      bodyScaleBaselineRef.current.set(id, {
        mass: next.mass / scale,
        radius: next.radius / scale,
      })
    }
    setBodies((current) => {
      const updated = current.map((body) => (body.id === id ? next : body))
      bodiesRef.current = updated
      return updated
    })
    setTrackedBodyId((current) => {
      if (current === id) {
        trackingBaselineRef.current = {
          sourceId: id,
          initialMass: Math.max(next.mass, 0),
        }
      }
      return current
    })
    clearCollisionWarning()
    resetTrailSampling(simulationTimeRef.current)
    setTrailVersion((v) => v + 1)
  }, [clearCollisionWarning, resetTrailSampling])

  const changeBodyScale = useCallback((nextScale: number) => {
    if (!Number.isFinite(nextScale)) return
    const clamped = normalizeBodyScale(nextScale)
    const previousScale = Math.max(bodyScaleRef.current, 1e-9)
    if (Math.abs(clamped - previousScale) < 1e-9) return

    const baselines = new Map(bodyScaleBaselineRef.current)
    const nextBodies = bodiesRef.current.map((body) => {
      if (!isScalableBody(body)) return body

      const baseline = baselines.get(body.id) ?? {
        mass: body.mass / previousScale,
        radius: body.radius / previousScale,
      }
      baselines.set(body.id, baseline)

      return {
        ...body,
        mass: Math.max(0.001, baseline.mass * clamped),
        radius: Math.max(0.005, baseline.radius * clamped),
      }
    })

    if (trackingBaselineRef.current) {
      trackingBaselineRef.current = {
        ...trackingBaselineRef.current,
        initialMass: trackingBaselineRef.current.initialMass * (clamped / previousScale),
      }
    }

    bodyScaleBaselineRef.current = baselines
    bodyScaleRef.current = clamped
    setBodyScale(clamped)
    bodiesRef.current = nextBodies
    setBodies(nextBodies)
    runningRef.current = false
    setIsRunning(false)
    clearCollisionWarning()
    resetTrailSampling(simulationTimeRef.current)
    setTrailVersion((v) => v + 1)
  }, [clearCollisionWarning, resetTrailSampling])

  const watchCollision = useCallback(() => {
    const prediction = collisionPredictionRef.current
    if (!prediction) return

    const collisionAlreadyHappened = hasTargetPairCollisionResult(
      bodiesRef.current,
      prediction.bodyAId,
      prediction.bodyBId,
    )
    const replay = collisionAlreadyHappened && collisionReplayRef.current?.pairKey === prediction.pairKey
      ? collisionReplayRef.current
      : null

    let watchBodies = bodiesRef.current
    if (replay) {
      watchBodies = cloneBodies(replay.bodies)
      bodiesRef.current = watchBodies
      setBodies(watchBodies)
      setTime(replay.time)
      resetTrailSampling(replay.time)
      setTrailVersion((value) => value + 1)
    }

    beginCollisionWatchInfo(prediction, watchBodies)

    applyCollisionWatchSpeed(COLLISION_WATCH_APPROACH_SPEED)
    runningRef.current = true
    setIsRunning(true)

    collisionWatchMuteUntilRef.current = performance.now() + COLLISION_WATCH_MUTE_MS
    collisionPredictionRef.current = null
    collisionConfirmationRef.current = null
    collisionReplayRef.current = null
    collisionLastSeenAtRef.current = 0
    autoCollisionWatchPairRef.current = null
    setCollisionPrediction(null)
    setCollisionReplayReady(false)
  }, [applyCollisionWatchSpeed, beginCollisionWatchInfo, resetTrailSampling])

  useEffect(() => {
    let animationFrame = 0
    let previous = performance.now()
    let accumulator = 0
    let publishAccumulator = 0

    const tick = (now: number) => {
      animationFrame = requestAnimationFrame(tick)
      const realDelta = Math.min((now - previous) / 1000, 0.05)
      previous = now
      if (!runningRef.current) return

      const activeCollisionWatch = collisionWatchInfoRef.current
      const activeCollisionCamera = collisionCameraFocusRef.current
      const collisionWatchLocked = activeCollisionCamera !== null

      const timingEntry = collisionWatchTimingProfileRef.current
      const activePhase = collisionWatchPhaseRef.current
      if (timingEntry && activePhase && activePhase !== 'approach') {
        const elapsedMs = now - collisionWatchPhaseStartedAtRef.current
        const { profile } = timingEntry

        if (activePhase === 'impact' && elapsedMs >= profile.impactHoldMs) {
          collisionWatchPhaseRef.current = 'postImpact'
          collisionWatchPhaseStartedAtRef.current = now
          applyCollisionWatchSpeed(COLLISION_WATCH_POST_IMPACT_SPEED)
        } else if (activePhase === 'postImpact' && elapsedMs >= profile.postImpactHoldMs) {
          collisionWatchPhaseRef.current = 'restoring'
          collisionWatchPhaseStartedAtRef.current = now
          collisionWatchRestoreStartSpeedRef.current = speedRef.current
        } else if (activePhase === 'restoring') {
          const restoreTarget = collisionWatchRestoreSpeedRef.current
          const restoreStart = collisionWatchRestoreStartSpeedRef.current ?? speedRef.current
          if (collisionWatchSpeedOverriddenRef.current || restoreTarget === null) {
            collisionWatchPhaseRef.current = null
            collisionWatchRestoreStartSpeedRef.current = null
            collisionWatchTimingProfileRef.current = null
          } else {
            const rampSpeed = getCollisionWatchRestoreSpeed(
              restoreStart,
              restoreTarget,
              elapsedMs,
              profile.restoreRampMs,
            )
            applyCollisionWatchSpeed(rampSpeed)
            if (elapsedMs >= profile.restoreRampMs) {
              speedRef.current = restoreTarget
              setSpeed(restoreTarget)
              collisionWatchRestoreSpeedRef.current = null
              collisionWatchManagedSpeedRef.current = null
              collisionWatchRestoreStartSpeedRef.current = null
              collisionWatchPhaseRef.current = null
              collisionWatchTimingProfileRef.current = null
            }
          }
        }
      }

      if (
        activeCollisionWatch &&
        activeCollisionWatch.impactObservedAt === null &&
        collisionWatchPhaseRef.current === 'approach'
      ) {
        const expectedImpactAt = collisionWatchImpactSimTimeRef.current
        if (expectedImpactAt !== null) {
          const timeToImpact = expectedImpactAt - simulationTimeRef.current
          const watchSpeed = timeToImpact <= COLLISION_WATCH_IMPACT_SLOW_TIME
            ? COLLISION_WATCH_IMPACT_SPEED
            : timeToImpact <= COLLISION_REPLAY_LEAD_TIME
              ? COLLISION_WATCH_APPROACH_SPEED
              : null
          if (watchSpeed !== null && Math.abs(speedRef.current - watchSpeed) > 1e-9) {
            applyCollisionWatchSpeed(watchSpeed)
          }
        }
      }

      if (
        !collisionWatchLocked &&
        now >= nextCollisionCheckAtRef.current &&
        now >= collisionWatchMuteUntilRef.current
      ) {
        nextCollisionCheckAtRef.current = now + COLLISION_CHECK_INTERVAL_MS
        const minimumHorizon = collisionWatchEnabledRef.current ? COLLISION_CAMERA_LEAD_TIME : 0.8
        const horizon = Math.min(6, Math.max(minimumHorizon, speedRef.current * 1.2))
        const upcoming = predictUpcomingCollision(bodiesRef.current, horizon)

        if (upcoming) {
          const previousConfirmation = collisionConfirmationRef.current
          const confirmationCount = previousConfirmation?.pairKey === upcoming.pairKey
            ? previousConfirmation.count + 1
            : 1
          collisionConfirmationRef.current = {
            pairKey: upcoming.pairKey,
            count: confirmationCount,
          }

          if (confirmationCount >= COLLISION_CONFIRMATION_COUNT || upcoming.timeToImpact <= 0.2) {
            const previousPrediction = collisionPredictionRef.current
            if (previousPrediction?.pairKey !== upcoming.pairKey) {
              collisionReplayRef.current = null
              setCollisionReplayReady(false)
            }

            collisionPredictionRef.current = upcoming
            collisionLastSeenAtRef.current = now
            setCollisionPrediction(upcoming)

            if (
              collisionWatchEnabledRef.current &&
              upcoming.timeToImpact <= COLLISION_CAMERA_LEAD_TIME &&
              autoCollisionWatchPairRef.current !== upcoming.pairKey
            ) {
              beginCollisionWatchInfo(upcoming, bodiesRef.current)
              autoCollisionWatchPairRef.current = upcoming.pairKey
            }

            if (
              upcoming.timeToImpact <= COLLISION_REPLAY_LEAD_TIME &&
              collisionReplayRef.current?.pairKey !== upcoming.pairKey
            ) {
              collisionReplayRef.current = {
                pairKey: upcoming.pairKey,
                bodies: cloneBodies(bodiesRef.current),
                time: simulationTimeRef.current,
              }
              setCollisionReplayReady(true)
            }
          }
        } else {
          collisionConfirmationRef.current = null
          const activePrediction = collisionPredictionRef.current
          if (activePrediction) {
            const descendantA = resolveBodyDescendant(bodiesRef.current, activePrediction.bodyAId)
            const descendantB = resolveBodyDescendant(bodiesRef.current, activePrediction.bodyBId)
            const pairStillExists = Boolean(
              descendantA && descendantB && descendantA.id !== descendantB.id,
            )
            const holdMs = pairStillExists ? COLLISION_MISS_GRACE_MS : COLLISION_ALERT_HOLD_MS

            if (now - collisionLastSeenAtRef.current > holdMs) {
              collisionPredictionRef.current = null
              collisionReplayRef.current = null
              collisionLastSeenAtRef.current = 0
              autoCollisionWatchPairRef.current = null
              setCollisionPrediction(null)
              setCollisionReplayReady(false)
            }
          }
        }
      }

      accumulator += realDelta * speedRef.current
      publishAccumulator += realDelta
      let steps = 0
      let advanced = 0
      let nextBodies = bodiesRef.current
      let simulationTime = simulationTimeRef.current

      while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        const previousBodies = nextBodies
        nextBodies = stepBodies(nextBodies, PHYSICS_DT)
        accumulator -= PHYSICS_DT
        advanced += PHYSICS_DT
        simulationTime += PHYSICS_DT
        steps += 1

        const activeWatch = collisionWatchInfoRef.current
        if (activeWatch && activeWatch.impactObservedAt === null) {
          const refreshedWatch = refreshCollisionWatchDetails(activeWatch, nextBodies)
          collisionWatchInfoRef.current = refreshedWatch

          const impactObserved = didCollisionWatchTargetImpact(
            previousBodies,
            nextBodies,
            activeWatch.bodyA.sourceId,
            activeWatch.bodyB.sourceId,
            PHYSICS_DT,
          )

          if (impactObserved) {
            const impactedWatch = { ...refreshedWatch, impactObservedAt: now }
            collisionWatchInfoRef.current = impactedWatch
            collisionCameraFocusRef.current = impactedWatch
            collisionWatchPhaseRef.current = 'impact'
            collisionWatchPhaseStartedAtRef.current = now
            collisionWatchRestoreStartSpeedRef.current = null
            collisionWatchImpactSimTimeRef.current = null
            collisionPredictionRef.current = null
            collisionConfirmationRef.current = null
            collisionReplayRef.current = null
            collisionLastSeenAtRef.current = 0
            applyCollisionWatchSpeed(COLLISION_WATCH_IMPACT_SPEED)
            setCollisionWatchInfo(impactedWatch)
            setCollisionCameraFocus(impactedWatch)
            setCollisionPrediction(null)
            setCollisionReplayReady(false)
          }
        }

        if (trailEnabledRef.current && simulationTime + 1e-12 >= nextTrailSampleAtRef.current) {
          const sampleTime = nextTrailSampleAtRef.current
          nextBodies.forEach((body) => {
            if (body.bodyType === 'effect') return
            if (body.bodyType === 'fragment' && (body.age ?? 0) >= FRAGMENT_TRAIL_TIME) return

            trailSampleQueueRef.current.push({
              bodyId: body.id,
              color: body.color,
              position: { ...body.position },
              simulatedAt: sampleTime,
            })
          })
          do {
            nextTrailSampleAtRef.current += TRAIL_SAMPLE_INTERVAL
          } while (nextTrailSampleAtRef.current <= simulationTime)
        }
      }

      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
      if (advanced > 0) {
        simulationTimeRef.current = simulationTime
        bodiesRef.current = nextBodies
        setTime(simulationTime)
      }

      if (publishAccumulator >= 1 / 30 && advanced > 0) {
        setBodies(nextBodies)
        const latestWatch = collisionWatchInfoRef.current
        if (latestWatch && latestWatch.impactObservedAt === null) {
          setCollisionWatchInfo(latestWatch)
        }
        if (trailSampleQueueRef.current.length > 0) {
          trailBatchSequenceRef.current += 1
          setTrailSampleBatch({
            sequence: trailBatchSequenceRef.current,
            samples: trailSampleQueueRef.current,
          })
          trailSampleQueueRef.current = []
        }
        publishAccumulator = 0
      }
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [applyCollisionWatchSpeed, beginCollisionWatchInfo])

  const trackingBaseline = trackingBaselineRef.current
  const cameraTrackingCandidate = trackedBodyId && trackingBaseline
    ? findTrackingCandidate(bodies, trackingBaseline.sourceId)
    : null
  const cameraTrackedBodyId = trackedBodyId && trackingBaseline && cameraTrackingCandidate &&
    isTrackingMassEligible(cameraTrackingCandidate.mass, trackingBaseline.initialMass)
    ? trackingBaseline.sourceId
    : null

  return (
    <main className="app-shell">
      <label className="language-picker" title={t.language} aria-label={t.language}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 12h17M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.6 8.2 12S9.5 18.4 12 21" />
        </svg>
        <select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={t.language}>
          <option value="ko">{t.korean}</option>
          <option value="en">{t.english}</option>
        </select>
      </label>

      <ViewportSpeedMenu
        isRunning={isRunning}
        speed={speed}
        time={time}
        language={language}
        onSpeedChange={changeSpeed}
      />
      <BodyTrackingRail
        bodies={bodies}
        bodyCount={bodyCount}
        bodyScale={bodyScale}
        preset={preset}
        spaceMode={spaceMode}
        isRunning={isRunning}
        language={language}
        trackedBodyId={trackedBodyId}
        onTrackedBodyChange={changeTrackedBody}
      />

      <section className="viewport-shell">
        <SimulationView
          bodies={bodies}
          simulationTime={time}
          simulationSpeed={speedRef.current}
          trailVersion={trailVersion}
          trailEnabled={trailEnabled}
          trailDuration={trailDuration}
          trailSampleBatch={trailSampleBatch}
          trackedBodyId={cameraTrackedBodyId}
          collisionCameraFocus={collisionCameraFocus ? {
            pairKey: collisionCameraFocus.pairKey,
            bodyAId: collisionCameraFocus.bodyA.sourceId,
            bodyBId: collisionCameraFocus.bodyB.sourceId,
          } : null}
          collisionWatchPhase={collisionWatchPhaseRef.current}
          collisionWatchPairKey={collisionWatchInfo?.pairKey ?? collisionCameraFocus?.pairKey ?? null}
          collisionImpactObserved={Boolean(
            collisionWatchInfo?.impactObservedAt ?? collisionCameraFocus?.impactObservedAt,
          )}
        />
        {collisionWatchInfo && (
          <CollisionWatchInfo details={collisionWatchInfo} language={language} />
        )}
        {collisionPrediction && !collisionCameraFocus && (
          <CollisionAlert
            prediction={collisionPrediction}
            language={language}
            replayReady={collisionReplayReady}
            onWatch={watchCollision}
          />
        )}
      </section>
      <ControlPanel
        bodies={bodies}
        bodyCount={bodyCount}
        spaceMode={spaceMode}
        isRunning={isRunning}
        speed={speed}
        bodyScale={bodyScale}
        preset={preset}
        language={language}
        trailEnabled={trailEnabled}
        trailDuration={trailDuration}
        trackedBodyId={trackedBodyId}
        collisionWatchEnabled={collisionWatchEnabled}
        onTrailEnabledChange={setTrailEnabled}
        onTrailDurationChange={setTrailDuration}
        onTrackedBodyChange={changeTrackedBody}
        onCollisionWatchEnabledChange={setCollisionWatchEnabled}
        onRunningChange={setIsRunning}
        onSpeedChange={changeSpeed}
        onBodyScaleChange={changeBodyScale}
        onSpaceModeChange={changeSpaceMode}
        onBodyCountChange={changeBodyCount}
        onPresetChange={loadPreset}
        onReset={reset}
        onBodyChange={updateBody}
      />
    </main>
  )
}
