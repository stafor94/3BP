#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarHdrVisualRegression as hdr
import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-pass1-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_PASS1_BASELINE_REF',
    '09153897130cd25d35820174b2b81b5dea5b80c7',
)
ZOOM_LEVELS = {
    'normal': 0,
    'large': -4,
}
STAR_ORDER = ('cool', 'solar', 'hot')


def analyze_star(image: Image.Image, blurred: Image.Image, index: int) -> dict[str, float]:
    pixels = image.load()
    blurred_pixels = blurred.load()
    width, height = image.size
    center_x, center_y, radius = hdr.locate_star(image, index)
    core_radius = max(radius * 0.72, 3.0)
    left = max(1, int(center_x - core_radius - 1))
    right = min(width - 2, int(center_x + core_radius + 2))
    top = max(1, int(center_y - core_radius - 1))
    bottom = min(height - 2, int(center_y + core_radius + 2))

    luma_sum = 0.0
    luma_sq_sum = 0.0
    blurred_luma_sum = 0.0
    blurred_luma_sq_sum = 0.0
    neighbor_delta_sum = 0.0
    neighbor_delta_count = 0
    local_minima_count = 0
    sample_count = 0
    rgb_sum = [0.0, 0.0, 0.0]

    for y in range(top, bottom + 1):
        for x in range(left, right + 1):
            if math.hypot(x - center_x, y - center_y) > core_radius:
                continue
            rgb = pixels[x, y]
            value = hdr.luma(rgb)
            if value < 70:
                continue

            blurred_value = hdr.luma(blurred_pixels[x, y])
            sample_count += 1
            luma_sum += value
            luma_sq_sum += value * value
            blurred_luma_sum += blurred_value
            blurred_luma_sq_sum += blurred_value * blurred_value
            for channel in range(3):
                rgb_sum[channel] += rgb[channel]

            neighbors = (
                hdr.luma(pixels[x - 1, y]),
                hdr.luma(pixels[x + 1, y]),
                hdr.luma(pixels[x, y - 1]),
                hdr.luma(pixels[x, y + 1]),
            )
            if min(neighbors) >= 65:
                neighbor_mean = sum(neighbors) / 4.0
                neighbor_delta_sum += abs(value - neighbor_mean)
                neighbor_delta_count += 1
                brighter_neighbors = sum(neighbor >= value + 2.0 for neighbor in neighbors)
                if neighbor_mean >= value + 2.5 and brighter_neighbors >= 3:
                    local_minima_count += 1

    base.require(sample_count >= 20, f'star {index}: insufficient photosphere core samples')
    mean_luma = luma_sum / sample_count
    mean_blurred_luma = blurred_luma_sum / sample_count
    luma_std = math.sqrt(max(0.0, luma_sq_sum / sample_count - mean_luma * mean_luma))
    broad_std = math.sqrt(
        max(0.0, blurred_luma_sq_sum / sample_count - mean_blurred_luma * mean_blurred_luma)
    )
    channel_sum = max(sum(rgb_sum), 1.0)

    return {
        'equivalent_radius_px': radius,
        'mean_luma': mean_luma,
        'luma_std': luma_std,
        'broad_std': broad_std,
        'surface_neighbor_contrast': neighbor_delta_sum / max(neighbor_delta_count, 1),
        'local_minima_fraction': local_minima_count / max(neighbor_delta_count, 1),
        'hue_r': rgb_sum[0] / channel_sum,
        'hue_g': rgb_sum[1] / channel_sum,
        'hue_b': rgb_sum[2] / channel_sum,
    }


def analyze(path: Path) -> dict[str, dict[str, float]]:
    image = Image.open(path).convert('RGB')
    blurred = image.filter(ImageFilter.GaussianBlur(radius=2.6))
    return {
        name: analyze_star(image, blurred, index)
        for index, name in enumerate(STAR_ORDER)
    }


def hue_distance(a: dict[str, float], b: dict[str, float]) -> float:
    return math.sqrt(sum((a[key] - b[key]) ** 2 for key in ('hue_r', 'hue_g', 'hue_b')))


