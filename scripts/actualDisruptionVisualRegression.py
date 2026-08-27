#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import shutil
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('actual-disruption-visual-artifacts')
URL = os.environ.get(
    'ACTUAL_DISRUPTION_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=actual-disruption',
)
CAPTURE_TARGETS = [0.260, 0.520, 0.700, 1.050, 1.500, 1.880, 2.200, 2.600]
CAPTURE_NAMES = [
    '02-260ms',
    '03-520ms',
    '04-700ms',
    '05-1050ms',
    '06-1500ms',
    '07-1880ms',
    '08-2200ms',
    '09-2600ms',
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


def is_warm_source_pixel(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    return r >= 34 and r >= g * 1.07 and r >= b * 1.14


def warm_components(path: Path) -> list[list[tuple[int, int]]]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    candidates: set[tuple[int, int]] = set()
    for y in range(int(height * 0.08), int(height * 0.92)):
        for x in range(int(width * 0.05), int(width * 0.95)):
            if is_warm_source_pixel(image.getpixel((x, y))):
                candidates.add((x, y))

    components: list[list[tuple[int, int]]] = []
    remaining = set(candidates)
    while remaining:
        seed = remaining.pop()
        stack = [seed]
        component = [seed]
        while stack:
            x, y = stack.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor not in remaining:
                    continue
                remaining.remove(neighbor)
                stack.append(neighbor)
                component.append(neighbor)
        components.append(component)
    return components


def largest_warm_source(path: Path, minimum_pixels: int = 40) -> list[tuple[int, int]] | None:
    components = warm_components(path)
    if not components:
        return None
    source = max(components, key=len)
    return source if len(source) >= minimum_pixels else None


def centroid(points: list[tuple[int, int]]) -> tuple[float, float]:
    return (
        sum(x for x, _ in points) / len(points),
        sum(y for _, y in points) / len(points),
    )


def equivalent_radius(points: list[tuple[int, int]]) -> float:
    return math.sqrt(len(points) / math.pi)


def registered_difference(
    base: Path,
    current: Path,
    mask: list[tuple[int, int]],
    shift: tuple[float, float],
) -> float:
    image_a = Image.open(base).convert('RGB')
    image_b = Image.open(current).convert('RGB')
    values: list[float] = []
    shift_x, shift_y = shift
    for x, y in mask:
        current_x = int(round(x + shift_x))
        current_y = int(round(y + shift_y))
        if not (0 <= current_x < image_b.width and 0 <= current_y < image_b.height):
            continue
        before = image_a.getpixel((x, y))
        after = image_b.getpixel((current_x, current_y))
        values.append(sum(abs(before[i] - after[i]) for i in range(3)) / 3.0)
    require(len(values) >= 80, f'not enough registered surface samples in {current.name}')
    return sum(values) / len(values)


def registered_darkened_fraction(
    base: Path,
    current: Path,
    mask: list[tuple[int, int]],
    shift: tuple[float, float],
) -> float:
    image_a = Image.open(base).convert('RGB')
    image_b = Image.open(current).convert('RGB')
    samples = 0
    darkened = 0
    shift_x, shift_y = shift
    for x, y in mask:
        current_x = int(round(x + shift_x))
        current_y = int(round(y + shift_y))
        if not (0 <= current_x < image_b.width and 0 <= current_y < image_b.height):
            continue
        before = image_a.getpixel((x, y))
        after = image_b.getpixel((current_x, current_y))
        samples += 1
        if max(before) >= 42 and max(after) < max(20, max(before) * 0.42):
            darkened += 1
    require(samples >= 100, f'not enough registered darkening samples in {current.name}')
    return darkened / samples


def original_source_occupancy(path: Path, source_mask: list[tuple[int, int]]) -> float:
    image = Image.open(path).convert('RGB')
    warm = sum(1 for point in source_mask if is_warm_source_pixel(image.getpixel(point)))
    return warm / len(source_mask)


def whole_frame_difference(a: Path, b: Path) -> float:
    diff = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def image_energy(path: Path) -> int:
    image = Image.open(path).convert('RGB')
    return sum(1 for pixel in image.getdata() if max(pixel) >= 45)


def trigger(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        window.__startMovingDisruptionVisual();
        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== 'destruction') {
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
                'return typeof window.__startMovingDisruptionVisual === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.7)

        impact = capture_canvas(driver, '01-impact')
        impact_source = largest_warm_source(impact, minimum_pixels=350)
        require(impact_source is not None, 'impact capture did not contain the warm source body')
        impact_center = centroid(impact_source)
        source_radius_px = equivalent_radius(impact_source)
        contact_side = [(x, y) for x, y in impact_source if x >= impact_center[0] + 2]
        opposite_side = [(x, y) for x, y in impact_source if x <= impact_center[0] - 2]
        require(len(contact_side) >= 120 and len(opposite_side) >= 120, 'impact source hemisphere masks are too small')

        trigger(driver)
        started_at = time.monotonic()
        captures: dict[str, Path] = {'impact': impact}
        for target, name in zip(CAPTURE_TARGETS, CAPTURE_NAMES):
            wait_until(started_at, target)
            captures[name] = capture_canvas(driver, name)

        source_motion: dict[str, dict[str, float | int | None]] = {}
        registered_localization: dict[str, dict[str, float]] = {}
        for name in CAPTURE_NAMES:
            component = largest_warm_source(captures[name])
            if component is None:
                source_motion[name] = {
                    'pixels': 0,
                    'centroid_x': None,
                    'centroid_y': None,
                    'shift_px': None,
                    'shift_source_radii': None,
                }
                continue
            current_center = centroid(component)
            shift = (current_center[0] - impact_center[0], current_center[1] - impact_center[1])
            shift_px = math.hypot(*shift)
            source_motion[name] = {
                'pixels': len(component),
                'centroid_x': current_center[0],
                'centroid_y': current_center[1],
                'shift_px': shift_px,
                'shift_source_radii': shift_px / max(source_radius_px, 1e-9),
            }
            if name in {'02-260ms', '03-520ms', '04-700ms'}:
                registered_localization[name] = {
                    'contact_side_difference': registered_difference(
                        impact, captures[name], contact_side, shift
                    ),
                    'opposite_side_difference': registered_difference(
                        impact, captures[name], opposite_side, shift
                    ),
                    'source_darkened_fraction': registered_darkened_fraction(
                        impact, captures[name], impact_source, shift
                    ),
                }

        original_occupancy = {
            name: original_source_occupancy(captures[name], impact_source)
            for name in CAPTURE_NAMES
        }
        warm_pixel_counts = {
            name: sum(len(component) for component in warm_components(path))
            for name, path in captures.items()
        }
        energies = {name: image_energy(path) for name, path in captures.items()}
        frame_differences = {
            name: whole_frame_difference(impact, path)
            for name, path in captures.items()
            if name != 'impact'
        }

        payload = {
            'capture_targets_seconds': dict(zip(CAPTURE_NAMES, CAPTURE_TARGETS)),
            'impact_source_pixels': len(impact_source),
            'impact_source_equivalent_radius_px': source_radius_px,
            'source_motion': source_motion,
            'registered_localization': registered_localization,
            'original_collision_site_source_occupancy': original_occupancy,
            'warm_pixel_counts': warm_pixel_counts,
            'non_dark_pixels': energies,
            'whole_frame_difference': frame_differences,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        require(
            registered_localization['02-260ms']['source_darkened_fraction'] <= 0.055,
            '260ms impact hold must preserve the original source surface',
        )
        require(
            registered_localization['03-520ms']['contact_side_difference'] >=
            registered_localization['03-520ms']['opposite_side_difference'] * 1.05,
            '520ms deformation must remain localized to the physical contact side',
        )
        require(
            registered_localization['04-700ms']['contact_side_difference'] >=
            registered_localization['04-700ms']['opposite_side_difference'] * 1.02,
            '700ms ejecta onset must retain contact-side localization',
        )

        shift_520 = float(source_motion['03-520ms']['shift_source_radii'] or 0)
        shift_1050 = float(source_motion['05-1050ms']['shift_source_radii'] or 0)
        shift_1500 = float(source_motion['06-1500ms']['shift_source_radii'] or 0)
        shift_1880 = float(source_motion['07-1880ms']['shift_source_radii'] or 0)
        require(shift_1050 >= shift_520 + 0.55, 'moving disruption snapshot must keep following system translation after product reveal begins')
        require(shift_1500 >= shift_1050 + 0.45, 'handoff snapshot gross translation must continue with the moving result')
        require(shift_1500 >= 1.5, 'moving result must carry the source silhouette by at least 1.5 source radii')
        require(shift_1880 >= shift_1500, 'source/result separation must not revert toward a stationary collision-site ghost')

        require(
            original_occupancy['05-1050ms'] <= 0.35,
            'full source disc is still occupying the original collision site at 1050ms',
        )
        require(
            original_occupancy['06-1500ms'] <= 0.20,
            'stationary collision-site source ghost remains visible at 1500ms',
        )
        require(
            original_occupancy['07-1880ms'] <= 0.16,
            'source handoff must not remain as an independent body at its collision coordinates',
        )

        require(
            warm_pixel_counts['09-2600ms'] <= len(impact_source) * 0.22,
            'source-sized warm handoff surface remains visible after the 2600ms lifecycle',
        )
        require(
            original_occupancy['09-2600ms'] <= 0.08,
            'collision handoff snapshot did not visually clear by lifecycle completion',
        )

        for name, energy in energies.items():
            require(energy >= 320, f'{name} capture is unexpectedly empty')
            require(
                energy <= energies['impact'] * 3.2,
                f'{name} foreground energy expanded excessively; possible duplicate full-disc/product rendering',
            )
        require(frame_differences['03-520ms'] >= 0.10, '520ms product-reveal boundary must differ visibly from impact')
        require(frame_differences['05-1050ms'] >= 0.12, '1050ms structural breakup must remain visible')
        require(frame_differences['08-2200ms'] >= 0.10, '2200ms cross-fade must retain visible physical result/fragments')

        print('actual disruption moving-anchor browser visual regression: ok')
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
