#!/usr/bin/env python3
"""Production photographic light acceptance; see docs/stellar-photographic-target.md.

Reuse production UI/capture helpers, never the historical surface-detail gates.
Geometry and wheel input are taken from the original compact production reference,
so an extended halo cannot masquerade as a larger photosphere in the metrics.
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarProductionIntegrationVisualRegression as production
import stellarHeliosFinalVisualRegression as helios

base = production.p2.base
p2 = production.p2
OUT = Path('stellar-photographic-artifacts')
BASELINE = '3c0863ee2b77614634ac6926c4cfebf568b2e0fb'
REFERENCE = '339537525fa5ce77e42040f7144e5ea1480c0921'
STARS = ('cool', 'solar', 'hot')
LEVELS = ('normal', 'enlarged', 'extreme')
RADII = (0.90, 0.98, 1.04, 1.10, 1.20, 1.40, 1.70, 2.0, 2.3)

# Importing the historical Helios module installs its old masking wrapper.
# Restore the raw production canvas path: metric pixels must not be painted over.
production.capture_canvas = helios.pass5runner._original_capture_canvas
production.LEVEL_TARGETS = {'normal': (52., 90.), 'enlarged': (150., 210.), 'extreme': (320., 380.)}
p2.LEVEL_TARGETS = production.LEVEL_TARGETS
production.OUTPUT_DIR = OUT
p2.OUTPUT_DIR = OUT
helios.OUTPUT_DIR = OUT


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def rgb_at(image, x, y):
    # Bilinear sampling; no wide box filter that leaks core pixels into the rim.
    x0, y0 = int(x), int(y)
    dx, dy = x - x0, y - y0
    return tuple(sum(image.getpixel((x0 + i, y0 + j))[c]
                     * (dx if i else 1 - dx) * (dy if j else 1 - dy)
                     for i in (0, 1) for j in (0, 1)) for c in range(3))


def geometry(path):
    image = Image.open(path).convert('RGB')
    # Browser element captures may include fixed DOM despite the hide/restore
    # fallback. At normal size the Start button is larger than the star. Restrict
    # localization to the unobstructed gameplay band; preserve every saved pixel
    # and sample the original full image for all light/color measurements.
    top, bottom = int(image.height * .18), int(image.height * .80)
    result = p2.locate_photosphere(image.crop((0, top, image.width, bottom)))
    result['center_y'] += top
    aspect = float(result['bbox_width_px']) / float(result['bbox_height_px'])
    require(.9 <= aspect <= 1.1, f'{path}: located component is not a stellar disk')
    return result


def analyze(path, geo):
    image = Image.open(path).convert('RGB')
    cx, cy, radius = (float(geo[k]) for k in ('center_x', 'center_y', 'equivalent_radius_px'))
    core = []
    residuals = []
    blurred = image.filter(ImageFilter.GaussianBlur(max(1., radius * .04)))
    for y in range(max(0, int(cy - radius * .65)), min(image.height, int(cy + radius * .65))):
        for x in range(max(0, int(cx - radius * .65)), min(image.width, int(cx + radius * .65))):
            if math.hypot(x - cx, y - cy) <= radius * .65:
                core.append(image.getpixel((x, y)))
                residuals.append(base.luminance(image.getpixel((x, y))) - base.luminance(blurred.getpixel((x, y))))
    core_rgb = [statistics.mean(p[c] for p in core) for c in range(3)]
    # Median angle statistics reject isolated background stars without repainting.
    profiles = {}
    rgb_profiles = {}
    for r in RADII:
        colors = []
        for index in range(144):
            angle = math.tau * (index + .5) / 144
            x, y = cx + math.cos(angle) * radius * r, cy + math.sin(angle) * radius * r
            if 1 <= x < image.width - 2 and 1 <= y < image.height - 2:
                colors.append(rgb_at(image, x, y))
        require(len(colors) >= 8, f'{path}: insufficient visible halo directions at {r}R')
        rgb = [statistics.median(p[c] for p in colors) for c in range(3)]
        rgb_profiles[str(r)] = rgb
        profiles[str(r)] = base.luminance(rgb) / 255.
    return {'geometry': geo, 'core_rgb': core_rgb, 'core_luma': base.luminance(core_rgb) / 255.,
            'surface_noise': statistics.pstdev(residuals), 'radial_luma': profiles, 'radial_rgb': rgb_profiles}


def capture(driver, url, revision, star, level, steps):
    canvas = production.prepare_scene(driver, url, star)
    production.validate_production_ui(driver)
    if steps:
        production.p2runner.apply_batch_zoom(driver, canvas, -steps, settle_frames=36)
    scene = OUT / f'{revision}-{star}-{level}-scene.png'
    ui = OUT / f'{revision}-{star}-{level}-ui.png'
    production.capture_canvas(driver, canvas, scene)
    production.capture_full_ui(driver, ui)
    state = production.current_telemetry(driver)
    require(state.get('mode') == 'tracking', f'{scene}: production tracking lost')
    return scene, ui, state


def contact(paths, output, crop=False):
    width, height = (300, 340) if crop else (390, 870)
    sheet = Image.new('RGB', (width * 3, height * 3), '#070a10')
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(LEVELS):
        for col, star in enumerate(STARS):
            im = Image.open(paths[star][level]).convert('RGB')
            if crop:
                # Fixed native-pixel central crop, identical for before/after.
                im = im.crop((0, 280, 390, 720)).resize((300, 310))
            sheet.paste(im, (col * width, row * height + 25))
            draw.text((col * width + 6, row * height + 5), f'{star} / {level}', fill='white')
    sheet.save(output)


def side_by_side(before, after, output):
    a, b = Image.open(before).convert('RGB'), Image.open(after).convert('RGB')
    sheet = Image.new('RGB', (a.width + b.width, max(a.height, b.height) + 24), '#070a10')
    sheet.paste(a, (0, 24)); sheet.paste(b, (a.width, 24))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 6), 'BEFORE v0.24.18', fill='white')
    draw.text((a.width + 8, 6), 'AFTER soft light transition', fill='white')
    sheet.save(output)


def validate(current, before, name):
    rgb = current['core_rgb']
    require(min(rgb) >= 235 and max(rgb) - min(rgb) <= 12, f'{name}: core_white not bright/neutral')
    require(current['surface_noise'] <= 1.5, f'{name}: surface_noise dominates light')
    p = current['radial_luma']
    require(.20 <= p['1.1'] <= .85, f'{name}: near_glow missing or overly opaque')
    require(.025 <= p['1.7'] <= .25, f'{name}: diffuse_halo missing or overpowering')
    require(p['1.1'] > p['1.4'] > p['1.7'] > p['2.3'], f'{name}: light layers do not decay outwards')
    # No local minimum followed by a luminous ring, including the silhouette.
    values = [p[str(r)] for r in RADII]
    require(all(b <= a + .025 for a, b in zip(values, values[1:])), f'{name}: dark_outline or neon_ring radial rebound')
    require(p['0.98'] - p['1.04'] <= .45, f'{name}: hard cut edge instead of soft luminous rim')
    require(p['1.7'] >= before['radial_luma']['1.7'] + .02, f'{name}: halo not visibly improved over #146')


def validate_soft_transition(current, before, name):
    p, b = current['radial_luma'], before['radial_luma']
    # Paired production pixels: soften the immediate silhouette without expanding
    # the outer veil. Retain the original light/color/noise gates independently.
    require(p['0.98'] - p['1.1'] <= (b['0.98'] - b['1.1']) * .90,
            f'{name}: immediate edge contrast did not decrease visibly')
    require(p['1.2'] >= b['1.2'] + .025,
            f'{name}: bright transition shoulder did not broaden')
    require(abs(p['1.7'] - b['1.7']) <= .035,
            f'{name}: outer halo expanded instead of softening the edge')


def validate_temperature_identity(metrics, baseline):
    for level in LEVELS:
        # Isolate emitted light from the blue scene background at the exact same
        # positions. The fixed #146 baseline has no corona left at 1.4R. Raw RGB
        # would incorrectly demand orange compensation for the background itself.
        colors = {star: [a - b for a, b in zip(
            metrics[star][level]['radial_rgb']['1.4'],
            baseline[star][level]['radial_rgb']['1.4'])] for star in STARS}
        # Kelvin cool is orange; hot is blue-white. Core color is tested separately.
        warm = colors['cool'][0] - colors['cool'][2]
        solar = colors['solar'][0] - colors['solar'][2]
        hot = colors['hot'][2] - colors['hot'][0]
        require(warm > 8 and 0 <= solar < warm and hot > 3,
                f'{level}: temperature_identity must live in surrounding light: {colors}')


def capture_sweep(driver, url, steps, revision):
    canvas = production.prepare_scene(driver, url, 'hot')
    paths, geometries = [], []
    for index in range(steps + 1):
        if index:
            production.apply_single_zoom(driver, canvas, settle_frames=10)
        path = OUT / f'{revision}-zoom-{index:02d}.png'
        production.capture_canvas(driver, canvas, path)
        paths.append(path)
        if revision == 'reference':
            geometries.append(geometry(path))
    production.make_zoom_strip(paths, OUT / f'{revision}-zoom-strip.png')
    return paths, geometries


def main():
    OUT.mkdir(exist_ok=True)
    base.wait_for_url(base.CURRENT_URL)
    paths, ui, telemetry, metrics = {}, {}, {}, {}
    driver = base.make_driver()
    try:
        # Measure the disk on the original compact reference. A low brightness
        # threshold on v0.24.18 includes its halo and changes the physical zoom
        # target depending on temperature; that is not photosphere geometry.
        metrics['reference'] = {}
        with p2.baseline_preview(REFERENCE) as reference_url:
            production.configure_production_storage(driver, reference_url)
            steps = production.calibrate_zoom_steps(driver, reference_url)
            for star in STARS:
                metrics['reference'][star] = {}
                for level in LEVELS:
                    scene, _, _ = capture(driver, reference_url, 'reference', star, level, steps[level])
                    metrics['reference'][star][level] = analyze(scene, geometry(scene))
            _, reference_sweep_geo = capture_sweep(driver, reference_url, steps['extreme'], 'reference')
        with p2.baseline_preview(BASELINE) as baseline_url:
            for revision, url in [('before', baseline_url), ('after', base.CURRENT_URL)]:
                production.configure_production_storage(driver, url)
                paths[revision], ui[revision], telemetry[revision], metrics[revision] = {}, {}, {}, {}
                for star in STARS:
                    paths[revision][star], ui[revision][star], telemetry[revision][star], metrics[revision][star] = {}, {}, {}, {}
                    for level in LEVELS:
                        scene, full_ui, state = capture(driver, url, revision, star, level, steps[level])
                        paths[revision][star][level], ui[revision][star][level] = scene, full_ui
                        telemetry[revision][star][level] = state
                        geo = metrics['reference'][star][level]['geometry']
                        low, high = production.LEVEL_TARGETS[level]
                        require(low <= geo['bright_photosphere_diameter_px'] <= high,
                                f'{scene}: paired production disk misses {level} screen-size coverage')
                        metrics[revision][star][level] = analyze(scene, geo)
                contact(ui[revision], OUT / f'{revision}-production-mobile-3x3.png')
                contact(paths[revision], OUT / f'{revision}-stars-3x3.png', crop=True)
                sweep_paths, sweep_geo = capture_sweep(driver, url, steps['extreme'], revision)
                if revision == 'after':
                    sweep = [analyze(path, geo) for path, geo in zip(sweep_paths, reference_sweep_geo)]
                # Real multi-body App + SimulationView scene, including trails.
                helios.configure_storage(driver, url)
                for level in LEVELS:
                    canvas, context = helios.prepare_helios_scene(driver, url)
                    if steps[level]:
                        production.p2runner.apply_batch_zoom(driver, canvas, -steps[level], settle_frames=36)
                    scene = OUT / f'{revision}-helios-{level}-scene.png'
                    production.capture_canvas(driver, canvas, scene)
                    production.capture_full_ui(driver, OUT / f'{revision}-helios-{level}-ui.png')
                    require(context['trail_enabled'], 'production Helios scene must retain trails')
    finally:
        driver.quit()
    for label in ('production-mobile-3x3', 'stars-3x3', 'zoom-strip'):
        side_by_side(OUT / f'before-{label}.png', OUT / f'after-{label}.png', OUT / f'ab-{label}.png')
    for level in LEVELS:
        side_by_side(OUT / f'before-helios-{level}-ui.png', OUT / f'after-helios-{level}-ui.png', OUT / f'ab-helios-{level}.png')
    payload = {'baseline_sha': BASELINE, 'photographic_reference_sha': REFERENCE, 'viewport': [390, 844], 'wheel_steps': steps,
               'geometry_source': 'compact #146 reference disk; identical wheel input across reference/main/after',
               'metrics': metrics, 'telemetry': telemetry, 'zoom_sweep': sweep}
    (OUT / 'metrics.json').write_text(json.dumps(payload, indent=2))
    errors = []
    for star in STARS:
        for level in LEVELS:
            try:
                validate(metrics['after'][star][level], metrics['reference'][star][level], f'{star}/{level}')
                validate_soft_transition(metrics['after'][star][level], metrics['before'][star][level], f'{star}/{level}')
            except AssertionError as error:
                errors.append(str(error))
    try:
        validate_temperature_identity(metrics['after'], metrics['reference'])
        for a, b in zip(sweep, sweep[1:]):
            require(abs(a['radial_luma']['1.7'] - b['radial_luma']['1.7']) < .035, 'halo brightness pops during zoom')
            require(b['surface_noise'] <= 1.5, 'surface noise appears during zoom')
    except AssertionError as error:
        errors.append(str(error))
    require(not errors, '\n'.join(errors))
    print('Photographic production gate passed: 3 temperatures x 3 sizes, continuous zoom, Helios production A/B')


if __name__ == '__main__':
    main()
