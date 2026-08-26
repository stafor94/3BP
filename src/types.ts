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
}

export type BodyState = {
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
   * Source body ids whose ordinary camera tracking may continue onto this body.
   * This is intentionally narrower than generic collision lineage: absorption
   * carries only the dominant absorber, while a true merge may carry both merged
   * physical source lineages. The captured initial-mass gate still applies.
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
