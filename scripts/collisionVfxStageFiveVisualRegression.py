#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import shutil
import time
from collections import deque
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image, ImageChops, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-vfx-stage5-visual-artifacts')
BASE_URL = 'http://127.0.0.1:4173/3BP/'
VIEWPORT = (900, 700)
SCENARIOS = ('representative', 'head-on', 'oblique')
BASELINES = ('stage4', 'stage5')
PRE_CAPTURE = ('tm0100', -0.1)
POST_CAPTURES = (
    ('t0000', 0.0),
    ('t0033', 0.033),
    ('t0066', 0.066),
    ('t0100', 0.1),
    ('t0150', 0.15),
    ('t0200', 0.2),
    ('t0300', 0.3),
    ('t0500', 0.5),
    ('t0800', 0.8),
    ('t1000', 1.0),
)
PHYSICS_SNAPSHOT_TIMES = (0.0, 0.1, 0.3)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument(f'--window-size={VIEWPORT[0]},{VIEWPORT[1]}')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--ignore-gpu-blocklist')
    options.add_argument('--enable-webgl')
    options.add_argument('--enable-unsafe-swiftshader')
    options.add_argument('--use-gl=angle')
    options.add_argument('--use-angle=swiftshader')
    options.add_argument('--hide-scrollbars')
    chrome_binary = (
        shutil.which('google-chrome')
        or shutil.which('google-chrome-stable')
        or shutil.which('chromium')
        or shutil.which('chromium-browser')
    )
    if chrome_binary:
        options.binary_location = chrome_binary
    driver_binary = shutil.which('chromedriver')
    if driver_binary:
        return webdriver.Chrome(service=Service(driver_binary), options=options)
    return webdriver.Chrome(options=options)


def capture_canvas(driver: webdriver.Chrome, path: Path) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {path}')


def wait_two_frames(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        requestAnimationFrame(() => requestAnimationFrame(done));
        """
    )


def wait_until(started_at: float, target_seconds: float) -> None:
    remaining = target_seconds - (time.monotonic() - started_at)
    if remaining > 0:
        time.sleep(remaining)


def seek(driver: webdriver.Chrome, seconds_after_impact: float) -> None:
    driver.execute_async_script(
        """
        const target = arguments[0];
        const done = arguments[arguments.length - 1];
        window.__seekNonStellarDestructionVisual(target);
        requestAnimationFrame(() => requestAnimationFrame(done));
        """,
        seconds_after_impact,
    )


def reset(driver: webdriver.Chrome) -> None:
    driver.execute_script(
        """
        window.__survivorImpactResponseMetrics = {};
        window.__resetNonStellarDestructionVisual();
        """
    )
    wait_two_frames(driver)


def trigger(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        window.__startNonStellarDestructionVisual();
        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== 'destruction') {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(done));
        };
        requestAnimationFrame(waitForCommit);
        """
    )


def physics_snapshot(driver: webdriver.Chrome) -> list[dict[str, object]]:
    value = driver.execute_script(
        'return window.__getNonStellarDestructionPhysicsSnapshot();'
    )
    require(isinstance(value, list), 'physics snapshot hook did not return a body list')
    return value


def canonical_snapshot(snapshot: list[dict[str, object]]) -> str:
    return json.dumps(snapshot, sort_keys=True, separators=(',', ':'))


