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
MAX_NORMALIZED_PENETRATION = 0.18


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
        'source_separation': float(root.get_attribute('data-source-separation') or 0),
        'penetration_depth': float(root.get_attribute('data-penetration-depth') or 0),
        'normalized_penetration': float(root.get_attribute('data-normalized-penetration') or 0),
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


def primary_geometry(path: Path) -> tuple[float, float, float]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    points: list[tuple[int, int]] = []
    for y in range(int(height * 0.20), int(height * 0.80)):
        for x in range(int(width * 0.25), int(width * 0.75)):
            r, g, b = image.getpixel((x, y))
            if r >= 28 and r >= g * 1.08 and r >= b * 1.15:
                points.append((x, y))
    require(len(points) >= 500, 'baseline primary body is not detectable')
    center_x = sum(x for x, _ in points) / len(points)
    center_y = sum(y for _, y in points) / len(points)
    radius = max(
        max(x for x, _ in points) - center_x,
        center_x - min(x for x, _ in points),
    )
    return center_x, center_y, radius


def visible_impactor_pixels(
    path: Path,
    geometry: tuple[float, float, float],
) -> int:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    center_x, center_y, radius = geometry
    x0 = max(0, int(center_x + radius * 0.65))
    x1 = min(width, int(center_x + radius * 2.10) + 1)
    y0 = max(0, int(center_y - radius * 0.90))
    y1 = min(height, int(center_y + radius * 0.90) + 1)
    count = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            brightest = max(r, g, b)
            darkest = min(r, g, b)
            if 15 <= brightest <= 90 and brightest - darkest <= 25:
                count += 1
    return count


def exposed_impactor_silhouette(
    path: Path,
    geometry: tuple[float, float, float],
) -> dict[str, int]:
    image = Image.open(path).convert('RGB')
    center_x, center_y, radius = geometry
    x0 = max(0, int(math.ceil(center_x + radius * 1.03)))
    x1 = min(image.width, int(math.ceil(center_x + radius * 1.85)) + 1)
    y0 = max(0, int(math.floor(center_y - radius * 0.95)))
    y1 = min(image.height, int(math.ceil(center_y + radius * 0.95)) + 1)
    occupied: set[tuple[int, int]] = set()
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if (
                12 <= r <= 80 and
                r >= g - 1 and
                g >= b - 2 and
                r - b <= 20
            ):
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
        if len(points) >= 20:
            components.append(points)

    require(components, f'{path.name}: exposed impactor silhouette is not detectable')
    points = max(components, key=len)
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    column_heights: list[int] = []
    for x in range(min(xs), max(xs) + 1):
        column_ys = [y for point_x, y in points if point_x == x]
        if column_ys:
            column_heights.append(max(column_ys) - min(column_ys) + 1)
    require(column_heights, f'{path.name}: exposed impactor silhouette has no column samples')
    return {
        'area': len(points),
        'width': max(xs) - min(xs) + 1,
        'height': max(ys) - min(ys) + 1,
        'max_column_height': max(column_heights),
        'outward_edge_x': max(xs),
    }


