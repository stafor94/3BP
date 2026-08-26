#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import time
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('visual-regression-artifacts')
URL = os.environ.get(
    'VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=stellar-topology',
)


@dataclass
class FrameMetrics:
    width: int
    height: int
    roi_width: int
    roi_height: int
    hot_neutral_pixels: int
    hot_neutral_fraction: float
    largest_component_area: int
    largest_component_width: int
    largest_component_height: int
    largest_component_cx: float
    largest_component_cy: float
    saturated_bright_pixels: int
    saturated_bright_fraction: float


def assert_condition(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def connected_components(mask: list[list[bool]]) -> list[tuple[int, int, int, float, float]]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    visited = [[False] * width for _ in range(height)]
    components: list[tuple[int, int, int, float, float]] = []

    for y in range(height):
        for x in range(width):
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
                cx, cy = queue.popleft()
                count += 1
                sum_x += cx
                sum_y += cy
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)

                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx = cx + dx
                        ny = cy + dy
                        if nx < 0 or nx >= width or ny < 0 or ny >= height:
                            continue
                        if visited[ny][nx] or not mask[ny][nx]:
                            continue
                        visited[ny][nx] = True
                        queue.append((nx, ny))

            components.append((
                count,
                max_x - min_x + 1,
                max_y - min_y + 1,
                sum_x / count,
                sum_y / count,
            ))

    components.sort(reverse=True, key=lambda component: component[0])
    return components


def analyze(path: Path) -> FrameMetrics:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    cx = width // 2
    cy = height // 2

    half_width = min(150, max(width // 3, 80))
    half_height = min(110, max(height // 3, 70))
    left = max(0, cx - half_width)
    upper = max(0, cy - half_height)
    right = min(width, cx + half_width)
    lower = min(height, cy + half_height)
    roi = image.crop((left, upper, right, lower))
    roi_width, roi_height = roi.size

    hot_mask = [[False] * roi_width for _ in range(roi_height)]
    hot_count = 0
    saturated_count = 0

    pixels = roi.load()
    for y in range(roi_height):
        for x in range(roi_width):
            r, g, b = pixels[x, y]
            maximum = max(r, g, b)
            minimum = min(r, g, b)
            spread = maximum - minimum
            luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

            is_hot_neutral = luminance >= 178 and spread <= 58
            if is_hot_neutral:
                hot_mask[y][x] = True
                hot_count += 1

            if luminance >= 92 and spread >= 72:
                saturated_count += 1

    components = connected_components(hot_mask)
    largest = components[0] if components else (0, 0, 0, 0.0, 0.0)
    area = max(roi_width * roi_height, 1)

    return FrameMetrics(
        width=width,
        height=height,
        roi_width=roi_width,
        roi_height=roi_height,
        hot_neutral_pixels=hot_count,
        hot_neutral_fraction=hot_count / area,
        largest_component_area=largest[0],
        largest_component_width=largest[1],
        largest_component_height=largest[2],
        largest_component_cx=largest[3],
        largest_component_cy=largest[4],
        saturated_bright_pixels=saturated_count,
        saturated_bright_fraction=saturated_count / area,
    )


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


def set_stage(driver: webdriver.Chrome, stage: str) -> float:
    # Do not use Selenium's default 500 ms polling here. The occlusion-retention
    # window itself is only hundreds of milliseconds, so a coarse DOM poll can
    # accidentally sample after the effect has correctly retired. Synchronize
    # inside the browser on animation frames instead.
    elapsed_ms = driver.execute_async_script(
        """
        const stage = arguments[0];
        const done = arguments[arguments.length - 1];
        const startedAt = performance.now();
        window.__setStellarVisualStage(stage);

        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== stage) {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(() => {
            done(performance.now() - startedAt);
          }));
        };
        requestAnimationFrame(waitForCommit);
        """,
        stage,
    )
    elapsed = float(elapsed_ms)
    assert_condition(elapsed < 180, f'visual stage transition was too slow for deterministic capture: {elapsed:.1f} ms')
    return elapsed


def capture_canvas(driver: webdriver.Chrome, name: str) -> tuple[Path, FrameMetrics]:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / f'{name}.png'
    result = canvas.screenshot(str(path))
    assert_condition(bool(result) and path.exists(), f'failed to capture browser canvas for {name}')
    metrics = analyze(path)
    return path, metrics


def validate(metrics: dict[str, FrameMetrics]) -> None:
    separate = metrics['separate']
    peak = metrics['peak']
    retained = metrics['remnant-retained']
    faded = metrics['remnant-faded']

    assert_condition(
        peak.largest_component_area >= max(900, int(separate.largest_component_area * 1.5)),
        'peak topology mask does not form a substantially larger connected screen region than the source stars: '
        f'separate={separate.largest_component_area}px peak={peak.largest_component_area}px',
    )
    assert_condition(
        peak.largest_component_width >= max(78, int(separate.largest_component_width * 1.5)),
        'peak topology mask is not wide enough to bridge and cover both source silhouettes: '
        f'separate={separate.largest_component_width}px peak={peak.largest_component_width}px',
    )
    assert_condition(
        peak.largest_component_height >= 32,
        f'peak topology mask is too thin to hide stellar silhouettes: {peak.largest_component_height}px',
    )
    assert_condition(
        peak.saturated_bright_fraction <= separate.saturated_bright_fraction * 0.55,
        'source-star colored silhouettes remain too exposed at peak instead of being washed into the impact mask: '
        f'separate={separate.saturated_bright_fraction:.4f}, peak={peak.saturated_bright_fraction:.4f}',
    )

    assert_condition(
        retained.largest_component_width >= int(peak.largest_component_width * 0.68),
        'topology veil collapses horizontally on the first remnant frame: '
        f'peak={peak.largest_component_width}px retained={retained.largest_component_width}px',
    )
    assert_condition(
        retained.largest_component_area >= int(peak.largest_component_area * 0.45),
        'topology veil disappears too early after the 2->1 switch: '
        f'peak={peak.largest_component_area}px retained={retained.largest_component_area}px',
    )
    assert_condition(
        retained.hot_neutral_pixels >= int(peak.hot_neutral_pixels * 0.4),
        'the first remnant frame is not still visibly covered by the white-hot handoff mask: '
        f'peak={peak.hot_neutral_pixels}px retained={retained.hot_neutral_pixels}px',
    )

    assert_condition(
        faded.hot_neutral_pixels <= int(retained.hot_neutral_pixels * 0.78),
        'topology veil does not visibly retire after its handoff window: '
        f'retained={retained.hot_neutral_pixels}px faded={faded.hot_neutral_pixels}px',
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    metrics: dict[str, FrameMetrics] = {}
    transition_ms: dict[str, float] = {}

    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script('return typeof window.__setStellarVisualStage === "function"')
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.18)

        _, metrics['separate'] = capture_canvas(driver, '01-separate')

        transition_ms['peak'] = set_stage(driver, 'peak')
        time.sleep(0.10)
        _, metrics['peak'] = capture_canvas(driver, '02-peak')

        transition_ms['remnant'] = set_stage(driver, 'remnant')
        time.sleep(0.02)
        _, metrics['remnant-retained'] = capture_canvas(driver, '03-remnant-retained')

        time.sleep(0.62)
        _, metrics['remnant-faded'] = capture_canvas(driver, '04-remnant-faded')

        serialized = {
            'transition_ms': transition_ms,
            'frames': {name: asdict(value) for name, value in metrics.items()},
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(serialized, indent=2), encoding='utf-8')
        print(json.dumps(serialized, indent=2))
        validate(metrics)
        print('stellar collision browser visual regression: ok')
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
