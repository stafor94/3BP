#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path

from PIL import Image, ImageDraw

import stellarPhotospherePass2VisualRegression as p2
import stellarPhotospherePass2VisualRegressionRunner as p2runner  # noqa: F401

OUTPUT_DIR = Path('stellar-pass3-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_PASS3_BASELINE_REF',
    'f75bcf8a3b6a7be65cd88e379e10b43d346f75b5',
)
STAR_ORDER = ('cool', 'solar', 'hot')
LEVELS = p2.LEVELS
ANNULI = {
    'center': (0.00, 0.24),
    'inner_mid': (0.30, 0.48),
    'outer_mid': (0.55, 0.72),
    'inner_limb': (0.78, 0.90),
}

# Importing the Pass 2 runner installs its hardened camera handoff and batch-zoom
# implementation into p2. Redirect its evidence path for this Pass 3 run.
p2.OUTPUT_DIR = OUTPUT_DIR


def annulus_values(
    image: Image.Image,
    center_x: float,
    center_y: float,
    radius: float,
    inner: float,
    outer: float,
) -> list[float]:
    pixels = image.load()
    width, height = image.size
    values: list[float] = []
    r0 = radius * inner
    r1 = radius * outer
    left = max(0, int(center_x - r1 - 1))
    right = min(width - 1, int(center_x + r1 + 1))
    top = max(0, int(center_y - r1 - 1))
    bottom = min(height - 1, int(center_y + r1 + 1))
    for y in range(top, bottom + 1):
        for x in range(left, right + 1):
            distance = math.hypot(x - center_x, y - center_y)
            if r0 <= distance < r1:
                values.append(p2.luma(pixels[x, y]))
    p2.base.require(len(values) >= 20, f'annulus {inner:.2f}-{outer:.2f}: insufficient pixels')
    return values


def radial_profile(
    image: Image.Image,
    center_x: float,
    center_y: float,
    radius: float,
    start: float = 0.10,
    stop: float = 0.92,
    step: float = 0.04,
) -> list[dict[str, float]]:
    profile: list[dict[str, float]] = []
    current = start
    while current + step <= stop + 1e-9:
        values = annulus_values(image, center_x, center_y, radius, current, current + step)
        profile.append({
            'inner_r01': current,
            'outer_r01': current + step,
            'mean_luma': statistics.fmean(values),
            'std_luma': statistics.pstdev(values),
        })
        current += step
    return profile


def mean_profile_std(profile: list[dict[str, float]], start: float, stop: float) -> float:
    selected = [
        float(item['std_luma'])
        for item in profile
        if float(item['inner_r01']) >= start - 1e-9 and float(item['outer_r01']) <= stop + 1e-9
    ]
    p2.base.require(bool(selected), f'no radial detail bins in {start:.2f}-{stop:.2f}')
    return statistics.fmean(selected)


def analyze_radial(path: Path) -> dict[str, object]:
    image = Image.open(path).convert('RGB')
    geometry = p2.locate_photosphere(image)
    center_x = float(geometry['center_x'])
    center_y = float(geometry['center_y'])
    radius = float(geometry['equivalent_radius_px'])

    annulus_metrics: dict[str, dict[str, float]] = {}
    for name, (inner, outer) in ANNULI.items():
        values = annulus_values(image, center_x, center_y, radius, inner, outer)
        annulus_metrics[name] = {
            'mean_luma': statistics.fmean(values),
            'std_luma': statistics.pstdev(values),
            'pixel_count': float(len(values)),
        }

    profile = radial_profile(image, center_x, center_y, radius)
    outer_profile = [item for item in profile if float(item['inner_r01']) >= 0.66]
    outer_steps = [
        float(outer_profile[index + 1]['mean_luma']) - float(outer_profile[index]['mean_luma'])
        for index in range(len(outer_profile) - 1)
    ]
    outer_narrow_peaks = [
        float(outer_profile[index]['mean_luma']) - 0.5 * (
            float(outer_profile[index - 1]['mean_luma']) +
            float(outer_profile[index + 1]['mean_luma'])
        )
        for index in range(1, len(outer_profile) - 1)
    ]

    center = annulus_metrics['center']['mean_luma']
    inner_mid = annulus_metrics['inner_mid']['mean_luma']
    outer_mid = annulus_metrics['outer_mid']['mean_luma']
    inner_limb = annulus_metrics['inner_limb']['mean_luma']
    reference = max(inner_mid, 1.0)

    return {
        **geometry,
        'annuli': annulus_metrics,
        'radial_profile': profile,
        'center_to_inner_mid_ratio': center / max(inner_mid, 1.0),
        'inner_mid_to_outer_mid_ratio': inner_mid / max(outer_mid, 1.0),
        'outer_mid_to_inner_limb_ratio': outer_mid / max(inner_limb, 1.0),
        'center_to_inner_limb_ratio': center / max(inner_limb, 1.0),
        'inner_limb_to_center_ratio': inner_limb / max(center, 1.0),
        'detail_center_mid_std': mean_profile_std(profile, 0.22, 0.62),
        'detail_near_limb_std': mean_profile_std(profile, 0.70, 0.86),
        'max_outer_radial_rise_fraction': max([0.0, *outer_steps]) / reference,
        'max_outer_radial_drop_fraction': max([0.0, *[-value for value in outer_steps]]) / reference,
        'max_outer_narrow_peak_fraction': max([0.0, *outer_narrow_peaks]) / reference,
    }


