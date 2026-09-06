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
