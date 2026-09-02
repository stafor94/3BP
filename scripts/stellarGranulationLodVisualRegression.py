#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-granulation-lod-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_GRANULATION_LOD_BASELINE_REF',
    '901b2dd596cb3a0f240853aa851981087f92ae04',
)
ZOOM_LEVELS = {
    'large': -8,
    'normal': 0,
    'small': 5,
}


def luma(rgb: tuple[int, int, int]) -> float:
    return base.luminance(rgb)


def prepare_scene(driver, root_url: str):
    driver.get(base.harness_url(root_url))
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__setStellarVisualStage === "function"'
        )
    )
    driver.execute_async_script(
        '''
        const done = arguments[arguments.length - 1];
        window.__setStellarVisualStage('separate');
        const waitForStage = () => {
          if (document.body.dataset.visualStage !== 'separate') {
            requestAnimationFrame(waitForStage);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)));
        };
        requestAnimationFrame(waitForStage);
        ''',
    )
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return arguments[0].width > 0 && arguments[0].height > 0',
            canvas,
        )
    )
    return canvas


def apply_zoom(driver, canvas, wheel_steps: int, delta: float = 100.0, settle_frames: int = 45):
    if wheel_steps == 0:
        driver.execute_async_script(
            '''
            const done = arguments[arguments.length - 1];
            let frames = arguments[0];
            const settle = () => {
              if (frames-- <= 0) { done(); return; }
              requestAnimationFrame(settle);
            };
            requestAnimationFrame(settle);
            ''',
            settle_frames,
        )
        return

    driver.execute_async_script(
        '''
        const element = arguments[0];
        let remaining = Math.abs(arguments[1]);
        const signedDelta = arguments[1] > 0 ? arguments[2] : -arguments[2];
        let settleFrames = arguments[3];
        const done = arguments[arguments.length - 1];

        const settle = () => {
          if (settleFrames-- <= 0) { done(); return; }
          requestAnimationFrame(settle);
        };
        const step = () => {
          if (remaining-- <= 0) {
            requestAnimationFrame(settle);
            return;
          }
          element.dispatchEvent(new WheelEvent('wheel', {
            deltaY: signedDelta,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
          }));
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        ''',
        canvas,
        wheel_steps,
        delta,
        settle_frames,
    )


def capture_level(driver, label: str, root_url: str, wheel_steps: int) -> Path:
    canvas = prepare_scene(driver, root_url)
    apply_zoom(driver, canvas, wheel_steps)
    path = OUTPUT_DIR / f'{label}-mobile.png'
    base.require(bool(canvas.screenshot(str(path))) and path.exists(), f'{label}: capture failed')
    return path


