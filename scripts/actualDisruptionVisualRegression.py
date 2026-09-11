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
CAPTURES = [
    ('02-260ms', 0.26),
    ('03-520ms', 0.52),
    ('04-700ms', 0.70),
    ('05-1050ms', 1.05),
    ('06-1500ms', 1.50),
    ('07-1880ms', 1.88),
    ('08-2200ms', 2.20),
    ('09-2600ms', 2.60),
]
EARLY_PARTICLE_HANDOFF_FRAMES = {'02-260ms', '03-520ms', '04-700ms'}


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


def is_warm(pixel: tuple[int, int, int], threshold: int) -> bool:
    r, g, b = pixel
    return r >= threshold and r >= g * 1.05 and r >= b * 1.12


def warm_components(
    path: Path,
    threshold: int,
    minimum_area: int = 24,
) -> list[list[tuple[int, int]]]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.08), int(width * 0.94)
    y0, y1 = int(height * 0.12), int(height * 0.88)
    candidates = {
        (x, y)
        for y in range(y0, y1)
        for x in range(x0, x1)
        if is_warm(image.getpixel((x, y)), threshold)
    }
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
        if len(component) >= minimum_area:
            components.append(component)
    return sorted(components, key=len, reverse=True)


def warm_pixel_count(path: Path, threshold: int) -> int:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.08), int(width * 0.94)
    y0, y1 = int(height * 0.12), int(height * 0.88)
    return sum(
        1
        for y in range(y0, y1)
        for x in range(x0, x1)
        if is_warm(image.getpixel((x, y)), threshold)
    )


def centroid(component: list[tuple[int, int]]) -> tuple[float, float]:
    return (
        sum(x for x, _ in component) / len(component),
        sum(y for _, y in component) / len(component),
    )


def equivalent_radius(component: list[tuple[int, int]]) -> float:
    return math.sqrt(len(component) / math.pi)


def original_site_occupancy(
    path: Path,
    center: tuple[float, float],
    radius: float,
) -> float:
    image = Image.open(path).convert('RGB')
    cx, cy = center
    sample_radius = max(4.0, radius * 0.82)
    warm = 0
    total = 0
    for y in range(max(0, int(cy - sample_radius)), min(image.height - 1, int(cy + sample_radius)) + 1):
        for x in range(max(0, int(cx - sample_radius)), min(image.width - 1, int(cx + sample_radius)) + 1):
            if math.hypot(x - cx, y - cy) > sample_radius:
                continue
            total += 1
            if is_warm(image.getpixel((x, y)), 24):
                warm += 1
    require(total > 0, 'original collision-site sample is empty')
    return warm / total


