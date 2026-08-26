#!/usr/bin/env python3
from __future__ import annotations

import json
import math
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

OUTPUT_DIR = Path('absorption-continuity-visual-artifacts')
URL = os.environ.get(
    'ABSORPTION_CONTINUITY_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=absorption-continuity',
)
CAPTURE_STEPS = [0, 8, 12, 15, 16]
INITIAL_IMPACTOR_RADIUS = 0.0187


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


def set_visual_step(driver: webdriver.Chrome, step: int) -> None:
    driver.execute_async_script(
        """
        const target = arguments[0];
        const done = arguments[arguments.length - 1];
        window.__setAbsorptionContinuityVisualStep(target);
        const waitForCommit = () => {
          if (document.body.dataset.visualStep !== String(target)) {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(done));
        };
        requestAnimationFrame(waitForCommit);
        """,
        step,
    )


def read_diagnostics(driver: webdriver.Chrome) -> dict[str, float | int | str]:
    root = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="absorption-continuity"]')
    return {
        'impactor_radius': float(root.get_attribute('data-impactor-radius') or 0),
        'primary_radius': float(root.get_attribute('data-primary-radius') or 0),
        'remnant_id': root.get_attribute('data-remnant-id') or '',
        'mass_effect_count': int(root.get_attribute('data-mass-effect-count') or 0),
        'solid_fragment_count': int(root.get_attribute('data-solid-fragment-count') or 0),
        'max_effect_stretch': float(root.get_attribute('data-max-effect-stretch') or 0),
        'max_effect_tail': float(root.get_attribute('data-max-effect-tail') or 0),
    }


def bright_components(path: Path) -> list[dict[str, float | int]]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.18), int(width * 0.82)
    y0, y1 = int(height * 0.14), int(height * 0.86)
    occupied: set[tuple[int, int]] = set()
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if max(r, g, b) >= 62 and (r + g + b) >= 108:
                occupied.add((x, y))

    components: list[dict[str, float | int]] = []
    while occupied:
        seed = occupied.pop()
        queue = deque([seed])
        points = [seed]
        while queue:
            x, y = queue.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    candidate = (x + dx, y + dy)
                    if candidate in occupied:
                        occupied.remove(candidate)
                        queue.append(candidate)
                        points.append(candidate)
        if len(points) < 8:
            continue
        xs = [x for x, _ in points]
        ys = [y for _, y in points]
        component_width = max(xs) - min(xs) + 1
        component_height = max(ys) - min(ys) + 1
        components.append({
            'area': len(points),
            'min_x': min(xs),
            'max_x': max(xs),
            'min_y': min(ys),
            'max_y': max(ys),
            'width': component_width,
            'height': component_height,
            'cx': sum(xs) / len(xs),
            'cy': sum(ys) / len(ys),
            'aspect': max(component_width / max(component_height, 1), component_height / max(component_width, 1)),
        })
    return sorted(components, key=lambda component: int(component['area']), reverse=True)


def component_gap(a: dict[str, float | int], b: dict[str, float | int]) -> float:
    dx = max(0.0, float(b['min_x']) - float(a['max_x']), float(a['min_x']) - float(b['max_x']))
    dy = max(0.0, float(b['min_y']) - float(a['max_y']), float(a['min_y']) - float(b['max_y']))
    return math.hypot(dx, dy)


def detached_component_metrics(path: Path) -> dict[str, object]:
    components = bright_components(path)
    if not components:
        return {
            'component_count': 0,
            'primary_area': 0,
            'detached_count': 0,
            'detached_areas': [],
            'max_detached_aspect': 0.0,
        }
    primary = components[0]
    detached = [
        component
        for component in components[1:]
        if int(component['area']) >= 16 and component_gap(primary, component) >= 10.0
    ]
    return {
        'component_count': len(components),
        'primary_area': int(primary['area']),
        'detached_count': len(detached),
        'detached_areas': [int(component['area']) for component in detached],
        'max_detached_aspect': max((float(component['aspect']) for component in detached), default=0.0),
    }


def cyan_pixels(path: Path) -> int:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.25), int(width * 0.75)
    y0, y1 = int(height * 0.20), int(height * 0.80)
    count = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if g >= 42 and b >= 48 and b >= r * 1.08 and g >= r * 1.04:
                count += 1
    return count


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__setAbsorptionContinuityVisualStep === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.7)

        captures: dict[int, Path] = {}
        diagnostics: dict[int, dict[str, float | int | str]] = {}
        cyan_counts: dict[int, int] = {}
        for step in CAPTURE_STEPS:
            set_visual_step(driver, step)
            name = f'{step:02d}-step'
            captures[step] = capture_canvas(driver, name)
            diagnostics[step] = read_diagnostics(driver)
            cyan_counts[step] = cyan_pixels(captures[step])

        step16_components = detached_component_metrics(captures[16])
        time.sleep(0.75)
        post_fade = capture_canvas(driver, '17-post-fade')
        post_fade_components = detached_component_metrics(post_fade)

        payload = {
            'physics_dt': 0.0015,
            'capture_steps': CAPTURE_STEPS,
            'diagnostics': diagnostics,
            'cyan_pixels': cyan_counts,
            'step16_components': step16_components,
            'post_fade_components': post_fade_components,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        radius8 = float(diagnostics[8]['impactor_radius'])
        radius12 = float(diagnostics[12]['impactor_radius'])
        radius15 = float(diagnostics[15]['impactor_radius'])
        require(
            INITIAL_IMPACTOR_RADIUS * 0.68 <= radius8 <= INITIAL_IMPACTOR_RADIUS * 0.96,
            f'absorbed body must begin shrinking before handoff: step8 radius={radius8:.6f}',
        )
        require(
            0 < radius12 <= INITIAL_IMPACTOR_RADIUS * 0.58,
            f'absorbed body must continue shrinking instead of holding full size: step12 radius={radius12:.6f}',
        )
        require(
            0 < radius15 <= INITIAL_IMPACTOR_RADIUS * 0.20,
            f'absorbed body must be nearly collapsed before replacement: step15 radius={radius15:.6f}',
        )
        require(
            float(diagnostics[16]['impactor_radius']) == 0,
            'physical result step must replace the absorbed source after the visible collapse',
        )
        require(
            str(diagnostics[16]['remnant_id']),
            'physical result step must contain the combined planet remnant',
        )
        require(
            int(diagnostics[16]['solid_fragment_count']) == 0,
            'tiny low-energy absorption must not pop detached solid fragments into view',
        )
        require(
            int(diagnostics[16]['mass_effect_count']) > 0,
            'tiny absorption must keep represented ejecta mass in transient contact effects',
        )
        require(
            float(diagnostics[16]['max_effect_stretch']) <= 1.11 and
            float(diagnostics[16]['max_effect_tail']) <= 0.081,
            'absorption ejecta must remain compact rather than turning into long streak effects',
        )
        require(
            cyan_counts[0] >= 20,
            'baseline impactor is not visibly detectable in the browser capture',
        )
        require(
            cyan_counts[15] < cyan_counts[0] * 0.42,
            'browser capture must show the small body visually collapsing before it disappears',
        )
        require(
            int(step16_components['detached_count']) <= 1,
            'physical result frame contains detached bright pop-in components away from the contact body',
        )
        require(
            int(post_fade_components['detached_count']) == 0 or
            float(post_fade_components['max_detached_aspect']) <= 2.6,
            'late post-impact frame contains a detached elongated special-effect streak',
        )
        print('absorption continuity browser visual regression: ok')
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
