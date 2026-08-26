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


def warm_surface_centroid(path: Path) -> tuple[float, float, int]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.34), int(width * 0.66)
    y0, y1 = int(height * 0.24), int(height * 0.76)
    points: list[tuple[int, int]] = []

    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if r < 35:
                continue
            if r < g * 1.06 or r < b * 1.12:
                continue
            points.append((x, y))

    require(len(points) >= 40, f'not enough warm source-surface pixels in {path.name}')
    center_x = sum(x for x, _ in points) / len(points)
    center_y = sum(y for _, y in points) / len(points)
    return center_x, center_y, len(points)


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

        # Let ordinary tracking settle on the original source before contact capture.
        time.sleep(0.65)
        contact = capture_canvas(driver, '01-contact')

        trigger_destruction(driver)
        destruction_started_at = time.monotonic()

        # Target absolute offsets from the committed destruction state. Screenshot
        # capture itself can take hundreds of milliseconds on CI, so cumulative
        # sleeps would otherwise push later captures past the 1.5s handoff.
        wait_until(destruction_started_at, 0.30)
        early = capture_canvas(driver, '02-early-fracture')
        wait_until(destruction_started_at, 0.78)
        middle = capture_canvas(driver, '03-mid-breakup')
        wait_until(destruction_started_at, 1.18)
        reveal = capture_canvas(driver, '04-result-reveal')
        # Capture final debris well after the 1.5s source handoff so the final
        # frame proves that physical fragment separation continues after reveal.
        wait_until(destruction_started_at, 2.10)
        final = capture_canvas(driver, '05-final-debris')

        captures = {
            'contact': contact,
            'early_fracture': early,
            'mid_breakup': middle,
            'result_reveal': reveal,
            'final_debris': final,
        }
        energies = {name: image_energy(path) for name, path in captures.items()}
        differences = {
            'contact_to_early': mean_difference(contact, early),
            'early_to_mid': mean_difference(early, middle),
            'mid_to_reveal': mean_difference(middle, reveal),
            'reveal_to_final': mean_difference(reveal, final),
        }
        contact_centroid = warm_surface_centroid(contact)
        early_centroid = warm_surface_centroid(early)
        early_surface_shift = math.dist(contact_centroid[:2], early_centroid[:2])

        payload['capture_targets_seconds'] = {
            'early_fracture': 0.30,
            'mid_breakup': 0.78,
            'result_reveal': 1.18,
            'final_debris': 2.10,
        }
        payload['non_dark_pixels'] = energies
        payload['mean_frame_differences'] = differences
        payload['warm_surface_centroid'] = {
            'contact': {
                'x': contact_centroid[0],
                'y': contact_centroid[1],
                'pixels': contact_centroid[2],
            },
            'early_fracture': {
                'x': early_centroid[0],
                'y': early_centroid[1],
                'pixels': early_centroid[2],
            },
            'early_shift_px': early_surface_shift,
        }

        # Persist diagnostics before assertions so failed CI runs remain debuggable.
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        require(energies['contact'] >= 700, 'contact capture is unexpectedly empty')
        require(
            energies['early_fracture'] >= energies['contact'] * 0.55,
            'the original solid surface disappeared too abruptly during early fracture',
        )
        require(
            early_surface_shift <= 38.0,
            'preserved source surface moved after destruction; possible synthetic handoff drift',
        )
        for stage, energy in energies.items():
            require(energy >= 450, f'{stage} capture is unexpectedly empty')
            require(
                energy <= energies['contact'] * 3.5,
                f'{stage} foreground expanded excessively; possible camera overzoom/reframe',
            )

        require(
            differences['contact_to_early'] >= 0.12,
            'early fracture must be visually distinct from contact',
        )
        require(
            differences['early_to_mid'] >= 0.12,
            'mid breakup must advance beyond early fracture',
        )
        require(
            differences['mid_to_reveal'] >= 0.10,
            'result reveal must remain visually distinct from mid breakup',
        )
        require(
            differences['reveal_to_final'] >= 0.08,
            'final debris must continue evolving after result reveal',
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