def frame_difference(a: Path, b: Path) -> float:
    diff = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def connected_components(points: set[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    components: list[list[tuple[int, int]]] = []
    while points:
        seed = points.pop()
        queue = deque([seed])
        component = [seed]
        while queue:
            x, y = queue.popleft()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    candidate = (x + dx, y + dy)
                    if candidate in points:
                        points.remove(candidate)
                        queue.append(candidate)
                        component.append(candidate)
        if len(component) >= 3:
            components.append(component)
    components.sort(key=len, reverse=True)
    return components


def visual_metrics(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    cx = width / 2
    cy = height / 2
    x0, x1 = max(0, int(cx - 155)), min(width, int(cx + 155))
    y0, y1 = max(0, int(cy - 125)), min(height, int(cy + 125))
    luminous: set[tuple[int, int]] = set()
    colored = 0
    non_dark = 0

    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            brightest = max(r, g, b)
            darkest = min(r, g, b)
            if brightest >= 24:
                non_dark += 1
            if brightest >= 28 and brightest - darkest >= 7:
                colored += 1
            # The dark solid surfaces do not reach this threshold in the fixture;
            # it isolates the compact additive contact/spark footprint while single
            # background stars are removed by connected-component filtering.
            if brightest >= 178 and r + g + b >= 430:
                luminous.add((x, y))

    components = connected_components(set(luminous))
    central = []
    for component in components:
        component_cx = sum(point[0] for point in component) / len(component)
        component_cy = sum(point[1] for point in component) / len(component)
        if math.hypot(component_cx - cx, component_cy - cy) <= 120:
            central.append((len(component), component, component_cx, component_cy))
    central.sort(key=lambda item: item[0], reverse=True)

    if central:
        _, component, component_cx, component_cy = central[0]
        xs = [point[0] for point in component]
        ys = [point[1] for point in component]
        bbox_width = max(xs) - min(xs) + 1
        bbox_height = max(ys) - min(ys) + 1
        luminous_pixels = len(component)
        bbox_area = bbox_width * bbox_height
        centroid_distance = math.hypot(component_cx - cx, component_cy - cy)
    else:
        bbox_width = bbox_height = bbox_area = luminous_pixels = 0
        centroid_distance = 0.0

    return {
        'luminous_pixels': luminous_pixels,
        'bbox_width': bbox_width,
        'bbox_height': bbox_height,
        'bbox_area': bbox_area,
        'centroid_distance_from_frame_center': centroid_distance,
        'colored_pixels': colored,
        'non_dark_pixels': non_dark,
    }


def destruction_url(scenario: str, baseline: str) -> str:
    query = urlencode({
        'visual-regression': 'non-stellar-destruction',
        'ejecta-scenario': scenario,
        'ejecta-baseline': 'stage3',
        'survivor-response-baseline': 'stage4',
        'collision-vfx-baseline': baseline,
    })
    return f'{BASE_URL}?{query}'


def capture_destruction_run(
    driver: webdriver.Chrome,
    scenario: str,
    baseline: str,
) -> dict[str, object]:
    driver.get(destruction_url(scenario, baseline))
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__startNonStellarDestructionVisual === "function" && '
            'typeof window.__getNonStellarDestructionPhysicsSnapshot === "function"'
        )
    )
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
    )
    harness = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="non-stellar-destruction"]')
    require(harness.get_attribute('data-ejecta-scenario') == scenario, 'scenario routing mismatch')
    require(harness.get_attribute('data-ejecta-baseline') == 'stage3', 'Stage 3 physics baseline routing mismatch')
    require(
        harness.get_attribute('data-physics-source') == 'fragmentAwareEngine.stepBodies',
        'Stage 4/5 VFX A/B must use production Stage 3/4 physics',
    )

    deterministic_snapshots: dict[str, list[dict[str, object]]] = {}
    for target in PHYSICS_SNAPSHOT_TIMES:
        seek(driver, target)
        deterministic_snapshots[f'{target:.3f}'] = physics_snapshot(driver)

    seek(driver, PRE_CAPTURE[1])
    run_dir = OUTPUT_DIR / scenario / baseline
    run_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    metrics: dict[str, dict[str, float | int]] = {}
    pre_path = run_dir / f'{PRE_CAPTURE[0]}.png'
    capture_canvas(driver, pre_path)
    paths[PRE_CAPTURE[0]] = pre_path
    metrics[PRE_CAPTURE[0]] = visual_metrics(pre_path)

    reset(driver)
    time.sleep(0.12)
    trigger(driver)
    harness = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="non-stellar-destruction"]')
    debris_count = int(harness.get_attribute('data-physical-debris-count') or '0')
    require(debris_count > 0, f'{scenario}/{baseline} did not produce physical debris')

    started_at = time.monotonic()
    for name, target in POST_CAPTURES:
        wait_until(started_at, target)
        path = run_dir / f'{name}.png'
        capture_canvas(driver, path)
        paths[name] = path
        metrics[name] = visual_metrics(path)

    require(metrics['t0000']['non_dark_pixels'] >= 120, f'{scenario}/{baseline} impact frame is empty')
    return {
        'physics_source': 'fragmentAwareEngine.stepBodies',
        'physical_debris_count_at_resolve': debris_count,
        'physics_snapshots': deterministic_snapshots,
        'metrics': metrics,
        'paths': {name: str(path) for name, path in paths.items()},
    }


