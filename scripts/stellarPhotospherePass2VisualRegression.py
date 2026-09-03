#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import shutil
from collections import deque
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-pass2-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_PASS2_BASELINE_REF',
    '3b023b49bef317ab841f7758b6ddf69fa10812b1',
)
STAR_STAGES = {
    'cool': 'temperature-cool',
    'solar': 'temperature-solar',
    'hot': 'temperature-hot',
}
STAR_MASSES = {'cool': 0.35, 'solar': 1.0, 'hot': 8.0}
LEVELS = ('normal', 'enlarged', 'extreme')
LEVEL_TARGETS = {
    'normal': (55.0, 90.0),
    'enlarged': (150.0, 210.0),
    'extreme': (320.0, 380.0),
}


def luma(rgb: tuple[int, int, int]) -> float:
    return base.luminance(rgb)


@contextmanager
def baseline_preview(ref: str):
    worktree = Path('/tmp/3bp-stellar-pass2-baseline')
    log_path = OUTPUT_DIR / 'baseline-preview.log'
    if worktree.exists():
        shutil.rmtree(worktree, ignore_errors=True)

    base.run(['git', 'fetch', 'origin', 'main', '--depth=50'])
    base.run(['git', 'worktree', 'add', '--detach', str(worktree), ref])
    try:
        node_modules = base.ROOT / 'node_modules'
        base.require(node_modules.exists(), 'root node_modules is required for baseline build')
        os.symlink(node_modules, worktree / 'node_modules', target_is_directory=True)

        # Use exactly the same focused fixture on Pass 1 and Pass 2. Only the
        # stellar photosphere implementation differs between the two previews.
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


def prepare_focus_scene(driver, root_url: str, stage: str):
    driver.get(base.harness_url(root_url))
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__setStellarVisualStage === "function"'
        )
    )
    driver.execute_async_script(
        '''
        const stage = arguments[0];
        const done = arguments[arguments.length - 1];
        window.__setStellarVisualStage(stage);
        const waitForStage = () => {
          if (document.body.dataset.visualStage !== stage) {
            requestAnimationFrame(waitForStage);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)));
        };
        requestAnimationFrame(waitForStage);
        ''',
        stage,
    )
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return arguments[0].width > 0 && arguments[0].height > 0',
            canvas,
        )
    )
    return canvas


