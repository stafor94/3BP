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

OUTPUT_DIR = Path('collision-merge-handoff-visual-artifacts')
URL = os.environ.get(
    'COLLISION_MERGE_HANDOFF_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=collision-merge-handoff',
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


def capture_canvas(driver: webdriver.Chrome, name: str) -> Path:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / f'{name}.png'
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {name}')
    return path


def root_diagnostics(driver: webdriver.Chrome) -> dict[str, float | int | str]:
    root = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="collision-merge-handoff"]')
    return {
        'step': int(root.get_attribute('data-physics-step') or 0),
        'remnant_id': root.get_attribute('data-remnant-id') or '',
        'source_a_present': int(root.get_attribute('data-source-a-present') or 0),
        'source_b_present': int(root.get_attribute('data-source-b-present') or 0),
        'source_separation': float(root.get_attribute('data-source-separation') or 0),
        'physical_body_count': int(root.get_attribute('data-physical-body-count') or 0),
        'remnant_mass': float(root.get_attribute('data-remnant-mass') or 0),
        'remnant_radius': float(root.get_attribute('data-remnant-radius') or 0),
        'remnant_vx': float(root.get_attribute('data-remnant-vx') or 0),
        'remnant_vy': float(root.get_attribute('data-remnant-vy') or 0),
        'remnant_vz': float(root.get_attribute('data-remnant-vz') or 0),
    }


def advance_step(driver: webdriver.Chrome, expected_step: int) -> None:
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


def handoff_metrics(driver: webdriver.Chrome) -> dict[str, object]:
    return driver.execute_script(
        """
        const values = Object.values(window.__collisionSolidHandoffMetrics || {});
        return values.length ? values[0] : null;
        """
    ) or {}


def wait_for_progress(driver: webdriver.Chrome, minimum: float) -> dict[str, object]:
    WebDriverWait(driver, 4, poll_frequency=0.01).until(
        lambda browser: float((handoff_metrics(browser) or {}).get('progress', -1)) >= minimum
    )
    return handoff_metrics(driver)