def analyze(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    blurred = image.filter(ImageFilter.GaussianBlur(radius=2.5))
    width, height = image.size
    crop_half_height = min(190, height // 3)
    top = height // 2 - crop_half_height
    roi = image.crop((0, top, width, height // 2 + crop_half_height))
    blur_roi = blurred.crop((0, top, width, height // 2 + crop_half_height))
    pixels = roi.load()
    blur_pixels = blur_roi.load()
    roi_width, roi_height = roi.size

    bright_pixels = 0
    very_bright_pixels = 0
    bright_luma_sum = 0.0
    neighbor_delta_sum = 0.0
    neighbor_delta_count = 0
    high_frequency_sum = 0.0
    high_frequency_count = 0
    lane_pixels = 0
    hue_r = 0.0
    hue_g = 0.0
    hue_b = 0.0
    hue_count = 0
    low_frequency_sum = 0.0
    low_frequency_sq_sum = 0.0
    low_frequency_count = 0
    half_core_counts = [0, 0]

    def luma_at(x: int, y: int) -> float:
        return luma(pixels[x, y])

    for y in range(1, roi_height - 1):
        for x in range(1, roi_width - 1):
            r, g, b = pixels[x, y]
            current_luma = luma((r, g, b))
            if current_luma >= 90:
                bright_pixels += 1
                bright_luma_sum += current_luma
                half_core_counts[0 if x < roi_width // 2 else 1] += 1
            if current_luma >= 180:
                very_bright_pixels += 1
            if current_luma >= 105:
                channel_sum = max(r + g + b, 1)
                hue_r += r / channel_sum
                hue_g += g / channel_sum
                hue_b += b / channel_sum
                hue_count += 1

            right_luma = luma_at(x + 1, y)
            down_luma = luma_at(x, y + 1)
            if current_luma >= 150 and right_luma >= 150:
                neighbor_delta_sum += abs(current_luma - right_luma)
                neighbor_delta_count += 1
            if current_luma >= 150 and down_luma >= 150:
                neighbor_delta_sum += abs(current_luma - down_luma)
                neighbor_delta_count += 1

            left_luma = luma_at(x - 1, y)
            up_luma = luma_at(x, y - 1)
            neighbors = (left_luma, right_luma, up_luma, down_luma)
            neighbor_mean = sum(neighbors) / 4.0
            if current_luma >= 120 and min(neighbors) >= 105:
                high_frequency_sum += abs(current_luma - neighbor_mean)
                high_frequency_count += 1
                brighter_neighbors = sum(value >= current_luma + 2.0 for value in neighbors)
                if neighbor_mean >= current_luma + 2.5 and brighter_neighbors >= 3:
                    lane_pixels += 1

            if current_luma >= 145:
                low_luma = luma(blur_pixels[x, y])
                low_frequency_sum += low_luma
                low_frequency_sq_sum += low_luma * low_luma
                low_frequency_count += 1

    area = max(roi_width * roi_height, 1)
    low_mean = low_frequency_sum / max(low_frequency_count, 1)
    low_variance = max(
        0.0,
        low_frequency_sq_sum / max(low_frequency_count, 1) - low_mean * low_mean,
    )
    equivalent_diameters = [2.0 * math.sqrt(count / math.pi) for count in half_core_counts]

    return {
        'width': width,
        'height': height,
        'bright_fraction': bright_pixels / area,
        'very_bright_fraction': very_bright_pixels / area,
        'bright_mean_luma': bright_luma_sum / max(bright_pixels, 1),
        'surface_neighbor_contrast': neighbor_delta_sum / max(neighbor_delta_count, 1),
        'high_frequency_energy': high_frequency_sum / max(high_frequency_count, 1),
        'lane_presence': lane_pixels / max(high_frequency_count, 1),
        'low_frequency_std': math.sqrt(low_variance),
        'hue_r': hue_r / max(hue_count, 1),
        'hue_g': hue_g / max(hue_count, 1),
        'hue_b': hue_b / max(hue_count, 1),
        'equivalent_core_diameter_px': sum(equivalent_diameters) / 2.0,
    }


def validate_level(level: str, baseline: dict[str, float | int], current: dict[str, float | int]):
    for metric, relative_tolerance, absolute_tolerance in (
        ('bright_fraction', 0.12, 0.0025),
        ('very_bright_fraction', 0.14, 0.0025),
    ):
        baseline_value = float(baseline[metric])
        current_value = float(current[metric])
        tolerance = max(abs(baseline_value) * relative_tolerance, absolute_tolerance)
        base.require(
            abs(current_value - baseline_value) <= tolerance,
            f'{level}: {metric} drifted beyond Pass 3 budget: '
            f'baseline={baseline_value:.6f} current={current_value:.6f} tolerance={tolerance:.6f}',
        )

    baseline_luma = float(baseline['bright_mean_luma'])
    current_luma = float(current['bright_mean_luma'])
    base.require(
        abs(current_luma - baseline_luma) <= max(abs(baseline_luma) * 0.10, 4.0),
        f'{level}: photosphere mean brightness changed too much: '
        f'baseline={baseline_luma:.3f} current={current_luma:.3f}',
    )

    hue_delta = sum(
        (float(current[channel]) - float(baseline[channel])) ** 2
        for channel in ('hue_r', 'hue_g', 'hue_b')
    ) ** 0.5
    base.require(hue_delta <= 0.025, f'{level}: stellar temperature hue drifted: {hue_delta:.5f}')

    diameter_delta = abs(
        float(current['equivalent_core_diameter_px']) -
        float(baseline['equivalent_core_diameter_px'])
    )
    base.require(
        diameter_delta <= max(float(baseline['equivalent_core_diameter_px']) * 0.12, 2.0),
        f'{level}: bright photosphere footprint changed too much: diameter delta={diameter_delta:.3f}px',
    )


def validate(metrics: dict[str, dict[str, dict[str, float | int]]]):
    for level in ZOOM_LEVELS:
        validate_level(level, metrics['baseline'][level], metrics['current'][level])

    large_base = metrics['baseline']['large']
    large_current = metrics['current']['large']
    base.require(
        float(large_current['high_frequency_energy']) >= float(large_base['high_frequency_energy']) * 0.55,
        'large: resolved close-up granulation lost too much Pass 2 fine structure',
    )
    base.require(
        float(large_current['lane_presence']) >= float(large_base['lane_presence']) * 0.45,
        'large: resolved close-up intergranular lanes were over-suppressed',
    )

    normal_current = metrics['current']['normal']
    base.require(
        float(normal_current['surface_neighbor_contrast']) >= 0.55,
        'normal: cellular photosphere became too smooth to read as surface structure',
    )
    base.require(
        float(normal_current['low_frequency_std']) >= 4.0,
        'normal: low-frequency photosphere structure is not measurable',
    )

    small_base = metrics['baseline']['small']
    small_current = metrics['current']['small']
    base.require(
        float(small_current['high_frequency_energy']) <= float(small_base['high_frequency_energy']) * 0.98 + 0.05,
        'small: derivative LOD did not reduce unresolved high-frequency energy versus Pass 2',
    )
    base.require(
        float(small_current['lane_presence']) <= float(small_base['lane_presence']) * 1.05 + 0.002,
        'small: thin lane minima became more prominent instead of anti-aliased',
    )
    base.require(
        float(small_current['low_frequency_std']) >= 2.0,
        'small: photosphere collapsed to a completely smooth luminous sphere',
    )


def capture_zoom_sweep(driver, root_url: str):
    canvas = prepare_scene(driver, root_url)
    apply_zoom(driver, canvas, -6, settle_frames=30)
    sweep = []
    for index in range(13):
        path = OUTPUT_DIR / f'zoom-sweep-{index:02d}.png'
        base.require(bool(canvas.screenshot(str(path))) and path.exists(), 'zoom sweep capture failed')
        metric = analyze(path)
        sweep.append({
            'index': index,
            'high_frequency_energy': metric['high_frequency_energy'],
            'lane_presence': metric['lane_presence'],
            'equivalent_core_diameter_px': metric['equivalent_core_diameter_px'],
        })
        if index < 12:
            apply_zoom(driver, canvas, 1, delta=35.0, settle_frames=5)

    for previous, current in zip(sweep, sweep[1:]):
        previous_hf = float(previous['high_frequency_energy'])
        current_hf = float(current['high_frequency_energy'])
        base.require(
            current_hf <= previous_hf * 1.45 + 0.35,
            'zoom sweep: high-frequency energy spikes while zooming out, indicating shimmer/popping: '
            f'{previous_hf:.4f} -> {current_hf:.4f}',
        )
    return sweep


def make_contact_sheet(paths: dict[str, dict[str, Path]]):
    first = Image.open(paths['baseline']['large']).convert('RGB')
    margin = 12
    label_height = 30
    row_height = first.height + label_height
    sheet = Image.new(
        'RGB',
        (first.width * 2 + margin * 3, row_height * 3 + margin * 2),
        (12, 14, 20),
    )
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(('large', 'normal', 'small')):
        y = margin + row * row_height
        draw.text((margin, y), f'Pass 2 baseline / {level}', fill=(235, 238, 245))
        draw.text((margin * 2 + first.width, y), f'Pass 3 screen-space LOD / {level}', fill=(235, 238, 245))
        baseline = Image.open(paths['baseline'][level]).convert('RGB')
        current = Image.open(paths['current'][level]).convert('RGB')
        sheet.paste(baseline, (margin, y + label_height))
        sheet.paste(current, (margin * 2 + first.width, y + label_height))
    sheet.save(OUTPUT_DIR / 'mobile-three-distance-contact-sheet.png')


def main():
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
        zoom_sweep = capture_zoom_sweep(driver, base.CURRENT_URL)
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
        'zoom_sweep': zoom_sweep,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    print('stellar screen-space granulation LOD mobile regression: ok')
    for level in ('large', 'normal', 'small'):
        baseline = metrics['baseline'][level]
        current = metrics['current'][level]
        print(
            f"  {level}: diameter {current['equivalent_core_diameter_px']:.1f}px, "
            f"HF {baseline['high_frequency_energy']:.3f}->{current['high_frequency_energy']:.3f}, "
            f"lanes {baseline['lane_presence']:.5f}->{current['lane_presence']:.5f}, "
            f"low-freq std {current['low_frequency_std']:.3f}"
        )
    print(
        '  zoom sweep HF: ' +
        ' -> '.join(f"{float(item['high_frequency_energy']):.3f}" for item in zoom_sweep)
    )


if __name__ == '__main__':
    main()
