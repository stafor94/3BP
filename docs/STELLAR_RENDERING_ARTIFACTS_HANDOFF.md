# Stellar rendering artifacts handoff

## Working state

- Baseline `main`: `c99a3fe0d4a031f7c36809c6d80d71f9aa23269a` (merged PR #159, v0.28.0)
- Working branch: `fix/stellar-rendering-artifacts`
- Working PR: Draft PR #160 — https://github.com/stafor94/3BP/pull/160
- Stage-2 starting head: `8b92ce7e7cbed996786f51be531e463ebf7730ef`
- Stage 1 implementation commit: `f57c510f2687a6b585b06825529e0dbcc29b00b0`
- Stage 2 code commits:
  - `41ef763573ac106262d78ec998acff7c69a42ca9` — stellar corona compositing/depth/fade
  - `d09d1d53d110c8885fc875c5692e6c9d9565cbca` — collision-envelope ownership/halo continuity
- Stage 2 handoff head: `1df5d72b573ef3145135b529880913ad7c5ce569`
- Status: **2단계 개발 완료, 실행·시각 검증 미실시**.
- No stage-local version bump or CHANGELOG entry is made. Repository policy still requires version/CHANGELOG plus required automated/runtime/A-B validation in the final integration stage before merge.
- Draft PR pushes may automatically start the repository PR workflows. No test/build/workflow command was manually invoked, awaited, or rerun for Stage 2, and automatic runs are not used as the Stage-2 visual acceptance decision.

The source videos are not available in this session. Symptom timing below is based on the user's observations and is not a claim that the videos were re-watched here.

## Symptom ownership map

### 1. Flat white/light-blue stellar disk

Primary files:

- `src/rendering/stellarPhotosphereMaterial.ts`
- `src/rendering/stellarRenderProfile.ts`
- `src/rendering/bodyLighting.ts`
- `src/rendering/simulationRenderer.ts`

Stage 1 restored object-space low-frequency surface structure, strengthened the continuous center-to-limb emission response, and lowered photosphere-local HDR intensity so ACES is less likely to flatten the remaining color/brightness separation. The single temperature-colored emission path is preserved; no white center/core was restored.

### 2. Gray transparent shell alternating with bright soft glow

Primary files/functions:

- `src/rendering/bodyLighting.ts` / `setBodyGlowVisibility`
- `src/rendering/stellarCoronaMaterial.ts` / `configureStellarCoronaMaterial`
- `src/rendering/simulationRenderer.ts` / `createBodyGlowTexture`, `createGlowMaterial`, `resolveStellarRenderObjects`
- `src/rendering/stellarCollisionEnvelope.ts` / `createEnvelope`, `createStellarCollisionEnvelopeLayer`
- `src/rendering/liveCollisionVfxBridge.ts` / `updateLiveCollisionVfxFrame`

### 3. Small white ring, long gray/brown triangular band, detached collision residue

Stage-3 primary files/functions:

- `src/rendering/collisionEffectRenderer.ts`
  - `createCollisionEffectsLayer`
  - `updateVisual`
  - contact/shear/plasma/afterglow shader branches
  - synthetic retirement / physical effect introduction paths
- `src/rendering/collisionEffectProfile.ts` / `getCollisionEffectProfile`
- `src/rendering/liveCollisionVfxBridge.ts` / `updateLiveCollisionVfxFrame`
- `src/rendering/stellarGasTrail.ts` / retained stellar-plasma samples and geometry updates
- `src/rendering/stellarImpactBurstLayer.ts` if the ring is not owned by the main collision-effect layer

Stage 2 does not change those collision-effect shapes, positions, or lifetimes.

## Stage 2: confirmed causes

### A. Hard proximity threshold replaced the normal star/corona without a collision event

`createStellarCollisionEnvelopeLayer` previously searched for a nearby star even when neither star had `stellarCollisionPresentation`:

- activation condition: distance `< (radiusA + radiusB) * 1.18`
- entering the threshold called `show(...)` for a separate collision envelope
- `show(...)` marked the body as suppressed
- suppression hid the renderer-owned photosphere, corona, and secondary glow
- leaving the same threshold removed the envelope and restored the normal renderer objects

This is a code-confirmed discontinuity. A close orbital pass can cross the threshold repeatedly and alternate between two materially different render paths even though no explicit collision presentation state exists. It also conflated world-space proximity with actual collision ownership.

Stage 2 removes the proximity-only activation path. Non-merge envelopes now activate only when the body has explicit `stellarCollisionPresentation`. Screen-space overlap and close approach alone no longer replace the normal stellar renderer.

### B. Collision envelope owned a second expanded BackSide halo shell while suppressing the normal corona

`createEnvelope` created two visible layers:

1. temperature-colored envelope photosphere surface
2. a separate transparent additive `BackSide` halo mesh displaced outward by `uShellOffset = profileRadius * 0.62`

The halo is a closed expanded geometry shell with nonzero alpha concentrated toward the limb. At the same time, envelope suppression hid the normal per-star corona. This is a code-confirmed material handoff from a broad sprite corona to a geometrically bounded shell, matching the reported class of “soft glow ↔ spherical membrane” alternation.

Stage 2 changes ownership as follows:

- the collision envelope still replaces the solid photosphere when explicit collision presentation requires it
- the renderer-owned per-star corona is no longer suppressed
- the expanded legacy envelope halo mesh remains allocated for structural compatibility but `visible=false`, so it is not submitted as a second spherical glow surface
- the unused secondary stellar glow remains suppressed as before

The surrounding light therefore stays on the same corona object/material across ordinary motion and collision-envelope presentation instead of switching to a separate shell material.

### C. Stellar corona ignored opaque depth while overlapping other stellar disks

`simulationRenderer.ts:createGlowMaterial` initializes shared glow sprites with `depthTest=false`. `configureStellarCoronaMaterial` previously left that state unchanged. Because the stellar corona uses additive blending and depthWrite is disabled, a farther corona could contribute through a nearer opaque stellar photosphere during screen-space overlap.

Stage 2 makes the stellar-specific corona contract explicit in `configureStellarCoronaMaterial`:

- `blending = THREE.AdditiveBlending`
- straight alpha (`premultipliedAlpha = false`)
- `depthTest = true`
- `depthWrite = false`

Corona sprites remain additive with each other, but opaque stellar depth can occlude a farther corona. This is local to the stellar corona; generic body/fragment glow configuration was not globally changed.

### D. Corona carrier outer fade was unnecessarily concentrated near the sprite edge

The corona shader already computes its own signed-distance alpha rather than relying on the legacy texture alpha. Its final carrier fade previously used `smoothstep(0.88, 0.995, coronaRadius)`, concentrating the final transition in a narrow outer band.

Stage 2 widens this to `smoothstep(0.74, 1.0, coronaRadius)` and discards fragments once final alpha is effectively zero. The intended diffuse corona remains; this only makes the carrier boundary approach zero over a broader interval and removes residual zero-alpha fragment contribution at the edge.

## Stage 2: investigated but not identified as causes

- Per-star corona materials are separate `SpriteMaterial` instances. The radial texture is shared, but opacity/color/material shader uniform state is not one shared material overwritten by different stars.
- Corona angular variation is based on simulation-derived stellar animation time and deterministic body seed. No frame-random noise is introduced by this path.
- The normal corona already used additive blending and `depthWrite=false`; changing every transparent material to additive blending is neither needed nor done.
- Global renderer exposure, ACES configuration, bloom-equivalent scene tuning, and Stage-1 photosphere intensity/color calculations were not changed in Stage 2.

## Remaining hypotheses / not yet visually confirmed

- No runtime/frame inspection was performed, so it is not yet proven which of the two confirmed code problems dominated each exact 53254.mp4 timestamp. The hard proximity handoff and expanded envelope halo are both real discontinuities/artifact sources that were removed from the relevant paths.
- Actual collision/remnant handoff can replace two source-body corona objects with a result-body corona as bodies are removed/created. The renderer creates current-body visuals before the envelope update, so there is no intentional “corona off” branch now, but final visual continuity across the exact merge handoff still requires Stage-5 runtime A/B inspection.
- The 53255.mp4 white ring / triangular band / detached trail remain Stage-3 work. Stage 2 does not claim those are fixed.

## Stage 1 preservation

Stage 2 does not modify:

- `src/rendering/stellarPhotosphereMaterial.ts`
- `src/rendering/stellarRenderProfile.ts`
- `src/starColors.ts`
- global renderer exposure / ACES settings
- collision physics or orbital integration

The Stage-1 temperature identity, low-frequency surface texture, center-to-limb depth, removal of the white center highlight, and photosphere-local HDR range remain unchanged.

## Stage 3 starting points

Start from the actual collision-effect lifetime and ownership chain rather than changing the stellar corona again:

1. `src/rendering/collisionEffectRenderer.ts:createCollisionEffectsLayer`
   - map each physical/synthetic effect ID to creation, `ensure`, `updateVisual`, retirement, and removal
   - identify which shader kind produces the reported small white ring and long triangular band
2. `src/rendering/collisionEffectProfile.ts:getCollisionEffectProfile`
   - compare world radius, anisotropic stretch, width, tail, fade alpha, brightness, and progress for the identified kinds
3. `src/rendering/liveCollisionVfxBridge.ts:updateLiveCollisionVfxFrame`
   - follow simulation-time ownership and body/effect handoff order
4. `src/rendering/stellarGasTrail.ts`
   - for detached plasma residue, compare retained sample positions/ages against the actual source/remnant motion before changing coordinates
5. `src/rendering/stellarImpactBurstLayer.ts`
   - inspect only if the ring is not produced by the primary collision-effect material

Do not rework corona/exposure to hide Stage-3 collision artifacts.

## Final-stage validation scenarios

Run in Stage 5 unless a later user instruction explicitly changes the staged workflow.

- **Standalone stellar motion:** corona stays temperature-colored and softly decays to the background with no circular carrier boundary.
- **Close two-star orbit without collision presentation:** repeatedly pass through the old 1.18× proximity range and confirm there is no material/corona path switch.
- **Screen-space overlap without physical contact:** farther corona is occluded by the nearer opaque photosphere rather than shining through it; surrounding additive glow remains continuous outside the disks.
- **Actual contact / envelope:** confirm the envelope replaces only the solid photosphere while the surrounding corona remains continuous and no expanded gray spherical halo shell appears.
- **Different sizes/colors:** blue/white/yellow/orange stars retain distinct Stage-1 photosphere identity while their coronas remain temperature-related.
- **Small vs enlarged projected size:** no abrupt corona boundary or LOD-triggered glow toggle.
- **Pause/resume/reset:** deterministic simulation-time corona does not jump merely because wall time advanced while paused.
- **Merge/remnant handoff:** source corona -> result corona transition has no one-frame dropout, membrane flash, or duplicate shell.
- **53254-equivalent sequence:** check the reported ~0.25 s and ~1.50 s shell/glow alternation under equivalent state.
- **53255-equivalent sequence:** separately validate the Stage-3 ring/band/residue fixes.
- **Final repository gates:** required regression tests, type/lint/build/CI, runtime A/B visual validation, version bump, and matching CHANGELOG before merge/deploy.

## Validation status

**2단계 개발 완료, 실행·시각 검증 미실시.**

No local/manual test, type-check, lint, build, browser execution, screenshot/video capture, visual regression run, or dedicated validation subtask was executed for Stage 2. Automatic repository workflows triggered by PR pushes are not awaited, rerun, or treated as visual acceptance evidence in this stage.
