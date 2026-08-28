#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import shutil
import statistics
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('non-stellar-destruction-visual-artifacts')
URL = os.environ.get(
    'NON_STELLAR_DESTRUCTION_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=non-stellar-destruction',
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
    result = canvas.screenshot(str(path))
    require(bool(result) and path.exists(), f'failed to capture browser canvas for {name}')
    return path


def image_energy(path: Path) -> int:
    image = Image.open(path).convert('RGB')
    return sum(1 for r, g, b in image.getdata() if max(r, g, b) >= 45)


def mean_difference(a: Path, b: Path) -> float:
    image_a = Image.open(a).convert('RGB')
    image_b = Image.open(b).convert('RGB')
    difference = ImageChops.difference(image_a, image_b)
    return sum(ImageStat.Stat(difference).mean) / 3.0


def debris_region_difference(a: Path, b: Path) -> dict[str, float | int | list[int]]:
    image_a = Image.open(a).convert('RGB')
    image_b = Image.open(b).convert('RGB')
    width, height = image_a.size
    require(image_b.size == (width, height), 'debris comparison images have different sizes')

    # The harness keeps the disrupted source/debris near the center while the
    # rest of the canvas is mostly static space. Measure that physical debris
    # region directly so moving fragment pixels are not diluted by the canvas.
    x0, x1 = int(width * 0.28), int(width * 0.72)
    y0, y1 = int(height * 0.32), int(height * 0.68)
    differences: list[float] = []
    changed = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            before = image_a.getpixel((x, y))
            after = image_b.getpixel((x, y))
            delta = sum(abs(before[index] - after[index]) for index in range(3)) / 3.0
            differences.append(delta)
            if delta >= 2.0:
                changed += 1

    require(bool(differences), 'debris comparison ROI is empty')
    return {
        'roi': [x0, y0, x1, y1],
        'pixels': len(differences),
        'mean_difference': sum(differences) / len(differences),
        'changed_fraction': changed / len(differences),
    }


def warm_surface_points(path: Path) -> list[tuple[int, int]]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.34), int(width * 0.66)
    y0, y1 = int(height * 0.24), int(height * 0.76)
    candidates: set[tuple[int, int]] = set()

    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if r < 35:
                continue
            if r < g * 1.06 or r < b * 1.12:
                continue
            candidates.add((x, y))

    # The broad ROI can contain the edge of another warm planet. Comparing all
    # warm pixels made that unrelated body shift the centroid and look like the
    # disrupted source had lost surface pixels. Isolate the actual central source
    # as the largest 4-connected warm component before measuring its damage.
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

    require(bool(components), f'no warm source-surface component in {path.name}')
    source = max(components, key=len)
    require(len(source) >= 40, f'not enough warm source-surface pixels in {path.name}')
    return source


def warm_surface_centroid(points: list[tuple[int, int]]) -> tuple[float, float, int]:
    center_x = sum(x for x, _ in points) / len(points)
    center_y = sum(y for _, y in points) / len(points)
    return center_x, center_y, len(points)


def dim_source_surface_points(
    path: Path,
    search_center: tuple[float, float],
    search_radius: float,
) -> list[tuple[int, int]]:
    image = Image.open(path).convert('RGB')
    center_x, center_y = search_center
    radius = max(8.0, search_radius)
    x0 = max(0, int(math.floor(center_x - radius)))
    x1 = min(image.width - 1, int(math.ceil(center_x + radius)))
    y0 = max(0, int(math.floor(center_y - radius)))
    y1 = min(image.height - 1, int(math.ceil(center_y + radius)))
    points: list[tuple[int, int]] = []

    # Use a deliberately low luminance floor for registration. The handoff
    # ownership cross-fade may dim the intact source uniformly, so the old warm
    # threshold could latch onto ejecta or a neighboring body and report a fake
    # shell loss. Small background stars cannot dominate this local disc mask.
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x - center_x) ** 2 + (y - center_y) ** 2 > radius ** 2:
                continue
            if max(image.getpixel((x, y))) >= 18:
                points.append((x, y))

    require(len(points) >= 400, f'not enough dim source-surface pixels in {path.name}')
    return points


