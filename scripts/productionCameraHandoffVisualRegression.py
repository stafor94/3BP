#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import math
import os
import shutil
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


OUTPUT_DIR = Path(os.environ.get(
    'PRODUCTION_CAMERA_HANDOFF_OUTPUT_DIR',
    'production-camera-handoff-artifacts',
))
BASE_URL = os.environ.get('PRODUCTION_CAMERA_HANDOFF_BASE_URL', 'http://127.0.0.1:4173/3BP/')
URL = (
    f'{BASE_URL}?visual-regression=production-camera-handoff'
    '&production-camera-fixture=fast-moving-remnant'
)
TRACKED_BODY_NAME = os.environ.get('PRODUCTION_CAMERA_TRACKED_BODY', 'Handoff A')
VIEWPORT_WIDTH = int(os.environ.get('PRODUCTION_CAMERA_VIEWPORT_WIDTH', '390'))
VIEWPORT_HEIGHT = int(os.environ.get('PRODUCTION_CAMERA_VIEWPORT_HEIGHT', '844'))
SIMULATION_SPEED = os.environ.get('PRODUCTION_CAMERA_HANDOFF_SPEED', '3')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument(f'--window-size={VIEWPORT_WIDTH},{VIEWPORT_HEIGHT}')
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


def screenshot_canvas(driver: webdriver.Chrome, filename: str) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / filename
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {filename}')


def write_data_url(data_url: str, filename: str) -> None:
    prefix = 'data:image/png;base64,'
    require(data_url.startswith(prefix), f'{filename} must be a PNG data URL')
    path = OUTPUT_DIR / filename
    path.write_bytes(base64.b64decode(data_url[len(prefix):]))
    require(path.exists() and path.stat().st_size > 0, f'failed to write {filename}')


def history(driver: webdriver.Chrome) -> list[dict[str, object]]:
    result = driver.execute_script('return window.__productionCameraHandoffHistory || []')
    return result if isinstance(result, list) else []


def wait_for_sample(driver: webdriver.Chrome, predicate: str, timeout: float = 35) -> dict[str, object]:
    sample = WebDriverWait(driver, timeout, poll_frequency=0.02).until(
        lambda browser: browser.execute_script(
            f"""
            const samples = window.__productionCameraHandoffHistory || [];
            return samples.find((sample) => ({predicate})) || null;
            """
        )
    )
    require(isinstance(sample, dict), f'expected telemetry sample for {predicate}')
    return sample


