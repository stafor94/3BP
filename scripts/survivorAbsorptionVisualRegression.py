#!/usr/bin/env python3
from __future__ import annotations

import json
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

OUTPUT_DIR = Path('survivor-absorption-visual-artifacts')
URL = os.environ.get(
    'SURVIVOR_ABSORPTION_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=survivor-absorption',
)
CAPTURE_TARGETS = [0.15, 0.35, 0.70, 1.10, 1.60]


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


def warm_primary_pixels(path: Path) -> list[tuple[int, int]]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.30), int(width * 0.66)
    y0, y1 = int(height * 0.22), int(height * 0.78)
    points: list[tuple[int, int]] = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if r >= 42 and r >= g * 1.05 and r >= b * 1.10:
                points.append((x, y))
    require(len(points) >= 500, f'not enough primary surface pixels in {path.name}')
    return points


def body_geometry(points: list[tuple[int, int]]) -> tuple[float, float, int, int, int, int]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return (
        sum(xs) / len(xs),
        sum(ys) / len(ys),
        min(xs),
        max(xs),
        min(ys),
        max(ys),
    )


def opposite_hemisphere_mask(
    points: list[tuple[int, int]],
    center_x: float,
) -> list[tuple[int, int]]:
    # The impactor approaches from +X (screen-right). Restrict comparison to the
    # left half of pixels that were definitely part of the primary before impact.
    mask = [(x, y) for x, y in points if x <= center_x - 2]
    require(len(mask) >= 220, 'opposite hemisphere mask is unexpectedly small')
    return mask


def impact_cap_mask(
    points: list[tuple[int, int]],
    center_x: float,
    max_x: int,
) -> list[tuple[int, int]]:
    # The shader caps the effect around the +X contact normal. Measure the
    # projected outer 20% of the primary's right-side radius instead of diluting
    # the signal across the entire canvas.
    cutoff = center_x + (max_x - center_x) * 0.80
    mask = [(x, y) for x, y in points if x >= cutoff]
    require(len(mask) >= 180, 'impact cap mask is unexpectedly small')
    return mask


def masked_metrics(base: Path, current: Path, mask: list[tuple[int, int]]) -> dict[str, float]:
    image_a = Image.open(base).convert('RGB')
    image_b = Image.open(current).convert('RGB')
    differences: list[float] = []
    darkened = 0
    for x, y in mask:
        before = image_a.getpixel((x, y))
        after = image_b.getpixel((x, y))
        differences.append(sum(abs(before[i] - after[i]) for i in range(3)) / 3.0)
        if max(before) >= 45 and max(after) < 22:
            darkened += 1
    return {
        'mean_difference': sum(differences) / len(differences),
        'darkened_fraction': darkened / len(mask),
    }


def whole_frame_difference(a: Path, b: Path) -> float:
    diff = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def wait_for_stage(driver: webdriver.Chrome, stage: str) -> None:
    driver.execute_async_script(
        """
        const stage = arguments[0];
        const done = arguments[arguments.length - 1];
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


def trigger(driver: webdriver.Chrome) -> None:
    driver.execute_script('window.__startSurvivorAbsorptionVisual()')
    wait_for_stage(driver, 'absorption')


def reset(driver: webdriver.Chrome) -> None:
    driver.execute_script('window.__resetSurvivorAbsorptionVisual()')
    wait_for_stage(driver, 'contact')


def wait_until(started_at: float, target_seconds: float) -> None:
    remaining = target_seconds - (time.monotonic() - started_at)
    if remaining > 0:
        time.sleep(remaining)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__startSurvivorAbsorptionVisual === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.75)
        contact = capture_canvas(driver, '01-contact')
        baseline_points = warm_primary_pixels(contact)
        center_x, center_y, min_x, max_x, min_y, max_y = body_geometry(baseline_points)
        opposite_mask = opposite_hemisphere_mask(baseline_points, center_x)
        impact_mask = impact_cap_mask(baseline_points, center_x, max_x)

        captures: dict[str, Path] = {'contact': contact}
        names = ['02-150ms', '03-350ms', '04-700ms', '05-1100ms', '06-1600ms']
        for target, name in zip(CAPTURE_TARGETS, names):
            reset(driver)
            trigger(driver)
            started_at = time.monotonic()
            wait_until(started_at, target)
            captures[name] = capture_canvas(driver, name)

        opposite = {
            name: masked_metrics(contact, path, opposite_mask)
            for name, path in captures.items()
            if name != 'contact'
        }
        impact = {
            name: masked_metrics(contact, path, impact_mask)
            for name, path in captures.items()
            if name != 'contact'
        }
        surface_counts = {
            name: len(warm_primary_pixels(path))
            for name, path in captures.items()
        }
        frame_differences = {
            name: whole_frame_difference(contact, path)
            for name, path in captures.items()
            if name != 'contact'
        }
        payload = {
            'capture_targets_seconds': CAPTURE_TARGETS,
            'capture_mode': 'independent-reset',
            'baseline_primary': {
                'center_x': center_x,
                'center_y': center_y,
                'bbox': [min_x, min_y, max_x, max_y],
                'surface_pixels': len(baseline_points),
                'opposite_mask_pixels': len(opposite_mask),
                'impact_cap_pixels': len(impact_mask),
            },
            'opposite_hemisphere': opposite,
            'impact_cap': impact,
            'warm_surface_pixels': surface_counts,
            'whole_frame_difference': frame_differences,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        baseline_count = surface_counts['contact']
        for name, metrics in opposite.items():
            require(
                metrics['darkened_fraction'] <= 0.035,
                f'{name}: opposite hemisphere developed dark holes; possible global dissolve/black shell',
            )
            require(
                metrics['mean_difference'] <= 10.0,
                f'{name}: opposite hemisphere changed too much; survivor effect is not contact-local',
            )
        for name in ['04-700ms', '05-1100ms', '06-1600ms']:
            ratio = surface_counts[name] / baseline_count
            require(0.82 <= ratio <= 1.18, f'{name}: survivor silhouette/surface area changed excessively: ratio={ratio:.3f}')

        require(
            impact['02-150ms']['mean_difference'] >= 4.0,
            '150ms contact cap must show a visible local collision response',
        )
        require(
            impact['03-350ms']['mean_difference'] >= 2.0,
            '350ms contact cap must retain a visible local impact trace',
        )
        for name in ['04-700ms', '05-1100ms', '06-1600ms']:
            require(
                impact[name]['mean_difference'] <= 1.0,
                f'{name}: survivor impact should have faded from the contact cap',
            )
        print('survivor absorption browser visual regression: ok')
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
