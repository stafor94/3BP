# Stellar rendering artifacts handoff

## Working state

- Baseline `main`: `c99a3fe0d4a031f7c36809c6d80d71f9aa23269a` (merged PR #159, v0.28.0)
- Working branch: `fix/stellar-rendering-artifacts`
- Working PR: Draft PR #160 — https://github.com/stafor94/3BP/pull/160
- Stage-3 starting head: `5cf3aa9580c837a1a54280b7f2d6b7012d276b49`
- Stage 1 implementation: `f57c510f2687a6b585b06825529e0dbcc29b00b0`
- Stage 2 code:
  - `41ef763573ac106262d78ec998acff7c69a42ca9` — stellar corona compositing/depth/fade
  - `d09d1d53d110c8885fc875c5692e6c9d9565cbca` — collision-envelope ownership/halo continuity
- Stage 3 code:
  - `384c12b4fa2103cfff3f081b1c5d6f4bb1e51deb` — kind-specific stellar collision profiles / presentation-radius sizing
  - `7846ee5a7ced92af4f74198203754beb1b312422` — discontinuous world-space gas-trail segmentation
  - `4ea1a08bcf9d55973e3680882eae8ccd925b1dc7` — surface-effect anchoring / diffuse afterglow shader
- Status: **3단계 개발 완료, 실행·시각 검증 미실시**.
- No stage-local version bump or CHANGELOG entry is made. Repository policy still requires the final-stage automated/runtime/A-B validation plus version/CHANGELOG before merge.
- PR pushes can automatically start repository workflows. No test/build/workflow command was manually invoked, awaited, or rerun for Stage 3.

The source videos are not available in this session. Timing references below use the user's observations and are not a claim that the videos were re-watched here.

## Symptom ownership map

### 1. Flat/washed stellar photosphere — Stage 1

Primary path:

- `src/rendering/stellarPhotosphereMaterial.ts`
- `src/rendering/stellarRenderProfile.ts`
- `src/rendering/bodyLighting.ts`

Stage 1 restored temperature-colored object-space surface structure and center-to-limb depth without restoring the old white-center term.

### 2. Gray shell / corona material switching — Stage 2

Primary path:

- `src/rendering/stellarCoronaMaterial.ts` / `configureStellarCoronaMaterial`
- `src/rendering/stellarCollisionEnvelope.ts` / `createStellarCollisionEnvelopeLayer`
- `src/rendering/bodyLighting.ts` / `setBodyGlowVisibility`

Stage 2 removed proximity-only envelope activation, stopped the envelope's expanded BackSide halo draw, kept renderer-owned corona alive through envelope presentation, and made stellar corona depth/fade state explicit.

### 3. Small white oval ring around ~1 s in 53255.mp4 — Stage 3

Code-connected effect kind and flow:

1. physics event creation: `src/physics/engine.ts` / `makeStellarAfterglow`
   - creates a physical `effect` body at the collision contact point
   - `effectVisual.kind = 'stellarAfterglow'`
   - age/lifetime advance on simulation time
2. profile: `src/rendering/collisionEffectProfile.ts` / `getCollisionEffectProfile`
3. renderer: `src/rendering/collisionEffectRenderer.ts` / `updateVisual`
4. shader: `effectFragmentShader`, `uKind < 3.5` branch

Confirmed code cause: the afterglow shader explicitly rendered a hollow expanding shell using `abs(radial - shellRadius)` plus a `hollow` mask. This is an annulus by construction and can read as a small white/bright oval once projected onto the camera-facing quad. It was not the synthetic cloud branch: production `updateLiveCollisionVfxFrame` passes `simulationTime`, so `getSyntheticStellarEffects` is not layered into normal production collision rendering.

A second code issue made stellar kind ownership less predictable: `getCollisionEffectProfile` returned from a generic `if (stellar)` block before physical `contactFlash`, `compressionShear`, and `stellarAfterglow` reached their dedicated profile branches. Their generated `stretch`, `widthScale`, fade and kind-specific sizing were therefore bypassed.

Stage 3 changes:

- generic stellar early return now applies only to `stellarPlasma`, the effect that actually owns the world-space gas trail
- physical stellar contact/shear/afterglow now reach their kind-specific profiles
- stellar contact/shear footprint sizing uses source **presentation radius** rather than an effect body's arbitrary physical radius
- stellar afterglow sizing also uses source presentation radius
- the afterglow annulus is replaced with a filled, diffuse cooling cloud whose RGB/alpha contribution falls smoothly toward the carrier edge
- afterglow brightness/opacity/glow are reduced from shell-like peak values but the effect is not disabled or driven near zero
- stellar colors still come from the existing temperature-related base/secondary color path; no pure-white stellar body/core path is added

The exact ~1 s video frame is not runtime-verified in this stage, so this is a code-confirmed annulus source, not a claim that the recorded frame has been visually rechecked.

### 4. Long gray/brown triangular band around ~2.5–3.75 s — Stage 3

Code-connected effect kind and flow:

1. `src/physics/engine.ts` / `makeEjecta`
   - creates physical `stellarPlasma` effect bodies at source-surface launch positions
   - preserves their world position and velocity as independent ejecta
2. `src/rendering/collisionEffectRenderer.ts`
   - physical `stellarPlasma` uses `createStellarGasTrail` instead of the generic plane
3. `src/rendering/stellarGasTrail.ts`
   - retains simulation-time world-position samples
   - generates one ribbon strip from adjacent retained samples

Confirmed geometry failure mode: `sampleObservedPosition` previously connected every accepted old/new position pair. Even if an effect observation jumped by a very large world distance, it only limited interpolation to at most five segments and still bridged the full displacement. The two side vertices at each sample then formed a very long ribbon segment; changing widths along that segment can visually become a triangular/trapezoidal band extending far from the source.

Stage 3 changes:

- retained plasma remains world-space ejecta; it is **not** attached back to the star
- trail width/sampling scale now derives from the source presentation radius
- before interpolation, new position continuity is checked against both:
  - the retained history time window
  - expected travel from the parcel's current speed and elapsed simulation time, with source-radius tolerance
- if observations cannot belong to one continuous retained trajectory, the renderer starts a new trail segment and resets draw range instead of connecting the stale endpoint to the new point
- ordinary continuous movement still interpolates by simulation time/distance and retains the existing soft lateral/head/tail fades
- this is segmentation of invalid history, not a post-hoc maximum ribbon-length clamp

The existing width-side basis already has near-zero cross-product fallbacks and flips each new side to remain consistent with the previous side within the generated strip. No per-frame random direction was added.

The code mechanism above is a direct source of runaway ribbon geometry. Without Stage-5 frame inspection, it is still possible that a particular reported frame also contains a bounded `compressionShear` sheet; Stage 3 therefore does not claim the video's exact band has been visually identified beyond code ownership.

### 5. Contact effect left behind after stellar motion — Stage 3

Physical creation path in `src/physics/engine.ts` was inspected but not changed:

- `contactFlash`, `compressionShear`, and `stellarAfterglow` are created as non-gravitating/visual `effect` bodies at the contact point with center-of-mass velocity
- `stellarPlasma` is actual emitted presentation matter with its own launch position/velocity
- effect age/lifetime is advanced with simulation `dt`

Before Stage 3, `collisionEffectRenderer.ts:updateVisual` always placed every non-trail effect mesh at the independently integrated effect-body world position. That is appropriate for emitted plasma/afterglow residue, but not for the short contact flash and compression patch that visually belong to a stellar surface/contact region. As a survivor/remnant moved on a different path, those contact cues could separate from the body.

Stage 3 adds presentation-only surface ownership for physical stellar `contactFlash` and `compressionShear`:

- on first render, choose the closest valid current star surface and store its actual body ID, a stable world-space surface direction, and normalized radial placement
- while that body exists, update the effect mesh from the current body position and current presentation radius
- if that body is replaced, resolve a descendant/remnant with `bodyCarriesCollisionLineage` and continue following the valid result body
- if neither owner nor lineage descendant exists, stop pretending the patch is attached and fade it over `SURFACE_ANCHOR_LOST_FADE_SECONDS` using the effect's **simulation age**, not frame count
- renderer anchoring changes only the presentation mesh position/opacity; solver body position, velocity, mass, collision outcome and orbital state are untouched

`stellarPlasma` is deliberately excluded from this anchor path. Its world-space parcel/trail continues independently after launch. `stellarAfterglow` also remains world-space residual heat, but is now a diffuse fading cloud rather than a hard hollow ring.

The simulation already contains a separate curved survivor-impact patch in `liveCollisionVfxBridge.ts` that is evaluated on the actual body shader/geometry. The Stage-3 contact billboard remains a small supporting cue; final occlusion/curvature quality must be checked at runtime rather than inferred from code.

## Lifetime, pause/reset, and object reuse

- Physical stellar effect `age` comes from solver simulation `dt`; Stage 3 does not replace it with frame count or wall-clock time.
- `stellarGasTrail` samples use passed simulation time and reset on event-key change, simulation-time rewind, or age rewind.
- New discontinuity segmentation clears stale samples and sets geometry draw range to zero before starting the next strip.
- `collisionEffectRenderer` does not maintain a reusable pool for these visual objects. Visuals are keyed by effect ID and disposed when the ID leaves the current set; gas geometry/material is disposed with the visual.
- No stale active-vertex range is intentionally retained after a trail segment reset or visual removal.
- Synthetic retirement still uses its existing wall-clock helper, but production with explicit simulation time does not create synthetic collision effects. Stage 4 should keep this distinction explicit.

## Stage 1 / Stage 2 preservation

Stage 3 does not modify:

- `src/rendering/stellarPhotosphereMaterial.ts`
- `src/rendering/stellarRenderProfile.ts`
- `src/rendering/stellarCoronaMaterial.ts`
- `src/rendering/stellarCollisionEnvelope.ts`
- `src/starColors.ts`
- global ACES/exposure settings
- collision classification, contact detection, merge result, mass, momentum, ejecta velocity, or orbital integration

Therefore the Stage-1 temperature identity/surface/depth changes and Stage-2 corona/envelope continuity changes remain intact.

## Stage 4 starting points / integration work

Stage 4 should integrate ownership and transition timing without re-opening the three local shape fixes unless runtime evidence requires it.

1. `src/rendering/liveCollisionVfxBridge.ts`
   - `syncLiveCollisionVfxState`
   - `updateLiveCollisionVfxFrame`
   - `applySurvivorImpact`
   - `applyCollisionProductLifecycle`
   - check collision layer -> handoff -> envelope update ordering
2. `src/rendering/collisionHandoffLayer.ts`
   - verify source/result solid handoff does not temporarily duplicate or hide Stage-3 anchored contact cues
3. `src/rendering/stellarCollisionEnvelope.ts`
   - verify Stage-2 photosphere suppression and Stage-3 contact anchors agree during contact -> settle/remnant transition
4. `src/rendering/bodyLighting.ts`
   - verify final photosphere/corona ownership remains consistent while source IDs disappear and result IDs appear
5. reset/pause integration
   - `liveCollisionVfxBridge` survivor/remnant material lifecycle still contains wall-clock (`performance.now`) presentation timing, while Stage-3 physical stellar effects use simulation age/time. Stage 4 should decide and document the unified pause/slow-motion policy instead of adding another local clock workaround.

Remaining integration question: a source star can be replaced by a remnant in the same render update. Stage-3 contact anchors resolve lineage when possible, but Stage 4 must verify ordering so the source object is not hidden/disposed before its result presentation is ready.

## Final Stage-5 validation scenarios — record only, do not run in Stage 3

- frontal star-star collision
- grazing star-star collision
- strongly unequal stellar radii/masses
- low relative speed and high relative speed
- merge followed by moving remnant
- hit-and-run / partial disruption with two surviving stars
- physical `contactFlash` remains local to a valid surface/contact region while its owner moves
- `compressionShear` remains bounded to source presentation scale and does not become a screen-spanning plane
- `stellarAfterglow` reads as diffuse residual heat with no small hollow white/oval ring
- continuous `stellarPlasma` ejecta leaves an independent world-space trail with smooth head/tail/lateral fade
- a discontinuous/stale plasma observation starts a new strip instead of drawing one long triangle between endpoints
- sequential collisions and visual removal/recreation do not retain stale trail draw ranges or anchor state
- slow motion, pause, resume, and reset preserve simulation-time effect movement/fade consistently
- source removal / remnant lineage handoff does not leave a surface effect floating at its old world coordinate
- re-run 53255-equivalent timings (~1 s ring and ~2.5–3.75 s band/residue) using equivalent state
- re-run Stage-1 photosphere and Stage-2 corona/shell acceptance checks to detect integration regressions
- final repository gates: required tests/type/lint/build/CI, runtime A/B capture/inspection, version bump and matching CHANGELOG, then merge/deploy

## Validation status

**3단계 개발 완료, 실행·시각 검증 미실시**.

No local/manual test, type-check, lint, build, browser execution, screenshot/video capture, visual regression run, or dedicated validation subtask was executed for Stage 3. Automatic repository workflows triggered by branch/PR updates are not awaited, rerun, or treated as visual acceptance evidence in this stage. The code changes identify and remove concrete artifact mechanisms, but whether the user-visible video symptoms are fully resolved remains a Stage-5 runtime/A-B decision.