def advance_merge_step(driver: webdriver.Chrome, expected_step: int) -> None:
    driver.execute_async_script(
        """
        const expected = String(arguments[0]);
        const done = arguments[arguments.length - 1];
        window.__advanceCollisionMergeHandoffStep();
        const waitForCommit = () => {
          if (document.body.dataset.visualStep !== expected) {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(done));
        };
        requestAnimationFrame(waitForCommit);
        """,
        expected_step,
    )


def merge_physics(driver: webdriver.Chrome) -> dict[str, float | int | str]:
    root = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="collision-merge-handoff"]')
    return {
        'step': int(root.get_attribute('data-physics-step') or 0),
        'remnant_id': root.get_attribute('data-remnant-id') or '',
        'physical_body_count': int(root.get_attribute('data-physical-body-count') or 0),
        'remnant_mass': float(root.get_attribute('data-remnant-mass') or 0),
        'remnant_radius': float(root.get_attribute('data-remnant-radius') or 0),
        'remnant_vx': float(root.get_attribute('data-remnant-vx') or 0),
        'remnant_vy': float(root.get_attribute('data-remnant-vy') or 0),
        'remnant_vz': float(root.get_attribute('data-remnant-vz') or 0),
    }


def capture_gentle_merge_run(driver: webdriver.Chrome, baseline: str) -> dict[str, object]:
    query = urlencode({
        'visual-regression': 'collision-merge-handoff',
        'collision-vfx-baseline': baseline,
    })
    driver.get(f'{BASE_URL}?{query}')
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__advanceCollisionMergeHandoffStep === "function"'
        )
    )
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
    )
    for step in range(1, 17):
        advance_merge_step(driver, step)
    physics = merge_physics(driver)
    require(bool(physics['remnant_id']), f'gentle merge {baseline} did not resolve 2->1')
    require(physics['physical_body_count'] == 1, f'gentle merge {baseline} physical body count changed')

    run_dir = OUTPUT_DIR / 'gentle-merge' / baseline
    run_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    metrics: dict[str, dict[str, float | int]] = {}
    started_at = time.monotonic()
    for name, target in POST_CAPTURES:
        wait_until(started_at, target)
        path = run_dir / f'{name}.png'
        capture_canvas(driver, path)
        paths[name] = path
        metrics[name] = visual_metrics(path)

    return {
        'physics': physics,
        'metrics': metrics,
        'paths': {name: str(path) for name, path in paths.items()},
    }


def sum_metric(run: dict[str, object], names: tuple[str, ...], metric: str) -> float:
    metrics = run['metrics']
    assert isinstance(metrics, dict)
    return sum(float(metrics[name][metric]) for name in names)