def validate(metrics: dict[str, dict[str, dict[str, dict[str, float]]]]) -> None:
    for level in ZOOM_LEVELS:
        baseline = metrics['baseline'][level]
        current = metrics['current'][level]
        for star in STAR_ORDER:
            before = baseline[star]
            after = current[star]

            base.require(
                abs(after['mean_luma'] - before['mean_luma']) <= max(before['mean_luma'] * 0.18, 9.0),
                f'{level}/{star}: mean luminance drifted too far: '
                f"{before['mean_luma']:.2f} -> {after['mean_luma']:.2f}",
            )
            base.require(
                abs(after['equivalent_radius_px'] - before['equivalent_radius_px']) <=
                max(before['equivalent_radius_px'] * 0.14, 2.0),
                f'{level}/{star}: bright photosphere footprint changed too much: '
                f"{before['equivalent_radius_px']:.2f}px -> {after['equivalent_radius_px']:.2f}px",
            )
            base.require(
                hue_distance(before, after) <= 0.025,
                f'{level}/{star}: temperature-derived photosphere hue drifted too far',
            )
            base.require(
                after['broad_std'] >= max(before['broad_std'] * 0.28, 0.75),
                f'{level}/{star}: broad photosphere variation collapsed toward a flat sphere: '
                f"{before['broad_std']:.3f} -> {after['broad_std']:.3f}",
            )
            # Keep a small nonzero local residual; cellular/Voronoi topology is
            # guarded by the rendering structural regression.
            base.require(
                after['surface_neighbor_contrast'] >= 0.12,
                f'{level}/{star}: weak local photosphere inhomogeneity disappeared: '
                f"{after['surface_neighbor_contrast']:.3f}",
            )

        cool = current['cool']
        solar = current['solar']
        hot = current['hot']
        base.require(cool['hue_r'] > cool['hue_b'] + 0.055, f'{level}: cool star lost its warm identity')
        base.require(solar['hue_r'] > solar['hue_b'] + 0.025, f'{level}: solar-like star became neutral white')
        base.require(hot['hue_b'] >= hot['hue_r'] - 0.010, f'{level}: hot star lost its blue-white identity')


def make_contact_sheet(paths: dict[str, dict[str, Path]]) -> None:
    sample = Image.open(paths['baseline']['normal']).convert('RGB')
    margin = 12
    label_height = 30
    row_height = sample.height + label_height
    sheet = Image.new(
        'RGB',
        (sample.width * 2 + margin * 3, row_height * 2 + margin * 2),
        (12, 14, 20),
    )
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(('normal', 'large')):
        y = margin + row * row_height
        draw.text((margin, y), f'Baseline main cellular / {level}', fill=(235, 238, 245))
        draw.text((margin * 2 + sample.width, y), f'Pass 1 non-cellular basis / {level}', fill=(235, 238, 245))
        sheet.paste(Image.open(paths['baseline'][level]).convert('RGB'), (margin, y + label_height))
        sheet.paste(Image.open(paths['current'][level]).convert('RGB'), (margin * 2 + sample.width, y + label_height))
    sheet.save(OUTPUT_DIR / 'mobile-temperature-pass1-ab.png')


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base.OUTPUT_DIR = OUTPUT_DIR
    hdr.OUTPUT_DIR = OUTPUT_DIR
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    paths: dict[str, dict[str, Path]] = {'baseline': {}, 'current': {}}
    try:
        with hdr.baseline_preview(BASELINE_REF) as baseline_url:
            for level, wheel_steps in ZOOM_LEVELS.items():
                paths['baseline'][level] = hdr.capture_level(
                    driver,
                    f'baseline-{level}',
                    baseline_url,
                    wheel_steps,
                )
        for level, wheel_steps in ZOOM_LEVELS.items():
            paths['current'][level] = hdr.capture_level(
                driver,
                f'current-{level}',
                base.CURRENT_URL,
                wheel_steps,
            )
    finally:
        driver.quit()

    metrics = {
        side: {level: analyze(path) for level, path in side_paths.items()}
        for side, side_paths in paths.items()
    }
    validate(metrics)
    make_contact_sheet(paths)

    payload = {
        'baseline_ref': BASELINE_REF,
        'viewport': {
            'width': base.VIEWPORT_WIDTH,
            'height': base.VIEWPORT_HEIGHT,
            'mobile': True,
        },
        'scene': 'stellar-topology/temperature (0.35, 1, 8 solar masses)',
        'zoom_levels': ZOOM_LEVELS,
        'metrics': metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    print('stellar photosphere Pass 1 mobile A/B regression: ok')
    for level in ('normal', 'large'):
        print(f'  {level}:')
        for star in STAR_ORDER:
            before = metrics['baseline'][level][star]
            after = metrics['current'][level][star]
            print(
                f"    {star}: luma {before['mean_luma']:.1f}->{after['mean_luma']:.1f}, "
                f"broad std {before['broad_std']:.3f}->{after['broad_std']:.3f}, "
                f"local {before['surface_neighbor_contrast']:.3f}->{after['surface_neighbor_contrast']:.3f}, "
                f"minima {before['local_minima_fraction']:.5f}->{after['local_minima_fraction']:.5f}"
            )


if __name__ == '__main__':
    main()
