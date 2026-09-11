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

OUTPUT_DIR = Path('collision-watch-visual-artifacts')
URL = os.environ.get(
    'COLLISION_WATCH_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=collision-watch',
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
        window.__setCollisionWatchVisualStage(stage);
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


def capture_canvas(driver: webdriver.Chrome, name: str) -> Path:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / f'{name}.png'
    result = canvas.screenshot(str(path))
    require(bool(result) and path.exists(), f'failed to capture browser canvas for {name}')
    return path


def component_metrics(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    cx = width // 2
    cy = height // 2
    half = min(190, width // 3, height // 2)
    left = max(0, cx - half)
    top = max(0, cy - half)
    right = min(width, cx + half)
    bottom = min(height, cy + half)
    roi = image.crop((left, top, right, bottom))
    roi_width, roi_height = roi.size
    pixels = roi.load()

    mask = [[False] * roi_width for _ in range(roi_height)]
    for y in range(roi_height):
        for x in range(roi_width):
            r, g, b = pixels[x, y]
            luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
            # Track the photosphere by brightness rather than a warm-color bias.
            # Stellar luminosity/temperature rendering can legitimately make the
            # centered primary nearly neutral white, while the surrounding star
            # field remains far below this threshold.
            if luminance >= 120:
                mask[y][x] = True

    visited = [[False] * roi_width for _ in range(roi_height)]
    components: list[tuple[int, int, int, float, float]] = []
    for y in range(roi_height):
        for x in range(roi_width):
            if not mask[y][x] or visited[y][x]:
                continue
            queue = deque([(x, y)])
            visited[y][x] = True
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            sum_x = 0
            sum_y = 0
            while queue:
                px, py = queue.popleft()
                min_x = min(min_x, px)
                max_x = max(max_x, px)
                min_y = min(min_y, py)
                max_y = max(max_y, py)
                count += 1
                sum_x += px
                sum_y += py
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx = px + dx
                        ny = py + dy
                        if nx < 0 or nx >= roi_width or ny < 0 or ny >= roi_height:
                            continue
                        if visited[ny][nx] or not mask[ny][nx]:
                            continue
                        visited[ny][nx] = True
                        queue.append((nx, ny))
            components.append((
                count,
                max_x - min_x + 1,
                max_y - min_y + 1,
                left + sum_x / count,
                top + sum_y / count,
            ))

    require(bool(components), 'camera visual regression could not isolate the primary stellar body')
    components.sort(reverse=True, key=lambda component: component[0])
    area, component_width, component_height, component_cx, component_cy = components[0]
    return {
        'canvas_width': width,
        'canvas_height': height,
        'component_area': area,
        'component_width': component_width,
        'component_height': component_height,
        'component_cx': component_cx,
        'component_cy': component_cy,
        'diameter_fraction': component_width / max(width, 1),
        'center_error_px': ((component_cx - cx) ** 2 + (component_cy - cy) ** 2) ** 0.5,
    }


def image_energy(path: Path) -> int:
    image = Image.open(path).convert('RGB')
    return sum(1 for r, g, b in image.getdata() if max(r, g, b) >= 45)


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
                'return typeof window.__setCollisionWatchVisualStage === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )

        # The renderer converges smoothly toward the collision-watch framing.
        # Give slow/headless CI enough wall time to reach the settled target.
        time.sleep(0.90)
        camera_path = capture_canvas(driver, '01-camera')
        camera_metrics = component_metrics(camera_path)
        payload['camera'] = camera_metrics
        require(
            0.09 <= camera_metrics['diameter_fraction'] <= 0.15,
            'collision-watch primary diameter should occupy roughly 9-15% of viewport width: '
            f"fraction={camera_metrics['diameter_fraction']:.4f}",
        )
        require(
            camera_metrics['center_error_px'] <= 18,
            'collision-watch primary must remain centered on screen: '
            f"error={camera_metrics['center_error_px']:.2f}px",
        )

        set_stage(driver, 'head-on')
        time.sleep(0.38)
        head_on_path = capture_canvas(driver, '02-head-on')
        head_on_energy = image_energy(head_on_path)
        payload['head_on_non_dark_pixels'] = head_on_energy
        require(head_on_energy >= 900, 'head-on collision visual capture is unexpectedly empty')

        set_stage(driver, 'grazing')
        time.sleep(0.38)
        grazing_path = capture_canvas(driver, '03-grazing')
        grazing_energy = image_energy(grazing_path)
        payload['grazing_non_dark_pixels'] = grazing_energy
        require(grazing_energy >= 900, 'grazing collision visual capture is unexpectedly empty')

        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('collision watch browser visual regression: ok')
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
