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
GPU performance are not certified. CI captures must be retrieved and inspected;
automatic CI passage alone must not be reported as complete visual acceptance.

The external gas is currently a diffuse distribution at physical particle poses,
not hydrodynamics. Its visual tails use current physical velocity. Long curved
stream continuity, extreme mass ratios, overlapping simultaneous collisions and
transition back to the ordinary far corona still require visual assessment.
Do not merge while any requested acceptance item remains unverified.
