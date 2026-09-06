# Photographic stellar light — 0.24.18

Baseline: main `339537525fa5ce77e42040f7144e5ea1480c0921` (PR #146).
Target: the supplied 50394.jpg reference montage's nearly white saturated core,
soft luminous edge and temperature-tinted diffuse light, including gameplay size.
The montage includes illustrative astronomical imagery; it is a shared visual
direction, not a calibrated astronomical exposure or a texture to reproduce.

## Root cause and scope

`SimulationView` uses `simulationRenderer`, whose existing primary mesh is routed
through `bodyLighting` into `stellarPhotosphereMaterial`. `bodyLighting` updates
one existing inner glow Sprite using `stellarCoronaMaterial` and disables the
second stellar Sprite. `stellarRenderProfile` owns their intensity and footprint.
The final call is `renderer.render(scene, camera)` with ACES/exposure 1. There is
no EffectComposer or production bloom pass. Increasing emission cannot scatter
light beyond a mesh silhouette in this pipeline.

The previous corona scale was 2.90–3.04 (only about 1.5 photosphere radii), with
opacity 0.18–0.235, another 0.52 alpha multiplier, and multiple early tail cutoffs.
An outside-only rising mask suppressed the immediate edge. Halo information was
removed in the corona shader/profile, before final additive composition. The
photosphere independently compressed near-neutral intensity to preserve visible
surface contrast under ACES. The resulting center-to-background step and weak
outside light read as a ball. The PR #146 production artifacts confirm this:
small disks have almost no visible surroundings; enlarged ones emphasize noise.

Only three stellar runtime files change. The existing single corona Sprite now
carries overlapping immediate glow, shoulder and a broad monotonically fading
halo. The core uses bounded HDR energy and desaturation before the unchanged
ACES chunk; a coverage feather overlaps the immediate glow. No global bloom,
camera, physics, generic material, UI, background, trail or gameplay changes.

## Why historical gates are stale

The old active workflow coupled several generations of visual targets, including
minimum granulation at normal size, mandatory increasing detail with zoom,
surface hue separation, and rejection of broad diffuse halos. These directly
contradict this request. Their scripts are retained for historical investigation,
but their art acceptance is superseded, not threshold-relaxed or silently caught.

| Historical requirement | Current production acceptance |
| --- | --- |
| Minimum surface contrast; rising contrast with zoom | Upper bound on residual noise; white bright core at every size |
| Dark topology/lane removal | No high-contrast surface structure, plus shader exclusion of cellular fields |
| Surface hue must be visibly different | Near-neutral core; warm/solar/blue identity measured in surrounding light |
| Compact corona; large halo is failure | Visible near glow and diffuse halo; outward decay and bounded brightness |
| Limb depth and surface-detail retention | No dark valley, neon radial rebound or abrupt core-to-glow drop |
| Texture correlation during zoom | Stable glow brightness and low noise through the full production zoom sweep |
| Historical isolated harness A/B | Same pre-change main, production App/SimulationView, input and mobile viewport |

`stellarPhotographicVisualRegression.py` captures raw rendered canvases and full
UI at 390×844 for cool/solar/hot × normal/enlarged/extreme, a continuous hot zoom
sweep and the multi-body Helios production scene with trajectories. It produces
before/after contact sheets and a zoom strip before running acceptance, including
when acceptance fails. It does not paint over captured pixels. Baseline geometry
and identical wheel steps avoid counting a brighter halo as a larger body.

The numerical checks assist direct image review. Baseline-relative halo increase
and absolute core/glow requirements make a smooth disk without surrounding light
fail even with zero surface noise. In fixture names, `cool` means low Kelvin
(warm orange light), `hot` means high Kelvin (blue-white light).

## Evidence status

The supplied JPG and PR #146 production 3×3/zoom artifacts were directly viewed.
The first paired production run's normal/enlarged/extreme 3×3, Helios normal
scene and continuous zoom strip were also directly viewed: pale textured disks
become white luminous cores with visible warm/solar/blue-white surroundings.
No black outline, detached neon band or dominant surface noise was observed.
Its initial metric failure localized the normal-size Start button instead of the
star. Localization now excludes fixed UI bands without repainting saved images,
and checks disk aspect ratio and actual size. Halo color is measured after
subtracting the paired baseline background, avoiding its blue color bias.
The same captured images pass all nine light gates, color identity and 36 zoom
samples under these measurement corrections; no acceptance threshold changed.
No latest gameplay video is present among this turn's attachments; older workspace
videos are not evidence of the latest build. This limitation must stay explicit
until the requested video is provided and checked. Final CI and direct A/B review
results are recorded in the PR after the production artifacts are available.


## v0.24.19: disk-to-glow transition

Baseline: main `3c0863ee2b77614634ac6926c4cfebf568b2e0fb` (v0.24.18).
The supplied gameplay screenshot has a white core and visible halo, but the
immediate exponential glow (0.12 photosphere radii) falls too quickly and leaves
a distinct disk silhouette. Production still renders directly with ACES exposure
1 and no postprocessing bloom; changing exposure is not the fix.

Only the immediate component of the existing stellar Sprite changes: a Gaussian
shoulder at 0.24R has zero initial slope and connects the core to the unchanged
soft shoulder and diffuse halo. Core emission, surface variation, temperature,
outer distribution, carrier size, blending, draw count and simulation are unchanged.
No additional angular asymmetry is planned unless production evidence needs it.

Before implementation, acceptance was fixed to: visibly reduced edge contrast,
broader bright transition at normal size, retained white core/color identity,
no texture/outline/ring, and no wider outer veil. Paired v0.24.18 captures test a
10% edge-contrast reduction (.98R to 1.1R), a .025 luminance gain at 1.2R and at
most .035 change at 1.7R. These supplement, not replace or relax, all original
photographic gates. The original #146 production reference is captured separately
for the existing halo-gain and background-subtracted temperature checks.

Inspect all three temperatures at normal/enlarged/extreme, mobile App scenes,
Helios scenes and continuous zoom strips. The supplied screenshot is visual
context; no latest gameplay video was attached. User-device motion confirmation
must not be claimed from still captures.

The first capture attempt exposed stale size calibration: the helper's 82/255
brightness threshold counts v0.24.18's halo as disk, and its temperature changes
the measured size (cool/enlarged missed the target before any after capture).
Calibration and geometry therefore remain on the original compact #146 disk,
with identical wheel inputs reused for v0.24.18 and this revision. All before/after
images still compare latest main; no acceptance threshold was relaxed.

## Outer-halo follow-up: acceptance before experimentation

Baseline: main `076fb962267658e58cf56c8699423567fca155a5` (v0.24.19).
The supplied 50428.mp4 (7.253 seconds, 1080x1708) and 50394.jpg reference
montage were opened directly, including a 4-fps sequence and a native-size
video frame. The video retains the white core and soft glow, while its faint
outer distribution reads nearly circular. It does not establish temperature
separation or a performance regression.

Before any runtime change, capture the production mobile temperature/size
matrix. Experiment only with the existing outer-halo distribution: broad,
weak, body-seeded and time-independent. Keep the white core, round near rim,
temperature identity, carrier size/opacity and existing 1+1 draw structure.
No new pass, diffraction, lens flare, surface detail, or non-stellar change.

Adoption requires directly reviewed paired latest-main frames, normal mobile
priority, all nine temperature/size combinations, overlapping stars, continuous
zoom and movement, and measured frame time. Existing photographic, soft-rim,
noise, outline/ring and color gates remain active. A pattern that reads as
petals, stripes or smoke fails even if CI passes. Revert the experiment if the
visual improvement is unclear; version only an adopted runtime change.
