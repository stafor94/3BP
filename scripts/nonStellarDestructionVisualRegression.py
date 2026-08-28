#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import time
from collections import deque
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
CAPTURES = [
    ('02-impact', 0.12),
    ('03-early-fracture', 0.36),
    ('04-mid-fracture', 0.70),
    ('05-transfer', 1.15),
    ('06-remnant-settle', 2.05),
    ('07-final', 3.40),
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


def image_energy(path: Path) -> int:
    image = Image.open(path).convert('RGB')
    return sum(1 for pixel in image.getdata() if max(pixel) >= 42)


def frame_difference(a: Path, b: Path) -> float:
    diff = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def bright_components(path: Path) -> list[int]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    occupied: set[tuple[int, int]] = set()
    for y in range(int(height * 0.18), int(height * 0.82)):
        for x in range(int(width * 0.20), int(width * 0.80)):
            r, g, b = image.getpixel((x, y))
            if max(r, g, b) >= 40 and (r + g + b) >= 78:
                occupied.add((x, y))

    areas: list[int] = []
    while occupied:
        seed = occupied.pop()
        queue = deque([seed])
        area = 1
        while queue:
            x, y = queue.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    point = (x + dx, y + dy)
                    if point not in occupied:
                        continue
                    occupied.remove(point)
                    queue.append(point)
                    area += 1
        if area >= 20:
            areas.append(area)
    return sorted(areas, reverse=True)


def roi_motion(a: Path, b: Path) -> dict[str, float]:
    image_a = Image.open(a).convert('RGB')
    image_b = Image.open(b).convert('RGB')
    width, height = image_a.size
    x0, x1 = int(width * 0.28), int(width * 0.72)
    y0, y1 = int(height * 0.30), int(height * 0.70)
    changed = 0
    samples = 0
    total_delta = 0.0
    for y in range(y0, y1):
        for x in range(x0, x1):
            before = image_a.getpixel((x, y))
            after = image_b.getpixel((x, y))
            delta = sum(abs(before[i] - after[i]) for i in range(3)) / 3.0
            total_delta += delta
            samples += 1
            if delta >= 2.0:
                changed += 1
    return {
        'mean_difference': total_delta / max(samples, 1),
        'changed_fraction': changed / max(samples, 1),
    }


def trigger(driver: webdriver.Chrome) -> None:
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
        trigger(driver)
        started_at = time.monotonic()
        captures: dict[str, Path] = {'contact': contact}
        for name, target in CAPTURES:
            wait_until(started_at, target)
            captures[name] = capture_canvas(driver, name)

        energies = {name: image_energy(path) for name, path in captures.items()}
        components = {name: bright_components(path) for name, path in captures.items()}
        differences = {
            name: frame_difference(contact, path)
            for name, path in captures.items()
            if name != 'contact'
        }
        late_motion = roi_motion(captures['06-remnant-settle'], captures['07-final'])
        final_area = max(1, components['07-final'][0] if components['07-final'] else 1)
        source_sized_counts = {
            name: sum(1 for area in areas if area >= final_area * 0.65)
            for name, areas in components.items()
        }
        chunk_scale_counts = {
            name: sum(1 for area in areas if final_area * 0.015 <= area <= final_area * 0.45)
            for name, areas in components.items()
        }

        payload = {
            'capture_targets_seconds': {name: target for name, target in CAPTURES},
            'phase_frames': {
                'IMPACT': '02-impact',
                'EARLY_FRACTURE': '03-early-fracture',
                'MID_FRACTURE': '04-mid-fracture',
                'TRANSFER': '05-transfer',
                'REMNANT_SETTLE': '06-remnant-settle',
            },
            'non_dark_pixels': energies,
            'bright_component_areas': components,
            'chunk_scale_component_counts_for_inspection': chunk_scale_counts,
            'source_sized_component_counts_relative_to_final': source_sized_counts,
            'whole_frame_difference_from_contact': differences,
            'post_settle_roi_motion': late_motion,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        require(energies['contact'] >= 700, 'contact capture is unexpectedly empty')
        for name, energy in energies.items():
            require(energy >= 250, f'{name} capture is unexpectedly empty')
            require(energy <= energies['contact'] * 3.5, f'{name}: foreground expanded excessively')

        # Phase-1 regression remains strict: contact-local breakup may add small
        # components, but may not reintroduce source-sized full-body spheres.
        require(
            source_sized_counts['05-transfer'] <= 1,
            'TRANSFER contains multiple source-sized full-body components',
        )
        require(
            source_sized_counts['06-remnant-settle'] <= 1,
            'REMNANT_SETTLE contains duplicate source-sized full-body components',
        )

        require(differences['03-early-fracture'] >= 0.04, 'early FRACTURE must begin evolving from contact')
        require(differences['04-mid-fracture'] >= 0.06, 'mid FRACTURE must differ visibly from contact')
        require(differences['05-transfer'] >= 0.08, 'TRANSFER must advance beyond contact')
        require(differences['06-remnant-settle'] >= 0.08, 'REMNANT_SETTLE must remain visually distinct')
        require(float(late_motion['mean_difference']) >= 0.15, 'debris/remnant region must continue settling')
        require(float(late_motion['changed_fraction']) >= 0.015, 'too few pixels evolve after remnant settle begins')
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
