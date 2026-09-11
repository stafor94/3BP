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
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarProductionIntegrationVisualRegression as production

base = production.p2.base
OUT = Path('stellar-photographic-artifacts')
STARS = ('cool', 'solar', 'hot')
DISK_RADII = (0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.72)
RADII = (
    *DISK_RADII,
    0.80,
    0.83,
    0.86,
    0.88,
    0.90,
    0.94,
    0.97,
    1.00,
    1.03,
    1.06,
    1.10,
    1.20,
    1.40,
    1.70,
    2.00,
    2.30,
)


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


def locate_production_photosphere(image):
    # Element screenshots include viewport overlays such as the bottom Start
    # button. Mask only those UI bands for geometry detection, then use the
    # existing production locator unchanged on the full-size pixel coordinate
    # system so low-threshold corona coverage cannot be mistaken for a custom
    # high-luminance photosphere radius.
    locator_image = image.copy()
    draw = ImageDraw.Draw(locator_image)
    top_ui = int(image.height * 0.12)
    bottom_ui = int(image.height * 0.82)
    draw.rectangle((0, 0, image.width, top_ui), fill=(0, 0, 0))
    draw.rectangle((0, bottom_ui, image.width, image.height), fill=(0, 0, 0))
    return production.p2.locate_photosphere(locator_image)


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


def validate_disk_continuity(metrics, name):
    # Ring medians suppress surface texture without blurring away a disk boundary.
    # RGB distance catches desaturation boundaries even for nearly neutral solar
    # stars; normalized chromaticity avoids unstable HSV hue near white.
    rgb = [metrics['radial_rgb'][str(radius)] for radius in DISK_RADII]
    luma = [metrics['radial_luma'][str(radius)] for radius in DISK_RADII]
    chroma = [[channel / sum(color) for channel in color] for color in rgb]
    for index, (inner, outer) in enumerate(zip(luma, luma[1:])):
        interval = f'{DISK_RADII[index]}R->{DISK_RADII[index + 1]}R'
        require(-0.008 <= inner - outer <= 0.035,
                f'{name}: abrupt mid-disk luminance change at {interval}')
        # Allow the compact core's warm highlight to decay; keep the middle
        # disk stricter, where a white-disk boundary is never expected.
        rgb_limit = 18 if index == 0 else 14
        require(max(abs(a - b) for a, b in zip(rgb[index], rgb[index + 1])) <= rgb_limit,
                f'{name}: abrupt mid-disk RGB jump at {interval}')
        require(max(abs(a - b) for a, b in zip(chroma[index], chroma[index + 1])) <= 0.014,
                f'{name}: abrupt mid-disk hue/chromaticity jump at {interval}')

    # A compact highlight has spent most of its contrast by 0.35R. A broad white
    # disk instead concentrates its falloff in the 0.35R->0.55R colored annulus.
    inner_drop = luma[0] - luma[2]
    shoulder_drop = luma[2] - luma[4]
    require(shoulder_drop <= max(0.008, inner_drop * 0.45),
            f'{name}: broad white disk / colored annulus at 0.4R-0.6R')
    for index in (3, 4):
        for channel in range(3):
            low = min(chroma[index - 1][channel], chroma[index + 1][channel])
            high = max(chroma[index - 1][channel], chroma[index + 1][channel])
            require(low - 0.003 <= chroma[index][channel] <= high + 0.003,
                    f'{name}: independent colored annulus at {DISK_RADII[index]}R')


def validate_star(metrics, name):
    radial = metrics['radial_luma']
    validate_disk_continuity(metrics, name)
    # core_white now means luminous center only; neutrality is intentionally not
    # enforced because temperature identity may remain visible through the core.
    require(metrics['core_luma'] >= 0.84, f'{name}: core_white/core_bright is not luminous enough')
    require(metrics['surface_noise'] <= 1.8, f'{name}: surface_noise dominates photographic emission')
    require(0.10 <= radial['1.1'] <= 0.90, f'{name}: near_glow missing or overpowering')
    require(0.010 <= radial['1.7'] <= 0.30, f'{name}: diffuse_halo missing or overpowering')

    handoff_radii = (0.80, 0.83, 0.86, 0.88, 0.90, 0.94, 0.97, 1.00, 1.03, 1.06, 1.10)
    handoff = [radial[str(radius)] for radius in handoff_radii]
    running_min = handoff[0]
    max_rebound = 0.0
    for value in handoff[1:]:
        max_rebound = max(max_rebound, value - running_min)
        running_min = min(running_min, value)
    require(
        max_rebound <= 0.035,
        f'{name}: photosphere/corona handoff contains a positive radial rebound ({max_rebound:.4f})',
    )
    require(
        max(radial['0.97'], radial['1.0'], radial['1.03']) <= radial['0.9'] + 0.035,
        f'{name}: independent bright annular band appears around the photosphere edge',
    )

    outward = [radial[str(radius)] for radius in (1.1, 1.2, 1.4, 1.7, 2.0, 2.3)]
    require(
        all(next_value <= value + 0.025 for value, next_value in zip(outward, outward[1:])),
        f'{name}: dark_outline or neon_ring radial rebound',
    )
    require(radial['1.1'] > radial['1.4'] > radial['1.7'] > radial['2.3'],
            f'{name}: halo does not decay monotonically outward')
    require(radial['0.97'] - radial['1.03'] <= 0.50,
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

            geometry = locate_production_photosphere(image)
            require(52.0 <= geometry['bright_photosphere_diameter_px'] <= 95.0,
                    f'{star}: normal gameplay disk size changed unexpectedly')
            scene_paths[star] = scene_path
            ui_paths[star] = ui_path
            telemetry[star] = state
            metrics[star] = analyze(image, geometry)
    finally:
        driver.quit()

    make_contact_sheet(scene_paths, OUT / 'normal-scenes.png')
    make_contact_sheet(ui_paths, OUT / 'normal-ui.png')
    (OUT / 'metrics.json').write_text(json.dumps({
        'viewport': [390, 844],
        'scope': 'cool/solar/hot at normal gameplay size only',
        'metrics': metrics,
        'telemetry': telemetry,
    }, indent=2))
    for star in STARS:
        validate_star(metrics[star], star)
    validate_temperature_identity(metrics)

    print('Photographic production gate passed: cool/solar/hot normal gameplay color identity')


if __name__ == '__main__':
    main()
