#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import json
import math
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageStat
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

import stellarCoronaVisualRegression as corona
import stellarPhotospherePass2VisualRegression as p2
import stellarPhotospherePass2VisualRegressionRunner as p2runner
import stellarPhotospherePass3RadialRegression as p3

OUTPUT_DIR = Path('stellar-production-pass5-artifacts')
STAR_ORDER = ('cool', 'solar', 'hot')
STAR_MASSES = {'cool': 0.35, 'solar': 1.0, 'hot': 8.0}
LEVELS = ('normal', 'enlarged', 'extreme')
LEVEL_TARGETS = p2.LEVEL_TARGETS
p2.OUTPUT_DIR = OUTPUT_DIR


def require(condition: bool, message: str) -> None:
    p2.base.require(condition, message)


def production_url(root_url: str, star: str) -> str:
    return (
        f'{root_url}?visual-regression=production-camera-handoff'
        f'&production-stellar-fixture={star}'
    )


def configure_production_storage(driver, root_url: str) -> None:
    driver.get(root_url)
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script('return document.readyState === "complete"')
    )
    driver.execute_script(
        '''
        localStorage.setItem('3bp-space-mode', '3d');
        localStorage.setItem('3bp-body-count', '1');
        localStorage.setItem('3bp-preset', 'singleDrift');
        localStorage.setItem('3bp-trail-enabled', 'false');
        localStorage.setItem('3bp-trail-duration', '10');
        localStorage.setItem('3bp-language', 'en');
        localStorage.setItem('3bp-collision-watch-enabled', 'false');
        '''
    )


def wait_frames(driver, frames: int) -> None:
    driver.execute_async_script(
        '''
        let remaining = arguments[0];
        const done = arguments[arguments.length - 1];
        const tick = () => {
          if (remaining-- <= 0) { done(); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        ''',
        frames,
    )


def prepare_scene(driver, root_url: str, star: str):
    driver.get(production_url(root_url, star))
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.find_elements(By.CSS_SELECTOR, '.app-shell')
        and browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')
        and browser.find_elements(By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button')
        and browser.find_elements(By.CSS_SELECTOR, '.control-panel .panel-toggle')
    )

    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return arguments[0].width > 0 && arguments[0].height > 0',
            canvas,
        )
    )

    tracking_button = driver.find_element(By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button')
    if tracking_button.get_attribute('aria-pressed') != 'true':
        tracking_button.click()

    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.find_element(
            By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button'
        ).get_attribute('aria-pressed') == 'true'
    )
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: bool(browser.execute_script(
            '''
            const history = window.__productionCameraHandoffHistory || [];
            const last = history[history.length - 1];
            return last && last.mode === 'tracking' &&
              last.resolvedTrackedBodyId &&
              last.resolvedTrackedBodyId.startsWith('pass5-star-');
            '''
        ))
    )

    # Use the real mobile UI control to collapse the bottom sheet. This leaves
    # production chrome and tracking controls visible while keeping the tracked
    # star unobstructed for the required visual review.
    toggle = driver.find_element(By.CSS_SELECTOR, '.control-panel .panel-toggle')
    if toggle.get_attribute('aria-expanded') == 'true':
        toggle.click()
    WebDriverWait(driver, 10, poll_frequency=0.05).until(
        lambda browser: 'collapsed' in browser.find_element(
            By.CSS_SELECTOR, '.control-panel'
        ).get_attribute('class').split()
    )

    # The production tracking camera has an 18-frame settle phase.
    wait_frames(driver, 72)
    return canvas


def apply_single_zoom(driver, canvas, delta: float = -100.0, settle_frames: int = 8) -> None:
    driver.execute_async_script(
        '''
        const element = arguments[0];
        const deltaY = arguments[1];
        let settleFrames = arguments[2];
        const done = arguments[arguments.length - 1];
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new WheelEvent('wheel', {
          deltaY,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.5,
          view: window,
        }));
        const settle = () => {
          if (settleFrames-- <= 0) { done(); return; }
          requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
        ''',
        canvas,
        delta,
        settle_frames,
    )


