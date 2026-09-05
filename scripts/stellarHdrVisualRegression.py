#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import shutil
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageDraw
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

import stellarGranulationLodVisualRegression as lod
import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-hdr-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_HDR_BASELINE_REF',
    'fe1d138268a40ce7707df64ac60a0ab384a995bc',
)
ZOOM_LEVELS = {
    'normal': 0,
    'large': -4,
}
STAR_ORDER = ('cool', 'solar', 'hot')


@contextmanager
def baseline_preview(ref: str):
    worktree = Path('/tmp/3bp-stellar-hdr-baseline')
    log_path = OUTPUT_DIR / 'baseline-preview.log'
    if worktree.exists():
        shutil.rmtree(worktree, ignore_errors=True)

    base.run(['git', 'fetch', 'origin', 'main', '--depth=50'])
    base.run(['git', 'worktree', 'add', '--detach', str(worktree), ref])
    try:
        node_modules = base.ROOT / 'node_modules'
        base.require(node_modules.exists(), 'root node_modules is required for baseline build')
        os.symlink(node_modules, worktree / 'node_modules', target_is_directory=True)

        harness = Path('src/visualRegression/StellarTopologyVisualHarness.tsx')
        shutil.copy2(base.ROOT / harness, worktree / harness)

        base.run([str(node_modules / '.bin' / 'vite'), 'build'], cwd=worktree)
        with base.preview_server(worktree, base.BASELINE_PORT, log_path) as root_url:
            yield root_url
    finally:
        try:
            if (worktree / 'node_modules').is_symlink():
                (worktree / 'node_modules').unlink()
        except FileNotFoundError:
            pass
        base.subprocess.run(
            ['git', 'worktree', 'remove', '--force', str(worktree)],
            cwd=base.ROOT,
            check=False,
        )
        shutil.rmtree(worktree, ignore_errors=True)


