#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import json
import math
import os
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarGranulationLodVisualRegression as lod
import stellarLimbVisualRegression as limb
import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-corona-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_CORONA_BASELINE_REF',
    '93bb0d481464e633d6c15e91ecbcac51040c3555',
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


def sample_luma(image: Image.Image, x: float, y: float) -> float:
    width, height = image.size
    ix = min(width - 1, max(0, int(round(x))))
    iy = min(height - 1, max(0, int(round(y))))
    pixels = image.load()
    samples = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            sx = min(width - 1, max(0, ix + ox))
            sy = min(height - 1, max(0, iy + oy))
            samples.append(base.luminance(pixels[sx, sy]))
    return sum(samples) / len(samples)


def radial_profile(image: Image.Image, center: tuple[float, float], angle: float, max_radius: int) -> list[float]:
    cx, cy = center
    return [
        sample_luma(image, cx + math.cos(angle) * radius, cy + math.sin(angle) * radius)
        for radius in range(max_radius)
    ]


def chroma_at(image: Image.Image, x: float, y: float) -> float:
    width, height = image.size
    ix = min(width - 1, max(0, int(round(x))))
    iy = min(height - 1, max(0, int(round(y))))
    r, g, b = image.getpixel((ix, iy))
    peak = max(r, g, b)
    return (peak - min(r, g, b)) / max(float(peak), 1.0)


