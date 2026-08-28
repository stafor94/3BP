#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import time
from collections import deque
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('small-head-on-collision-artifact-visual-artifacts')
URL = os.environ.get(
    'SMALL_HEAD_ON_COLLISION_ARTIFACT_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=small-head-on-collision-artifacts',
)
CAPTURES = [
    ('02-flash-080ms', 0.08),
    ('03-flash-160ms', 0.16),
    ('04-fracture-900ms', 0.90),
    ('05-transfer-1350ms', 1.35),
]


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


def capture_canvas(driver: webdriver.Chrome, name: str) -> Path:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / f'{name}.png'
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {name}')
    return path


def trigger(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        window.__startSmallHeadOnCollisionArtifactVisual();
        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== 'collision') {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(done));
        };
        requestAnimationFrame(waitForCommit);
        """
    )


def wait_until(started_at: float, target_seconds: float) -> None:
    remaining = target_seconds - (time.monotonic() - started_at)
    if remaining > 0:
        time.sleep(remaining)


def connected_components(mask: set[tuple[int, int]], minimum_area: int = 3) -> list[list[tuple[int, int]]]:
    remaining = set(mask)
    components: list[list[tuple[int, int]]] = []
    while remaining:
        seed = remaining.pop()
        queue = deque([seed])
        component = [seed]
        while queue:
            x, y = queue.popleft()
            for neighbor in (
                (x - 1, y - 1), (x, y - 1), (x + 1, y - 1),
                (x - 1, y),                   (x + 1, y),
                (x - 1, y + 1), (x, y + 1), (x + 1, y + 1),
            ):
                if neighbor not in remaining:
                    continue
                remaining.remove(neighbor)
                queue.append(neighbor)
                component.append(neighbor)
        if len(component) >= minimum_area:
            components.append(component)
    return sorted(components, key=len, reverse=True)


def bounds(component: list[tuple[int, int]]) -> tuple[int, int, int, int]:
    xs = [point[0] for point in component]
    ys = [point[1] for point in component]
    return min(xs), min(ys), max(xs), max(ys)


def centroid(component: list[tuple[int, int]]) -> tuple[float, float]:
    return (
        sum(x for x, _ in component) / len(component),
        sum(y for _, y in component) / len(component),
    )


def bright_mask(path: Path) -> tuple[Image.Image, set[tuple[int, int]]]:
    image = Image.open(path).convert('RGB')
    cx, cy = image.width // 2, image.height // 2
    mask: set[tuple[int, int]] = set()
    for y in range(max(0, cy - 150), min(image.height, cy + 151)):
        for x in range(max(0, cx - 150), min(image.width, cx + 151)):
            r, g, b = image.getpixel((x, y))
            luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if luminance >= 185 and min(r, g, b) >= 105:
                mask.add((x, y))
    return image, mask


def spike_metrics(path: Path) -> dict[str, float | int]:
    image, mask = bright_mask(path)
    cx, cy = image.width // 2, image.height // 2
    components = connected_components(mask, minimum_area=4)
    central = [
        component
        for component in components
        if abs(centroid(component)[0] - cx) <= 36 and abs(centroid(component)[1] - cy) <= 48
    ]
    require(bool(central), f'{path.name}: no high-luminance collision-center component')
    component = max(central, key=len)
    x0, y0, x1, y1 = bounds(component)
    width = x1 - x0 + 1
    height = y1 - y0 + 1

    vertical_run = 0
    for x in range(max(x0, cx - 10), min(x1, cx + 10) + 1):
        run = 0
        best = 0
        for y in range(y0, y1 + 1):
            if (x, y) in mask:
                run += 1
                best = max(best, run)
            else:
                run = 0
        vertical_run = max(vertical_run, best)

    horizontal_run = 0
    for y in range(max(y0, cy - 10), min(y1, cy + 10) + 1):
        run = 0
        best = 0
        for x in range(x0, x1 + 1):
            if (x, y) in mask:
                run += 1
                best = max(best, run)
            else:
                run = 0
        horizontal_run = max(horizontal_run, best)

    run_aspect = vertical_run / max(horizontal_run, 1)
    bbox_aspect = height / max(width, 1)
    return {
        'area': len(component),
        'width': width,
        'height': height,
        'bbox_vertical_aspect': bbox_aspect,
        'vertical_run': vertical_run,
        'horizontal_run': horizontal_run,
        'run_vertical_aspect': run_aspect,
    }


def is_brown(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    # Synthetic solid chunks share the remnant's very dark brown palette. Include
    # the shaded body surface so tiny bright handoff particles cannot be selected
    # as the central "remnant" component by the regression classifier.
    return (
        14 <= r <= 205
        and 10 <= g <= 175
        and 8 <= b <= 150
        and r >= g * 1.06
        and r >= b * 1.12
        and g >= b
    )


def debris_column_metrics(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    cx, cy = image.width // 2, image.height // 2
    roi_radius = 120
    mask: set[tuple[int, int]] = set()
    for y in range(max(0, cy - roi_radius), min(image.height, cy + roi_radius + 1)):
        for x in range(max(0, cx - roi_radius), min(image.width, cx + roi_radius + 1)):
            if is_brown(image.getpixel((x, y))):
                mask.add((x, y))

    components = connected_components(mask, minimum_area=5)
    require(bool(components), f'{path.name}: no remnant/debris brown component')
    center_sorted = sorted(
        components,
        key=lambda component: (
            (centroid(component)[0] - cx) ** 2 + (centroid(component)[1] - cy) ** 2,
            -len(component),
        ),
    )
    remnant = center_sorted[0]
    rx0, ry0, rx1, ry1 = bounds(remnant)
    remnant_width = max(1, rx1 - rx0 + 1)
    remnant_height = max(1, ry1 - ry0 + 1)
    remnant_aspect = remnant_height / remnant_width

    corridor_half_width = max(8.0, remnant_width * 0.62)
    vertical_limit = max(24.0, remnant_height * 1.9)
    satellite_components = []
    for component in components:
        if component is remnant:
            continue
        ccx, ccy = centroid(component)
        if abs(ccx - cx) > corridor_half_width:
            continue
        if abs(ccy - cy) > vertical_limit:
            continue
        satellite_components.append(component)

    above = sum(1 for component in satellite_components if centroid(component)[1] < cy)
    below = sum(1 for component in satellite_components if centroid(component)[1] > cy)
    satellite_area = sum(len(component) for component in satellite_components)
    return {
        'remnant_area': len(remnant),
        'remnant_width': remnant_width,
        'remnant_height': remnant_height,
        'remnant_vertical_aspect': remnant_aspect,
        'vertical_satellite_count': len(satellite_components),
        'vertical_satellite_above': above,
        'vertical_satellite_below': below,
        'vertical_satellite_area': satellite_area,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__startSmallHeadOnCollisionArtifactVisual === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.6)
        capture_canvas(driver, '01-contact')

        trigger(driver)
        started_at = time.monotonic()
        captures: dict[str, Path] = {}
        for name, target in CAPTURES:
            wait_until(started_at, target)
            captures[name] = capture_canvas(driver, name)

        flash_metrics = {
            name: spike_metrics(captures[name])
            for name in ('02-flash-080ms', '03-flash-160ms')
        }
        debris_metrics = {
            name: debris_column_metrics(captures[name])
            for name in ('04-fracture-900ms', '05-transfer-1350ms')
        }

        payload = {
            'flash': flash_metrics,
            'debris': debris_metrics,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        for name, metrics in flash_metrics.items():
            require(
                metrics['run_vertical_aspect'] <= 2.20,
                f'{name}: narrow high-luminance vertical spike remains at collision center',
            )
            require(
                metrics['bbox_vertical_aspect'] <= 2.35,
                f'{name}: collision-center high-luminance component is still pillar-shaped',
            )

        for name, metrics in debris_metrics.items():
            require(
                metrics['remnant_vertical_aspect'] <= 1.55,
                f'{name}: brown remnant/debris silhouette is vertically columnar',
            )
            require(
                metrics['vertical_satellite_count'] <= 2,
                f'{name}: multiple large brown synthetic chunks remain aligned above/below remnant',
            )
            require(
                not (
                    metrics['vertical_satellite_above'] >= 2
                    and metrics['vertical_satellite_below'] >= 2
                ),
                f'{name}: symmetric vertical debris bead column remains on both sides of remnant',
            )

        print('small head-on collision artifact browser visual regression: ok')
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
