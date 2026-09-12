# Stellar rendering artifacts handoff

## Working state

- Baseline `main`: `c99a3fe0d4a031f7c36809c6d80d71f9aa23269a` (merged PR #159, v0.28.0)
- Working branch: `fix/stellar-rendering-artifacts`
- Working PR: Draft PR #160 — https://github.com/stafor94/3BP/pull/160
- Stage 1 scope: rendering-path investigation plus stellar photosphere surface/color/depth restoration only.
- Status: **1단계는 개발만 완료, 실행·시각 검증 미실시**.
- Automatic workflow note: creating/updating Draft PR #160 automatically started the repository's PR workflows (`CI`, `Stellar Photosphere Quality`, `Collision VFX Stage 5`, `Space Background Quality`). No test/build/workflow command was manually invoked for Stage 1, and these automatic runs are not being used as the Stage-1 visual/runtime acceptance decision.
- Per the repository release rules, the user-visible rendering change still needs the final-stage version/CHANGELOG update plus required automated/runtime/A-B validation before merge. No version bump is made in Stage 1.

## User-observed symptoms and ownership map

The source videos are not available in this session. The entries below are based on the user's observations, not on a claim that the videos were re-watched here.

1. **Uniform white/light-blue stellar disk; little surface or radial depth**
   - `src/rendering/stellarPhotosphereMaterial.ts`
     - `getStellarPhotosphereFrame`
     - `getResolvedStellarPhotosphereColor`
     - `drawStellarSurfaceVariation` in `stellarPhotosphereFragmentShader`
     - `drawStellarEmission` in `stellarPhotosphereFragmentShader`
     - `updateStellarPhotosphereMaterial`
   - `src/rendering/stellarRenderProfile.ts`
     - `getStellarRenderProfile`
   - `src/rendering/bodyLighting.ts`
     - stellar material-path selection and per-frame photosphere update
   - `src/rendering/simulationRenderer.ts`
     - renderer output color space / ACES exposure configuration

2. **Gray transparent spherical shell alternating with bright glow (reported near 0.25 s and 1.50 s in 53254.mp4)**
   - Stage-2 primary path:
     - `src/rendering/bodyLighting.ts` / `setBodyGlowVisibility`
     - `src/rendering/stellarCoronaMaterial.ts` / `configureStellarCoronaMaterial`
     - `src/rendering/simulationRenderer.ts` / `createGlowMaterial`
   - Collision-only shell/state candidates to distinguish in Stage 2:
     - `src/rendering/stellarCollisionEnvelope.ts` / `createStellarCollisionEnvelopeLayer`
     - `src/rendering/liveCollisionVfxBridge.ts` / `updateLiveCollisionVfxFrame`
   - The corona carrier currently uses additive blending, `depthTest=false`, `depthWrite=false`, `toneMapped=false`; the photosphere uses tone mapping. Whether the reported gray shell is this corona carrier, the collision envelope, or a transition interaction is not yet visually confirmed.

3. **Small white ring followed by long gray/brown triangular band and effects left behind after star motion (reported around 1 s and 2.5-3.75 s in 53255.mp4)**
   - `src/rendering/collisionEffectRenderer.ts`
     - `createCollisionEffectsLayer`
     - `updateVisual`
     - effect fragment shader branches for contact/shear/plasma/afterglow
     - synthetic retirement and physical effect introduction/fade paths
   - `src/rendering/collisionEffectProfile.ts` / `getCollisionEffectProfile`
   - `src/rendering/liveCollisionVfxBridge.ts` / `updateLiveCollisionVfxFrame`
   - `src/rendering/stellarGasTrail.ts` for retained stellar-plasma sample geometry
   - `src/rendering/stellarImpactBurstLayer.ts` remains a related burst path to inspect if the ring/band is not owned by the main collision-effect layer.
   - Stage 1 does not alter these collision effects.

## Confirmed code findings vs. unverified hypotheses

### Confirmed from code

- The equilibrium stellar identity comes from `getStellarDisplayColorFromBody` / `getStellarDisplayColorFromTemperature`. The temperature-to-display-color helper uses only a small desaturation (`0.055`) and white mix (`0.045`), so it is not an aggressive forced-white palette conversion.
- `bodyLighting.ts` updates `uIdentityColor` every stellar frame from `StellarPhotosphereFrame.displayColor`; the initial nearest-palette color used by the generic object constructor is therefore not the final photosphere color source.
- The current photosphere has one temperature-colored emission path. PR #159 removed the previous `uCenterHighlightStrength` additive white-center branch; Stage 1 does not restore it.
- Before this stage, surface variation was a single very broad noise term scaled by only `0.012`, and it was additionally derivative-faded. That made resolved local intensity variation extremely small and directly contributed to the flat-disk look.
- Before this stage, radial emission ranged only from `0.78` at the limb to `1.0` near the center. This provided limited spherical depth.
- Before this stage, `getStellarRenderProfile` could drive photosphere intensity to about `1.25` before the material's ACES tone mapping. That is local to the photosphere and can compress already-small contrast in the bright range.
- The photosphere material is `toneMapped=true` and its custom shader includes Three.js tone-mapping and color-space output chunks. `simulationRenderer.ts` configures `SRGBColorSpace`, `ACESFilmicToneMapping`, and exposure `1`. No separate global exposure reduction is introduced here.
- The stellar corona is a separate sprite path with additive blending and tone mapping disabled, so its behavior must be evaluated separately in Stage 2 rather than hidden by changing scene-wide exposure.
- Production collision VFX are updated by `updateLiveCollisionVfxFrame`, which updates collision effects, handoff, and the stellar envelope. `collisionEffectRenderer.ts` uses camera-facing additive quads/trails with depth testing/writing disabled for its base effect material.

### Not yet confirmed

- The reported gray spherical shell has not been mapped to a specific draw call without runtime/frame inspection. The corona carrier, stellar collision envelope, and transition overlap remain candidates.
- The reported small white ring and long triangular gray/brown band have not been mapped to a specific effect kind/material. Contact/afterglow masks, shear/plasma quads, gas-trail geometry, or a state handoff may be involved.
- The reason a collision effect appears spatially detached after the star moves is not yet proven. Stage 3 must compare effect world positions, source/remnant ownership, sample history, lifetime, and simulation-time handoff before changing coordinates.
- No local/manual test, type-check, lint, build, browser run, screenshot/video capture, or visual comparison was launched for Stage 1. Draft PR creation did auto-start the repository workflows noted above; their presence does not change the Stage-1 status or constitute the deferred visual acceptance check.

## Stage 1 implementation

`src/rendering/stellarPhotosphereMaterial.ts`:

- Replaced the almost-flat single noise term with two restrained object-space value-noise bands.
- Added derivative-based LOD independently for broad and medium structure so medium detail disappears first as the projected star shrinks; no screen-space or frame-random noise was added.
- Kept variation bounded (`0.92..1.07`) to avoid coarse speckles and bright pinpoints.
- Strengthened the continuous center-to-limb response from `0.78..1.0` to `0.68..1.0` with a broad smooth transition.
- Kept all radii on `uIdentityColor * intensity`; no white additive center/core and no dark outline were added.
- Removed the previous time-dependent micro modulation from surface brightness so the restored texture itself is temporally stable in object space. The existing time uniform contract remains intact for callers.

`src/rendering/stellarRenderProfile.ts`:

- Narrowed photosphere intensity from `1.05 + 0.12*luminosity + 0.08*temperature` to `1.00 + 0.07*luminosity + 0.03*temperature` (maximum about `1.10`).
- This is a photosphere-local HDR adjustment intended to preserve the shader's radial/texture contrast through ACES without reducing global renderer exposure or disabling the corona/collision effects.

The temperature/identity-color functions in `src/starColors.ts`, renderer-wide ACES exposure, corona settings, collision physics, orbital logic, and collision VFX are unchanged in Stage 1.

## Stage 2 starting points

Start by identifying which draw call owns the reported shell/glow alternation under the same collision state:

- `src/rendering/bodyLighting.ts` / `setBodyGlowVisibility`: verifies when the single stellar corona sprite is enabled/disabled and how its color/opacity/scale are updated.
- `src/rendering/stellarCoronaMaterial.ts` / `configureStellarCoronaMaterial`: inspect signed-distance coverage, carrier fade, near-white mix, additive blending, and shader-state persistence.
- `src/rendering/simulationRenderer.ts` / `createGlowMaterial`: inspect `depthTest=false`, `depthWrite=false`, additive blending, `toneMapped=false`, and sprite texture interaction.
- `src/rendering/stellarCollisionEnvelope.ts` / `createStellarCollisionEnvelopeLayer`: distinguish a collision envelope surface from a corona sprite before changing either.
- `src/rendering/liveCollisionVfxBridge.ts` / `updateLiveCollisionVfxFrame`: verify envelope/collision/handoff update ordering and state transitions.

Do not fix the shell by globally reducing exposure, disabling glow, or disabling the collision envelope. First establish whether the gray sphere is corona carrier coverage, envelope material/color/opacity, or an overlap/state transition.

## Final-stage validation scenarios

Run only in the final integration/validation stage unless a later instruction explicitly changes the staged workflow.

- **Photosphere identity/depth:** blue, white, yellow, and orange stars at normal gameplay size and enlarged tracking size. Confirm distinct temperature identity, continuous center-to-limb depth, stable broad texture, no white center dot, no colored-edge/white-center split, no black rim, and no small-star shimmer.
- **53254-equivalent collision:** reproduce the state corresponding to the reported ~0.25 s and ~1.50 s shell/glow alternation. Frame-by-frame identify and then verify removal of the hard gray spherical carrier boundary without suppressing intended corona light.
- **53255-equivalent collision:** reproduce the reported ~1 s white ring and ~2.5-3.75 s gray/brown triangular band; verify effect shape, source/remnant anchoring, orientation, lifetime, and cleanup while bodies move.
- **Transition continuity:** pre-contact -> contact -> transfer/separation -> settle/remnant, checking that photosphere/corona/envelope ownership does not double-draw or leave stale render objects.
- **Temperature regression:** compare cool/solar/hot stars through the same camera/exposure with the v0.25.2+ temperature-color preservation intent.
- **Final repository gates:** required regression tests, type/lint/build/CI, runtime A/B visual validation, then version/CHANGELOG update in the same PR before merge/deploy.
