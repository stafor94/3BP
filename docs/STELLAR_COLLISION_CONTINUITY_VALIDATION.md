# Stellar collision continuity (0.27.0)

Baseline: main `1bf71ca47f106ea8caa64b6ba42400c85667d66e` (0.26.0).

## Acceptance and scope

Contact must lead continuously through deformed connected surfaces to a remnant;
partial disruption and hit-and-run must retain both solver survivors. There must
be no white topology veil or long shock needle. Temperature color, correct
normals, pause/resume, reset/dispose and existing solid-body/camera behavior must
be preserved. Browser image bounds are necessary but not sufficient: inspect the
sequence, rotated view, and mobile performance before approving visual quality.

## Implementation layers

- Physics classification, source masses/radii and contact duration are retained.
  Immutable `stellarCollisionPresentation` metadata records original sources,
  predicted targets, outcome, progress and simulation elapsed time. No envelope
  mesh or proxy body enters the gravitating array.
- Stellar ejecta directions use a deterministic wider fan in the collision basis.
  The existing solver momentum correction remains authoritative. These are the
  only intentional physical velocity changes; planet/moon ejecta are unchanged.
- `stellarCollisionEnvelope.ts` generates an opaque cross-sectional 3D surface.
  Source lobe volumes transfer into the dominant lobe, then relax into the actual
  solver radius. The first settled shape inherits the final contact parameters.
  Partial disruption and hit-and-run use independent surfaces. Computed vertex
  normals drive the existing photosphere emission and compact highlight shader.
- A single production frame call owns collision effects and their disposal.
  The ineffective renderer-prototype hook and per-material VFX updates are gone.
  Legacy topology-veil/burst layers are not instantiated by production.
- Stellar effect age is physical age, not wall-clock time. Geometry does not
  rebuild while time and body state are unchanged. `simulationTime`, speed and
  pause are explicitly passed to the render frame; speed is not applied twice.

## Correctness evidence

Baseline full build passed before implementation. The updated physics suite
passes conservation, stellar collision/ejecta, solid collision, camera/tracking,
state continuity, pause, finite vertex/normal and disposal regressions.
The deterministic oblique and equal-mass runs measured maximum envelope endpoint
steps of 2.32% and 2.01% respectively at dt=0.0005. These are geometric observations,
not a claim that browser-rendered silhouettes have passed visual review.

The production-input harness starts just outside contact and advances the real
fragment-aware engine, rendering through the real SimulationView. It does not
replace stars by manually authored overlap scenes. CI captures both baseline and
candidate using the identical fixture on desktop and portrait viewports.

## Pending runtime acceptance

Local Chromium was blocked from creating its process singleton socket. An
escalation request was rejected by the environment approval policy. Therefore
local WebGL execution, video A/B, rotation, actual low-speed playback and mobile
GPU performance are not certified. CI run 34564259247 produced baseline/candidate captures for all five scenarios
at desktop and portrait sizes. Retrieved images show the bilateral needle removed
and a connected lobe replacing the round disappearing source. They also exposed
visible corona rings, now changed to smoothly vanishing shell column density.
The solid handoff browser check failed (28.38 px centroid shift); the new explicit
frame hook was overwriting solid material identity after handoff sampling. It is
now restricted to stars. CI run 34601624379 passed the solid handoff and remaining browser regressions,
including pause and speed probes. However, its retrieved images exposed interior
corona overdraw: smoothing the rings had bleached the opaque surface. Corona
shells now render back faces with depth testing, so the opaque photosphere masks
interior emission. A new pixel gate limits clipped white pixels within the bright
object area rather than merely limiting screen coverage. This fix requires a
fresh browser run. The other three quality workflows passed. Automatic CI passage alone must not
be reported as complete visual acceptance.

Gas now uses a bounded history of measured physical positions, rendered as one
broadening strip per parcel rather than a bright particle head. History never
advances while physical age is paused; an orbit changes strip width orientation
without changing its centerline. No past trajectory is guessed or extrapolated.
The original narrow transverse ejecta test was replaced by a broad transverse
fan requirement with a minimum angular spread; conservation checks are retained.
Adjacent correlated hash seeds are stratified only in the star-star branch.
These follow-up changes passed the full local build, including momentum checks
and curved-path/pause/orbit/reset tests. New CI imagery is required to validate
the gas appearance. Run 34602243013 stopped in the unchanged baseline playback
probe because the harness exposed stale React effect snapshots after reset.
Imperative test commands now flush committed state and read a current frame ref;
the app playback code is unchanged. Extreme mass ratios, overlapping simultaneous collisions
and transition back to the ordinary far corona still require visual assessment.
Do not merge while any requested acceptance item remains unverified.

CI timing in run 34601624379 exposed excessive overhead from six corona shell
draws: low-speed median 66.6/50 ms (desktop/portrait) versus 33.3/16.7 ms on
baseline. The corona now uses one expanded back-face mesh and an analytic smooth
column-density falloff. This restores one photosphere + one corona draw per
envelope; renewed A/B timing is required. These are SwiftShader CI frame times,
not measurements of a mobile GPU.
