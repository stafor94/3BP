#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
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


def luma(rgb: tuple[int, int, int]) -> float:
    return p2.base.luminance(rgb)


def sample_luma(image: Image.Image, x: float, y: float) -> float:
    width, height = image.size
    ix = min(width - 1, max(0, int(round(x))))
    iy = min(height - 1, max(0, int(round(y))))
    pixels = image.load()
    values: list[float] = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            sx = min(width - 1, max(0, ix + ox))
            sy = min(height - 1, max(0, iy + oy))
            values.append(luma(pixels[sx, sy]))
    return statistics.fmean(values)


def point_inside(image: Image.Image, x: float, y: float, margin: float = 2.0) -> bool:
    return margin <= x < image.width - margin and margin <= y < image.height - margin


def background_luma(image: Image.Image, cx: float, cy: float, radius: float) -> float:
    pixels = image.load()
    values: list[float] = []
    min_radius_sq = (radius * 1.48) ** 2
    for y in range(0, image.height, 3):
        dy = y - cy
        for x in range(0, image.width, 3):
            dx = x - cx
            if dx * dx + dy * dy < min_radius_sq:
                continue
            values.append(luma(pixels[x, y]))
    p2.base.require(len(values) >= 80, 'corona background sample is too small')
    return statistics.median(values)


def annulus_excess(
    image: Image.Image,
    cx: float,
    cy: float,
    radius: float,
    inner_scale: float,
    outer_scale: float,
    background: float,
) -> float:
    values: list[float] = []
    for angle_index in range(48):
        angle = math.tau * angle_index / 48.0
        for radial_index in range(4):
            scale = inner_scale + (outer_scale - inner_scale) * (radial_index + 0.5) / 4.0
            x = cx + math.cos(angle) * radius * scale
            y = cy + math.sin(angle) * radius * scale
            if not point_inside(image, x, y):
                continue
            values.append(max(0.0, sample_luma(image, x, y) - background))
    p2.base.require(values, f'empty annulus sample {inner_scale:.2f}-{outer_scale:.2f}')
    return statistics.fmean(values)


def core_luma(image: Image.Image, cx: float, cy: float, radius: float) -> float:
    values: list[float] = []
    for angle_index in range(36):
        angle = math.tau * angle_index / 36.0
        for radial_scale in (0.28, 0.40, 0.52, 0.64):
            x = cx + math.cos(angle) * radius * radial_scale
            y = cy + math.sin(angle) * radius * radial_scale
            if point_inside(image, x, y):
                values.append(sample_luma(image, x, y))
    p2.base.require(values, 'empty photosphere core sample')
    return statistics.fmean(values)


def radial_extent_fraction(
    image: Image.Image,
    cx: float,
    cy: float,
    radius: float,
    background: float,
    core: float,
) -> tuple[float, float]:
    extents: list[float] = []
    threshold = max(1.15, core * 0.0055)
    for angle_index in range(48):
        angle = math.tau * angle_index / 48.0
        samples: list[tuple[float, float]] = []
        for step in range(1, 73):
            scale = 1.0 + step * 0.008
            if scale > 1.56:
                break
            x = cx + math.cos(angle) * radius * scale
            y = cy + math.sin(angle) * radius * scale
            if not point_inside(image, x, y):
                break
            samples.append((scale, max(0.0, sample_luma(image, x, y) - background)))
        if len(samples) < 12:
            continue

        last_visible = 1.0
        consecutive_below = 0
        for scale, excess in samples:
            if excess >= threshold:
                last_visible = scale
                consecutive_below = 0
            else:
                consecutive_below += 1
                if consecutive_below >= 4 and last_visible > 1.0:
                    break
        extents.append(max(0.0, last_visible - 1.0))

    p2.base.require(len(extents) >= 12, 'not enough unclipped corona extent directions')
    return statistics.fmean(extents), statistics.pstdev(extents)


def analyze_corona(path: Path) -> dict[str, float]:
    image = Image.open(path).convert('RGB')
    geometry = p2.locate_photosphere(image)
    cx = float(geometry['center_x'])
    cy = float(geometry['center_y'])
    radius = float(geometry['equivalent_radius_px'])
    background = background_luma(image, cx, cy, radius)
    core = core_luma(image, cx, cy, radius)

    near = annulus_excess(image, cx, cy, radius, 1.018, 1.12, background)
    outer = annulus_excess(image, cx, cy, radius, 1.16, 1.31, background)
    far = annulus_excess(image, cx, cy, radius, 1.34, 1.46, background)
    ring = annulus_excess(image, cx, cy, radius, 1.002, 1.045, background)
    shoulder = annulus_excess(image, cx, cy, radius, 1.055, 1.105, background)
    extent_mean, extent_std = radial_extent_fraction(image, cx, cy, radius, background, core)

    return {
        'photosphere_radius_px': radius,
        'background_luma': background,
        'core_luma': core,
        'near_excess_luma': near,
        'outer_excess_luma': outer,
        'far_excess_luma': far,
        'ring_excess_luma': ring,
        'shoulder_excess_luma': shoulder,
        'near_to_core': near / max(core, 1.0),
        'outer_to_core': outer / max(core, 1.0),
        'far_to_core': far / max(core, 1.0),
        'outer_to_near': outer / max(near, 0.01),
        'far_to_outer': far / max(outer, 0.01),
        'ring_to_core': ring / max(core, 1.0),
        'ring_to_shoulder': ring / max(shoulder, 0.01),
        'extent_fraction': extent_mean,
        'extent_std_fraction': extent_std,
    }