def frame_difference(a: Path, b: Path) -> float:
    diff = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def image_energy(path: Path) -> int:
    """Whole-frame brightness helper retained for mobile viewport coverage gates."""
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
        impact_components = warm_components(impact, 24)
        require(bool(impact_components), 'impact capture has no collision body component')
        impact_component = impact_components[0]
        impact_center = centroid(impact_component)
        impact_radius = equivalent_radius(impact_component)

        trigger(driver)
        started_at = time.monotonic()
        captures: dict[str, Path] = {'impact': impact}
        for name, target in CAPTURES:
            wait_until(started_at, target)
            captures[name] = capture_canvas(driver, name)

        tracking_components = {
            name: warm_components(
                path,
                24,
                12 if name in EARLY_PARTICLE_HANDOFF_FRAMES else 24,
            )
            for name, path in captures.items()
        }
        tracking_warm_pixels = {
            name: warm_pixel_count(path, 24)
            for name, path in captures.items()
        }
        full_brightness_components = {
            name: warm_components(path, 38)
            for name, path in captures.items()
        }
        for name, components in tracking_components.items():
            require(bool(components), f'{name}: moving collision system disappeared')
        for name in EARLY_PARTICLE_HANDOFF_FRAMES:
            require(
                tracking_warm_pixels[name] >= 28,
                f'{name}: early disruption particle handoff lost too much visible material',
            )

        primary_collision_component_pixels = {
            name: len(components[0]) if components else 0
            for name, components in tracking_components.items()
        }
        motion_radii = {
            name: math.dist(impact_center, centroid(tracking_components[name][0])) / max(impact_radius, 1.0)
            for name, _target in CAPTURES
        }
        occupancy = {
            name: original_site_occupancy(captures[name], impact_center, impact_radius)
            for name in ('05-1050ms', '06-1500ms', '07-1880ms', '08-2200ms', '09-2600ms')
        }

        final_full_area = max(1, len(full_brightness_components['09-2600ms'][0]))
        full_disc_ratio: dict[str, float] = {}
        full_disc_counts: dict[str, int] = {}
        for name in ('06-1500ms', '07-1880ms', '08-2200ms', '09-2600ms'):
            components = full_brightness_components[name]
            primary_area = len(components[0]) if components else 0
            full_disc_ratio[name] = primary_area / final_full_area
            full_disc_counts[name] = sum(1 for component in components if len(component) >= final_full_area * 0.65)

        differences = {
            name: frame_difference(impact, path)
            for name, path in captures.items()
            if name != 'impact'
        }

        payload = {
            'capture_targets_seconds': {'impact': 0.0, **{name: target for name, target in CAPTURES}},
            'impact_equivalent_radius_px': impact_radius,
            'motion_source_radii': motion_radii,
            'tracking_warm_pixels': tracking_warm_pixels,
            'primary_collision_component_pixels': primary_collision_component_pixels,
            'original_collision_site_occupancy': occupancy,
            'full_brightness_disc_equivalent_ratio_to_final': full_disc_ratio,
            'full_brightness_source_sized_component_count': full_disc_counts,
            'whole_frame_difference': differences,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        # The dedicated non-stellar destruction regression still owns the early
        # impact-hold/contact-localization/shell-peeling gates. This moving fixture
        # focuses on the user-observed ghost: the handoff must leave the impact
        # coordinates with the physical result rather than remain as a static body.
        require(motion_radii['06-1500ms'] >= 1.25, 'moving disruption did not travel by at least one source radius')
        require(occupancy['05-1050ms'] <= 0.20, 'source disc remains at the original collision site at 1050ms')
        require(occupancy['07-1880ms'] <= 0.12, 'stationary full-body handoff ghost remains at 1880ms')
        require(occupancy['09-2600ms'] <= 0.08, 'source silhouette remains at the impact site after handoff completion')

        # A moving snapshot can still look like extra bodies if both source copies
        # remain opaque while the physical result reveals. Compare full-brightness
        # connected area to the stable final product: this catches overlapping
        # source-sized discs even when they form one connected collision cluster.
        require(full_disc_ratio['06-1500ms'] <= 1.45, '1500ms source/result double-render contains excessive full-disc area')
        require(full_disc_ratio['07-1880ms'] <= 1.18, '1880ms ownership transfer still reads as multiple full bodies')
        require(full_disc_ratio['08-2200ms'] <= 1.10, '2200ms late cross-fade still contains duplicate source-sized area')
        require(full_disc_counts['07-1880ms'] <= 1, 'multiple source-sized full-brightness components remain at 1880ms')
        require(full_disc_counts['08-2200ms'] <= 1, 'multiple source-sized full-brightness components remain at 2200ms')

        # Keep the existing 400-pixel visibility floor, but apply it to the
        # segmented foreground collision component rather than the whole frame.
        # This preserves the disruption readability gate without counting stars or
        # other background pixels as collision material.
        for name, pixels in primary_collision_component_pixels.items():
            require(pixels >= 400, f'{name}: foreground collision component is unexpectedly small')
        require(differences['03-520ms'] >= 0.10, '520ms handoff stage must differ visibly from impact')
        require(differences['04-700ms'] >= 0.12, '700ms ejecta stage must advance beyond impact')
        require(differences['05-1050ms'] >= 0.12, '1050ms structural handoff must remain visible')
        require(differences['06-1500ms'] >= 0.10, '1500ms result/fragments must remain visible')

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
