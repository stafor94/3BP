#!/usr/bin/env python3
"""Minimal production photographic-light regression for normal gameplay size.

The renderer should keep a bright photographic core while preserving temperature
identity across the disk and near glow. This gate intentionally avoids the former
3x3 size sweep and continuous-zoom baseline work for this focused color fix.
"""
from __future__ import annotations

import json
import math
import statistics
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarProductionIntegrationVisualRegression as production

base = production.p2.base
OUT = Path('stellar-photographic-artifacts')
STARS = ('cool', 'solar', 'hot')
RADII = (0.72, 0.90, 0.98, 1.04, 1.10, 1.20, 1.40, 1.70, 2.00, 2.30)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def rgb_at(image, x, y):
    x0, y0 = int(x), int(y)
    dx, dy = x - x0, y - y0
    return tuple(
        sum(
            image.getpixel((x0 + i, y0 + j))[channel]
            * (dx if i else 1 - dx)
            * (dy if j else 1 - dy)
            for i in (0, 1)
            for j in (0, 1)
        )
        for channel in range(3)
    )


def locate_photosphere(image):
    # Use a high-luminance connected component so the broad corona cannot inflate
    # the measured disk radius. Normal gameplay stars are far larger than any
    # isolated background star at this threshold.
    width, height = image.size
    pixels = image.load()
    threshold = 175.0
    bright = {
        (x, y)
        for y in range(height)
        for x in range(width)
        if base.luminance(pixels[x, y]) >= threshold
    }
    largest = []

    while bright:
        start = bright.pop()
        queue = deque([start])
        component = [start]
        while queue:
            x, y = queue.popleft()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor not in bright:
                    continue
                bright.remove(neighbor)
                queue.append(neighbor)
                component.append(neighbor)
        if len(component) > len(largest):
            largest = component

    require(len(largest) >= 500, 'normal gameplay photosphere is too small or too dim')
    center_x = sum(point[0] for point in largest) / len(largest)
    center_y = sum(point[1] for point in largest) / len(largest)
    radius = math.sqrt(len(largest) / math.pi)
    xs = [point[0] for point in largest]
    ys = [point[1] for point in largest]
    aspect = (max(xs) - min(xs) + 1) / max(1, max(ys) - min(ys) + 1)
    require(0.88 <= aspect <= 1.12, 'located bright component is not a stellar disk')
    return {
        'center_x': center_x,
        'center_y': center_y,
        'equivalent_radius_px': radius,
        'bright_photosphere_diameter_px': radius * 2.0,
        'component_pixels': len(largest),
    }


def analyze(image, geometry):
    cx = float(geometry['center_x'])
    cy = float(geometry['center_y'])
    radius = float(geometry['equivalent_radius_px'])
    blurred = image.filter(ImageFilter.GaussianBlur(max(1.0, radius * 0.04)))
    core = []
    residuals = []

    for y in range(max(0, int(cy - radius * 0.60)), min(image.height, int(cy + radius * 0.60))):
        for x in range(max(0, int(cx - radius * 0.60)), min(image.width, int(cx + radius * 0.60))):
            distance = math.hypot(x - cx, y - cy)
            if distance <= radius * 0.28:
                pixel = image.getpixel((x, y))
                core.append(pixel)
            if distance <= radius * 0.60:
                residuals.append(
                    base.luminance(image.getpixel((x, y)))
                    - base.luminance(blurred.getpixel((x, y)))
                )

    require(core, 'stellar core sampling failed')
    core_rgb = [statistics.mean(pixel[channel] for pixel in core) for channel in range(3)]
    radial_luma = {}
    radial_rgb = {}

    for radius_multiple in RADII:
        colors = []
        for index in range(144):
            angle = math.tau * (index + 0.5) / 144
            x = cx + math.cos(angle) * radius * radius_multiple
            y = cy + math.sin(angle) * radius * radius_multiple
            if 1 <= x < image.width - 2 and 1 <= y < image.height - 2:
                colors.append(rgb_at(image, x, y))
        require(len(colors) >= 24, f'insufficient radial samples at {radius_multiple}R')
        rgb = [statistics.median(pixel[channel] for pixel in colors) for channel in range(3)]
        radial_rgb[str(radius_multiple)] = rgb
        radial_luma[str(radius_multiple)] = base.luminance(rgb) / 255.0

    return {
        'geometry': geometry,
        'core_rgb': core_rgb,
        'core_luma': base.luminance(core_rgb) / 255.0,
        'surface_noise': statistics.pstdev(residuals),
        'radial_luma': radial_luma,
        'radial_rgb': radial_rgb,
    }


