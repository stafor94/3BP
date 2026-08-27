#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import shutil
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


OUTPUT_DIR = Path(os.environ.get(
    'COLLISION_CAMERA_RETAINED_OUTPUT_DIR',
    'collision-camera-retained-tracking-artifacts',
))
BASE_URL = os.environ.get('COLLISION_CAMERA_RETAINED_BASE_URL', 'http://127.0.0.1:4173/3BP/')
URL = (
    f'{BASE_URL}?visual-regression=production-camera-handoff'
    '&production-camera-fixture=fast-moving-remnant'
)
VIEWPORT_WIDTH = int(os.environ.get('COLLISION_CAMERA_RETAINED_VIEWPORT_WIDTH', '390'))
VIEWPORT_HEIGHT = int(os.environ.get('COLLISION_CAMERA_RETAINED_VIEWPORT_HEIGHT', '844'))
SIMULATION_SPEED = os.environ.get('COLLISION_CAMERA_RETAINED_SPEED', '3')


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


def history(driver: webdriver.Chrome) -> list[dict[str, object]]:
    result = driver.execute_script('return window.__productionCameraHandoffHistory || []')
    return result if isinstance(result, list) else []


def screenshot_canvas(driver: webdriver.Chrome, filename: str) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / filename
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {filename}')


def wait_for_sample(driver: webdriver.Chrome, predicate: str, timeout: float = 35) -> dict[str, object]:
    sample = WebDriverWait(driver, timeout, poll_frequency=0.02).until(
        lambda browser: browser.execute_script(
            f"""
            const samples = window.__productionCameraHandoffHistory || [];
            return samples.find((sample, index) => ({predicate})) || null;
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


def main() -> None:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)
    driver = make_driver()
    samples: list[dict[str, object]] = []
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
        require(
            not any('active' in (button.get_attribute('class') or '').split()
                    for button in driver.find_elements(By.CSS_SELECTOR, '.body-tracking-button')),
            'fixture must begin with no user tracking selection',
        )

        speed_badge = driver.find_element(By.CSS_SELECTOR, '.viewport-badge')
        driver.execute_script('arguments[0].click()', speed_badge)
        speed_button = WebDriverWait(driver, 5).until(
            lambda browser: next(
                button for button in browser.find_elements(By.CSS_SELECTOR, '[role="menuitemradio"]')
                if button.text.strip() == f'{SIMULATION_SPEED}×'
            )
        )
        driver.execute_script('arguments[0].click()', speed_button)
        panel_toggle = driver.find_element(By.CSS_SELECTOR, '.panel-toggle')
        if panel_toggle.get_attribute('aria-expanded') == 'true':
            driver.execute_script('arguments[0].click()', panel_toggle)
        start_button = next(
            button for button in driver.find_elements(By.CSS_SELECTOR, '.start-button')
            if button.is_displayed()
        )
        driver.execute_script('arguments[0].click()', start_button)

        wait_for_sample(driver, "sample.mode === 'collision'")
        screenshot_canvas(driver, 'collision-camera.png')
        wait_for_sample(driver, 'sample.collisionImpactObserved === true')
        release = wait_for_sample(
            driver,
            "index > 0 && samples[index - 1].collisionCameraFocused === true && "
            "sample.collisionCameraFocused === false && sample.collisionImpactObserved === true",
        )
        release_now = float(release['nowMs'])
        screenshot_canvas(driver, 'release.png')
        wait_until_after(driver, release_now, 1000)
        normal = wait_for_sample(
            driver,
            f"sample.nowMs >= {release_now + 900} && sample.mode === 'tracking' && "
            "sample.cameraWriteSource === 'normal-tracking'",
        )
        screenshot_canvas(driver, 'tracking-plus-1s.png')

        samples = history(driver)
        release_sequence = int(release['renderFrameSequence'])
        release_index = next(
            index for index, sample in enumerate(samples)
            if int(sample.get('renderFrameSequence') or -1) == release_sequence
        )
        normal_sequence = int(normal['renderFrameSequence'])
        normal_index = next(
            index for index, sample in enumerate(samples)
            if int(sample.get('renderFrameSequence') or -1) == normal_sequence
        )
        stable_collision_steps = [
            float(samples[index].get('screenSpaceStep') or 0)
            for index in range(max(0, release_index - 10), release_index)
            if samples[index].get('cameraWriteSource') == 'collision-camera'
        ]
        require(len(stable_collision_steps) >= 4, 'need stable collision-camera continuity baseline')
        baseline = percentile(stable_collision_steps, 0.9)
        threshold = max(math.hypot(VIEWPORT_WIDTH, VIEWPORT_HEIGHT) * 0.03, baseline * 4, 12)
        retained_id = release.get('resolvedTrackedBodyId')
        post_release = samples[release_index:normal_index + 1]
        screen_steps = [
            float(sample['screenSpaceStep'])
            for sample in post_release
            if sample.get('screenSpaceStep') is not None
        ]

        metrics = {
            'releaseFrame': release_sequence,
            'firstNormalTrackingFrame': normal_sequence,
            'retainedBodyId': retained_id,
            'releaseMode': release.get('mode'),
            'releaseWriter': release.get('cameraWriteSource'),
            'releaseCollisionCameraJustReleased': release.get('collisionCameraJustReleased'),
            'screenStepBaselineP90': baseline,
            'screenStepThreshold': threshold,
            'maxPostReleaseScreenStep': max(screen_steps, default=0),
            'allPostReleaseVisible': all(bool(sample.get('trackedBodyVisible')) for sample in post_release),
            'allPostReleaseTracking': all(sample.get('mode') == 'tracking' for sample in post_release),
        }
        (OUTPUT_DIR / 'frame-telemetry.json').write_text(
            json.dumps(samples, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        (OUTPUT_DIR / 'metrics.json').write_text(
            json.dumps(metrics, indent=2, sort_keys=True),
            encoding='utf-8',
        )

        require(retained_id is not None, f'collision camera target was not retained: {metrics}')
        require(release.get('mode') == 'tracking', f'release fell back to preserve: {metrics}')
        require(bool(release.get('collisionCameraJustReleased')), f'release handoff was not entered: {metrics}')
        require(release.get('cameraWriteSource') == 'tracking-transition', f'wrong release writer: {metrics}')
        require(metrics['allPostReleaseTracking'], f'camera tracking dropped after release: {metrics}')
        require(metrics['allPostReleaseVisible'], f'retained body left the viewport after release: {metrics}')
        require(
            float(metrics['maxPostReleaseScreenStep']) <= threshold,
            f'camera discontinuity after collision release: {metrics}',
        )
        require(
            all(sample.get('resolvedTrackedBodyId') == retained_id for sample in post_release),
            f'retained collision target identity changed after release: {metrics}',
        )
        print('collision camera retained tracking regression passed')
    finally:
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
