#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path

from PIL import Image, ImageDraw

import stellarPhotospherePass2VisualRegression as p2
import stellarPhotospherePass2VisualRegressionRunner as runner  # noqa: F401

OUTPUT_DIR = Path('stellar-corona-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_CORONA_BASELINE_REF',
    '4e7b58098d8fd5c96deb8e8caf4d823409eec359',
)
STAR_ORDER = ('cool', 'solar', 'hot')
LEVEL_ORDER = ('normal', 'enlarged', 'extreme')
BRIGHT_THRESHOLD = 82.0


def luma(rgb: tuple[int, int, int]) -> float:
    return p2.base.luminance(rgb)


def sample_luma(image: Image.Image, x: float, y: float) -> float:
    width, height = image.size
    ix = min(width - 1, max(0, int(round(x))))
    iy = min(height - 1, max(0, int(round(y))))
    pixels = image.load()
    values = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            sx = min(width - 1, max(0, ix + ox))
            sy = min(height - 1, max(0, iy + oy))
            values.append(luma(pixels[sx, sy]))
    return statistics.fmean(values)


def point_inside(image: Image.Image, x: float, y: float, margin: float = 3.0) -> bool:
    return margin <= x < image.width - margin and margin <= y < image.height - margin


def background_luma(image: Image.Image, cx: float, cy: float, radius: float) -> float:
    pixels = image.load()
    values = []
    minimum_radius_sq = (radius * 1.55) ** 2
    for y in range(0, image.height, 3):
        dy = y - cy
        for x in range(0, image.width, 3):
            dx = x - cx
            if dx * dx + dy * dy < minimum_radius_sq:
                continue
            values.append(luma(pixels[x, y]))
    p2.base.require(len(values) >= 80, 'corona background sample is too small')
    return statistics.median(values)


def core_luma(image: Image.Image, cx: float, cy: float, radius: float) -> float:
    values = []
    for angle_index in range(36):
        angle = math.tau * angle_index / 36.0
        for radial_scale in (0.30, 0.45, 0.60):
            x = cx + math.cos(angle) * radius * radial_scale
            y = cy + math.sin(angle) * radius * radial_scale
            if point_inside(image, x, y):
                values.append(sample_luma(image, x, y))
    p2.base.require(values, 'empty photosphere core sample')
    return statistics.fmean(values)


def silhouette_radius(
    image: Image.Image,
    cx: float,
    cy: float,
    radius: float,
    angle: float,
) -> float | None:
    # Equivalent component radius sits inside the anti-aliased disk at normal
    # mobile scale. Find the actual per-angle threshold crossing, then measure
    # corona only outside that rendered silhouette.
    samples: list[tuple[float, float]] = []
    current = radius * 0.72
    stop = radius * 1.35
    while current <= stop:
        x = cx + math.cos(angle) * current
        y = cy + math.sin(angle) * current
        if not point_inside(image, x, y):
            break
        samples.append((current, sample_luma(image, x, y)))
        current += 0.5

    last_above: float | None = None
    for index, (distance, value) in enumerate(samples):
        if value >= BRIGHT_THRESHOLD:
            last_above = distance
            continue
        if last_above is None:
            continue
        following = [sample[1] for sample in samples[index:index + 3]]
        if len(following) >= 2 and all(sample < BRIGHT_THRESHOLD for sample in following):
            return last_above
    return last_above


def percentile(values: list[float], q01: float) -> float:
    p2.base.require(values, 'percentile sample is empty')
    ordered = sorted(values)
    position = (len(ordered) - 1) * q01
    low = int(math.floor(position))
    high = int(math.ceil(position))
    if low == high:
        return ordered[low]
    weight = position - low
    return ordered[low] * (1.0 - weight) + ordered[high] * weight