def validate_radial(star: str, level: str, metric: dict[str, object]) -> None:
    diameter = float(metric['bright_photosphere_diameter_px'])
    target = p2.LEVEL_TARGETS[level]
    p2.base.require(
        target[0] <= diameter <= target[1],
        f'{star}/{level}: diameter {diameter:.1f}px misses {target[0]:.0f}-{target[1]:.0f}px target',
    )

    annuli = metric['annuli']
    assert isinstance(annuli, dict)
    center = float(annuli['center']['mean_luma'])
    inner_mid = float(annuli['inner_mid']['mean_luma'])
    outer_mid = float(annuli['outer_mid']['mean_luma'])
    inner_limb = float(annuli['inner_limb']['mean_luma'])

    # Allow sub-luma quantization noise, but reject genuine brightness reversal.
    p2.base.require(center + 0.6 >= inner_mid, f'{star}/{level}: center is dimmer than inner-mid')
    p2.base.require(inner_mid + 0.6 >= outer_mid, f'{star}/{level}: inner-mid is dimmer than outer-mid')
    p2.base.require(outer_mid + 0.6 >= inner_limb, f'{star}/{level}: outer-mid is dimmer than inner-limb')

    center_limb = float(metric['center_to_inner_limb_ratio'])
    if level == 'normal':
        p2.base.require(
            1.012 <= center_limb <= 1.30,
            f'{star}/{level}: center/limb ratio {center_limb:.3f} is too flat or too vignetted',
        )
    else:
        p2.base.require(
            1.025 <= center_limb <= 1.30,
            f'{star}/{level}: center/limb ratio {center_limb:.3f} is too flat or too vignetted',
        )
        p2.base.require(
            1.001 <= float(metric['center_to_inner_mid_ratio']) <= 1.14,
            f'{star}/{level}: central lift is missing or hotspot-like',
        )
        p2.base.require(
            1.002 <= float(metric['inner_mid_to_outer_mid_ratio']) <= 1.16,
            f'{star}/{level}: mid-radius luminance slope is missing or excessive',
        )
        p2.base.require(
            1.006 <= float(metric['outer_mid_to_inner_limb_ratio']) <= 1.22,
            f'{star}/{level}: limb transition is flat or planet-dark',
        )

    p2.base.require(
        0.77 <= float(metric['inner_limb_to_center_ratio']) <= 0.988,
        f'{star}/{level}: inner limb is either too dark or indistinguishable from center',
    )

    # Hard-ring checks intentionally inspect only the outer disk and reject a
    # narrow pre-silhouette spike/drop, not the desired broad luminance slope.
    rise_limit = 0.065 if level == 'normal' else 0.040
    drop_limit = 0.095 if level == 'normal' else 0.070
    peak_limit = 0.050 if level == 'normal' else 0.030
    p2.base.require(
        float(metric['max_outer_radial_rise_fraction']) <= rise_limit,
        f'{star}/{level}: outer radial profile contains a bright-ring rise',
    )
    p2.base.require(
        float(metric['max_outer_radial_drop_fraction']) <= drop_limit,
        f'{star}/{level}: outer radial profile contains a dark outline/ring drop',
    )
    p2.base.require(
        float(metric['max_outer_narrow_peak_fraction']) <= peak_limit,
        f'{star}/{level}: outer radial profile contains a narrow annulus peak',
    )

    if level != 'normal':
        center_detail = float(metric['detail_center_mid_std'])
        limb_detail = float(metric['detail_near_limb_std'])
        p2.base.require(center_detail >= 0.08, f'{star}/{level}: center/mid surface detail vanished')
        p2.base.require(
            limb_detail <= center_detail * 0.94 + 0.05,
            f'{star}/{level}: near-limb detail is not clearly compressed relative to center/mid',
        )
        p2.base.require(
            limb_detail >= center_detail * 0.12 - 0.05,
            f'{star}/{level}: near-limb detail collapses into a smooth ring',
        )