def validate_state(
    star: str,
    level: str,
    baseline_surface: dict[str, float | int],
    current_surface: dict[str, float | int],
    corona: dict[str, float],
) -> None:
    near = corona['near_to_core']
    outer = corona['outer_to_core']
    far = corona['far_to_core']
    extent = corona['extent_fraction']
    extent_std = corona['extent_std_fraction']

    minimum_near = 0.018 if level == 'normal' else 0.014
    minimum_outer = 0.0035 if level == 'normal' else 0.0025
    p2.base.require(
        near >= minimum_near,
        f'{star}/{level}: near-limb corona is not visibly present ({near:.4f})',
    )
    p2.base.require(
        outer >= minimum_outer,
        f'{star}/{level}: diffuse outer corona is below minimum visibility ({outer:.4f})',
    )
    p2.base.require(
        near <= 0.20,
        f'{star}/{level}: near-limb corona competes with the photosphere ({near:.4f})',
    )
    p2.base.require(
        outer <= 0.075,
        f'{star}/{level}: diffuse outer corona is too bright ({outer:.4f})',
    )
    p2.base.require(
        far <= 0.026,
        f'{star}/{level}: excessive outer haze remains far from the photosphere ({far:.4f})',
    )
    p2.base.require(
        0.10 <= corona['outer_to_near'] <= 0.58,
        f"{star}/{level}: near/outer balance is unnatural ({corona['outer_to_near']:.3f})",
    )
    p2.base.require(
        corona['far_to_outer'] <= 0.78,
        f"{star}/{level}: outer corona does not decay enough ({corona['far_to_outer']:.3f})",
    )
    p2.base.require(
        0.10 <= extent <= 0.48,
        f'{star}/{level}: corona extent outside bounded range ({extent:.3f} R)',
    )
    p2.base.require(
        extent_std <= 0.075,
        f'{star}/{level}: angular corona variation is too strong/spiky ({extent_std:.3f} R)',
    )
    p2.base.require(
        corona['ring_to_core'] <= 0.22,
        f"{star}/{level}: bright neon ring detected ({corona['ring_to_core']:.4f})",
    )
    p2.base.require(
        corona['ring_to_shoulder'] <= 1.75,
        f"{star}/{level}: corona collapses into a narrow edge outline ({corona['ring_to_shoulder']:.3f})",
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


def validate_luminosity_response(corona_metrics: dict[str, dict[str, dict[str, float]]]) -> None:
    for level in LEVEL_ORDER:
        cool = corona_metrics['cool'][level]
        hot = corona_metrics['hot'][level]
        p2.base.require(
            hot['near_to_core'] <= cool['near_to_core'] * 1.45 + 0.015,
            f'{level}: luminosity makes the near corona too much stronger',
        )
        p2.base.require(
            hot['extent_fraction'] <= cool['extent_fraction'] + 0.11,
            f'{level}: luminosity expands corona extent too aggressively',
        )


def make_contact_sheet(paths: dict[str, dict[str, Path]], output: Path) -> Path:
    first = Image.open(paths['cool']['normal']).convert('RGB')
    margin = 10
    label_height = 28
    cell_width = first.width
    cell_height = first.height + label_height
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
            sheet.paste(image, (x, y + label_height))
    sheet.save(output)
    return output


def print_review_image(path: Path) -> None:
    image = Image.open(path).convert('RGB')
    image.thumbnail((760, 1500))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=72, optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    print('STELLAR_CORONA_PASS4_REVIEW_JPEG_BASE64_BEGIN')
    for index in range(0, len(encoded), 120):
        print(encoded[index:index + 120])
    print('STELLAR_CORONA_PASS4_REVIEW_JPEG_BASE64_END')


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
        star: {level: p2.analyze(path) for level, path in levels.items()}
        for star, levels in current_paths.items()
    }
    baseline_surface = {
        star: {level: p2.analyze(path) for level, path in levels.items()}
        for star, levels in baseline_paths.items()
    }
    corona_metrics = {
        star: {level: analyze_corona(path) for level, path in levels.items()}
        for star, levels in current_paths.items()
    }

    for star in STAR_ORDER:
        for level in LEVEL_ORDER:
            validate_state(
                star,
                level,
                baseline_surface[star][level],
                current_surface[star][level],
                corona_metrics[star][level],
            )
    validate_luminosity_response(corona_metrics)

    payload = {
        'baseline_ref': BASELINE_REF,
        'viewport': {
            'width': p2.base.VIEWPORT_WIDTH,
            'height': p2.base.VIEWPORT_HEIGHT,
            'mobile': True,
        },
        'stars_mass_solar': p2.STAR_MASSES,
        'zoom_steps': zoom_steps,
        'current_surface': current_surface,
        'baseline_surface': baseline_surface,
        'corona': corona_metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    contact_sheet = make_contact_sheet(
        current_paths,
        OUTPUT_DIR / 'mobile-pass4-corona-3x3.png',
    )
    print('Pass 4 corona metrics:')
    for star in STAR_ORDER:
        for level in LEVEL_ORDER:
            metric = corona_metrics[star][level]
            print(
                f"  {star}/{level}: near={metric['near_to_core']:.4f} "
                f"outer={metric['outer_to_core']:.4f} far={metric['far_to_core']:.4f} "
                f"extent={metric['extent_fraction']:.3f}R "
                f"angularStd={metric['extent_std_fraction']:.3f}R "
                f"ring={metric['ring_to_core']:.4f}"
            )
    print_review_image(contact_sheet)
    print('stellar corona Pass 4 0.35/1/8 M_sun normal/enlarged/extreme regression: ok')


if __name__ == '__main__':
    main()