def prepare_temperature_scene(driver, root_url: str):
    driver.get(base.harness_url(root_url))
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__setStellarVisualStage === "function"'
        )
    )
    driver.execute_async_script(
        '''
        const done = arguments[arguments.length - 1];
        window.__setStellarVisualStage('temperature');
        const waitForStage = () => {
          if (document.body.dataset.visualStage !== 'temperature') {
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


def capture_level(driver, label: str, root_url: str, wheel_steps: int) -> Path:
    canvas = prepare_temperature_scene(driver, root_url)
    lod.apply_zoom(driver, canvas, wheel_steps, settle_frames=45)
    path = OUTPUT_DIR / f'{label}-mobile.png'
    base.require(bool(canvas.screenshot(str(path))) and path.exists(), f'{label}: capture failed')
    return path


def luma(rgb: tuple[int, int, int]) -> float:
    return base.luminance(rgb)


def chroma(rgb: tuple[int, int, int]) -> float:
    peak = max(rgb)
    return (peak - min(rgb)) / max(float(peak), 1.0)


def locate_star(image: Image.Image, index: int) -> tuple[float, float, float]:
    width, height = image.size
    left = int(index * width / 3)
    right = int((index + 1) * width / 3)
    top = max(0, height // 2 - min(210, height // 3))
    bottom = min(height, height // 2 + min(210, height // 3))
    pixels = image.load()

    weighted_x = 0.0
    weighted_y = 0.0
    weight_sum = 0.0
    bright_count = 0
    for y in range(top, bottom):
        for x in range(left, right):
            value = luma(pixels[x, y])
            weight = max(value - 42.0, 0.0)
            if weight <= 0:
                continue
            weighted_x += x * weight
            weighted_y += y * weight
            weight_sum += weight
            if value >= 82:
                bright_count += 1

    base.require(weight_sum > 0 and bright_count >= 20, f'star {index}: unable to locate photosphere')
    center_x = weighted_x / weight_sum
    center_y = weighted_y / weight_sum
    equivalent_radius = math.sqrt(bright_count / math.pi)
    return center_x, center_y, equivalent_radius


def analyze_star(image: Image.Image, index: int) -> dict[str, float]:
    pixels = image.load()
    width, height = image.size
    center_x, center_y, radius = locate_star(image, index)
    core_radius = max(radius * 0.72, 3.0)
    center_radius = max(radius * 0.32, 2.0)
    left = max(1, int(center_x - core_radius - 1))
    right = min(width - 2, int(center_x + core_radius + 2))
    top = max(1, int(center_y - core_radius - 1))
    bottom = min(height - 2, int(center_y + core_radius + 2))

    rgb_sum = [0.0, 0.0, 0.0]
    luma_sum = 0.0
    chroma_sum = 0.0
    core_count = 0
    white_blob_count = 0
    center_white_count = 0
    center_count = 0
    neighbor_delta_sum = 0.0
    neighbor_delta_count = 0

    for y in range(top, bottom + 1):
        for x in range(left, right + 1):
            distance = math.hypot(x - center_x, y - center_y)
            if distance > core_radius:
                continue
            rgb = pixels[x, y]
            value = luma(rgb)
            if value < 70:
                continue

            core_count += 1
            luma_sum += value
            chroma_sum += chroma(rgb)
            for channel in range(3):
                rgb_sum[channel] += rgb[channel]
            if value >= 225 and chroma(rgb) <= 0.055:
                white_blob_count += 1

            if distance <= center_radius:
                center_count += 1
                if value >= 225 and chroma(rgb) <= 0.055:
                    center_white_count += 1

            right_luma = luma(pixels[x + 1, y])
            down_luma = luma(pixels[x, y + 1])
            if value >= 100 and right_luma >= 75:
                neighbor_delta_sum += abs(value - right_luma)
                neighbor_delta_count += 1
            if value >= 100 and down_luma >= 75:
                neighbor_delta_sum += abs(value - down_luma)
                neighbor_delta_count += 1

    base.require(core_count >= 20, f'star {index}: insufficient photosphere core pixels')
    mean_rgb = [value / core_count for value in rgb_sum]
    channel_sum = max(sum(mean_rgb), 1.0)
    return {
        'center_x': center_x,
        'center_y': center_y,
        'equivalent_radius_px': radius,
        'mean_luma': luma_sum / core_count,
        'surface_neighbor_contrast': neighbor_delta_sum / max(neighbor_delta_count, 1),
        'mean_chroma': chroma_sum / core_count,
        'white_blob_fraction': white_blob_count / core_count,
        'center_white_fraction': center_white_count / max(center_count, 1),
        'hue_r': mean_rgb[0] / channel_sum,
        'hue_g': mean_rgb[1] / channel_sum,
        'hue_b': mean_rgb[2] / channel_sum,
    }


def analyze(path: Path) -> dict[str, dict[str, float]]:
    image = Image.open(path).convert('RGB')
    return {
        name: analyze_star(image, index)
        for index, name in enumerate(STAR_ORDER)
    }


def hue_distance(a: dict[str, float], b: dict[str, float]) -> float:
    return math.sqrt(sum((a[channel] - b[channel]) ** 2 for channel in ('hue_r', 'hue_g', 'hue_b')))


def validate(metrics: dict[str, dict[str, dict[str, dict[str, float]]]]) -> None:
    for level in ZOOM_LEVELS:
        baseline = metrics['baseline'][level]
        current = metrics['current'][level]
        for star in STAR_ORDER:
            before = baseline[star]
            after = current[star]
            luma_tolerance = max(before['mean_luma'] * 0.18, 9.0)
            base.require(
                abs(after['mean_luma'] - before['mean_luma']) <= luma_tolerance,
                f'{level}/{star}: photosphere mean luminance drifted too far: '
                f"{before['mean_luma']:.2f} -> {after['mean_luma']:.2f}",
            )
            # Pass 1 intentionally removes the old cellular lane contrast. HDR
            # validation still requires visible local inhomogeneity, while the
            # dedicated Pass 1 gate verifies crack/minima removal and broad detail.
            base.require(
                after['surface_neighbor_contrast'] >= 0.12,
                f'{level}/{star}: photosphere became locally flat after HDR calibration: '
                f"{after['surface_neighbor_contrast']:.3f}",
            )
            base.require(
                after['white_blob_fraction'] <= min(0.38, before['white_blob_fraction'] + 0.10),
                f'{level}/{star}: photosphere expanded into a white clipped blob: '
                f"{before['white_blob_fraction']:.4f} -> {after['white_blob_fraction']:.4f}",
            )
            base.require(
                after['center_white_fraction'] <= min(0.62, before['center_white_fraction'] + 0.16),
                f'{level}/{star}: white-hot treatment spread beyond the limited center: '
                f"{before['center_white_fraction']:.4f} -> {after['center_white_fraction']:.4f}",
            )
            radius_tolerance = max(before['equivalent_radius_px'] * 0.14, 2.0)
            base.require(
                abs(after['equivalent_radius_px'] - before['equivalent_radius_px']) <= radius_tolerance,
                f'{level}/{star}: bright photosphere footprint changed too much: '
                f"{before['equivalent_radius_px']:.2f}px -> {after['equivalent_radius_px']:.2f}px",
            )

        cool = current['cool']
        solar = current['solar']
        hot = current['hot']
        baseline_cool_solar = hue_distance(baseline['cool'], baseline['solar'])
        baseline_solar_hot = hue_distance(baseline['solar'], baseline['hot'])
        current_cool_solar = hue_distance(cool, solar)
        current_solar_hot = hue_distance(solar, hot)

        base.require(cool['hue_r'] > cool['hue_b'] + 0.055, f'{level}: cool star lost its warm temperature hue')
        base.require(solar['hue_r'] > solar['hue_b'] + 0.008, f'{level}: solar-like star became neutral white')
        base.require(hot['hue_b'] >= hot['hue_r'] - 0.010, f'{level}: hot star lost its blue-white bias')
        base.require(
            current_cool_solar >= max(0.018, baseline_cool_solar * 0.72),
            f'{level}: cool/solar temperature hues collapsed: {current_cool_solar:.5f}',
        )
        base.require(
            current_solar_hot >= max(0.010, baseline_solar_hot * 0.65),
            f'{level}: solar/hot temperature hues collapsed: {current_solar_hot:.5f}',
        )
        base.require(cool['mean_chroma'] >= 0.08, f'{level}: cool star chroma is too weak')
        base.require(solar['mean_chroma'] >= 0.035, f'{level}: solar star chroma is too weak')
        base.require(hot['mean_chroma'] >= 0.012, f'{level}: hot star chroma is too weak')


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
        draw.text((margin, y), f'Pass 5 main / {level}', fill=(235, 238, 245))
        draw.text((margin * 2 + sample.width, y), f'Pass 6 HDR / {level}', fill=(235, 238, 245))
        sheet.paste(Image.open(paths['baseline'][level]).convert('RGB'), (margin, y + label_height))
        sheet.paste(Image.open(paths['current'][level]).convert('RGB'), (margin * 2 + sample.width, y + label_height))
    sheet.save(OUTPUT_DIR / 'mobile-temperature-hdr-ab.png')


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base.OUTPUT_DIR = OUTPUT_DIR
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    paths: dict[str, dict[str, Path]] = {'baseline': {}, 'current': {}}
    try:
        with baseline_preview(BASELINE_REF) as baseline_url:
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
        'scene': 'stellar-topology/temperature (0.35, 1, 8 solar masses)',
        'zoom_levels': ZOOM_LEVELS,
        'metrics': metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    print('stellar HDR / luminance / color mobile A/B regression: ok')
    for level in ('normal', 'large'):
        print(f'  {level}:')
        for star in STAR_ORDER:
            before = metrics['baseline'][level][star]
            after = metrics['current'][level][star]
            print(
                f"    {star}: luma {before['mean_luma']:.1f}->{after['mean_luma']:.1f}, "
                f"contrast {before['surface_neighbor_contrast']:.3f}->{after['surface_neighbor_contrast']:.3f}, "
                f"chroma {before['mean_chroma']:.3f}->{after['mean_chroma']:.3f}, "
                f"white {before['white_blob_fraction']:.3f}->{after['white_blob_fraction']:.3f}"
            )


if __name__ == '__main__':
    main()