def peak_metric(run: dict[str, object], names: tuple[str, ...], metric: str) -> float:
    metrics = run['metrics']
    assert isinstance(metrics, dict)
    return max(float(metrics[name][metric]) for name in names)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        runs: dict[str, dict[str, dict[str, object]]] = {}
        comparisons: dict[str, dict[str, float]] = {}

        for scenario in SCENARIOS:
            runs[scenario] = {}
            for baseline in BASELINES:
                runs[scenario][baseline] = capture_destruction_run(driver, scenario, baseline)

            stage4 = runs[scenario]['stage4']
            stage5 = runs[scenario]['stage5']
            require(
                stage4['physical_debris_count_at_resolve'] == stage5['physical_debris_count_at_resolve'],
                f'{scenario}: Stage 4/5 physical debris count changed',
            )
            stage4_snapshots = stage4['physics_snapshots']
            stage5_snapshots = stage5['physics_snapshots']
            require(isinstance(stage4_snapshots, dict) and isinstance(stage5_snapshots, dict), 'physics snapshot payload missing')
            for key in stage4_snapshots:
                require(
                    canonical_snapshot(stage4_snapshots[key]) == canonical_snapshot(stage5_snapshots[key]),
                    f'{scenario}: Stage 4/5 physical body state differs at +{key}s',
                )

            early_names = ('t0000', 't0033', 't0066', 't0100', 't0150', 't0200')
            late_names = ('t0100', 't0150', 't0200', 't0300')
            stage4_peak = peak_metric(stage4, early_names, 'bbox_area')
            stage5_peak = peak_metric(stage5, early_names, 'bbox_area')
            require(stage5_peak <= stage4_peak * 1.02 + 4, f'{scenario}: Stage 5 flash footprint grew ({stage4_peak} -> {stage5_peak})')
            stage4_energy = sum_metric(stage4, early_names, 'luminous_pixels')
            stage5_energy = sum_metric(stage5, early_names, 'luminous_pixels')
            require(stage5_energy <= stage4_energy * 0.94 + 8, f'{scenario}: Stage 5 early luminous footprint did not decrease')
            stage4_late = sum_metric(stage4, late_names, 'luminous_pixels')
            stage5_late = sum_metric(stage5, late_names, 'luminous_pixels')
            require(stage5_late <= stage4_late * 1.03 + 6, f'{scenario}: Stage 5 flash/sparks lingered longer')
            require(
                float(stage5['metrics']['t0000']['luminous_pixels']) >= 3,
                f'{scenario}: Stage 5 removed the perceptible impact cue',
            )

            comparisons[scenario] = {}
            for name, _ in POST_CAPTURES:
                comparisons[scenario][name] = frame_difference(
                    Path(str(stage4['paths'][name])),
                    Path(str(stage5['paths'][name])),
                )
            require(
                max(comparisons[scenario][name] for name in early_names) >= 0.001,
                f'{scenario}: Stage 5 is not visibly distinct from Stage 4',
            )

        runs['gentle-merge'] = {}
        for baseline in BASELINES:
            runs['gentle-merge'][baseline] = capture_gentle_merge_run(driver, baseline)
        gentle4 = runs['gentle-merge']['stage4']
        gentle5 = runs['gentle-merge']['stage5']
        require(
            json.dumps(gentle4['physics'], sort_keys=True) == json.dumps(gentle5['physics'], sort_keys=True),
            'gentle merge Stage 4/5 physics state changed',
        )
        gentle_names = ('t0000', 't0033', 't0066', 't0100', 't0150', 't0200', 't0300')
        require(
            peak_metric(gentle5, gentle_names, 'bbox_area') <= peak_metric(gentle4, gentle_names, 'bbox_area') * 1.03 + 4,
            'gentle merge Stage 5 flash footprint became more explosive',
        )
        require(
            sum_metric(gentle5, gentle_names, 'luminous_pixels') <= sum_metric(gentle4, gentle_names, 'luminous_pixels') * 1.03 + 8,
            'gentle merge Stage 5 luminous energy became more explosive',
        )

        payload = {
            'viewport': {'width': VIEWPORT[0], 'height': VIEWPORT[1]},
            'capture_seconds_relative_to_first_physical_result': {
                PRE_CAPTURE[0]: PRE_CAPTURE[1],
                **{name: target for name, target in POST_CAPTURES},
            },
            'physics_snapshot_seconds': PHYSICS_SNAPSHOT_TIMES,
            'runs': runs,
            'stage4_vs_stage5_mean_pixel_difference': comparisons,
            'acceptance': {
                'physics_state_identical': True,
                'flash_peak_not_larger': True,
                'early_luminous_footprint_reduced': True,
                'late_luminous_linger_not_increased': True,
                'gentle_merge_not_more_explosive': True,
            },
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('collision VFX Stage4/Stage5 browser A/B regression: ok')
    except Exception:
        try:
            driver.save_screenshot(str(OUTPUT_DIR / 'failure-page.png'))
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == '__main__':
    main()