def source_surface_damage_metrics(
    base_path: Path,
    current_path: Path,
    points: list[tuple[int, int]],
    registration_shift: tuple[float, float],
) -> dict[str, float | int | list[float]]:
    base = Image.open(base_path).convert('RGB')
    current = Image.open(current_path).convert('RGB')
    shift_x, shift_y = registration_shift
    hot = 0
    raw_darkened = 0
    normalized_darkened = 0
    samples: list[tuple[float, float, tuple[int, int, int], tuple[int, int, int]]] = []
    intensity_ratios: list[float] = []

    for x, y in points:
        current_x = int(round(x + shift_x))
        current_y = int(round(y + shift_y))
        if not (0 <= current_x < current.width and 0 <= current_y < current.height):
            continue

        before = base.getpixel((x, y))
        after = current.getpixel((current_x, current_y))
        before_peak = float(max(before))
        after_peak = float(max(after))
        if before_peak < 35:
            continue
        samples.append((before_peak, after_peak, before, after))
        intensity_ratios.append(after_peak / max(before_peak, 1.0))

    require(len(samples) >= 40, f'not enough registered source-surface samples in {current_path.name}')
    # A uniform opacity handoff is not shell peeling. Estimate that global
    # brightness transfer robustly, then fail only pixels that disappear far
    # beyond the shared fade. A real discarded shell still produces localized
    # near-black holes and remains caught by the normalized loss fraction.
    global_intensity_scale = max(0.08, min(1.25, statistics.median(intensity_ratios)))

    for before_peak, after_peak, before, after in samples:
        if after_peak < max(18.0, before_peak * 0.45):
            raw_darkened += 1
        if after_peak < max(6.0, before_peak * global_intensity_scale * 0.45):
            normalized_darkened += 1
        if (
            after[0] >= before[0] + 28 and
            after[0] >= 75 and
            after[0] >= after[1] * 1.18 and
            after[0] >= after[2] * 1.35
        ):
            hot += 1

    return {
        'hot_fraction': hot / len(samples),
        'raw_darkened_fraction': raw_darkened / len(samples),
        'normalized_darkened_fraction': normalized_darkened / len(samples),
        'global_intensity_scale': global_intensity_scale,
        'samples': len(samples),
        'registration_shift_px': [shift_x, shift_y],
    }