def analyze_corona(path: Path) -> dict[str, float]:
    image = Image.open(path).convert('RGB')
    geometry = p2.locate_photosphere(image)
    cx = float(geometry['center_x'])
    cy = float(geometry['center_y'])
    radius = float(geometry['equivalent_radius_px'])
    background = background_luma(image, cx, cy, radius)
    core = core_luma(image, cx, cy, radius)

    profiles: list[list[tuple[float, float]]] = []
    for angle_index in range(72):
        angle = math.tau * angle_index / 72.0
        edge = silhouette_radius(image, cx, cy, radius, angle)
        if edge is None:
            continue

        far_x = cx + math.cos(angle) * (edge + radius * 0.46)
        far_y = cy + math.sin(angle) * (edge + radius * 0.46)
        if not point_inside(image, far_x, far_y):
            continue

        profile: list[tuple[float, float]] = []
        fraction = 0.02
        while fraction <= 0.4601:
            distance = edge + radius * fraction
            x = cx + math.cos(angle) * distance
            y = cy + math.sin(angle) * distance
            excess = max(0.0, sample_luma(image, x, y) - background)
            profile.append((fraction, excess))
            fraction += 0.02
        profiles.append(profile)

    p2.base.require(len(profiles) >= 24, 'not enough unclipped corona directions')

    def region(inner: float, outer: float) -> list[float]:
        return [
            excess
            for profile in profiles
            for fraction, excess in profile
            if inner - 1e-9 <= fraction <= outer + 1e-9
        ]

    near_luma = statistics.fmean(region(0.02, 0.10))
    outer_luma = statistics.fmean(region(0.14, 0.28))
    far_luma = statistics.fmean(region(0.32, 0.44))

    extent_threshold = max(1.15, core * 0.0055)
    extents: list[float] = []
    edge_to_shoulder: list[float] = []
    radial_rebounds: list[float] = []
    for profile in profiles:
        values = [excess for _, excess in profile]
        shoulder = statistics.fmean(values[2:5])
        edge_to_shoulder.append(values[0] / max(shoulder, 0.01))
        radial_rebounds.append(
            max([0.0, *[
                values[index + 1] - values[index]
                for index in range(len(values) - 1)
            ]]) / max(core, 1.0)
        )

        last_visible = 0.0
        consecutive_below = 0
        for fraction, excess in profile:
            if excess >= extent_threshold:
                last_visible = fraction
                consecutive_below = 0
            else:
                consecutive_below += 1
                if consecutive_below >= 3 and last_visible > 0.0:
                    break
        extents.append(last_visible)

    return {
        'photosphere_radius_px': radius,
        'background_luma': background,
        'core_luma': core,
        'near_excess_luma': near_luma,
        'outer_excess_luma': outer_luma,
        'far_excess_luma': far_luma,
        'near_to_core': near_luma / max(core, 1.0),
        'outer_to_core': outer_luma / max(core, 1.0),
        'far_to_core': far_luma / max(core, 1.0),
        'outer_to_near': outer_luma / max(near_luma, 0.01),
        'far_to_outer': far_luma / max(outer_luma, 0.01),
        'extent_fraction': statistics.fmean(extents),
        'extent_std_fraction': statistics.pstdev(extents),
        'edge_to_shoulder_p90': percentile(edge_to_shoulder, 0.90),
        'radial_rebound_p90': percentile(radial_rebounds, 0.90),
        'unclipped_direction_count': float(len(profiles)),
    }


