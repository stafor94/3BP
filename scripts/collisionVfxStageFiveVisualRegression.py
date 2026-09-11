#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import shutil
from collections import deque
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image, ImageChops, ImageDraw, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-vfx-stage5-visual-artifacts')
BASE_URL = 'http://127.0.0.1:4173/3BP/'
VIEWPORT = (900, 700)
SCENARIOS = ('representative', 'head-on', 'oblique', 'default')
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
FLASH_CHANNEL_THRESHOLD = 96
FLASH_TRANSIENT_DELTA = 14
FLASH_COMPONENT_MIN_PIXELS = 4
CONTACT_COMPONENT_MAX_OFFSET = 42.0
CONTACT_WINDOW_RADIUS = 58.0
CONTACT_FLASH_RADIUS = 16.0
FLASH_PEAK_NAMES = ('t0000', 't0033', 't0066')
MONTAGE_NAMES = ('tm0100', 't0000', 't0033', 't0066', 't0100', 't0150', 't0200', 't0300', 't0500')

TEST_CLOCK_SCRIPT = r"""
(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('collision-vfx-test-clock') !== '1') return;
  const nativeNow = Performance.prototype.now;
  const originMs = 100000;
  window.__collisionVfxTestClockOriginMs = originMs;
  window.__collisionVfxTestNowMs = originMs - 1000;
  Object.defineProperty(Performance.prototype, 'now', {
    configurable: true,
    value: function collisionVfxDeterministicNow() {
      const override = window.__collisionVfxTestNowMs;
      return Number.isFinite(override) ? override : nativeNow.call(this);
    },
  });
  window.__setCollisionVfxTestTime = (secondsAfterImpact) => {
    window.__collisionVfxTestNowMs = originMs + secondsAfterImpact * 1000;
    return window.__collisionVfxTestNowMs;
  };
})();
"""


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
        driver = webdriver.Chrome(service=Service(driver_binary), options=options)
    else:
        driver = webdriver.Chrome(options=options)
    driver.execute_cdp_cmd(
        'Page.addScriptToEvaluateOnNewDocument',
        {'source': TEST_CLOCK_SCRIPT},
    )
    return driver