def _capture_canvas_fallback(driver, canvas, path: Path) -> Image.Image:
    # Selenium element screenshots composite overlapping DOM. Hide only DOM
    # nodes outside the canvas ancestry during the capture, then restore them.
    driver.execute_script(
        '''
        const canvas = arguments[0];
        for (const element of document.querySelectorAll('body *')) {
          if (element === canvas || element.contains(canvas) || canvas.contains(element)) continue;
          element.setAttribute('data-pass5-prev-visibility', element.style.visibility || '');
          element.style.visibility = 'hidden';
          element.setAttribute('data-pass5-hidden', '1');
        }
        ''',
        canvas,
    )
    try:
        require(bool(canvas.screenshot(str(path))) and path.exists(), f'{path}: canvas capture failed')
    finally:
        driver.execute_script(
            '''
            for (const element of document.querySelectorAll('[data-pass5-hidden="1"]')) {
              element.style.visibility = element.getAttribute('data-pass5-prev-visibility') || '';
              element.removeAttribute('data-pass5-prev-visibility');
              element.removeAttribute('data-pass5-hidden');
            }
            '''
        )
    return Image.open(path).convert('RGB')


def capture_canvas(driver, canvas, path: Path) -> Image.Image:
    path.parent.mkdir(parents=True, exist_ok=True)
    wait_frames(driver, 2)
    data_url = driver.execute_script("return arguments[0].toDataURL('image/png');", canvas)
    if isinstance(data_url, str) and data_url.startswith('data:image/png;base64,'):
        raw = base64.b64decode(data_url.split(',', 1)[1])
        image = Image.open(io.BytesIO(raw)).convert('RGB')
        extrema = ImageStat.Stat(image.convert('L')).extrema[0]
        if extrema[1] >= 24:
            image.save(path)
            return image
    return _capture_canvas_fallback(driver, canvas, path)


def capture_full_ui(driver, path: Path) -> Image.Image:
    path.parent.mkdir(parents=True, exist_ok=True)
    require(bool(driver.save_screenshot(str(path))) and path.exists(), f'{path}: full UI capture failed')
    image = Image.open(path).convert('RGB')
    require(
        image.size == (p2.base.VIEWPORT_WIDTH, p2.base.VIEWPORT_HEIGHT),
        f'{path}: expected {p2.base.VIEWPORT_WIDTH}x{p2.base.VIEWPORT_HEIGHT}, got {image.size}',
    )
    return image


def current_telemetry(driver) -> dict[str, object]:
    result = driver.execute_script(
        '''
        const history = window.__productionCameraHandoffHistory || [];
        return history.length ? history[history.length - 1] : null;
        '''
    )
    require(isinstance(result, dict), 'production camera telemetry is unavailable')
    return result