def is_body_colored(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    brightest = max(r, g, b)
    darkest = min(r, g, b)
    chroma = brightest - darkest
    if brightest < 9 or chroma < 2 or chroma / max(brightest, 1) < 0.025:
        return False
    warm = r >= g * 1.005 and r >= b * 1.015
    cool = b >= r * 1.015 and b >= g * 1.005
    return warm or cool


def is_blue_body(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    brightest = max(r, g, b)
    return (
        brightest >= 9
        and b >= r * 1.025
        and b >= g * 1.008
        and b - min(r, g) >= 2
    )


def silhouette_metrics(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.18), int(width * 0.82)
    y0, y1 = int(height * 0.16), int(height * 0.84)
    occupied: set[tuple[int, int]] = set()
    blue_pixels = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            pixel = image.getpixel((x, y))
            if is_blue_body(pixel):
                blue_pixels += 1
            if is_body_colored(pixel):
                occupied.add((x, y))

    components: list[list[tuple[int, int]]] = []
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
        if len(points) >= 24:
            components.append(points)

    components.sort(key=len, reverse=True)
    selected = components[:3]
    points = [point for component in selected for point in component]
    require(len(points) >= 80, f'body silhouette is not detectable in {path.name}')
    area = len(points)
    cx = sum(x for x, _ in points) / area
    cy = sum(y for _, y in points) / area
    return {
        'area': area,
        'cx': cx,
        'cy': cy,
        'blue_pixels': blue_pixels,
        'component_count': len(components),
    }


def monotonic_nonincreasing(values: list[float], tolerance: float = 1e-6) -> bool:
    return all(values[index + 1] <= values[index] + tolerance for index in range(len(values) - 1))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__advanceCollisionMergeHandoffStep === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.7)

        initial = root_diagnostics(driver)
        require(initial['source_a_present'] == 1 and initial['source_b_present'] == 1, 'fixture must start with both source solids')
        separations = [float(initial['source_separation'])]

        for step in range(1, 16):
            advance_step(driver, step)
            diagnostics = root_diagnostics(driver)
            require(not diagnostics['remnant_id'], f'physical merge resolved too early at staging step {step}')
            require(diagnostics['source_a_present'] == 1 and diagnostics['source_b_present'] == 1, 'both source bodies must exist before physical resolve')
            separations.append(float(diagnostics['source_separation']))

        require(
            monotonic_nonincreasing(separations, 1e-9),
            f'A regression: staging separation rewound outward: {separations}',
        )
        pre_path = capture_canvas(driver, '00-pre-resolve')
        pre_visual = silhouette_metrics(pre_path)

        advance_step(driver, 16)
        post_physics = root_diagnostics(driver)
        require(bool(post_physics['remnant_id']), 'step 16 must physically resolve the small head-on pair')
        require(post_physics['physical_body_count'] == 1, f'fixture must physically resolve 2->1, got {post_physics["physical_body_count"]}')
        require(post_physics['source_b_present'] == 0, 'absorbed source must be absent from the physical result')

        WebDriverWait(driver, 3, poll_frequency=0.01).until(
            lambda browser: bool(handoff_metrics(browser))
        )
        first = handoff_metrics(driver)
        first_path = capture_canvas(driver, '01-first-post-solver')
        first_visual = silhouette_metrics(first_path)

        samples = [first]
        captures = [('first', first_visual)]
        for label, progress in [('early', 0.25), ('mid', 0.55), ('late', 0.85)]:
            sample = wait_for_progress(driver, progress)
            path = capture_canvas(driver, f'02-{label}-{progress:.2f}')
            samples.append(sample)
            captures.append((label, silhouette_metrics(path)))

        first_absorbed = (first.get('absorbed') or [])[0]
        first_survivor = first.get('survivor') or {}
        require(first_absorbed, 'first post-solver render must publish an absorbed solid silhouette')
        require(
            float(first_absorbed['radius']) >= float(first_absorbed['startRadius']) * 0.72,
            'absorbed solid silhouette disappeared too quickly on the first post-solver render',
        )
        require(
            float(first_survivor['radius']) < float(first_survivor['targetRadius']) * 0.98,
            'remnant popped in at essentially full presentation radius on the first post-solver render',
        )
        require(
            float(first_survivor['distanceToResult']) > 1e-4,
            'remnant presentation jumped directly to the physical result position',
        )

        absorbed_radii = [float((sample.get('absorbed') or [])[0]['radius']) for sample in samples]
        absorbed_distances = [float((sample.get('absorbed') or [])[0]['distanceToResult']) for sample in samples]
        absorbed_opacities = [float((sample.get('absorbed') or [])[0]['opacity']) for sample in samples]
        survivor_distances = [float((sample.get('survivor') or {})['distanceToResult']) for sample in samples]
        survivor_radii = [float((sample.get('survivor') or {})['radius']) for sample in samples]

        require(monotonic_nonincreasing(absorbed_radii), f'absorbed radius must shrink monotonically: {absorbed_radii}')
        require(monotonic_nonincreasing(absorbed_distances), f'absorbed source must sink monotonically toward remnant: {absorbed_distances}')
        require(monotonic_nonincreasing(absorbed_opacities), f'absorbed opacity must not increase: {absorbed_opacities}')
        require(monotonic_nonincreasing(survivor_distances), f'survivor presentation must converge monotonically: {survivor_distances}')
        require(
            all(survivor_radii[index + 1] + 1e-6 >= survivor_radii[index] for index in range(len(survivor_radii) - 1)),
            f'remnant reveal radius must grow monotonically for this fixture: {survivor_radii}',
        )
        require(
            absorbed_radii[-1] <= float(first_absorbed['startRadius']) * 0.18,
            'late handoff must collapse the absorbed solid almost completely',
        )
        require(
            survivor_distances[-1] <= survivor_distances[0] * 0.18,
            'late handoff must bring the survivor silhouette close to the physical remnant',
        )

        first_area_ratio = float(first_visual['area']) / max(float(pre_visual['area']), 1.0)
        centroid_jump = math.hypot(
            float(first_visual['cx']) - float(pre_visual['cx']),
            float(first_visual['cy']) - float(pre_visual['cy']),
        )
        require(
            0.76 <= first_area_ratio <= 1.65,
            f'first post-solver solid silhouette area popped discontinuously: ratio={first_area_ratio:.3f}',
        )
        require(
            centroid_jump <= 24.0,
            f'first post-solver screen-space collision centroid jumped {centroid_jump:.2f}px',
        )
        require(
            int(first_visual['blue_pixels']) >= int(pre_visual['blue_pixels']) * 0.35,
            'absorbed blue source silhouette vanished from the first post-solver browser frame',
        )

        adjacent_areas = [float(pre_visual['area'])] + [float(metrics['area']) for _, metrics in captures]
        for before, after in zip(adjacent_areas, adjacent_areas[1:]):
            ratio = after / max(before, 1.0)
            require(0.58 <= ratio <= 1.75, f'visible solid silhouette changed too abruptly between captures: ratio={ratio:.3f}')

        time.sleep(0.75)
        settled_path = capture_canvas(driver, '03-settled')
        settled_visual = silhouette_metrics(settled_path)
        settled_physics = root_diagnostics(driver)
        require(settled_physics['physical_body_count'] == 1, 'handoff completion must still have one physical remnant')
        require(
            int(settled_visual['blue_pixels']) <= max(18, int(pre_visual['blue_pixels']) * 0.18),
            'ghost absorbed source remained visibly blue after solid handoff completion',
        )
        require(
            not handoff_metrics(driver),
            'solid handoff state must release after the existing formation window',
        )

        payload = {
            'staging_separations': separations,
            'post_physics': post_physics,
            'handoff_samples': samples,
            'pre_visual': pre_visual,
            'captures': {label: metrics for label, metrics in captures},
            'settled_visual': settled_visual,
            'first_area_ratio': first_area_ratio,
            'first_centroid_jump_px': centroid_jump,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('collision merge handoff browser visual regression: ok')
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