def wait_two_frames(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        requestAnimationFrame(() => requestAnimationFrame(done));
        """
    )


def set_test_time(driver: webdriver.Chrome, seconds_after_impact: float) -> None:
    value = driver.execute_script(
        """
        if (typeof window.__setCollisionVfxTestTime !== 'function') return null;
        return window.__setCollisionVfxTestTime(arguments[0]);
        """,
        seconds_after_impact,
    )
    require(isinstance(value, (int, float)), 'deterministic collision VFX test clock is unavailable')


def seek(driver: webdriver.Chrome, seconds_after_impact: float, *, set_clock: bool = True) -> None:
    driver.execute_async_script(
        """
        const target = arguments[0];
        const setClock = arguments[1];
        const done = arguments[arguments.length - 1];
        if (setClock) window.__setCollisionVfxTestTime(target);
        window.__seekNonStellarDestructionVisual(target);
        requestAnimationFrame(() => requestAnimationFrame(done));
        """,
        seconds_after_impact,
        set_clock,
    )


def capture_canvas(driver: webdriver.Chrome, path: Path) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {path}')


def physics_snapshot(driver: webdriver.Chrome) -> list[dict[str, object]]:
    value = driver.execute_script('return window.__getNonStellarDestructionPhysicsSnapshot();')
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
        if len(component) >= FLASH_COMPONENT_MIN_PIXELS:
            components.append(component)
    components.sort(key=len, reverse=True)
    return components


def transient_components(current: Image.Image, pre: Image.Image) -> list[list[tuple[int, int]]]:
    width, height = current.size
    cx = width / 2
    cy = height / 2
    x0, x1 = max(0, int(cx - 155)), min(width, int(cx + 155))
    y0, y1 = max(0, int(cy - 125)), min(height, int(cy + 125))
    points: set[tuple[int, int]] = set()
    for y in range(y0, y1):
        for x in range(x0, x1):
            pixel = current.getpixel((x, y))
            before = pre.getpixel((x, y))
            brightest = max(pixel)
            transient = brightest - max(before)
            if brightest >= FLASH_CHANNEL_THRESHOLD and transient >= FLASH_TRANSIENT_DELTA:
                points.add((x, y))
    return connected_components(points)


def select_contact_component(
    components: list[list[tuple[int, int]]],
    frame_size: tuple[int, int],
    expected_contact: tuple[float, float] | None,
) -> list[tuple[int, int]]:
    width, height = frame_size
    frame_center = (width / 2, height / 2)
    center = expected_contact or frame_center
    max_offset = CONTACT_COMPONENT_MAX_OFFSET if expected_contact else 105.0
    candidates: list[tuple[int, float, list[tuple[int, int]]]] = []
    for component in components:
        centroid_x = sum(point[0] for point in component) / len(component)
        centroid_y = sum(point[1] for point in component) / len(component)
        offset = math.hypot(centroid_x - center[0], centroid_y - center[1])
        if offset <= max_offset:
            candidates.append((len(component), -offset, component))
    candidates.sort(reverse=True, key=lambda entry: (entry[0], entry[1]))
    return candidates[0][2] if candidates else []


def visual_metrics(
    path: Path,
    pre_path: Path,
    expected_contact: tuple[float, float] | None,
) -> dict[str, float | int]:
    current = Image.open(path).convert('RGB')
    pre = Image.open(pre_path).convert('RGB')
    width, height = current.size
    components = transient_components(current, pre)
    component = select_contact_component(components, current.size, expected_contact)

    if component:
        xs = [point[0] for point in component]
        ys = [point[1] for point in component]
        centroid_x = sum(xs) / len(xs)
        centroid_y = sum(ys) / len(ys)
        bbox_width = max(xs) - min(xs) + 1
        bbox_height = max(ys) - min(ys) + 1
        flash_pixels = len(component)
        transient_values: list[int] = []
        white_pixels = 0
        for x, y in component:
            pixel = current.getpixel((x, y))
            before = pre.getpixel((x, y))
            transient_values.append(max(pixel) - max(before))
            if max(pixel) - min(pixel) <= 55:
                white_pixels += 1
        peak_transient = max(transient_values)
        mean_transient = sum(transient_values) / len(transient_values)
        transient_sum = sum(transient_values)
        peak_channel = max(max(current.getpixel(point)) for point in component)
    else:
        centroid_x = centroid_y = 0.0
        bbox_width = bbox_height = flash_pixels = white_pixels = 0
        peak_transient = mean_transient = transient_sum = peak_channel = 0.0

    contact = expected_contact or ((centroid_x, centroid_y) if component else (width / 2, height / 2))
    contact_offset = math.hypot(centroid_x - contact[0], centroid_y - contact[1]) if component else 0.0
    contact_colored_pixels = 0
    contact_non_dark_pixels = 0
    contact_white_transient_pixels = 0
    contact_flash_white_pixels = 0
    for y in range(max(0, int(contact[1] - CONTACT_WINDOW_RADIUS)), min(height, int(contact[1] + CONTACT_WINDOW_RADIUS + 1))):
        for x in range(max(0, int(contact[0] - CONTACT_WINDOW_RADIUS)), min(width, int(contact[0] + CONTACT_WINDOW_RADIUS + 1))):
            distance = math.hypot(x - contact[0], y - contact[1])
            if distance > CONTACT_WINDOW_RADIUS:
                continue
            pixel = current.getpixel((x, y))
            before = pre.getpixel((x, y))
            brightest = max(pixel)
            chroma = brightest - min(pixel)
            transient = brightest - max(before)
            if brightest >= 24:
                contact_non_dark_pixels += 1
            if 28 <= brightest < FLASH_CHANNEL_THRESHOLD and chroma >= 7:
                contact_colored_pixels += 1
            if brightest >= FLASH_CHANNEL_THRESHOLD and transient >= FLASH_TRANSIENT_DELTA and chroma <= 55:
                contact_white_transient_pixels += 1
                if distance <= CONTACT_FLASH_RADIUS:
                    contact_flash_white_pixels += 1

    return {
        'flash_pixels': flash_pixels,
        'bbox_width': bbox_width,
        'bbox_height': bbox_height,
        'bbox_area': bbox_width * bbox_height,
        'centroid_x': centroid_x,
        'centroid_y': centroid_y,
        'contact_offset': contact_offset,
        'peak_channel': peak_channel,
        'peak_transient_luminance': peak_transient,
        'mean_transient_luminance': mean_transient,
        'transient_luminance_sum': transient_sum,
        'white_flash_pixels': white_pixels,
        'contact_white_transient_pixels': contact_white_transient_pixels,
        'contact_flash_white_pixels': contact_flash_white_pixels,
        'contact_colored_pixels': contact_colored_pixels,
        'contact_non_dark_pixels': contact_non_dark_pixels,
    }


def destruction_url(scenario: str, baseline: str) -> str:
    query = urlencode({
        'visual-regression': 'non-stellar-destruction',
        'ejecta-scenario': scenario,
        'ejecta-baseline': 'stage3',
        'survivor-response-baseline': 'stage4',
        'collision-vfx-baseline': baseline,
        'collision-vfx-test-clock': '1',
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
            'return typeof window.__seekNonStellarDestructionVisual === "function" && '
            'typeof window.__getNonStellarDestructionPhysicsSnapshot === "function" && '
            'typeof window.__setCollisionVfxTestTime === "function"'
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

    run_dir = OUTPUT_DIR / scenario / baseline
    run_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}

    name, target = PRE_CAPTURE
    seek(driver, target)
    pre_path = run_dir / f'{name}.png'
    capture_canvas(driver, pre_path)
    paths[name] = pre_path

    debris_count = 0
    for name, target in POST_CAPTURES:
        seek(driver, target)
        path = run_dir / f'{name}.png'
        capture_canvas(driver, path)
        paths[name] = path
        if target == 0.0:
            harness = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="non-stellar-destruction"]')
            debris_count = int(harness.get_attribute('data-physical-debris-count') or '0')
            require(debris_count > 0, f'{scenario}/{baseline} did not produce physical debris at true T0')

    # Snapshot verification is deliberately collected after visual captures. Rewinding
    # the deterministic physics fixture before the captures would also rewind the body
    # list while the renderer's effect-introduction map had already observed future IDs.
    deterministic_snapshots: dict[str, list[dict[str, object]]] = {}
    for target in PHYSICS_SNAPSHOT_TIMES:
        seek(driver, target, set_clock=False)
        deterministic_snapshots[f'{target:.3f}'] = physics_snapshot(driver)

    return {
        'physics_source': 'fragmentAwareEngine.stepBodies',
        'physical_debris_count_at_resolve': debris_count,
        'physics_snapshots': deterministic_snapshots,
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
        'collision-vfx-test-clock': '1',
    })
    driver.get(f'{BASE_URL}?{query}')
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__advanceCollisionMergeHandoffStep === "function" && '
            'typeof window.__setCollisionVfxTestTime === "function"'
        )
    )
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
    )

    # This fixture resolves on the 16th deterministic physics step. Capture step 15
    # at T-0.1, then advance the final step with the fake wall clock exactly at T0.
    set_test_time(driver, PRE_CAPTURE[1])
    for step in range(1, 16):
        advance_merge_step(driver, step)
    run_dir = OUTPUT_DIR / 'gentle-merge' / baseline
    run_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    pre_path = run_dir / f'{PRE_CAPTURE[0]}.png'
    capture_canvas(driver, pre_path)
    paths[PRE_CAPTURE[0]] = pre_path

    set_test_time(driver, 0.0)
    advance_merge_step(driver, 16)
    physics = merge_physics(driver)
    require(bool(physics['remnant_id']), f'gentle merge {baseline} did not resolve 2->1 at deterministic T0')
    require(physics['physical_body_count'] == 1, f'gentle merge {baseline} physical body count changed')

    for name, target in POST_CAPTURES:
        set_test_time(driver, target)
        wait_two_frames(driver)
        path = run_dir / f'{name}.png'
        capture_canvas(driver, path)
        paths[name] = path

    return {
        'physics': physics,
        'paths': {name: str(path) for name, path in paths.items()},
    }


def attach_metrics(run: dict[str, object], expected_contact: tuple[float, float]) -> None:
    paths = run['paths']
    assert isinstance(paths, dict)
    pre_path = Path(str(paths[PRE_CAPTURE[0]]))
    metrics: dict[str, dict[str, float | int]] = {}
    for name, _ in (PRE_CAPTURE, *POST_CAPTURES):
        metrics[name] = visual_metrics(Path(str(paths[name])), pre_path, expected_contact)
    run['metrics'] = metrics


def find_expected_contact(run: dict[str, object], *, required: bool = True) -> tuple[float, float]:
    paths = run['paths']
    assert isinstance(paths, dict)
    t0 = visual_metrics(
        Path(str(paths['t0000'])),
        Path(str(paths[PRE_CAPTURE[0]])),
        None,
    )
    if int(t0['flash_pixels']) >= 24:
        return float(t0['centroid_x']), float(t0['centroid_y'])
    require(not required, 'Stage 4 true-T0 contact component could not be identified')
    return VIEWPORT[0] / 2, VIEWPORT[1] / 2


def sum_metric(run: dict[str, object], names: tuple[str, ...], metric: str) -> float:
    metrics = run['metrics']
    assert isinstance(metrics, dict)
    return sum(float(metrics[name][metric]) for name in names)


def peak_frame(run: dict[str, object], names: tuple[str, ...]) -> tuple[str, dict[str, float | int]]:
    metrics = run['metrics']
    assert isinstance(metrics, dict)
    name = max(names, key=lambda key: float(metrics[key]['contact_flash_white_pixels']))
    return name, metrics[name]


def duration_proxy(run: dict[str, object], peak_white_pixels: float) -> float:
    metrics = run['metrics']
    assert isinstance(metrics, dict)
    active_floor = max(4.0, peak_white_pixels * 0.5)
    active = [
        target
        for name, target in POST_CAPTURES
        if target <= 0.5 and float(metrics[name]['contact_flash_white_pixels']) >= active_floor
    ]
    return max(active) if active else 0.0


def summarize_run(run: dict[str, object]) -> dict[str, object]:
    peak_name, peak = peak_frame(run, FLASH_PEAK_NAMES)
    peak_energy = float(peak['transient_luminance_sum'])
    peak_white_pixels = float(peak['contact_flash_white_pixels'])
    return {
        'peak_frame': peak_name,
        'peak_flash_pixels': int(peak['flash_pixels']),
        'peak_bbox_width': int(peak['bbox_width']),
        'peak_bbox_height': int(peak['bbox_height']),
        'peak_bbox_area': int(peak['bbox_area']),
        'peak_contact_offset': float(peak['contact_offset']),
        'peak_transient_luminance': float(peak['peak_transient_luminance']),
        'peak_transient_luminance_sum': peak_energy,
        'peak_contact_flash_white_pixels': int(peak_white_pixels),
        'duration_proxy_seconds': duration_proxy(run, peak_white_pixels),
        'white_occlusion_0p1_to_0p3': sum_metric(
            run,
            ('t0100', 't0150', 't0200', 't0300'),
            'contact_white_transient_pixels',
        ),
        'colored_visibility_0p1_to_0p3': sum_metric(
            run,
            ('t0100', 't0150', 't0200', 't0300'),
            'contact_colored_pixels',
        ),
    }


def build_montage(scenario: str, runs: dict[str, dict[str, object]]) -> Path:
    tile_width = 300
    tile_height = 233
    label_height = 24
    canvas = Image.new('RGB', (tile_width * len(MONTAGE_NAMES), (tile_height + label_height) * 2), '#111')
    draw = ImageDraw.Draw(canvas)
    for row, baseline in enumerate(BASELINES):
        paths = runs[baseline]['paths']
        assert isinstance(paths, dict)
        for column, name in enumerate(MONTAGE_NAMES):
            image = Image.open(Path(str(paths[name]))).convert('RGB')
            image.thumbnail((tile_width, tile_height), Image.Resampling.LANCZOS)
            x = column * tile_width + (tile_width - image.width) // 2
            y0 = row * (tile_height + label_height)
            y = y0 + label_height + (tile_height - image.height) // 2
            canvas.paste(image, (x, y))
            draw.text((column * tile_width + 6, y0 + 5), f'{baseline} {name}', fill='white')
    path = OUTPUT_DIR / scenario / 'stage4-stage5-montage.png'
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    return path


def check_scenario_quality(
    scenario: str,
    stage4: dict[str, object],
    stage5: dict[str, object],
) -> list[dict[str, object]]:
    checks: list[dict[str, object]] = []
    summary4 = stage4['summary']
    summary5 = stage5['summary']
    assert isinstance(summary4, dict) and isinstance(summary5, dict)
    metrics5 = stage5['metrics']
    assert isinstance(metrics5, dict)

    def add(name: str, passed: bool, detail: str) -> None:
        checks.append({'name': name, 'passed': passed, 'detail': detail})

    t0 = metrics5['t0000']
    add(
        'true_t0_impact_cue',
        int(t0['flash_pixels']) >= 10 and float(t0['peak_transient_luminance']) >= 18,
        f"Stage5 T0 area={t0['flash_pixels']} peakDelta={float(t0['peak_transient_luminance']):.1f}",
    )
    add(
        'contact_localization',
        float(summary5['peak_contact_offset']) <= 18.0,
        f"peak contact offset={float(summary5['peak_contact_offset']):.2f}px",
    )
    add(
        'compact_peak',
        int(summary5['peak_bbox_width']) <= 58 and int(summary5['peak_bbox_height']) <= 58,
        f"peak bbox={summary5['peak_bbox_width']}x{summary5['peak_bbox_height']}",
    )
    add(
        'short_decay',
        float(summary5['duration_proxy_seconds']) <= 0.3,
        f"half-peak contact decay proxy={float(summary5['duration_proxy_seconds']):.3f}s",
    )

    if scenario == 'head-on':
        width = max(int(summary5['peak_bbox_width']), 1)
        height = max(int(summary5['peak_bbox_height']), 1)
        aspect = max(width / height, height / width)
        pillar_like = (
            aspect > 2.4
            and max(width, height) >= 40
            and int(summary5['peak_flash_pixels']) >= 80
        )
        add(
            'head_on_no_pillar',
            not pillar_like,
            f"peak bbox={width}x{height} area={summary5['peak_flash_pixels']} aspect={aspect:.2f}",
        )
        add(
            'head_on_compact_vs_stage4',
            int(summary5['peak_bbox_area']) <= int(summary4['peak_bbox_area']) * 1.15 + 80,
            f"peak bbox area Stage4={summary4['peak_bbox_area']} Stage5={summary5['peak_bbox_area']}",
        )
    elif scenario in ('representative', 'oblique', 'default'):
        occlusion4 = float(summary4['white_occlusion_0p1_to_0p3'])
        occlusion5 = float(summary5['white_occlusion_0p1_to_0p3'])
        colored4 = float(summary4['colored_visibility_0p1_to_0p3'])
        colored5 = float(summary5['colored_visibility_0p1_to_0p3'])
        add(
            'late_white_occlusion_not_increased',
            occlusion5 <= occlusion4 * 1.03 + 18,
            f'white occlusion Stage4={occlusion4:.0f} Stage5={occlusion5:.0f}',
        )
        add(
            'physical_color_readability_preserved',
            colored5 + 24 >= colored4 * 0.78,
            f'colored contact pixels Stage4={colored4:.0f} Stage5={colored5:.0f}',
        )
    return checks


def check_gentle_merge_quality(stage4: dict[str, object], stage5: dict[str, object]) -> list[dict[str, object]]:
    summary4 = stage4['summary']
    summary5 = stage5['summary']
    assert isinstance(summary4, dict) and isinstance(summary5, dict)
    return [
        {
            'name': 'gentle_merge_not_more_explosive',
            'passed': int(summary5['peak_bbox_area']) <= int(summary4['peak_bbox_area']) * 1.08 + 50,
            'detail': f"peak bbox area Stage4={summary4['peak_bbox_area']} Stage5={summary5['peak_bbox_area']}",
        },
        {
            'name': 'gentle_merge_short_decay',
            'passed': float(summary5['duration_proxy_seconds']) <= 0.3,
            'detail': f"Stage5 half-peak decay proxy={float(summary5['duration_proxy_seconds']):.3f}s",
        },
    ]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        runs: dict[str, dict[str, dict[str, object]]] = {}
        comparisons: dict[str, dict[str, float]] = {}
        quality_checks: dict[str, list[dict[str, object]]] = {}

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

            expected_contact = find_expected_contact(stage4)
            stage4['expected_contact'] = {'x': expected_contact[0], 'y': expected_contact[1]}
            stage5['expected_contact'] = {'x': expected_contact[0], 'y': expected_contact[1]}
            attach_metrics(stage4, expected_contact)
            attach_metrics(stage5, expected_contact)
            stage4['summary'] = summarize_run(stage4)
            stage5['summary'] = summarize_run(stage5)
            quality_checks[scenario] = check_scenario_quality(scenario, stage4, stage5)
            build_montage(scenario, runs[scenario])

            comparisons[scenario] = {}
            for name, _ in POST_CAPTURES:
                comparisons[scenario][name] = frame_difference(
                    Path(str(stage4['paths'][name])),
                    Path(str(stage5['paths'][name])),
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
        expected_contact = find_expected_contact(gentle4, required=False)
        gentle4['expected_contact'] = {'x': expected_contact[0], 'y': expected_contact[1]}
        gentle5['expected_contact'] = {'x': expected_contact[0], 'y': expected_contact[1]}
        attach_metrics(gentle4, expected_contact)
        attach_metrics(gentle5, expected_contact)
        gentle4['summary'] = summarize_run(gentle4)
        gentle5['summary'] = summarize_run(gentle5)
        quality_checks['gentle-merge'] = check_gentle_merge_quality(gentle4, gentle5)
        build_montage('gentle-merge', runs['gentle-merge'])

        payload = {
            'viewport': {'width': VIEWPORT[0], 'height': VIEWPORT[1]},
            'capture_seconds_relative_to_first_physical_result': {
                PRE_CAPTURE[0]: PRE_CAPTURE[1],
                **{name: target for name, target in POST_CAPTURES},
            },
            'capture_clock': 'test-only deterministic performance.now override, query gated',
            'flash_metric': {
                'channel_threshold': FLASH_CHANNEL_THRESHOLD,
                'minimum_transient_channel_delta': FLASH_TRANSIENT_DELTA,
                'component_min_pixels': FLASH_COMPONENT_MIN_PIXELS,
                'expected_contact_source': 'Stage4 true-T0 transient component centroid',
                'contact_flash_radius_pixels': CONTACT_FLASH_RADIUS,
                'peak_window_seconds': [0.0, 0.033, 0.066],
                'decay_proxy': 'last <=0.5s frame at or above 50% of early contact-white peak',
            },
            'physics_snapshot_seconds': PHYSICS_SNAPSHOT_TIMES,
            'runs': runs,
            'stage4_vs_stage5_mean_pixel_difference': comparisons,
            'quality_checks': quality_checks,
            'acceptance': {
                'physics_state_identical': True,
                'capture_is_impact_relative': True,
                'scenario_specific_vfx_quality': all(
                    bool(check['passed'])
                    for checks in quality_checks.values()
                    for check in checks
                ),
                'gentle_merge_physics_identical': True,
            },
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        failed = [
            f"{scenario}: {check['name']} ({check['detail']})"
            for scenario, checks in quality_checks.items()
            for check in checks
            if not bool(check['passed'])
        ]
        require(not failed, 'Stage 5 visual quality checks failed:\n- ' + '\n- '.join(failed))
        print('collision VFX Stage4/Stage5 impact-relative browser A/B regression: ok')
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
