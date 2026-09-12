# Stellar collision continuity (0.27.0)

Baseline: main `1bf71ca47f106ea8caa64b6ba42400c85667d66e` (0.26.0).

## Acceptance and scope

Contact must lead continuously through deformed connected surfaces to a remnant;
partial disruption and hit-and-run must retain both solver survivors. There must
be no white topology veil or long shock needle. Temperature color, correct
normals, pause/resume, reset/dispose and existing solid-body/camera behavior must
be preserved.

The change is intentionally presentation-heavy. Collision classification, source
mass/radius, solver handoff time and conservation remain authoritative in the
physics engine. The only intentional physical velocity change is a wider,
deterministic stellar ejecta fan; the existing momentum correction remains in
force and planet/moon ejecta are unchanged.

## Implementation layers

- Immutable `stellarCollisionPresentation` metadata records original sources,
  predicted targets, outcome, contact progress and simulation elapsed time. No
  envelope proxy is inserted into the gravitating body array.
- `stellarCollisionEnvelope.ts` generates an opaque 3D surface. Merge lobes keep
  a connected neck while source volume transfers into the dominant lobe and the
  shape relaxes into the actual solver remnant. Partial disruption and hit-and-run
  retain independent survivor surfaces.
- Visible merge transfer continues into the existing 0.16 s settling window, so
  the solver's roughly 0.024 s contact does not visually collapse two lobes into
  one body in a single normal 1x render frame.
- Legacy topology veil / long collision ridge presentation is not instantiated by
  production. Collision glow is local and the corona uses one expanded back-face
  shell with depth testing so interior additive emission does not bleach the
  opaque photosphere.
- Stellar gas follows a bounded history of measured physical positions. History
  does not advance while paused and no past trajectory is guessed or extrapolated.
- Production owns collision VFX from one frame-level update/dispose path. Reset,
  remount and far-corona handoff use the same path.

## Correctness evidence

The updated build and physics suite pass conservation, stellar collision/ejecta,
solid collision, camera/tracking, state continuity, pause, finite geometry/normal,
reset and disposal regressions. The production-input harness advances the real
fragment-aware engine and renders through the real `SimulationView`; it does not
replace collisions with manually overlapped visual-only stars.

The deterministic merge geometry checks also retain continuous envelope bounds at
small timestep. Physics snapshots used by the Stage 4/5 A/B regression are
identical between presentation baselines at the sampled post-impact times.

## Runtime and A/B acceptance

Latest head before this document update: `32467fa60ac99bae2bc7927bf1c4ca87614ab2ff`.

The following GitHub Actions runs passed on that head:

- Full integration CI: `34665937313`
- Collision VFX Stage 5 A/B: `34665937262`
- Stellar Photosphere Quality: `34665937308`
- Space Background Quality: `34665937323`

Full CI passed the production stellar collision capture, strict stellar collision
visual gate, collision watch, camera tracking/handoff, production camera handoff,
non-stellar destruction, ejecta/survivor/penetration/disruption and mobile
regressions.

For qualitative A/B review, the final full-CI artifacts were retrieved and
inspected directly:

- baseline artifact: `stellar-continuity-baseline` / `10289201821`
- candidate artifact: `stellar-collision-visual-regression` / `10289426691`

The baseline oblique/head-on sequences show the reported failure clearly: a long
vertical white shock needle appears through contact and the 2->1 handoff is then
covered by a bright ring/white burst. Under the identical fixture and camera, the
candidate instead keeps two connected lobes with a visible neck through contact,
then transfers the smaller lobe into a lopsided remnant and settles to the final
star. The long white needle and topology-hiding ring are absent. A short diffuse
gas trace can still be visible beside the remnant around +0.07 s, but it is not a
detached white flash/solid projectile and is gone by the later settled captures.

Partial-disruption and hit-and-run captures retain two physical survivors and
separate without the merge-only topology swap. Temperature identity remains
visible across the connected surface instead of being replaced by a full white
mask.

The recorded 1x playback shows the same sequence over successive rendered frames;
it does not jump directly from two round stars to one round remnant. Pause probes
report `pause_changed_pixels = 0` at both 900x700 and 390x844 for 0.02x and 1x.
Rotation playback also completed with valid visible stellar shaders after settle.

## Frame-time diagnostics

CI frame times are SwiftShader diagnostics, not mobile-GPU measurements. On the
final artifacts:

- 900x700, 0.02x: baseline/candidate median 33.4/33.4 ms, p95 66.6/66.6 ms
- 900x700, 1x: baseline/candidate median 50.0/50.1 ms, p95 66.7/116.6 ms
- 390x844, 0.02x: baseline/candidate median 33.3/33.3 ms, p95 50.0/50.0 ms
- 390x844, 1x: baseline/candidate median 33.3/50.0 ms, p95 50.1/100.1 ms

The 1x SwiftShader tail/portrait numbers are therefore worse than baseline and
must not be presented as proof of equal real-device performance. The collision
surface has already been reduced to one photosphere mesh plus one shared-geometry
corona shell, removing the earlier six-shell draw-call regression. A real mobile
GPU measurement remains a user/device-level follow-up rather than something this
CI runner can certify.

## Acceptance status

Agent-accessible technical validation is complete: correctness, production runtime
captures, baseline/candidate A/B inspection and the full integration CI all pass.
The requested visual failure is materially reduced in the inspected production
captures: contact -> deformation -> transfer/separation -> settle is visible and
the previous long white needle/topology veil is gone.

Per `AGENT_QUALITY_VALIDATION.md`, this is not a substitute for the user's own
final visual judgment on the target device. In particular, real mobile-GPU frame
rate and subjective collision feel remain user-result confirmation items; they
are not silently claimed as certified by SwiftShader CI.