def validate_state(
    star: str,
    level: str,
    baseline_surface: dict[str, float | int],
    current_surface: dict[str, float | int],
    baseline_corona: dict[str, float],
    corona: dict[str, float],
) -> None:
    near = corona['near_to_core']
    outer = corona['outer_to_core']
    far = corona['far_to_core']
    extent = corona['extent_fraction']

    p2.base.require(
        0.080 <= near <= 0.20,
        f'{star}/{level}: near-limb glow outside bounded visibility range ({near:.4f})',
    )
    p2.base.require(
        0.015 <= outer <= 0.055,
        f'{star}/{level}: diffuse outer corona outside bounded visibility range ({outer:.4f})',
    )
    p2.base.require(
        far <= 0.014,
        f'{star}/{level}: excessive far outer haze ({far:.4f})',
    )
    p2.base.require(
        0.12 <= corona['outer_to_near'] <= 0.40,
        f"{star}/{level}: near/outer balance is unnatural ({corona['outer_to_near']:.3f})",
    )
    p2.base.require(
        corona['far_to_outer'] <= 0.35,
        f"{star}/{level}: diffuse corona does not decay enough ({corona['far_to_outer']:.3f})",
    )
    p2.base.require(
        0.24 <= extent <= 0.44,
        f'{star}/{level}: corona extent outside 0.24-0.44 photosphere radii ({extent:.3f})',
    )
    p2.base.require(
        corona['extent_std_fraction'] <= 0.060,
        f"{star}/{level}: corona boundary is too angular/spiky ({corona['extent_std_fraction']:.3f})",
    )

    edge_ratio_limit = 3.35 if level == 'normal' else 2.25
    p2.base.require(
        corona['edge_to_shoulder_p90'] <= edge_ratio_limit,
        f"{star}/{level}: corona collapses into a narrow bright outline "
        f"({corona['edge_to_shoulder_p90']:.3f})",
    )
    p2.base.require(
        corona['radial_rebound_p90'] <= 0.060,
        f"{star}/{level}: outer radial profile contains ring/ray rebound "
        f"({corona['radial_rebound_p90']:.4f})",
    )

    p2.base.require(
        extent >= baseline_corona['extent_fraction'] + 0.08,
        f'{star}/{level}: Pass 4 did not materially broaden corona visibility',
    )
    p2.base.require(
        outer >= baseline_corona['outer_to_core'] * 2.5 + 0.006,
        f'{star}/{level}: Pass 4 diffuse outer corona did not materially improve',
    )

    baseline_diameter = float(baseline_surface['bright_photosphere_diameter_px'])
    current_diameter = float(current_surface['bright_photosphere_diameter_px'])
    p2.base.require(
        abs(current_diameter - baseline_diameter) / max(baseline_diameter, 1.0) <= 0.035,
        f'{star}/{level}: photosphere footprint changed while tuning corona',
    )

    baseline_luma = float(baseline_surface['mean_luma'])
    current_luma = float(current_surface['mean_luma'])
    p2.base.require(
        abs(current_luma - baseline_luma) / max(baseline_luma, 1.0) <= 0.035,
        f'{star}/{level}: photosphere luminance changed while tuning corona',
    )

    hue_delta = sum(
        (float(current_surface[channel]) - float(baseline_surface[channel])) ** 2
        for channel in ('hue_r', 'hue_g', 'hue_b')
    ) ** 0.5
    p2.base.require(
        hue_delta <= 0.018,
        f'{star}/{level}: temperature hue drifted ({hue_delta:.5f})',
    )

    baseline_contrast = float(baseline_surface['granulation_contrast'])
    current_contrast = float(current_surface['granulation_contrast'])
    if baseline_contrast >= 0.08:
        p2.base.require(
            current_contrast >= baseline_contrast * 0.88,
            f'{star}/{level}: photosphere granulation was washed out by corona',
        )
        p2.base.require(
            current_contrast <= baseline_contrast * 1.12 + 0.05,
            f'{star}/{level}: photosphere contrast changed unexpectedly',
        )


def validate_luminosity_response(
    corona_metrics: dict[str, dict[str, dict[str, float]]],
) -> None:
    for level in LEVEL_ORDER:
        cool = corona_metrics['cool'][level]
        hot = corona_metrics['hot'][level]
        p2.base.require(
            hot['near_to_core'] <= cool['near_to_core'] * 1.35 + 0.015,
            f'{level}: luminosity makes near corona too much stronger',
        )
        p2.base.require(
            hot['outer_to_core'] <= cool['outer_to_core'] * 1.40 + 0.010,
            f'{level}: luminosity makes diffuse corona too much brighter',
        )
        p2.base.require(
            hot['extent_fraction'] <= cool['extent_fraction'] + 0.08,
            f'{level}: luminosity expands corona extent too aggressively',
        )


