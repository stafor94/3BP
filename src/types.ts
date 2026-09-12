export type Vec3 = { x: number; y: number; z: number }

export type BodyType = 'star' | 'planet' | 'moon' | 'fragment' | 'effect'

export type StellarEvolutionStage =
  | 'protostar'
  | 'mainSequence'
  | 'subgiant'
  | 'giant'
  | 'supergiant'
  | 'whiteDwarf'

export type SurfacePresetId =
  | 'rockyMercuryLike'
  | 'venusLike'
  | 'earthLike'
  | 'marsLike'
  | 'gasGiantJupiterLike'
  | 'gasGiantSaturnLike'
  | 'iceGiantUranusLike'
  | 'iceGiantNeptuneLike'
  | 'lavaWorld'
  | 'desertWorld'
  | 'oceanWorld'
  | 'iceWorld'
  | 'lunarGray'
  | 'ioVolcanic'
  | 'europaIcy'
  | 'ganymedeMixed'
  | 'callistoCratered'
  | 'titanHazy'
  | 'enceladusBrightIce'
  | 'rockyBrown'
  | 'charcoalCratered'
  | 'darkCarbonaceous'
  | 'stonySilicate'
  | 'metallicIron'
  | 'icyDebris'

export type AtmospherePresetId =
  | 'none'
  | 'thin'
  | 'earthLike'
  | 'venusHaze'
  | 'titanHaze'
  | 'gasGiant'
  | 'iceGiant'

export type StellarCollisionOutcome = 'merge' | 'hitAndRun' | 'partialDisruption'
export type StellarCollisionBodyRole = 'sourceA' | 'sourceB' | 'remnant' | 'survivorA' | 'survivorB'

export type EffectVisualKind =
  | 'contactFlash'
  | 'compressionShear'
  | 'stellarPlasma'
  | 'stellarAfterglow'
  | 'collisionSpark'

export type EffectVisualState = {
  kind: EffectVisualKind
  direction: Vec3
  normal?: Vec3
  stretch?: number
  widthScale?: number
  tailLength?: number
  brightness?: number
  turbulence?: number
  pulseStrength?: number
  phaseOffset?: number
  secondaryColor?: string
  temperatureBias?: number
  stellarCollision?: boolean
  stellarOutcome?: StellarCollisionOutcome
  /** Largest physical source radius captured at impact for presentation-only scaling. */
  sourceMaxRadius?: number
  /** Collision geometry telemetry used only to shape/fade presentation effects. */
  headOn?: number
  grazing?: number
}

/** Immutable presentation metadata. Never a gravitating body or solver input geometry. */
export type StellarCollisionSource = Pick<BodyState, 'id' | 'mass' | 'radius' | 'position' | 'velocity' | 'color' | 'stellarEvolutionStage' | 'stellarTemperatureK'>
export type StellarCollisionPresentation = {
  /** Stable collision-event identity. `key` is kept as its compatibility alias. */
  eventId?: string
  key: string
  sources: [StellarCollisionSource, StellarCollisionSource]
  targets: StellarCollisionSource[]
  outcome: StellarCollisionOutcome
  phase: 'contact' | 'settle'
  /** Body roles are event-scoped so two survivors can share one clock without sharing a role. */
  bodyRoles?: Record<string, StellarCollisionBodyRole>
  /** Cumulative simulation seconds from first staged contact. */
  eventAgeSeconds?: number
  contactDurationSeconds?: number
  settleDurationSeconds?: number
  settleAgeSeconds?: number
  contactProgress?: number
  transferClockProgress?: number
  transferProgress?: number
  settleProgress?: number
  releaseProgress?: number
  isComplete?: boolean
  /** Legacy compatibility aliases derived from the common timeline in production. */
  progress: number
  elapsed: number
  duration: number
}

export type BodyState = {
  stellarCollisionPresentation?: StellarCollisionPresentation
  /** Collision event carried by an authoritative physical stellar result. */
  stellarCollisionEventId?: string
  /** Cumulative simulation seconds from first staged contact; capped at event completion. */
  stellarCollisionAge?: number
  /** Contact duration captured when this event was staged, in simulation seconds. */
  stellarCollisionContactDurationSeconds?: number
  id: string
  name: string
  color: string
  mass: number
  radius: number
  position: Vec3
  velocity: Vec3
  bodyType?: BodyType
  stellarEvolutionStage?: StellarEvolutionStage
  stellarEvolutionPhase01?: number
  stellarRadiusScale?: number
  surfacePresetId?: SurfacePresetId
  surfaceVariant01?: number
  atmospherePresetId?: AtmospherePresetId
  age?: number
  lifetime?: number
  collisionCooldown?: number
  effectVisual?: EffectVisualState
  stellarCollisionOutcome?: StellarCollisionOutcome
  stellarTemperatureK?: number
  transientHeat01?: number
  transientHeatDecayMs?: number
  shockTemperatureBiasK?: number
  transientHeatToken?: string
  collisionScarIntensity?: number
  trailExcitation01?: number
  /**
   * Physical source identities represented by this collision result. This is
   * separate from `id`: a 2→1 absorb/merge may keep the primary body's stable id
   * while still carrying both source lineages for collision-watch resolution.
   */
  collisionLineageIds?: string[]
  /**
   * Source body ids whose ordinary camera tracking may continue onto this body.
   * A 2→1 absorption or true merge may carry both physical source lineages; the
   * captured initial-mass 50% gate still decides whether that handoff is eligible.
   */
  trackingContinuationIds?: string[]
}

export type TrailSample = {
  bodyId: string
  color: string
  position: Vec3
  simulatedAt: number
}

export type TrailSampleBatch = {
  sequence: number
  samples: TrailSample[]
}

export type SimulationSnapshot = {
  bodies: BodyState[]
  time: number
}

export type BodyCount = 1 | 2 | 3 | 4 | 5 | 6
export type SpaceMode = '2d' | '3d'

export type PresetId =
  | 'binarySpectrum'
  | 'tripleSpectrum'
  | 'quadSpectrum'
  | 'singleDrift'
  | 'binaryOrbit'
  | 'binaryEllipse'
  | 'binaryUnequal'
  | 'binaryWide'
  | 'binaryInclined'
  | 'binaryTight'
  | 'figure8'
  | 'hierarchical'
  | 'circumbinary'
  | 'trojan'
  | 'planetary'
  | 'random'
  | 'quadCrown'
  | 'quadNested'
  | 'quadCrossed'
  | 'quadDance'
  | 'pentaCrown'
  | 'pentaNested'
  | 'pentaCrossed'
  | 'pentaDance'
  | 'hexaCrown'
  | 'hexaNested'
  | 'hexaCrossed'
  | 'hexaDance'