def make_contact_sheet(
    paths: dict[str, dict[str, Path]],
    radial: dict[str, dict[str, dict[str, object]]],
    output_path: Path,
) -> None:
    width = p2.base.VIEWPORT_WIDTH
    crop_height = 430
    label_height = 58
    sheet = Image.new('RGB', (width * 3, (crop_height + label_height) * 3), '#080b12')
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(LEVELS):
        for column, star in enumerate(STAR_ORDER):
            image = Image.open(paths[star][level]).convert('RGB')
            top = max(0, image.height // 2 - crop_height // 2)
            crop = image.crop((0, top, image.width, min(image.height, top + crop_height)))
            y = row * (crop_height + label_height) + label_height
            sheet.paste(crop, (column * width, y))
            metric = radial[star][level]
            text = (
                f'{star} {p2.STAR_MASSES[star]:g} M_sun / {level} / '
                f'{float(metric["bright_photosphere_diameter_px"]):.1f}px\n'
                f'C/L {float(metric["center_to_inner_limb_ratio"]):.3f} / '
                f'detail {float(metric["detail_center_mid_std"]):.2f} -> '
                f'{float(metric["detail_near_limb_std"]):.2f}'
            )
            draw.multiline_text(
                (column * width + 8, row * (crop_height + label_height) + 8),
                text,
                fill='white',
                spacing=3,
            )
    sheet.save(output_path)


def make_extreme_ab_sheet(
    baseline_paths: dict[str, dict[str, Path]],
    current_paths: dict[str, dict[str, Path]],
    output_path: Path,
) -> None:
    width = p2.base.VIEWPORT_WIDTH
    crop_height = 430
    label_height = 34
    sheet = Image.new('RGB', (width * 3, (crop_height + label_height) * 2), '#080b12')
    draw = ImageDraw.Draw(sheet)
    for row, (revision, paths) in enumerate((('Pass 2', baseline_paths), ('Pass 3', current_paths))):
        for column, star in enumerate(STAR_ORDER):
            image = Image.open(paths[star]['extreme']).convert('RGB')
            top = max(0, image.height // 2 - crop_height // 2)
            crop = image.crop((0, top, image.width, min(image.height, top + crop_height)))
            y = row * (crop_height + label_height) + label_height
            sheet.paste(crop, (column * width, y))
            draw.text(
                (column * width + 8, row * (crop_height + label_height) + 10),
                f'{revision} / {star}',
                fill='white',
            )
    sheet.save(output_path)


def print_metrics(radial: dict[str, dict[str, dict[str, object]]]) -> None:
    print('Pass 3 radial metrics:')
    for level in LEVELS:
        print(f'  {level}:')
        for star in STAR_ORDER:
            metric = radial[star][level]
            annuli = metric['annuli']
            assert isinstance(annuli, dict)
            print(
                f'    {star} {p2.STAR_MASSES[star]:g} M_sun: '
                f'diameter={float(metric["bright_photosphere_diameter_px"]):.1f}px, '
                f'luma={float(annuli["center"]["mean_luma"]):.2f}/'
                f'{float(annuli["inner_mid"]["mean_luma"]):.2f}/'
                f'{float(annuli["outer_mid"]["mean_luma"]):.2f}/'
                f'{float(annuli["inner_limb"]["mean_luma"]):.2f}, '
                f'C/L={float(metric["center_to_inner_limb_ratio"]):.3f}, '
                f'detail={float(metric["detail_center_mid_std"]):.3f}->'
                f'{float(metric["detail_near_limb_std"]):.3f}, '
                f'ring rise/drop/peak='
                f'{float(metric["max_outer_radial_rise_fraction"]):.4f}/'
                f'{float(metric["max_outer_radial_drop_fraction"]):.4f}/'
                f'{float(metric["max_outer_narrow_peak_fraction"]):.4f}'
            )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    p2.base.wait_for_url(p2.base.CURRENT_URL)
    driver = p2.base.make_driver()
    current_paths: dict[str, dict[str, Path]] = {star: {} for star in STAR_ORDER}
    baseline_paths: dict[str, dict[str, Path]] = {star: {} for star in STAR_ORDER}
    zoom_steps: dict[str, int] = {}

    try:
        for level in LEVELS:
            steps, diameter = p2.calibrate_zoom_steps(
                driver,
                p2.base.CURRENT_URL,
                p2.LEVEL_TARGETS[level],
            )
            zoom_steps[level] = steps
            print(f'Pass 3 zoom calibration {level}: {steps} wheel steps -> {diameter:.1f}px')

        for star in STAR_ORDER:
            for level in LEVELS:
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
                for level in LEVELS:
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
    current_radial = {
        star: {level: analyze_radial(path) for level, path in levels.items()}
        for star, levels in current_paths.items()
    }
    baseline_radial = {
        star: {level: analyze_radial(path) for level, path in levels.items()}
        for star, levels in baseline_paths.items()
    }

    payload = {
        'viewport': {'width': p2.base.VIEWPORT_WIDTH, 'height': p2.base.VIEWPORT_HEIGHT},
        'baseline_ref': BASELINE_REF,
        'zoom_steps': zoom_steps,
        'targets_px': p2.LEVEL_TARGETS,
        'baseline_surface': baseline_surface,
        'current_surface': current_surface,
        'baseline_radial': baseline_radial,
        'current_radial': current_radial,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    make_contact_sheet(current_paths, current_radial, OUTPUT_DIR / 'mobile-pass3-contact-sheet.png')
    make_extreme_ab_sheet(
        baseline_paths,
        current_paths,
        OUTPUT_DIR / 'mobile-pass2-vs-pass3-extreme.png',
    )
    print_metrics(current_radial)

    for star in STAR_ORDER:
        for level in LEVELS:
            validate_radial(star, level, current_radial[star][level])

            # Pass 3 may redistribute luminance radially, but it must keep Pass 2
            # topology, overall footprint, and temperature identity intact.
            baseline_diameter = float(baseline_surface[star][level]['bright_photosphere_diameter_px'])
            current_diameter = float(current_surface[star][level]['bright_photosphere_diameter_px'])
            p2.base.require(
                abs(current_diameter - baseline_diameter) / max(baseline_diameter, 1.0) <= 0.10,
                f'{star}/{level}: photosphere footprint changed by more than 10% versus Pass 2',
            )
            for channel in ('hue_r', 'hue_g', 'hue_b'):
                p2.base.require(
                    abs(
                        float(current_surface[star][level][channel]) -
                        float(baseline_surface[star][level][channel])
                    ) <= 0.025,
                    f'{star}/{level}: temperature identity changed ({channel})',
                )
            p2.base.require(
                float(current_surface[star][level]['largest_dark_component_span_fraction']) <= 0.70,
                f'{star}/{level}: topology-free surface regressed into a large dark network',
            )

    print('stellar photosphere Pass 3 radial emission mobile regression: ok')
    print(f'  viewport: {p2.base.VIEWPORT_WIDTH}x{p2.base.VIEWPORT_HEIGHT}')
    print(f'  baseline: {BASELINE_REF}')
    print(f'  zoom steps: {zoom_steps}')


if __name__ == '__main__':
    main()