def validate_production_ui(driver) -> None:
    for selector in (
        '.app-shell',
        '.simulation-view',
        '.body-tracking-rail',
        '.control-panel',
        '.language-picker',
    ):
        require(driver.find_element(By.CSS_SELECTOR, selector).is_displayed(), f'UI missing: {selector}')
    tracking = driver.find_element(By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button')
    require(tracking.get_attribute('aria-pressed') == 'true', 'production tracking UI is not active')
    panel = driver.find_element(By.CSS_SELECTOR, '.control-panel')
    require('collapsed' in panel.get_attribute('class').split(), 'mobile control panel did not collapse')
    require(current_telemetry(driver).get('mode') == 'tracking', 'camera telemetry is not tracking')


def calibrate_zoom_steps(driver, root_url: str) -> dict[str, int]:
    canvas = prepare_scene(driver, root_url, 'solar')
    temp = OUTPUT_DIR / 'zoom-calibration.png'
    image = capture_canvas(driver, canvas, temp)
    diameter = float(p2.locate_photosphere(image)['bright_photosphere_diameter_px'])
    low, high = LEVEL_TARGETS['normal']
    require(low <= diameter <= high, f'production normal size {diameter:.1f}px misses {low:.0f}-{high:.0f}px')

    steps = {'normal': 0}
    step_count = 0
    while ('enlarged' not in steps or 'extreme' not in steps) and step_count < 72:
        apply_single_zoom(driver, canvas, settle_frames=8)
        step_count += 1
        diameter = float(p2.locate_photosphere(capture_canvas(driver, canvas, temp))['bright_photosphere_diameter_px'])
        for level in ('enlarged', 'extreme'):
            target_low, target_high = LEVEL_TARGETS[level]
            if level not in steps and target_low <= diameter <= target_high:
                steps[level] = step_count
                print(f'Pass 5 production zoom calibration {level}: {step_count} -> {diameter:.1f}px')
    require('enlarged' in steps and 'extreme' in steps, 'production zoom calibration did not cover all levels')
    return steps


def capture_state(driver, root_url: str, star: str, level: str, wheel_steps: int):
    canvas = prepare_scene(driver, root_url, star)
    validate_production_ui(driver)
    if wheel_steps:
        p2runner.apply_batch_zoom(driver, canvas, -wheel_steps, delta=100.0, settle_frames=36)
    canvas_path = OUTPUT_DIR / f'production-{star}-{level}-canvas.png'
    ui_path = OUTPUT_DIR / f'production-{star}-{level}-ui.png'
    capture_canvas(driver, canvas, canvas_path)
    capture_full_ui(driver, ui_path)
    telemetry = current_telemetry(driver)
    require(telemetry.get('mode') == 'tracking', f'{star}/{level}: production tracking camera was lost')
    return canvas_path, ui_path, telemetry


def validate_surface(star: str, level: str, metric: dict[str, float | int]) -> None:
    diameter = float(metric['bright_photosphere_diameter_px'])
    low, high = LEVEL_TARGETS[level]
    require(low <= diameter <= high, f'{star}/{level}: diameter {diameter:.1f}px misses {low:.0f}-{high:.0f}px')
    contrast = float(metric['granulation_contrast'])
    contrast_low, contrast_high = {
        'normal': (0.08, 1.60),
        'enlarged': (0.16, 2.50),
        'extreme': (0.22, 3.40),
    }[level]
    require(
        contrast_low <= contrast <= contrast_high,
        f'{star}/{level}: granulation contrast {contrast:.3f} outside {contrast_low:.2f}-{contrast_high:.2f}',
    )
    require(float(metric['broad_variation_std']) >= 0.35, f'{star}/{level}: broad convection vanished')
    require(float(metric['high_frequency_energy']) <= 2.60, f'{star}/{level}: shimmer/moire-like HF energy is too high')
    require(float(metric['local_minima_fraction']) <= 0.10, f'{star}/{level}: excessive local pits')
    require(float(metric['dark_residual_fraction']) <= 0.34, f'{star}/{level}: dark trough coverage is excessive')
    require(float(metric['largest_dark_component_fraction']) <= 0.20, f'{star}/{level}: connected dark topology is too dominant')
    require(
        float(metric['largest_dark_component_span_fraction']) <= 0.70,
        f'{star}/{level}: Voronoi/honeycomb-like structure spans too much of the disk',
    )


def validate_corona(star: str, level: str, metric: dict[str, float]) -> None:
    near = metric['near_to_core']
    outer = metric['outer_to_core']
    far = metric['far_to_core']
    extent = metric['extent_fraction']
    require(0.080 <= near <= 0.20, f'{star}/{level}: near corona out of range ({near:.4f})')
    require(0.015 <= outer <= 0.055, f'{star}/{level}: outer corona out of range ({outer:.4f})')
    require(far <= 0.014, f'{star}/{level}: far halo is excessive ({far:.4f})')
    require(0.12 <= metric['outer_to_near'] <= 0.40, f'{star}/{level}: near/outer corona balance is unnatural')
    require(metric['far_to_outer'] <= 0.35, f'{star}/{level}: corona does not decay enough')
    require(0.24 <= extent <= 0.44, f'{star}/{level}: corona extent is too thin or broad ({extent:.3f})')
    require(metric['extent_std_fraction'] <= 0.060, f'{star}/{level}: corona boundary is too irregular')
    edge_limit = 3.35 if level == 'normal' else 2.25
    require(metric['edge_to_shoulder_p90'] <= edge_limit, f'{star}/{level}: corona is a thin outline')
    require(metric['radial_rebound_p90'] <= 0.060, f'{star}/{level}: corona contains a radial rebound')


def hue_distance(a: dict[str, float | int], b: dict[str, float | int]) -> float:
    return math.sqrt(sum((float(a[c]) - float(b[c])) ** 2 for c in ('hue_r', 'hue_g', 'hue_b')))


def validate_temperature_hues(surface: dict[str, dict[str, dict[str, float | int]]]) -> None:
    for level in LEVELS:
        cool = surface['cool'][level]
        solar = surface['solar'][level]
        hot = surface['hot'][level]
        require(float(cool['hue_r']) > float(cool['hue_b']) + 0.055, f'{level}: cool star lost warm hue')
        require(float(solar['hue_r']) > float(solar['hue_b']) + 0.025, f'{level}: solar star became neutral white')
        require(float(hot['hue_b']) >= float(hot['hue_r']) - 0.010, f'{level}: 8 M_sun star lost blue-white hue')
        require(hue_distance(cool, solar) >= 0.018, f'{level}: cool/solar hues collapsed')
        require(hue_distance(solar, hot) >= 0.010, f'{level}: solar/hot hues collapsed')


def residual_signature(path: Path, size: int = 84) -> tuple[list[list[float]], float]:
    image = Image.open(path).convert('RGB')
    geometry = p2.locate_photosphere(image)
    cx, cy = float(geometry['center_x']), float(geometry['center_y'])
    radius = float(geometry['equivalent_radius_px'])
    half = max(8.0, radius * 0.66)
    crop = image.crop((
        max(0, int(cx - half)), max(0, int(cy - half)),
        min(image.width, int(cx + half)), min(image.height, int(cy + half)),
    )).convert('L').resize((size, size), Image.Resampling.BICUBIC)
    blur = crop.filter(ImageFilter.GaussianBlur(radius=max(2.0, size / 24.0)))
    residual = [[0.0 for _ in range(size)] for _ in range(size)]
    values: list[float] = []
    center = (size - 1) * 0.5
    mask_radius = size * 0.43
    for y in range(size):
        for x in range(size):
            if math.hypot(x - center, y - center) > mask_radius:
                continue
            value = float(crop.getpixel((x, y))) - float(blur.getpixel((x, y)))
            residual[y][x] = value
            values.append(value)
    return residual, statistics.pstdev(values) if len(values) >= 2 else 0.0


def shifted_correlation(a: list[list[float]], b: list[list[float]], dx: int, dy: int) -> float:
    size = len(a)
    center = (size - 1) * 0.5
    pairs: list[tuple[float, float]] = []
    for y in range(size):
        by = y + dy
        if by < 0 or by >= size:
            continue
        for x in range(size):
            bx = x + dx
            if bx < 0 or bx >= size or math.hypot(x - center, y - center) > size * 0.40:
                continue
            pairs.append((a[y][x], b[by][bx]))
    if len(pairs) < 40:
        return 0.0
    mean_a = statistics.fmean(v[0] for v in pairs)
    mean_b = statistics.fmean(v[1] for v in pairs)
    numerator = sum((va - mean_a) * (vb - mean_b) for va, vb in pairs)
    denom_a = math.sqrt(sum((va - mean_a) ** 2 for va, _ in pairs))
    denom_b = math.sqrt(sum((vb - mean_b) ** 2 for _, vb in pairs))
    return numerator / max(denom_a * denom_b, 1e-9)


def pattern_correlation(previous: Path, current: Path) -> tuple[float, float, float]:
    a, std_a = residual_signature(previous)
    b, std_b = residual_signature(current)
    value = max(shifted_correlation(a, b, dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    return value, std_a, std_b


def capture_zoom_sweep(driver, root_url: str, extreme_steps: int):
    canvas = prepare_scene(driver, root_url, 'hot')
    validate_production_ui(driver)
    frames: list[Path] = []
    metrics: list[dict[str, float | int | None]] = []
    previous_path: Path | None = None
    for step in range(extreme_steps + 1):
        if step:
            apply_single_zoom(driver, canvas, settle_frames=4)
        path = OUTPUT_DIR / 'zoom-sweep' / f'hot-{step:02d}.png'
        capture_canvas(driver, canvas, path)
        frames.append(path)
        surface = p2.analyze(path)
        corona_metric = corona.analyze_corona(path)
        correlation = std_prev = std_now = None
        if previous_path is not None:
            correlation, std_prev, std_now = pattern_correlation(previous_path, path)
        metrics.append({
            'step': step,
            'diameter_px': float(surface['bright_photosphere_diameter_px']),
            'granulation_contrast': float(surface['granulation_contrast']),
            'high_frequency_energy': float(surface['high_frequency_energy']),
            'corona_extent_fraction': corona_metric['extent_fraction'],
            'corona_outer_to_core': corona_metric['outer_to_core'],
            'pattern_correlation_prev': correlation,
            'pattern_std_prev': std_prev,
            'pattern_std': std_now,
        })
        previous_path = path
    return metrics, frames


def validate_zoom_sweep(metrics: list[dict[str, float | int | None]]) -> None:
    correlations: list[float] = []
    for previous, current in zip(metrics, metrics[1:]):
        prev_d = float(previous['diameter_px'])
        curr_d = float(current['diameter_px'])
        require(curr_d + 0.6 >= prev_d, 'continuous zoom unexpectedly shrank the photosphere')
        require(curr_d / max(prev_d, 1.0) <= 1.20, f'continuous zoom camera jump {prev_d:.1f}->{curr_d:.1f}px')
        require(abs(float(current['granulation_contrast']) - float(previous['granulation_contrast'])) <= 0.80, 'granulation LOD pop')
        require(abs(float(current['high_frequency_energy']) - float(previous['high_frequency_energy'])) <= 0.90, 'shimmer/moire HF jump')
        require(abs(float(current['corona_extent_fraction']) - float(previous['corona_extent_fraction'])) <= 0.12, 'corona size jump')
        require(abs(float(current['corona_outer_to_core']) - float(previous['corona_outer_to_core'])) <= 0.040, 'corona brightness jump')
        correlation = current['pattern_correlation_prev']
        std_prev, std_now = current['pattern_std_prev'], current['pattern_std']
        if correlation is not None and std_prev is not None and std_now is not None and prev_d >= 120 and min(float(std_prev), float(std_now)) >= 0.08:
            value = float(correlation)
            correlations.append(value)
            require(value >= 0.15, f'continuous zoom texture pattern slipped ({value:.3f})')
    require(correlations, 'continuous zoom did not yield resolved texture-correlation samples')
    require(statistics.median(correlations) >= 0.45, f'texture alignment unstable (median {statistics.median(correlations):.3f})')


def make_ui_contact_sheet(paths: dict[str, dict[str, Path]], output: Path) -> None:
    width, height, label, margin = p2.base.VIEWPORT_WIDTH, p2.base.VIEWPORT_HEIGHT, 32, 8
    sheet = Image.new('RGB', (width * 3 + margin * 4, (height + label) * 3 + margin * 4), (8, 10, 16))
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(LEVELS):
        for col, star in enumerate(STAR_ORDER):
            x = margin + col * (width + margin)
            y = margin + row * (height + label + margin)
            draw.text((x, y), f'{STAR_MASSES[star]:g} M_sun / {level} / production UI', fill=(238, 241, 248))
            sheet.paste(Image.open(paths[star][level]).convert('RGB'), (x, y + label))
    sheet.save(output)


def make_zoom_strip(frames: list[Path], output: Path) -> None:
    count = min(7, len(frames))
    indices = sorted({round(i * (len(frames) - 1) / max(count - 1, 1)) for i in range(count)})
    images = [Image.open(frames[i]).convert('RGB') for i in indices]
    label = 26
    sheet = Image.new('RGB', (sum(i.width for i in images), max(i.height for i in images) + label), (8, 10, 16))
    draw = ImageDraw.Draw(sheet)
    x = 0
    for index, image in zip(indices, images):
        draw.text((x + 6, 7), f'zoom step {index}', fill=(238, 241, 248))
        sheet.paste(image, (x, label))
        x += image.width
    sheet.save(output)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    p2.base.wait_for_url(p2.base.CURRENT_URL)
    driver = p2.base.make_driver()
    canvas_paths = {star: {} for star in STAR_ORDER}
    ui_paths = {star: {} for star in STAR_ORDER}
    telemetry = {star: {} for star in STAR_ORDER}
    try:
        configure_production_storage(driver, p2.base.CURRENT_URL)
        zoom_steps = calibrate_zoom_steps(driver, p2.base.CURRENT_URL)
        print(f'Pass 5 production zoom steps: {zoom_steps}')
        for star in STAR_ORDER:
            for level in LEVELS:
                canvas_path, ui_path, state = capture_state(driver, p2.base.CURRENT_URL, star, level, zoom_steps[level])
                canvas_paths[star][level] = canvas_path
                ui_paths[star][level] = ui_path
                telemetry[star][level] = state
        zoom_sweep, sweep_frames = capture_zoom_sweep(driver, p2.base.CURRENT_URL, zoom_steps['extreme'])
    finally:
        driver.quit()

    surface = {star: {level: p2.analyze(path) for level, path in paths.items()} for star, paths in canvas_paths.items()}
    radial = {star: {level: p3.analyze_radial(path) for level, path in paths.items()} for star, paths in canvas_paths.items()}
    corona_metrics = {star: {level: corona.analyze_corona(path) for level, path in paths.items()} for star, paths in canvas_paths.items()}

    make_ui_contact_sheet(ui_paths, OUTPUT_DIR / 'production-mobile-ui-3x3.png')
    make_zoom_strip(sweep_frames, OUTPUT_DIR / 'hot-continuous-zoom-strip.png')
    payload = {
        'viewport': {'width': p2.base.VIEWPORT_WIDTH, 'height': p2.base.VIEWPORT_HEIGHT, 'mobile': True},
        'scene': 'real App + SimulationView + production renderer + tracking rail + OrbitControls',
        'star_masses_msun': STAR_MASSES,
        'zoom_steps': zoom_steps,
        'level_targets_px': LEVEL_TARGETS,
        'surface': surface,
        'radial': radial,
        'corona': corona_metrics,
        'camera_telemetry': telemetry,
        'continuous_zoom_hot': zoom_sweep,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    for star in STAR_ORDER:
        for level in LEVELS:
            validate_surface(star, level, surface[star][level])
            p3.validate_radial(star, level, radial[star][level])
            validate_corona(star, level, corona_metrics[star][level])
            require(telemetry[star][level].get('mode') == 'tracking', f'{star}/{level}: camera is not tracking')
    validate_temperature_hues(surface)
    validate_zoom_sweep(zoom_sweep)

    hot_surface = surface['hot']['enlarged']
    hot_radial = radial['hot']['enlarged']
    hot_corona = corona_metrics['hot']['enlarged']
    print('8 M_sun enlarged production acceptance: ok')
    print(
        '  topology/span={:.3f}, gran={:.3f}, center/limb={:.3f}, corona extent={:.3f}, edge/shoulder={:.3f}, hue B-R={:.4f}'.format(
            float(hot_surface['largest_dark_component_span_fraction']),
            float(hot_surface['granulation_contrast']),
            float(hot_radial['center_to_inner_limb_ratio']),
            hot_corona['extent_fraction'],
            hot_corona['edge_to_shoulder_p90'],
            float(hot_surface['hue_b']) - float(hot_surface['hue_r']),
        )
    )
    print('stellar Pass 5 production mobile integration regression: ok')
    print(f'  viewport: {p2.base.VIEWPORT_WIDTH}x{p2.base.VIEWPORT_HEIGHT}')
    print(f'  UI contact sheet: {OUTPUT_DIR / "production-mobile-ui-3x3.png"}')
    print(f'  continuous zoom strip: {OUTPUT_DIR / "hot-continuous-zoom-strip.png"}')


if __name__ == '__main__':
    main()