def annular_changed_fraction(
    before_path: Path,
    after_path: Path,
    geometry: tuple[float, float, float],
) -> float:
    before = Image.open(before_path).convert('RGB')
    after = Image.open(after_path).convert('RGB')
    center_x, center_y, radius = geometry
    changed = 0
    samples = 0
    inner = radius * 1.40
    outer = radius * 2.50
    x0 = max(0, int(center_x - outer))
    x1 = min(before.width, int(center_x + outer) + 1)
    y0 = max(0, int(center_y - outer))
    y1 = min(before.height, int(center_y + outer) + 1)
    for y in range(y0, y1):
        for x in range(x0, x1):
            distance = math.hypot(x - center_x, y - center_y)
            if distance < inner or distance > outer:
                continue
            a = before.getpixel((x, y))
            b = after.getpixel((x, y))
            mean_difference = sum(abs(a[i] - b[i]) for i in range(3)) / 3.0
            samples += 1
            if mean_difference > 8.0:
                changed += 1
    require(samples > 0, 'annular visual comparison mask is empty')
    return changed / samples


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
        for step in CAPTURE_STEPS:
            set_visual_step(driver, step)
            # Pre-transition absorption keeps the simulation step fixed. Allow a
            # few production WebGL frames for the contact-deformation material
            # recompile before sampling the actual rendered silhouette.
            if step in (8, 12, 15):
                time.sleep(0.12)
            name = f'{step:02d}-step'
            captures[step] = capture_canvas(driver, name)
            diagnostics[step] = read_diagnostics(driver)

        geometry = primary_geometry(captures[0])
        impactor_counts = {
            step: visible_impactor_pixels(path, geometry)
            for step, path in captures.items()
        }
        silhouettes = {
            step: exposed_impactor_silhouette(captures[step], geometry)
            for step in (0, 8, 12, 15)
        }
        time.sleep(0.75)
        post_fade = capture_canvas(driver, '17-post-fade')
        result_pop_fraction = annular_changed_fraction(captures[15], captures[16], geometry)
        late_effect_fraction = annular_changed_fraction(captures[16], post_fade, geometry)

        payload = {
            'physics_dt': 0.0015,
            'capture_steps': CAPTURE_STEPS,
            'diagnostics': diagnostics,
            'baseline_primary_geometry': {
                'center_x': geometry[0],
                'center_y': geometry[1],
                'radius': geometry[2],
            },
            'visible_impactor_pixels': impactor_counts,
            'exposed_impactor_silhouette': silhouettes,
            'result_pop_changed_fraction': result_pop_fraction,
            'late_effect_changed_fraction': late_effect_fraction,
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
            all(
                float(diagnostics[step]['normalized_penetration']) <= MAX_NORMALIZED_PENETRATION + 0.002
                for step in (8, 12, 15)
            ),
            'absorption staging must shrink near the contact surface without exceeding the normalized penetration cap',
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
            impactor_counts[0] >= 500,
            'baseline impactor is not visibly detectable in its local browser ROI',
        )
        require(
            impactor_counts[8] >= impactor_counts[0] * 0.55 and
            impactor_counts[12] >= impactor_counts[0] * 0.35 and
            impactor_counts[15] >= impactor_counts[0] * 0.20,
            'surface-local absorption staging lost the source silhouette before the physical handoff',
        )
        baseline_silhouette = silhouettes[0]
        require(
            int(baseline_silhouette['max_column_height']) >= 32,
            'baseline exposed impactor silhouette is too small for deformation inspection',
        )
        require(
            int(silhouettes[8]['width']) <= int(baseline_silhouette['width']) - 1 and
            int(silhouettes[8]['outward_edge_x']) <= int(baseline_silhouette['outward_edge_x']) - 1,
            'step8 rendered silhouette must already erode inward along the contact axis while the impactor remains large',
        )
        require(
            int(silhouettes[12]['width']) <= int(silhouettes[8]['width']) - 2 and
            int(silhouettes[12]['outward_edge_x']) <= int(silhouettes[8]['outward_edge_x']) - 2,
            'step12 rendered silhouette must deepen contact-axis deformation before topology collapse',
        )
        require(
            int(silhouettes[8]['max_column_height']) >= int(baseline_silhouette['max_column_height']) * 0.90 and
            int(silhouettes[12]['max_column_height']) >= int(baseline_silhouette['max_column_height']) * 0.90,
            'pre-transition deformation must preserve a tall far-side remainder instead of uniformly shrinking the sphere',
        )
        require(
            int(silhouettes[8]['width']) >= int(baseline_silhouette['width']) * 0.78 and
            int(silhouettes[12]['width']) >= int(baseline_silhouette['width']) * 0.52,
            'pre-transition deformation must retain a visible far-side remainder instead of uniformly deleting the sphere',
        )
        require(
            result_pop_fraction <= 0.01,
            f'physical result frame introduced detached visual pop outside the contact body: {result_pop_fraction:.4f}',
        )
        require(
            late_effect_fraction <= 0.01,
            f'late post-impact frame introduced detached/elongated effect activity: {late_effect_fraction:.4f}',
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
