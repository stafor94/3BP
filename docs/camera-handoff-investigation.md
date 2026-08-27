# Collision camera → tracking camera handoff investigation

## Baseline

- Starting `main`: `83be416afc84ea0e16d67e4830a7c58cd00ae7f1`
- Starting package version: `0.19.7`
- User evidence: `37484.mp4` (1080×1708, 11.264611 s, 696 encoded frames)

## What v0.19.7 covers

v0.19.7 preserves the collision camera's final rendered `camera.position`,
`controls.target`, and distance as handoff progress zero. This removes the direct
one-frame transform jump between the last collision frame and the first release
frame.

The v0.19.7 browser fixture stops physics before release and changes the renderer
state manually through `tracking → collision → collision-result → release`.
Consequently, it does not exercise collision prediction, collision-watch timing,
the App physics scheduler, React publication, speed restoration, a moving remnant,
or the transition-to-normal-tracking boundary.

## User-video frame evidence

The collision information card and the collision camera have different hold
timers for a standard collision (`3500 ms` versus `3800 ms`). The video's card
therefore disappears about 300 ms before the actual camera release. Reading the
variable-rate source frames by PTS gives the real camera boundary:

| Event | Source frame | PTS | Observed body center (px) | Note |
| --- | ---: | ---: | ---: | --- |
| Last collision-UI frame | 587 | 9.443 s | about (500, 943) | Information card still present |
| First frame without collision UI | 588 | 9.460 s | about (500, 943) | Camera hold is still active |
| Last stable collision-camera frame | 606 | 9.762 s | about (500, 943) | End of the extra 300 ms camera hold |
| First discontinuity / release | 607 | 9.776 s | about (280, 578) | About 424 px in one source frame |
| Off-screen | 608 | 9.794 s | not visible | Body exits the viewport |

The pixel measurement is descriptive evidence only. The automated regression
uses its own production-run baselines and relative continuity thresholds.

## Camera transform writers

| Writer | Position write | Target write | Activation |
| --- | --- | --- | --- |
| camera initialization | `camera.position.set` | OrbitControls default | Renderer creation only |
| collision-camera | target-follow shift plus collision-distance lerp | collision primary/descendant | `collisionCameraFocus` resolves both source lineages |
| tracking-handoff | absolute start→current-destination interpolation | absolute start→current-target interpolation | collision camera focused→released with valid tracking |
| normal-tracking | target delta is added to camera; optional distance lerp | resolved tracked body | valid tracking outside collision camera |
| selection-change | normal-tracking writer plus direction/settle reset | newly selected body | source selection changes |
| default-composition | target-follow shift | mobile/desktop composition offset | initial free-camera composition only |
| resize/composition | re-enters collision or tracking writer | same as active writer | viewport composition mode changes |
| OrbitControls.update | may update camera from internal spherical/damping state | may update controls target | resize/composition and every renderer frame |

The production telemetry records the writer-level before/after transform and
separately records `controls.update()` before/after state so a second owner in
the same renderer frame is visible.

## Concurrent timebases

| Timebase | Production use |
| --- | --- |
| physics simulation time | Fixed `0.0015` steps, accumulated from wall delta × current speed |
| wall clock (`performance.now`) | prediction polling, collision-watch phase ramps, impact timestamp, telemetry |
| `setTimeout` wall clock | collision information hold and collision camera hold release |
| App `requestAnimationFrame` | physics accumulator, watch state machine, speed management, React publication |
| renderer `requestAnimationFrame` | camera ownership, 18-frame handoff counter, OrbitControls, render |
| React propagation | bodies published at up to 30 Hz; simulation time is published after each advanced App frame |
| transition frame index | 18 renderer frames regardless of display refresh rate or simulation speed |

At 60/90/120 Hz, an 18-frame transition lasts about 283/189/142 ms between its
first and last samples. The duration is independent of simulation speed, while
the moving target's physics displacement over each published render snapshot is
speed-dependent. Frame count changes the duration but is not the first failing
operation in the captured production run.

## Production-path regression

The regression renders the real `App` and changes only its deterministic initial
body fixture. It then uses the production UI and production scheduler to select
tracking, request 3x speed, start simulation, predict the collision, enter the
collision watch, slow down, observe impact, create the physical merge remnant,
hold the collision camera, release it, restore 3x speed, finish handoff, and run
normal tracking for at least one additional second.

Per renderer frame it records wall/simulation time, React generation, physics
identity/position/velocity/mass/radius, collision phase, camera ownership,
before/desired/after transforms, every writer, OrbitControls effects, NDC/pixel
projection, visibility, and neighboring-frame deltas.

## Pre-fix failure and root cause

CI run 159 fails the production-path regression on renderer frame 42:

| Signal | Value |
| --- | ---: |
| writer before | `collision-camera` |
| writer after | `tracking-transition` |
| transition progress | `0` |
| tracked-body world step | `0.4501009317` |
| camera position step | `0` |
| controls target step | `0` |
| screen-space step | `265.076 px` |
| stable collision baseline P90 | approximately `0 px` |
| discontinuity threshold | `27.893 px` |
| OrbitControls changed transform | `false` |
| resolved identity changed | `false` |

The first bad writer is `tracking-transition`. v0.19.7 stores its start camera
and target as fixed world-space transforms. On release progress zero it writes
those old transforms again, although the real App has already published a newer
moving-remnant position. In the failing frame the body advances 0.4501 units but
the camera and target advance zero, producing the 265 px screen jump. Later
transition frames mix the same past world-space start with a current moving
destination, so the relative composition is speed- and publication-cadence
dependent.

This proves category **C / MOVING TARGET**. The 3x speed and 30 Hz React body
publication amplify the displacement, but neither identity resolution,
OrbitControls, multiple writers, resize/composition, nor physics itself caused
the first discontinuity.

The production fix therefore represents the handoff as offsets relative to the
current resolved tracked body. The body position is refreshed every renderer
frame; only the camera-relative and target-relative offsets are interpolated.
At progress zero the prior collision composition follows the body's legitimate
world motion, and at progress one the offsets are exactly the offsets used by
normal tracking.
