#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-camera-tracking-handoff-artifacts')
URL = os.environ.get(
    'COLLISION_CAMERA_TRACKING_HANDOFF_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=tracking-camera-handoff',
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=900,700')
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


def set_stage(driver: webdriver.Chrome, stage: str) -> None:
    driver.execute_async_script(
        """
        const stage = arguments[0];
        const done = arguments[arguments.length - 1];
        window.__setTrackingCameraHandoffStage(stage);
        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== stage) {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(done));
        };
        requestAnimationFrame(waitForCommit);
        """,
        stage,
    )


def screenshot_canvas(driver: webdriver.Chrome, name: str) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="tracking-camera-handoff"] canvas')
    path = OUTPUT_DIR / f'{name}.png'
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {name}')


def nearest_sample(samples: list[dict[str, object]], elapsed_ms: float) -> dict[str, object]:
    return min(samples, key=lambda sample: abs(float(sample['elapsedMs']) - elapsed_ms))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    payload: dict[str, object] = {}

    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__setTrackingCameraHandoffStage === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(
                By.CSS_SELECTOR,
                '[data-visual-regression="tracking-camera-handoff"] canvas',
            )) == 1
        )

        time.sleep(0.45)
        tracking = driver.execute_script('return window.__trackingCameraHandoffTelemetry')
        require(tracking and tracking['mode'] == 'tracking', 'fixture must begin in ordinary tracking mode')
        require(tracking['trackedBodyId'] == 'handoff-a', 'initial tracking source id must stay selected')

        set_stage(driver, 'collision')
        time.sleep(0.75)
        before_release = driver.execute_script('return window.__trackingCameraHandoffTelemetry')
        require(before_release and before_release['mode'] == 'collision', 'collision camera must own the frame before release')
        require(before_release['trackedBodyId'] == 'handoff-a', 'collision camera must not clear the tracking selection')
        screenshot_canvas(driver, '01-before-release')

        set_stage(driver, 'release')
        WebDriverWait(driver, 10, poll_frequency=0.02).until(
            lambda browser: browser.execute_script(
                """
                const samples = window.__trackingCameraHandoffSamples || [];
                return samples.length > 0 && samples[samples.length - 1].elapsedMs >= 650;
                """
            )
        )
        samples = driver.execute_script('return window.__trackingCameraHandoffSamples')
        require(isinstance(samples, list) and len(samples) >= 4, 'release telemetry must contain multiple renderer frames')

        retained_trail_ids = driver.execute_script(
            'return window.__trackingCameraHandoffRetainedTrailIds || []'
        )
        require(
            'handoff-a' in retained_trail_ids and 'handoff-b' in retained_trail_ids,
            f'collision source trails must remain after merge body-id replacement: {retained_trail_ids}',
        )
        payload['retained_trail_ids'] = retained_trail_ids

        first = samples[0]
        require(float(first['elapsedMs']) <= 50, 'first release telemetry must represent the immediate handoff frame')
        require(first['mode'] == 'tracking', 'release frame must go directly from collision mode to tracking mode')
        require(bool(first['collisionCameraJustReleased']), 'release frame must explicitly detect the camera-mode transition')
        require(bool(first['trackingFocusNeedsReset']), 'release frame must restart tracking focus settle')
        require(int(first['trackingFocusSettleFrames']) > 0, 'release frame must have active tracking settle frames')
        require(first['trackedBodyId'] == 'handoff-a', 'tracked source id must remain selected across handoff')
        require(first['resolvedTrackedBodyId'] == 'handoff-a+handoff-b', 'tracking must resolve to the authorized continuation')

        checkpoints = {
            'release_frame': nearest_sample(samples, 0),
            'plus_100ms': nearest_sample(samples, 100),
            'plus_300ms': nearest_sample(samples, 300),
            'plus_600ms': nearest_sample(samples, 600),
        }
        payload['before_release'] = before_release
        payload['checkpoints'] = checkpoints

        previous_error = None
        previous_distance = None
        max_relative_step = 0.0
        for sample in samples:
            if sample['mode'] != 'tracking':
                continue
            distance = float(sample['cameraDistanceToTrackedBody'])
            desired = float(sample['desiredCameraDistance'])
            error = abs(distance - desired)
            if previous_error is not None and int(sample['trackingFocusSettleFrames']) > 0:
                require(
                    error <= previous_error + 1e-5,
                    f'tracking distance error must decrease continuously during settle: {error} > {previous_error}',
                )
            if previous_distance is not None:
                relative_step = abs(distance - previous_distance) / max(abs(previous_distance), 1e-9)
                max_relative_step = max(max_relative_step, relative_step)
            previous_error = error
            previous_distance = distance

        require(max_relative_step <= 0.25, f'camera distance changed too abruptly in one frame: {max_relative_step:.4f}')
        payload['max_relative_distance_step'] = max_relative_step

        checkpoint_errors: list[float] = []
        checkpoint_target_errors: list[float] = []
        for name, sample in checkpoints.items():
            require(sample['mode'] == 'tracking', f'{name} must remain in tracking camera mode')
            require(sample['trackedBodyId'] == 'handoff-a', f'{name} must keep the tracking UI source id')
            require(sample['resolvedTrackedBodyId'] == 'handoff-a+handoff-b', f'{name} must keep the continuation target')
            ndc = sample['trackedBodyNdc']
            require(ndc is not None, f'{name} must expose tracked-body viewport telemetry')
            require(abs(float(ndc['x'])) <= 0.08 and abs(float(ndc['y'])) <= 0.08, f'{name} tracked body left viewport center: {ndc}')
            require(-1.0 <= float(ndc['z']) <= 1.0, f'{name} tracked body left camera depth range: {ndc}')
            target_error = float(sample['targetErrorToTrackedBody'])
            require(target_error <= 0.03, f'{name} controls target drifted away from tracked body: {target_error}')
            checkpoint_target_errors.append(target_error)
            distance = float(sample['cameraDistanceToTrackedBody'])
            desired = float(sample['desiredCameraDistance'])
            checkpoint_errors.append(abs(distance - desired))

        require(
            all(checkpoint_errors[index] <= checkpoint_errors[index - 1] + 1e-4 for index in range(1, len(checkpoint_errors))),
            f'checkpoint camera-distance error must not increase: {checkpoint_errors}',
        )
        require(
            checkpoint_errors[-1] / max(float(checkpoints['plus_600ms']['desiredCameraDistance']), 1e-9) <= 0.08,
            f'camera must converge close to tracked-body distance by +600ms: {checkpoint_errors[-1]}',
        )
        require(
            all(error <= checkpoint_target_errors[0] + 1e-5 for error in checkpoint_target_errors[1:]),
            f'camera target error must stay non-increasing after release: {checkpoint_target_errors}',
        )

        time.sleep(0.05)
        screenshot_canvas(driver, '02-after-release')
        (OUTPUT_DIR / 'metrics.json').write_text(
            json.dumps(payload, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        print('collision camera tracking handoff browser regression passed')
    finally:
        driver.quit()


if __name__ == '__main__':
    main()