def wait_until_after(driver: webdriver.Chrome, start_ms: float, elapsed_ms: float) -> None:
    WebDriverWait(driver, 10, poll_frequency=0.01).until(
        lambda browser: float(browser.execute_script('return performance.now()')) >= start_ms + elapsed_ms
    )


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def analyze(samples: list[dict[str, object]]) -> dict[str, object]:
    release_index = next(
        index for index, sample in enumerate(samples)
        if bool(sample.get('collisionCameraJustReleased'))
    )
    handoff_indices = [
        index for index in range(release_index, len(samples))
        if samples[index].get('cameraWriteSource') == 'tracking-transition'
    ]
    require(handoff_indices, 'production path must enter tracking-transition after release')
    handoff_last_index = handoff_indices[-1]
    first_normal_index = next(
        index for index in range(handoff_last_index + 1, len(samples))
        if samples[index].get('cameraWriteSource') == 'normal-tracking'
    )

    stable_collision_screen_steps = [
        float(samples[index].get('screenSpaceStep') or 0)
        for index in range(max(0, release_index - 10), release_index)
        if samples[index].get('cameraWriteSource') == 'collision-camera'
    ]
    require(
        len(stable_collision_screen_steps) >= 4,
        'continuity baseline requires stable collision-camera frames immediately before release',
    )
    screen_baseline = percentile(stable_collision_screen_steps, 0.9)
    viewport_diagonal = math.hypot(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
    screen_threshold = max(viewport_diagonal * 0.03, screen_baseline * 4, 12)

    first_discontinuity_index: int | None = None
    for index in range(release_index, len(samples)):
        sample = samples[index]
        screen_step = sample.get('screenSpaceStep')
        if screen_step is not None and float(screen_step) > screen_threshold:
            first_discontinuity_index = index
            break
        if index > 0 and samples[index - 1].get('resolvedTrackedBodyId') != sample.get('resolvedTrackedBodyId'):
            first_discontinuity_index = index
            break

    first_error = samples[first_discontinuity_index] if first_discontinuity_index is not None else None
    writer_before = (
        samples[first_discontinuity_index - 1].get('finalCameraWriteSource')
        if first_discontinuity_index is not None and first_discontinuity_index > 0
        else None
    )
    metrics: dict[str, object] = {
        'rootCause': 'C_MOVING_TARGET_FIXED_WORLD_TRANSFORM',
        'trackedBodyName': TRACKED_BODY_NAME,
        'requestedSimulationSpeed': float(SIMULATION_SPEED),
        'viewport': {'width': VIEWPORT_WIDTH, 'height': VIEWPORT_HEIGHT},
        'releaseFrame': samples[release_index].get('renderFrameSequence'),
        'handoffLastFrame': samples[handoff_last_index].get('renderFrameSequence'),
        'firstNormalTrackingFrame': samples[first_normal_index].get('renderFrameSequence'),
        'firstDiscontinuityFrame': first_error.get('renderFrameSequence') if first_error else None,
        'writerBefore': writer_before,
        'writerAfter': first_error.get('finalCameraWriteSource') if first_error else None,
        'trackedSourceId': first_error.get('trackedBodyId') if first_error else samples[release_index].get('trackedBodyId'),
        'resolvedTrackedBodyId': first_error.get('resolvedTrackedBodyId') if first_error else samples[release_index].get('resolvedTrackedBodyId'),
        'cameraPositionStep': first_error.get('cameraPositionStep') if first_error else 0,
        'targetStep': first_error.get('targetStep') if first_error else 0,
        'distanceStep': first_error.get('distanceStep') if first_error else 0,
        'screenSpaceStep': first_error.get('screenSpaceStep') if first_error else 0,
        'trackedBodyWorldStep': first_error.get('trackedBodyWorldStep') if first_error else 0,
        'transitionProgress': first_error.get('trackingTransitionProgress') if first_error else None,
        'simulationTime': first_error.get('simulationTime') if first_error else None,
        'wallTime': first_error.get('nowMs') if first_error else None,
        'controlsUpdateChangedTransform': first_error.get('controlsUpdateChangedTransform') if first_error else False,
        'screenStepBaselineP90': screen_baseline,
        'screenStepThreshold': screen_threshold,
        'releaseToHandoffFrameCount': handoff_last_index - release_index + 1,
        'handoffToNormalBoundary': {
            'before': samples[handoff_last_index],
            'after': samples[first_normal_index],
        },
    }
    return metrics


def main() -> None:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)
    driver = make_driver()
    metrics: dict[str, object] = {}

    try:
        driver.set_page_load_timeout(25)
        driver.set_script_timeout(15)
        driver.get(BASE_URL)
        driver.execute_script(
            """
            localStorage.setItem('3bp-space-mode', '3d');
            localStorage.setItem('3bp-body-count', '2');
            localStorage.setItem('3bp-preset', 'binaryOrbit');
            localStorage.setItem('3bp-collision-watch-enabled', 'true');
            localStorage.setItem('3bp-trail-enabled', 'true');
            localStorage.setItem('3bp-language', 'en');
            """
        )
        driver.get(URL)

        WebDriverWait(driver, 20, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        tracked_button = WebDriverWait(driver, 10).until(
            lambda browser: browser.find_element(By.CSS_SELECTOR, f'.body-tracking-button[title="{TRACKED_BODY_NAME}"]')
        )
        driver.execute_script('arguments[0].click()', tracked_button)
        WebDriverWait(driver, 10).until(
            lambda browser: browser.find_element(
                By.CSS_SELECTOR,
                f'.body-tracking-button[title="{TRACKED_BODY_NAME}"]',
            ).get_attribute('aria-pressed') == 'true'
        )

        speed_badge = driver.find_element(By.CSS_SELECTOR, '.viewport-badge')
        driver.execute_script('arguments[0].click()', speed_badge)
        speed_three = WebDriverWait(driver, 5).until(
            lambda browser: next(
                button for button in browser.find_elements(By.CSS_SELECTOR, '[role="menuitemradio"]')
                if button.text.strip() == f'{SIMULATION_SPEED}×'
            )
        )
        driver.execute_script('arguments[0].click()', speed_three)
        panel_toggle = driver.find_element(By.CSS_SELECTOR, '.panel-toggle')
        if panel_toggle.get_attribute('aria-expanded') == 'true':
            driver.execute_script('arguments[0].click()', panel_toggle)
        start_button = next(
            button for button in driver.find_elements(By.CSS_SELECTOR, '.start-button')
            if button.is_displayed()
        )
        driver.execute_script('arguments[0].click()', start_button)
        time.sleep(0.2)
        screenshot_canvas(driver, 'pre-collision.png')

        wait_for_sample(driver, "sample.mode === 'collision'")
        screenshot_canvas(driver, 'collision-camera.png')
        wait_for_sample(driver, 'sample.collisionImpactObserved === true')
        release = wait_for_sample(driver, 'sample.collisionCameraJustReleased === true')
        release_now = float(release['nowMs'])

        for elapsed_ms, filename in (
            (250, 'tracking-plus-250ms.png'),
            (500, 'tracking-plus-500ms.png'),
            (1000, 'tracking-plus-1000ms.png'),
        ):
            wait_until_after(driver, release_now, elapsed_ms)
            screenshot_canvas(driver, filename)

        wait_for_sample(
            driver,
            f"sample.nowMs >= {release_now + 1200} && sample.cameraWriteSource === 'normal-tracking'",
        )
        samples = history(driver)
        metrics = analyze(samples)

        frames = driver.execute_script('return window.__productionCameraHandoffFrames || {}')
        require(isinstance(frames, dict), 'renderer must expose exact boundary frame captures')
        for key, filename in (
            ('last-collision-frame', 'last-collision-frame.png'),
            ('release-frame', 'release-frame.png'),
            ('handoff-mid', 'handoff-mid.png'),
            ('handoff-last-frame', 'handoff-last-frame.png'),
            ('first-normal-tracking-frame', 'first-normal-tracking-frame.png'),
        ):
            require(isinstance(frames.get(key), str), f'missing exact renderer capture: {key}')
            write_data_url(frames[key], filename)

        (OUTPUT_DIR / 'frame-telemetry.json').write_text(
            json.dumps(samples, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        (OUTPUT_DIR / 'metrics.json').write_text(
            json.dumps(metrics, indent=2, sort_keys=True),
            encoding='utf-8',
        )

        require(
            metrics['firstDiscontinuityFrame'] is None,
            f"production camera handoff discontinuity: {json.dumps(metrics, sort_keys=True)}",
        )
        print('production camera handoff browser regression passed')
    finally:
        samples = history(driver)
        if samples and not (OUTPUT_DIR / 'frame-telemetry.json').exists():
            (OUTPUT_DIR / 'frame-telemetry.json').write_text(
                json.dumps(samples, indent=2, sort_keys=True),
                encoding='utf-8',
            )
        if metrics and not (OUTPUT_DIR / 'metrics.json').exists():
            (OUTPUT_DIR / 'metrics.json').write_text(
                json.dumps(metrics, indent=2, sort_keys=True),
                encoding='utf-8',
            )
        driver.quit()


if __name__ == '__main__':
    main()
