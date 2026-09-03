#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarGranulationLodVisualRegression as lod
import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-limb-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_LIMB_BASELINE_REF',
    '284d113e82523f90ae5ca92444f0eab0bbb98b26',
)
ZOOM_LEVELS = {
    'normal': 0,
    'large': -8,
}


def capture_level(driver, label: str, root_url: str, wheel_steps: int) -> Path:
    canvas = lod.prepare_scene(driver, root_url)
    lod.apply_zoom(driver, canvas, wheel_steps, settle_frames=45)
    path = OUTPUT_DIR / f'{label}-mobile.png'
    base.require(bool(canvas.screenshot(str(path))) and path.exists(), f'{label}: capture failed')
    return path


def luma(rgb: tuple[int, int, int]) -> float:
    return base.luminance(rgb)


def find_star_center(image: Image.Image, side: str) -> tuple[float, float]:
    width, height = image.size
    pixels = image.load()
    x_start = 0 if side == 'left' else width // 2
    x_end = width // 2 if side == 'left' else width
    y_start = max(0, height // 2 - 210)
    y_end = min(height, height // 2 + 210)

    total_weight = 0.0
    weighted_x = 0.0
    weighted_y = 0.0
    for y in range(y_start, y_end):
        for x in range(x_start, x_end):
            current = luma(pixels[x, y])
            if current < 115.0:
                continue
            weight = (current - 114.0) ** 1.35
            total_weight += weight
            weighted_x += x * weight
            weighted_y += y * weight

    base.require(total_weight > 0.0, f'{side}: failed to locate stellar photosphere')
    return weighted_x / total_weight, weighted_y / total_weight


def horizontal_profile(image: Image.Image, center: tuple[float, float], side: str) -> list[float]:
    pixels = image.load()
    width, height = image.size
    center_x = int(round(center[0]))
    center_y = int(round(center[1]))
    direction = -1 if side == 'left' else 1
    max_radius = center_x - 2 if side == 'left' else width - center_x - 3
    max_radius = max(8, min(max_radius, width // 2 - 3))
    profile: list[float] = []

    for radius in range(max_radius):
        x = center_x + direction * radius
        samples = []
        for y_offset in range(-2, 3):
            y = min(height - 1, max(0, center_y + y_offset))
            samples.append(luma(pixels[x, y]))
        profile.append(sum(samples) / len(samples))
    return profile


def first_sustained_crossing(profile: list[float], threshold: float, start: int = 4) -> int:
    for index in range(start, max(start, len(profile) - 2)):
        if profile[index] < threshold and profile[index + 1] < threshold:
            return index
    return len(profile) - 2


def interpolated_crossing(
    profile: list[float],
    target: float,
    start: int,
    end: int,
) -> float | None:
    previous = profile[start]
    if previous <= target:
        return float(start)

    for index in range(start + 1, min(end, len(profile))):
        current = profile[index]
        if current <= target:
            span = previous - current
            if span <= 1e-6:
                return float(index)
            fraction = max(0.0, min(1.0, (previous - target) / span))
            return float(index - 1) + fraction
        previous = current
    return None


def profile_metrics(profile: list[float]) -> dict[str, float]:
    core_radius = first_sustained_crossing(profile, 90.0)
    halo_radius = first_sustained_crossing(profile, 18.0, max(core_radius + 1, 5))
    edge_start = max(1, core_radius - 5)
    edge_end = min(len(profile) - 2, core_radius + 5)
    hard_edge_drop = max(
        (profile[index] - profile[index + 1] for index in range(edge_start, edge_end + 1)),
        default=0.0,
    )
    edge_inside = profile[max(0, core_radius - 3):max(1, core_radius)]
    edge_inside_luma = sum(edge_inside) / max(len(edge_inside), 1)

    inside_reference = sum(profile[max(0, core_radius - 6):max(1, core_radius - 3)]) / 3.0
    outside_reference = sum(profile[core_radius + 4:core_radius + 7]) / 3.0
    high = outside_reference + (inside_reference - outside_reference) * 0.80
    low = outside_reference + (inside_reference - outside_reference) * 0.20
    transition_start = max(1, core_radius - 7)
    transition_end = min(len(profile), core_radius + 9)
    high_radius = interpolated_crossing(profile, high, transition_start, transition_end)
    low_radius = interpolated_crossing(profile, low, transition_start, transition_end)
    transition_width = 0.0
    if high_radius is not None and low_radius is not None:
        transition_width = max(0.0, low_radius - high_radius)

    return {
        'core_radius_px': float(core_radius),
        'halo_radius_px': float(halo_radius),
        'halo_extent_px': float(max(0, halo_radius - core_radius)),
        'hard_edge_drop': float(hard_edge_drop),
        'edge_inside_luma': float(edge_inside_luma),
        'edge_transition_width_px': float(transition_width),
    }


def analyze(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    blurred = image.filter(ImageFilter.GaussianBlur(radius=1.15))
    aggregate = lod.analyze(path)
    side_metrics = []
    for side in ('left', 'right'):
        center = find_star_center(blurred, side)
        profile = horizontal_profile(blurred, center, side)
        side_metrics.append(profile_metrics(profile))

    for key in (
        'core_radius_px',
        'halo_radius_px',
        'halo_extent_px',
        'hard_edge_drop',
        'edge_inside_luma',
        'edge_transition_width_px',
    ):
        aggregate[key] = sum(float(metrics[key]) for metrics in side_metrics) / len(side_metrics)
    return aggregate


def validate_level(level: str, baseline: dict[str, float | int], current: dict[str, float | int]) -> None:
    base_core = float(baseline['core_radius_px'])
    current_core = float(current['core_radius_px'])
    base.require(
        abs(current_core - base_core) <= max(2.0, base_core * 0.09),
        f'{level}: photosphere bright radius changed too much: baseline={base_core:.2f}px current={current_core:.2f}px',
    )

    base_halo = float(baseline['halo_extent_px'])
    current_halo = float(current['halo_extent_px'])
    base.require(
        current_halo <= base_halo * 1.08 + 2.0,
        f'{level}: existing halo became thicker: baseline={base_halo:.2f}px current={current_halo:.2f}px',
    )

    base_edge_luma = float(baseline['edge_inside_luma'])
    current_edge_luma = float(current['edge_inside_luma'])
    base.require(
        current_edge_luma >= base_edge_luma * 0.80 - 4.0,
        f'{level}: limb became too dark/gray: baseline={base_edge_luma:.2f} current={current_edge_luma:.2f}',
    )

    hue_delta = sum(
        (float(current[channel]) - float(baseline[channel])) ** 2
        for channel in ('hue_r', 'hue_g', 'hue_b')
    ) ** 0.5
    base.require(hue_delta <= 0.025, f'{level}: stellar temperature hue drifted: {hue_delta:.5f}')

    base_contrast = float(baseline['surface_neighbor_contrast'])
    current_contrast = float(current['surface_neighbor_contrast'])
    base.require(
        current_contrast >= base_contrast * 0.72,
        f'{level}: Pass 2/3 granulation contrast was over-suppressed: '
        f'baseline={base_contrast:.3f} current={current_contrast:.3f}',
    )


def validate(metrics: dict[str, dict[str, dict[str, float | int]]]) -> None:
    for level in ZOOM_LEVELS:
        validate_level(level, metrics['baseline'][level], metrics['current'][level])

    large_base = metrics['baseline']['large']
    large_current = metrics['current']['large']
    normal_base = metrics['baseline']['normal']
    normal_current = metrics['current']['normal']

    base.require(
        float(large_current['hard_edge_drop']) <= float(large_base['hard_edge_drop']) * 1.02 + 0.5,
        'large: hard silhouette gradient became sharper instead of softer',
    )
    base.require(
        float(normal_current['hard_edge_drop']) <= float(normal_base['hard_edge_drop']) * 0.97 + 0.5,
        'normal: hard silhouette gradient did not soften measurably',
    )
    base.require(
        float(normal_current['edge_transition_width_px']) >= float(normal_base['edge_transition_width_px']) * 0.96,
        'normal: interpolated edge transition became materially narrower',
    )
    base.require(
        float(large_current['edge_transition_width_px']) >= float(large_base['edge_transition_width_px']) * 0.94,
        'large: interpolated edge transition became materially narrower',
    )


def make_contact_sheet(paths: dict[str, dict[str, Path]]) -> None:
    first = Image.open(paths['baseline']['normal']).convert('RGB')
    margin = 12
    label_height = 30
    row_height = first.height + label_height
    sheet = Image.new(
        'RGB',
        (first.width * 2 + margin * 3, row_height * 2 + margin * 2),
        (12, 14, 20),
    )
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(('normal', 'large')):
        y = margin + row * row_height
        draw.text((margin, y), f'Pass 3 main / {level}', fill=(235, 238, 245))
        draw.text((margin * 2 + first.width, y), f'Pass 4 limb-edge / {level}', fill=(235, 238, 245))
        baseline = Image.open(paths['baseline'][level]).convert('RGB')
        current = Image.open(paths['current'][level]).convert('RGB')
        sheet.paste(baseline, (margin, y + label_height))
        sheet.paste(current, (margin * 2 + first.width, y + label_height))
    sheet.save(OUTPUT_DIR / 'mobile-pass3-pass4-contact-sheet.png')


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base.OUTPUT_DIR = OUTPUT_DIR
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    paths: dict[str, dict[str, Path]] = {'baseline': {}, 'current': {}}
    try:
        with base.baseline_preview(BASELINE_REF) as baseline_url:
            for level, wheel_steps in ZOOM_LEVELS.items():
                paths['baseline'][level] = capture_level(
                    driver,
                    f'baseline-{level}',
                    baseline_url,
                    wheel_steps,
                )
        for level, wheel_steps in ZOOM_LEVELS.items():
            paths['current'][level] = capture_level(
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
        'scene': 'stellar-topology/separate',
        'zoom_levels': ZOOM_LEVELS,
        'metrics': metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    for level in ZOOM_LEVELS:
        baseline = metrics['baseline'][level]
        current = metrics['current'][level]
        print(
            f'stellar limb {level}: '
            f"hard edge {float(baseline['hard_edge_drop']):.2f} -> {float(current['hard_edge_drop']):.2f}, "
            f"transition {float(baseline['edge_transition_width_px']):.2f}px -> "
            f"{float(current['edge_transition_width_px']):.2f}px, "
            f"core radius {float(baseline['core_radius_px']):.2f}px -> "
            f"{float(current['core_radius_px']):.2f}px, "
            f"halo extent {float(baseline['halo_extent_px']):.2f}px -> "
            f"{float(current['halo_extent_px']):.2f}px"
        )
    print('stellar limb mobile Pass 3/Pass 4 A/B: ok')


if __name__ == '__main__':
    main()