def trigger_destruction(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        window.__startNonStellarDestructionVisual();
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
                'return typeof window.__startNonStellarDestructionVisual === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )

        time.sleep(0.65)
        contact = capture_canvas(driver, '01-contact')
        baseline_surface = warm_surface_points(contact)

        trigger_destruction(driver)
        destruction_started_at = time.monotonic()

        wait_until(destruction_started_at, 0.45)
        early = capture_canvas(driver, '02-contact-compression')
        wait_until(destruction_started_at, 1.15)
        middle = capture_canvas(driver, '03-local-ejecta')
        wait_until(destruction_started_at, 2.05)
        reveal = capture_canvas(driver, '04-result-handoff')
        wait_until(destruction_started_at, 3.40)
        final = capture_canvas(driver, '05-final-debris')

        captures = {
            'contact': contact,
            'contact_compression': early,
            'local_ejecta': middle,
            'result_handoff': reveal,
            'final_debris': final,
        }
        energies = {name: image_energy(path) for name, path in captures.items()}
        differences = {
            'contact_to_compression': mean_difference(contact, early),
            'compression_to_ejecta': mean_difference(early, middle),
            'ejecta_to_handoff': mean_difference(middle, reveal),
            'handoff_to_final': mean_difference(reveal, final),
        }
        debris_motion = debris_region_difference(reveal, final)
        contact_centroid = warm_surface_centroid(baseline_surface)
        source_equivalent_radius = math.sqrt(len(baseline_surface) / math.pi)
        registration_radius = source_equivalent_radius * 1.10
        contact_dim_surface = dim_source_surface_points(
            contact, (contact_centroid[0], contact_centroid[1]), registration_radius,
        )
        early_dim_surface = dim_source_surface_points(
            early, (contact_centroid[0], contact_centroid[1]), registration_radius,
        )
        early_centroid = warm_surface_centroid(early_dim_surface)
        middle_dim_surface = dim_source_surface_points(
            middle, (early_centroid[0], early_centroid[1]), registration_radius,
        )
        middle_centroid = warm_surface_centroid(middle_dim_surface)
        early_registration = (
            early_centroid[0] - contact_centroid[0],
            early_centroid[1] - contact_centroid[1],
        )
        middle_registration = (
            middle_centroid[0] - contact_centroid[0],
            middle_centroid[1] - contact_centroid[1],
        )
        early_surface_shift = math.hypot(*early_registration)
        silhouette_retention = {
            'contact_compression': len(early_dim_surface) / max(1, len(contact_dim_surface)),
            'local_ejecta': len(middle_dim_surface) / max(1, len(contact_dim_surface)),
        }
        surface_damage = {
            'contact_compression': source_surface_damage_metrics(
                contact,
                early,
                baseline_surface,
                early_registration,
            ),
            'local_ejecta': source_surface_damage_metrics(
                contact,
                middle,
                baseline_surface,
                middle_registration,
            ),
        }

        payload['capture_targets_seconds'] = {
            'contact_compression': 0.45,
            'local_ejecta': 1.15,
            'result_handoff': 2.05,
            'final_debris': 3.40,
        }
        payload['non_dark_pixels'] = energies
        payload['mean_frame_differences'] = differences
        payload['post_reveal_debris_motion'] = debris_motion
        payload['source_surface_damage'] = surface_damage
        payload['source_silhouette_retention'] = silhouette_retention
        payload['warm_surface_centroid'] = {
            'contact': {
                'x': contact_centroid[0],
                'y': contact_centroid[1],
                'pixels': contact_centroid[2],
            },
            'contact_compression': {
                'x': early_centroid[0],
                'y': early_centroid[1],
                'pixels': early_centroid[2],
            },
            'local_ejecta': {
                'x': middle_centroid[0],
                'y': middle_centroid[1],
                'pixels': middle_centroid[2],
            },
            'early_shift_px': early_surface_shift,
        }

        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        require(energies['contact'] >= 700, 'contact capture is unexpectedly empty')
        require(
            energies['contact_compression'] >= energies['contact'] * 0.55,
            'the original solid surface disappeared too abruptly during contact compression',
        )
        # Absolute source position is intentionally not bounded here. A disruption
        # handoff now carries the preserved surface with the physical fragment
        # system, and the damage comparisons above register that expected motion
        # before evaluating the original shell-preservation regression.
        for stage, energy in energies.items():
            require(energy >= 450, f'{stage} capture is unexpectedly empty')
            require(
                energy <= energies['contact'] * 3.5,
                f'{stage} foreground expanded excessively; possible camera overzoom/reframe',
            )

        # Regression for the user-observed "planet shedding its shell" failure.
        # Only the contact cap may heat strongly; the rest of the intact source
        # surface must not become a glowing crack network or get shader-cut away.
        # The source mask is isolated from unrelated warm bodies and registered
        # for expected collision-system motion before comparing pixels.
        for name, metrics in surface_damage.items():
            require(
                float(metrics['hot_fraction']) <= 0.12,
                f'{name}: hot surface coverage is too broad; possible global glowing crack/shell pattern',
            )
            require(
                float(metrics['normalized_darkened_fraction']) <= 0.05,
                f'{name}: too much locally normalized surface disappeared; possible shell peeling/discard regression',
            )

        for name, retention in silhouette_retention.items():
            require(
                retention >= 0.70,
                f'{name}: source silhouette area collapsed; possible shell peeling/discard regression',
            )

        require(
            differences['contact_to_compression'] >= 0.08,
            'contact compression must be visually distinct from contact',
        )
        # Screenshot capture latency varies slightly across CI runners. This is
        # only an evolution/readability check; the dedicated hot/dark surface
        # gates above remain the hard regression guard for shell peeling.
        require(
            differences['compression_to_ejecta'] >= 0.06,
            'local ejecta must advance beyond the compression frame',
        )
        require(
            differences['ejecta_to_handoff'] >= 0.08,
            'result handoff must remain visually distinct from local ejecta',
        )
        require(
            float(debris_motion['mean_difference']) >= 0.25,
            'final debris region must continue evolving after result handoff',
        )
        require(
            float(debris_motion['changed_fraction']) >= 0.025,
            'too few debris-region pixels changed after result handoff',
        )

        print('non-stellar destruction browser visual regression: ok')
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