def validate_star(metrics, name):
    radial = metrics['radial_luma']
    # core_white now means luminous center only; neutrality is intentionally not
    # enforced because temperature identity may remain visible through the core.
    require(metrics['core_luma'] >= 0.84, f'{name}: core_white/core_bright is not luminous enough')
    require(metrics['surface_noise'] <= 1.8, f'{name}: surface_noise dominates photographic emission')
    require(0.10 <= radial['1.1'] <= 0.90, f'{name}: near_glow missing or overpowering')
    require(0.010 <= radial['1.7'] <= 0.30, f'{name}: diffuse_halo missing or overpowering')

    outward = [radial[str(radius)] for radius in (1.1, 1.2, 1.4, 1.7, 2.0, 2.3)]
    require(
        all(next_value <= value + 0.025 for value, next_value in zip(outward, outward[1:])),
        f'{name}: dark_outline or neon_ring radial rebound',
    )
    require(radial['1.1'] > radial['1.4'] > radial['1.7'] > radial['2.3'],
            f'{name}: halo does not decay monotonically outward')
    require(radial['0.98'] - radial['1.04'] <= 0.50,
            f'{name}: dark_outline hard edge instead of a soft luminous rim')


def validate_temperature_identity(metrics):
    # Use the mid-disk where the photosphere must carry most of the identity color.
    # cool -> warm/red-biased, solar -> near-neutral warm white, hot -> blue-biased.
    colors = {star: metrics[star]['radial_rgb']['0.72'] for star in STARS}
    cool_warm = colors['cool'][0] - colors['cool'][2]
    solar_warm = colors['solar'][0] - colors['solar'][2]
    hot_cool = colors['hot'][2] - colors['hot'][0]
    require(
        cool_warm >= 18 and -4 <= solar_warm < cool_warm and hot_cool >= 10,
        f'temperature_identity lost at normal gameplay size: {colors}',
    )


def make_contact_sheet(paths, output):
    images = [Image.open(paths[star]).convert('RGB') for star in STARS]
    width = max(image.width for image in images)
    height = max(image.height for image in images)
    sheet = Image.new('RGB', (width * len(STARS), height + 26), '#070a10')
    draw = ImageDraw.Draw(sheet)
    for index, (star, image) in enumerate(zip(STARS, images)):
        x = index * width
        sheet.paste(image, (x, 26))
        draw.text((x + 8, 7), f'{star} / normal gameplay', fill='white')
    sheet.save(output)


def main():
    OUT.mkdir(exist_ok=True)
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    scene_paths = {}
    ui_paths = {}
    metrics = {}
    telemetry = {}

    try:
        production.configure_production_storage(driver, base.CURRENT_URL)
        for star in STARS:
            canvas = production.prepare_scene(driver, base.CURRENT_URL, star)
            production.validate_production_ui(driver)
            scene_path = OUT / f'{star}-normal-scene.png'
            ui_path = OUT / f'{star}-normal-ui.png'
            image = production.capture_canvas(driver, canvas, scene_path)
            production.capture_full_ui(driver, ui_path)
            state = production.current_telemetry(driver)
            require(state.get('mode') == 'tracking', f'{star}: production tracking lost')

            geometry = locate_photosphere(image)
            require(52.0 <= geometry['bright_photosphere_diameter_px'] <= 95.0,
                    f'{star}: normal gameplay disk size changed unexpectedly')
            scene_paths[star] = scene_path
            ui_paths[star] = ui_path
            telemetry[star] = state
            metrics[star] = analyze(image, geometry)
    finally:
        driver.quit()

    for star in STARS:
        validate_star(metrics[star], star)
    validate_temperature_identity(metrics)

    make_contact_sheet(scene_paths, OUT / 'normal-scenes.png')
    make_contact_sheet(ui_paths, OUT / 'normal-ui.png')
    (OUT / 'metrics.json').write_text(json.dumps({
        'viewport': [390, 844],
        'scope': 'cool/solar/hot at normal gameplay size only',
        'metrics': metrics,
        'telemetry': telemetry,
    }, indent=2))
    print('Photographic production gate passed: cool/solar/hot normal gameplay color identity')


if __name__ == '__main__':
    main()