def apply_centered_zoom(
    driver,
    canvas,
    wheel_steps: int,
    delta: float = 70.0,
    settle_frames: int = 45,
):
    driver.execute_async_script(
        '''
        const element = arguments[0];
        let remaining = Math.abs(arguments[1]);
        const signedDelta = arguments[1] > 0 ? arguments[2] : -arguments[2];
        let settleFrames = arguments[3];
        const done = arguments[arguments.length - 1];
        const rect = element.getBoundingClientRect();
        const clientX = rect.left + rect.width * 0.5;
        const clientY = rect.top + rect.height * 0.5;

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
            clientX,
            clientY,
            view: window,
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


def nearest_bright_seed(image: Image.Image) -> tuple[int, int]:
    width, height = image.size
    cx, cy = width // 2, height // 2
    best = (cx, cy)
    best_score = -1.0
    for y in range(max(0, cy - 120), min(height, cy + 121)):
        for x in range(max(0, cx - 120), min(width, cx + 121)):
            value = luma(image.getpixel((x, y)))
            score = value - math.hypot(x - cx, y - cy) * 0.08
            if score > best_score:
                best, best_score = (x, y), score
    base.require(best_score >= 72, 'focused star: no bright photosphere near viewport center')
    return best


def locate_photosphere(image: Image.Image) -> dict[str, float | int]:
    width, height = image.size
    pixels = image.load()
    seed = nearest_bright_seed(image)
    threshold = 82.0
    queue: deque[tuple[int, int]] = deque([seed])
    visited = {seed}
    component: list[tuple[int, int]] = []

    while queue:
        x, y = queue.popleft()
        if luma(pixels[x, y]) < threshold:
            continue
        component.append((x, y))
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                continue
            point = (nx, ny)
            if point in visited:
                continue
            visited.add(point)
            queue.append(point)

    base.require(len(component) >= 80, 'focused star: bright photosphere component is too small')
    center_x = sum(point[0] for point in component) / len(component)
    center_y = sum(point[1] for point in component) / len(component)
    radius = math.sqrt(len(component) / math.pi)
    xs = [point[0] for point in component]
    ys = [point[1] for point in component]
    return {
        'center_x': center_x,
        'center_y': center_y,
        'equivalent_radius_px': radius,
        'bright_photosphere_diameter_px': radius * 2.0,
        'component_pixels': len(component),
        'bbox_width_px': max(xs) - min(xs) + 1,
        'bbox_height_px': max(ys) - min(ys) + 1,
    }


def screenshot_canvas(canvas, path: Path) -> Image.Image:
    base.require(bool(canvas.screenshot(str(path))) and path.exists(), f'{path}: capture failed')
    return Image.open(path).convert('RGB')


def calibrate_zoom_steps(driver, root_url: str, target: tuple[float, float]) -> tuple[int, float]:
    canvas = prepare_focus_scene(driver, root_url, STAR_STAGES['solar'])
    temp_path = OUTPUT_DIR / 'zoom-calibration.png'
    steps = 0
    image = screenshot_canvas(canvas, temp_path)
    diameter = float(locate_photosphere(image)['bright_photosphere_diameter_px'])

    while diameter < target[0] and abs(steps) < 72:
        apply_centered_zoom(driver, canvas, -1, delta=70.0, settle_frames=12)
        steps -= 1
        image = screenshot_canvas(canvas, temp_path)
        diameter = float(locate_photosphere(image)['bright_photosphere_diameter_px'])

    base.require(
        target[0] <= diameter <= target[1],
        f'zoom calibration missed {target[0]:.0f}-{target[1]:.0f}px target: '
        f'{diameter:.1f}px at {steps} steps',
    )
    return steps, diameter


def capture_state(
    driver,
    root_url: str,
    revision: str,
    star: str,
    level: str,
    wheel_steps: int,
) -> Path:
    canvas = prepare_focus_scene(driver, root_url, STAR_STAGES[star])
    apply_centered_zoom(driver, canvas, wheel_steps, delta=70.0, settle_frames=55)
    path = OUTPUT_DIR / f'{revision}-{star}-{level}-mobile.png'
    screenshot_canvas(canvas, path)
    return path


def connected_dark_metric(
    residuals: dict[tuple[int, int], float],
    threshold: float,
    core_count: int,
    diameter: float,
) -> tuple[float, float, float]:
    dark = {point for point, residual in residuals.items() if residual <= -threshold}
    dark_fraction = len(dark) / max(core_count, 1)
    largest_count = 0
    largest_span = 0.0

    while dark:
        start = dark.pop()
        queue = deque([start])
        component = [start]
        while queue:
            x, y = queue.popleft()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor not in dark:
                    continue
                dark.remove(neighbor)
                queue.append(neighbor)
                component.append(neighbor)
        if len(component) > largest_count:
            largest_count = len(component)
            xs = [point[0] for point in component]
            ys = [point[1] for point in component]
            largest_span = max(max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)

    return (
        dark_fraction,
        largest_count / max(core_count, 1),
        largest_span / max(diameter, 1.0),
    )


def analyze(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    geometry = locate_photosphere(image)
    center_x = float(geometry['center_x'])
    center_y = float(geometry['center_y'])
    radius = float(geometry['equivalent_radius_px'])
    diameter = radius * 2.0
    core_radius = max(radius * 0.68, 4.0)

    local_blur_radius = max(1.2, diameter / 92.0)
    broad_blur_radius = max(2.5, diameter / 24.0)
    local_blur = image.filter(ImageFilter.GaussianBlur(radius=local_blur_radius))
    broad_blur = image.filter(ImageFilter.GaussianBlur(radius=broad_blur_radius))
    pixels = image.load()
    local_pixels = local_blur.load()
    broad_pixels = broad_blur.load()
    width, height = image.size

    lumas: list[float] = []
    broad_lumas: list[float] = []
    local_abs: list[float] = []
    high_frequency: list[float] = []
    rgb_sum = [0.0, 0.0, 0.0]
    residuals: dict[tuple[int, int], float] = {}
    minima = 0
    minima_candidates = 0

    left = max(2, int(center_x - core_radius))
    right = min(width - 3, int(center_x + core_radius))
    top = max(2, int(center_y - core_radius))
    bottom = min(height - 3, int(center_y + core_radius))
    for y in range(top, bottom + 1):
        for x in range(left, right + 1):
            if math.hypot(x - center_x, y - center_y) > core_radius:
                continue
            rgb = pixels[x, y]
            value = luma(rgb)
            if value < 70:
                continue
            local_value = luma(local_pixels[x, y])
            broad_value = luma(broad_pixels[x, y])
            residual = value - local_value
            residuals[(x, y)] = residual
            lumas.append(value)
            broad_lumas.append(broad_value)
            local_abs.append(abs(residual))
            for channel in range(3):
                rgb_sum[channel] += rgb[channel]

            neighbors = [
                luma(pixels[x - 1, y]),
                luma(pixels[x + 1, y]),
                luma(pixels[x, y - 1]),
                luma(pixels[x, y + 1]),
            ]
            high_frequency.append(abs(value - sum(neighbors) * 0.25))
            minima_candidates += 1
            if all(value + 0.8 < neighbor for neighbor in neighbors):
                minima += 1

    base.require(len(lumas) >= 80, f'{path}: insufficient photosphere core pixels')
    mean_rgb = [value / len(lumas) for value in rgb_sum]
    channel_sum = max(sum(mean_rgb), 1.0)
    local_contrast = sum(local_abs) / len(local_abs)
    dark_threshold = max(1.0, local_contrast * 1.05)
    dark_fraction, largest_dark_fraction, largest_dark_span = connected_dark_metric(
        residuals,
        dark_threshold,
        len(lumas),
        diameter,
    )
    broad_mean = sum(broad_lumas) / len(broad_lumas)

    return {
        **geometry,
        'mean_luma': sum(lumas) / len(lumas),
        'broad_variation_std': math.sqrt(
            sum((value - broad_mean) ** 2 for value in broad_lumas) / len(broad_lumas)
        ),
        'granulation_contrast': local_contrast,
        'high_frequency_energy': sum(high_frequency) / len(high_frequency),
        'local_minima_fraction': minima / max(minima_candidates, 1),
        'dark_residual_fraction': dark_fraction,
        'largest_dark_component_fraction': largest_dark_fraction,
        'largest_dark_component_span_fraction': largest_dark_span,
        'hue_r': mean_rgb[0] / channel_sum,
        'hue_g': mean_rgb[1] / channel_sum,
        'hue_b': mean_rgb[2] / channel_sum,
        'local_blur_radius_px': local_blur_radius,
        'broad_blur_radius_px': broad_blur_radius,
    }


def validate_pair(
    star: str,
    level: str,
    baseline: dict[str, float | int],
    current: dict[str, float | int],
) -> None:
    diameter = float(current['bright_photosphere_diameter_px'])
    target = LEVEL_TARGETS[level]
    base.require(target[0] <= diameter <= target[1], f'{star}/{level}: diameter {diameter:.1f}px misses target')

    baseline_diameter = float(baseline['bright_photosphere_diameter_px'])
    base.require(
        abs(diameter - baseline_diameter) / max(baseline_diameter, 1.0) <= 0.08,
        f'{star}/{level}: bright footprint changed versus Pass 1',
    )
    baseline_luma = float(baseline['mean_luma'])
    current_luma = float(current['mean_luma'])
    base.require(
        abs(current_luma - baseline_luma) / max(baseline_luma, 1.0) <= 0.08,
        f'{star}/{level}: mean photosphere luminance drifted by more than 8%',
    )
    for channel in ('hue_r', 'hue_g', 'hue_b'):
        base.require(
            abs(float(current[channel]) - float(baseline[channel])) <= 0.025,
            f'{star}/{level}: temperature hue identity changed ({channel})',
        )

    contrast = float(current['granulation_contrast'])
    lower, upper = {
        'normal': (0.08, 1.60),
        'enlarged': (0.16, 2.50),
        'extreme': (0.22, 3.40),
    }[level]
    base.require(lower <= contrast <= upper, f'{star}/{level}: granulation contrast {contrast:.3f} outside {lower:.2f}-{upper:.2f}')
    if level != 'normal':
        base.require(
            contrast >= float(baseline['granulation_contrast']) * 1.10,
            f'{star}/{level}: primary granulation did not recover enough detail over Pass 1',
        )

    base.require(float(current['broad_variation_std']) >= 0.35, f'{star}/{level}: broad convection vanished')
    base.require(float(current['high_frequency_energy']) <= 2.60, f'{star}/{level}: high-frequency energy reads as grain/static')
    base.require(float(current['local_minima_fraction']) <= 0.10, f'{star}/{level}: excessive local minima suggest noisy pits')
    base.require(float(current['dark_residual_fraction']) <= 0.34, f'{star}/{level}: dark trough coverage is excessive')
    base.require(float(current['largest_dark_component_fraction']) <= 0.20, f'{star}/{level}: one connected dark structure is too dominant')
    base.require(float(current['largest_dark_component_span_fraction']) <= 0.70, f'{star}/{level}: a dark structure spans too much of the photosphere')


def make_contact_sheet(
    paths: dict[str, dict[str, Path]],
    metrics: dict[str, dict[str, dict[str, float | int]]],
    output_path: Path,
) -> None:
    cell_width = base.VIEWPORT_WIDTH
    crop_height = 430
    label_height = 44
    stars = ('cool', 'solar', 'hot')
    sheet = Image.new('RGB', (cell_width * 3, (crop_height + label_height) * 3), '#080b12')
    draw = ImageDraw.Draw(sheet)

    for row, level in enumerate(LEVELS):
        for column, star in enumerate(stars):
            image = Image.open(paths[star][level]).convert('RGB')
            top = max(0, image.height // 2 - crop_height // 2)
            crop = image.crop((0, top, image.width, min(image.height, top + crop_height)))
            y = row * (crop_height + label_height) + label_height
            sheet.paste(crop, (column * cell_width, y))
            metric = metrics[star][level]
            text = (
                f'{star} {STAR_MASSES[star]:g} M_sun / {level} / '
                f'{float(metric["bright_photosphere_diameter_px"]):.1f}px / '
                f'gran {float(metric["granulation_contrast"]):.2f}'
            )
            draw.text((column * cell_width + 8, row * (crop_height + label_height) + 12), text, fill='white')
    sheet.save(output_path)


def make_extreme_ab_sheet(
    baseline_paths: dict[str, dict[str, Path]],
    current_paths: dict[str, dict[str, Path]],
    output_path: Path,
) -> None:
    stars = ('cool', 'solar', 'hot')
    width = base.VIEWPORT_WIDTH
    crop_height = 430
    label_height = 32
    sheet = Image.new('RGB', (width * 3, (crop_height + label_height) * 2), '#080b12')
    draw = ImageDraw.Draw(sheet)
    for row, (revision, paths) in enumerate((('Pass 1', baseline_paths), ('Pass 2', current_paths))):
        for column, star in enumerate(stars):
            image = Image.open(paths[star]['extreme']).convert('RGB')
            top = max(0, image.height // 2 - crop_height // 2)
            crop = image.crop((0, top, image.width, min(image.height, top + crop_height)))
            y = row * (crop_height + label_height) + label_height
            sheet.paste(crop, (column * width, y))
            draw.text((column * width + 8, row * (crop_height + label_height) + 9), f'{revision} / {star}', fill='white')
    sheet.save(output_path)


def print_metrics(metrics: dict[str, dict[str, dict[str, float | int]]]) -> None:
    for level in LEVELS:
        print(f'  {level}:')
        for star in ('cool', 'solar', 'hot'):
            metric = metrics[star][level]
            print(
                f'    {star} {STAR_MASSES[star]:g} M_sun: '
                f'diameter={float(metric["bright_photosphere_diameter_px"]):.1f}px, '
                f'gran={float(metric["granulation_contrast"]):.3f}, '
                f'broad={float(metric["broad_variation_std"]):.3f}, '
                f'HF={float(metric["high_frequency_energy"]):.3f}, '
                f'minima={float(metric["local_minima_fraction"]):.5f}, '
                f'dark-component={float(metric["largest_dark_component_fraction"]):.4f}/'
                f'{float(metric["largest_dark_component_span_fraction"]):.3f}'
            )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    current_paths: dict[str, dict[str, Path]] = {star: {} for star in STAR_STAGES}
    baseline_paths: dict[str, dict[str, Path]] = {star: {} for star in STAR_STAGES}
    zoom_steps: dict[str, int] = {}

    try:
        for level in LEVELS:
            steps, diameter = calibrate_zoom_steps(driver, base.CURRENT_URL, LEVEL_TARGETS[level])
            zoom_steps[level] = steps
            print(f'Pass 2 zoom calibration {level}: {steps} wheel steps -> {diameter:.1f}px')

        for star in STAR_STAGES:
            for level in LEVELS:
                current_paths[star][level] = capture_state(
                    driver, base.CURRENT_URL, 'current', star, level, zoom_steps[level]
                )

        with baseline_preview(BASELINE_REF) as baseline_url:
            for star in STAR_STAGES:
                for level in LEVELS:
                    baseline_paths[star][level] = capture_state(
                        driver, baseline_url, 'baseline', star, level, zoom_steps[level]
                    )
    finally:
        driver.quit()

    current_metrics = {
        star: {level: analyze(path) for level, path in paths.items()}
        for star, paths in current_paths.items()
    }
    baseline_metrics = {
        star: {level: analyze(path) for level, path in paths.items()}
        for star, paths in baseline_paths.items()
    }

    # Persist all evidence before hard gates. A failed metric must still leave the
    # nine production PNGs and contact sheets available for direct inspection.
    payload = {
        'viewport': {'width': base.VIEWPORT_WIDTH, 'height': base.VIEWPORT_HEIGHT},
        'baseline_ref': BASELINE_REF,
        'zoom_steps': zoom_steps,
        'targets_px': LEVEL_TARGETS,
        'baseline': baseline_metrics,
        'current': current_metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    make_contact_sheet(current_paths, current_metrics, OUTPUT_DIR / 'mobile-pass2-contact-sheet.png')
    make_extreme_ab_sheet(baseline_paths, current_paths, OUTPUT_DIR / 'mobile-pass1-vs-pass2-extreme.png')
    print('Pass 2 current metrics:')
    print_metrics(current_metrics)

    for star in STAR_STAGES:
        for level in LEVELS:
            validate_pair(star, level, baseline_metrics[star][level], current_metrics[star][level])

    for star in STAR_STAGES:
        normal = float(current_metrics[star]['normal']['granulation_contrast'])
        enlarged = float(current_metrics[star]['enlarged']['granulation_contrast'])
        extreme = float(current_metrics[star]['extreme']['granulation_contrast'])
        base.require(normal <= enlarged * 1.30, f'{star}: normal view surface texture is too prominent')
        base.require(extreme >= enlarged * 0.70, f'{star}: extreme view loses primary granulation unexpectedly')
        base.require(extreme <= enlarged * 1.80 + 0.25, f'{star}: extreme view contrast grows too aggressively')

    print('stellar photosphere Pass 2 normal/enlarged/extreme mobile regression: ok')
    print(f'  viewport: {base.VIEWPORT_WIDTH}x{base.VIEWPORT_HEIGHT}')
    print(f'  zoom steps: {zoom_steps}')


if __name__ == '__main__':
    main()