def side_corona_metrics(image: Image.Image, side: str) -> dict[str, float]:
    center = limb.find_star_center(image, side)
    outward = math.pi if side == 'left' else 0.0
    extents: list[float] = []
    halo_core_ratios: list[float] = []
    annulus_chroma: list[float] = []
    width, height = image.size
    max_radius = min(width // 2 - 3, height // 2 - 3)

    for offset in (-0.72, -0.54, -0.36, -0.18, 0.0, 0.18, 0.36, 0.54, 0.72):
        angle = outward + offset
        profile = radial_profile(image, center, angle, max_radius)
        metrics = limb.profile_metrics(profile)
        core = int(round(float(metrics['core_radius_px'])))
        halo = int(round(float(metrics['halo_radius_px'])))
        extents.append(max(0.0, float(halo - core)))
        core_start = max(2, int(core * 0.28))
        core_end = max(core_start + 1, int(core * 0.68))
        core_luma = sum(profile[core_start:core_end]) / max(core_end - core_start, 1)
        halo_start = min(len(profile) - 1, core + 2)
        halo_end = min(len(profile), max(halo_start + 2, halo + 1))
        halo_luma = sum(profile[halo_start:halo_end]) / max(halo_end - halo_start, 1)
        halo_core_ratios.append(halo_luma / max(core_luma, 1.0))
        sample_radius = core + min(3, max(1, halo - core))
        annulus_chroma.append(chroma_at(
            image,
            center[0] + math.cos(angle) * sample_radius,
            center[1] + math.sin(angle) * sample_radius,
        ))

    return {
        'corona_extent_mean_px': statistics.fmean(extents),
        'corona_extent_std_px': statistics.pstdev(extents),
        'halo_to_core_luma': statistics.fmean(halo_core_ratios),
        'corona_annulus_chroma': statistics.fmean(annulus_chroma),
    }


def analyze(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB').filter(ImageFilter.GaussianBlur(radius=1.0))
    metrics = limb.analyze(path)
    sides = [side_corona_metrics(image, side) for side in ('left', 'right')]
    for key in (
        'corona_extent_mean_px',
        'corona_extent_std_px',
        'halo_to_core_luma',
        'corona_annulus_chroma',
    ):
        metrics[key] = sum(float(side[key]) for side in sides) / len(sides)
    return metrics


def validate_level(level: str, baseline: dict[str, float | int], current: dict[str, float | int]) -> None:
    base_extent = float(baseline['corona_extent_mean_px'])
    current_extent = float(current['corona_extent_mean_px'])
    base.require(
        current_extent <= base_extent * 0.76 + 2.0,
        f'{level}: corona did not become materially more compact: baseline={base_extent:.2f}px current={current_extent:.2f}px',
    )

    base_ratio = float(baseline['halo_to_core_luma'])
    current_ratio = float(current['halo_to_core_luma'])
    base.require(
        current_ratio <= base_ratio * 0.90 + 0.02,
        f'{level}: halo still competes with photosphere: baseline={base_ratio:.4f} current={current_ratio:.4f}',
    )

    base.require(
        float(current['corona_extent_std_px']) >= 0.18,
        f'{level}: corona boundary is reading as perfectly concentric',
    )

    base.require(
        float(current['edge_inside_luma']) >= float(baseline['edge_inside_luma']) * 0.78 - 4.0,
        f'{level}: a dark/gray ring appeared at the Pass 4 stellar edge',
    )
    base.require(
        float(current['corona_annulus_chroma']) >= float(baseline['corona_annulus_chroma']) * 0.62 - 0.015,
        f'{level}: corona lost too much stellar temperature chroma',
    )

    hue_delta = sum(
        (float(current[channel]) - float(baseline[channel])) ** 2
        for channel in ('hue_r', 'hue_g', 'hue_b')
    ) ** 0.5
    base.require(hue_delta <= 0.030, f'{level}: stellar temperature hue drifted: {hue_delta:.5f}')
    # Pass 1 intentionally removes the old cellular lane contrast. Keep corona
    # validation focused on corona/edge behavior while still preventing a flat
    # photosphere regression.
    base.require(
        float(current['surface_neighbor_contrast']) >= 0.12,
        f'{level}: photosphere became locally flat while validating corona behavior',
    )
    base.require(
        float(current['hard_edge_drop']) <= float(baseline['hard_edge_drop']) * 1.12 + 1.0,
        f'{level}: Pass 4 soft stellar edge became materially harder',
    )
    base.require(
        float(current['edge_transition_width_px']) >= float(baseline['edge_transition_width_px']) * 0.80,
        f'{level}: Pass 4 edge transition became materially narrower',
    )


def make_contact_sheet(paths: dict[str, dict[str, Path]]) -> Path:
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
        draw.text((margin, y), f'Pass 4 main / {level}', fill=(235, 238, 245))
        draw.text((margin * 2 + first.width, y), f'Pass 5 compact corona / {level}', fill=(235, 238, 245))
        baseline = Image.open(paths['baseline'][level]).convert('RGB')
        current = Image.open(paths['current'][level]).convert('RGB')
        sheet.paste(baseline, (margin, y + label_height))
        sheet.paste(current, (margin * 2 + first.width, y + label_height))
    output = OUTPUT_DIR / 'mobile-pass4-pass5-contact-sheet.png'
    sheet.save(output)
    return output


def print_review_image(path: Path) -> None:
    image = Image.open(path).convert('RGB')
    image.thumbnail((820, 1180))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=82, optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    print('STELLAR_CORONA_REVIEW_JPEG_BASE64_BEGIN')
    for index in range(0, len(encoded), 120):
        print(encoded[index:index + 120])
    print('STELLAR_CORONA_REVIEW_JPEG_BASE64_END')


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base.OUTPUT_DIR = OUTPUT_DIR
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    paths: dict[str, dict[str, Path]] = {'baseline': {}, 'current': {}}
    try:
        with base.baseline_preview(BASELINE_REF) as baseline_url:
            for level, wheel_steps in ZOOM_LEVELS.items():
                paths['baseline'][level] = capture_level(driver, f'baseline-{level}', baseline_url, wheel_steps)
        for level, wheel_steps in ZOOM_LEVELS.items():
            paths['current'][level] = capture_level(driver, f'current-{level}', base.CURRENT_URL, wheel_steps)
    finally:
        driver.quit()

    metrics = {
        side: {level: analyze(path) for level, path in side_paths.items()}
        for side, side_paths in paths.items()
    }
    for level in ZOOM_LEVELS:
        validate_level(level, metrics['baseline'][level], metrics['current'][level])

    contact_sheet = make_contact_sheet(paths)
    payload = {
        'baseline_ref': BASELINE_REF,
        'viewport': {'width': base.VIEWPORT_WIDTH, 'height': base.VIEWPORT_HEIGHT, 'mobile': True},
        'scene': 'stellar-topology/separate',
        'zoom_levels': ZOOM_LEVELS,
        'metrics': metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    for level in ZOOM_LEVELS:
        baseline = metrics['baseline'][level]
        current = metrics['current'][level]
        print(
            f'stellar corona {level}: '
            f"extent {float(baseline['corona_extent_mean_px']):.2f}px -> {float(current['corona_extent_mean_px']):.2f}px, "
            f"halo/core {float(baseline['halo_to_core_luma']):.4f} -> {float(current['halo_to_core_luma']):.4f}, "
            f"boundary std {float(current['corona_extent_std_px']):.2f}px, "
            f"edge luma {float(baseline['edge_inside_luma']):.2f} -> {float(current['edge_inside_luma']):.2f}"
        )
    print_review_image(contact_sheet)
    print('stellar corona mobile Pass 4/Pass 5 A/B: ok')


if __name__ == '__main__':
    main()