def make_contact_sheet(paths: dict[str, dict[str, Path]], output: Path) -> Path:
    first = Image.open(paths['cool']['normal']).convert('RGB')
    crop_height = min(first.height, 560)
    margin = 10
    label_height = 28
    cell_width = first.width
    cell_height = crop_height + label_height
    sheet = Image.new(
        'RGB',
        (cell_width * 3 + margin * 4, cell_height * 3 + margin * 4),
        (10, 12, 18),
    )
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(LEVEL_ORDER):
        for col, star in enumerate(STAR_ORDER):
            x = margin + col * (cell_width + margin)
            y = margin + row * (cell_height + margin)
            draw.text(
                (x, y),
                f'{star} {p2.STAR_MASSES[star]:g} M_sun / {level}',
                fill=(235, 238, 245),
            )
            image = Image.open(paths[star][level]).convert('RGB')
            top = max(0, (image.height - crop_height) // 2)
            sheet.paste(image.crop((0, top, image.width, top + crop_height)), (x, y + label_height))
    sheet.save(output)
    return output


def main() -> None:
    p2.OUTPUT_DIR = OUTPUT_DIR
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    p2.base.wait_for_url(p2.base.CURRENT_URL)
    driver = p2.base.make_driver()
    current_paths: dict[str, dict[str, Path]] = {star: {} for star in STAR_ORDER}
    baseline_paths: dict[str, dict[str, Path]] = {star: {} for star in STAR_ORDER}
    zoom_steps: dict[str, int] = {}

    try:
        for level in LEVEL_ORDER:
            steps, diameter = p2.calibrate_zoom_steps(
                driver,
                p2.base.CURRENT_URL,
                p2.LEVEL_TARGETS[level],
            )
            zoom_steps[level] = steps
            print(f'Pass 4 corona zoom calibration {level}: {steps} -> {diameter:.1f}px')

        for star in STAR_ORDER:
            for level in LEVEL_ORDER:
                current_paths[star][level] = p2.capture_state(
                    driver,
                    p2.base.CURRENT_URL,
                    'current',
                    star,
                    level,
                    zoom_steps[level],
                )

        with p2.baseline_preview(BASELINE_REF) as baseline_url:
            for star in STAR_ORDER:
                for level in LEVEL_ORDER:
                    baseline_paths[star][level] = p2.capture_state(
                        driver,
                        baseline_url,
                        'baseline',
                        star,
                        level,
                        zoom_steps[level],
                    )
    finally:
        driver.quit()

    current_surface = {
        star: {level: p2.analyze(path) for level, path in paths.items()}
        for star, paths in current_paths.items()
    }
    baseline_surface = {
        star: {level: p2.analyze(path) for level, path in paths.items()}
        for star, paths in baseline_paths.items()
    }
    current_corona = {
        star: {level: analyze_corona(path) for level, path in paths.items()}
        for star, paths in current_paths.items()
    }
    baseline_corona = {
        star: {level: analyze_corona(path) for level, path in paths.items()}
        for star, paths in baseline_paths.items()
    }

    contact_sheet = make_contact_sheet(
        current_paths,
        OUTPUT_DIR / 'current-pass4-corona-3x3.png',
    )
    payload = {
        'baseline_ref': BASELINE_REF,
        'viewport': {
            'width': p2.base.VIEWPORT_WIDTH,
            'height': p2.base.VIEWPORT_HEIGHT,
            'mobile': True,
        },
        'zoom_steps': zoom_steps,
        'current_surface': current_surface,
        'baseline_surface': baseline_surface,
        'current_corona': current_corona,
        'baseline_corona': baseline_corona,
        'contact_sheet': str(contact_sheet),
    }
    (OUTPUT_DIR / 'metrics.json').write_text(
        json.dumps(payload, indent=2),
        encoding='utf-8',
    )

    for star in STAR_ORDER:
        for level in LEVEL_ORDER:
            corona = current_corona[star][level]
            print(
                f'Pass 4 corona {star}/{level}: '
                f"near={corona['near_to_core']:.4f} "
                f"outer={corona['outer_to_core']:.4f} "
                f"far={corona['far_to_core']:.4f} "
                f"extent={corona['extent_fraction']:.3f}R "
                f"edge/shoulder-p90={corona['edge_to_shoulder_p90']:.3f}"
            )
            validate_state(
                star,
                level,
                baseline_surface[star][level],
                current_surface[star][level],
                baseline_corona[star][level],
                corona,
            )

    validate_luminosity_response(current_corona)
    print('stellar corona Pass 4 0.35/1/8 M_sun x normal/enlarged/extreme regression: ok')


if __name__ == '__main__':
    main()
