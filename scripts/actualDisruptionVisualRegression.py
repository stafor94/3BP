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

OUTPUT_DIR = Path('actual-disruption-visual-artifacts')
URL = os.environ.get(
    'ACTUAL_DISRUPTION_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=actual-disruption',
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


def warm_source_pixels(path: Path) -> list[tuple[int, int]]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.30), int(width * 0.68)
    y0, y1 = int(height * 0.20), int(height * 0.80)
    candidates: set[tuple[int, int]] = set()
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = image.getpixel((x, y))
            if r >= 38 and r >= g * 1.06 and r >= b * 1.12:
                candidates.add((x, y))

    # The harness also leaves another warm physical body inside this broad ROI.
    # Measure the disrupted central source itself, not every similarly colored
    # body in the frame. Selecting the largest 4-connected warm component keeps
    # the hemisphere masks anchored to the body whose contact side is under test.
    components: list[list[tuple[int, int]]] = []
    remaining = set(candidates)
    while remaining:
        start = remaining.pop()
        stack = [start]
        component = [start]
        while stack:
            x, y = stack.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor not in remaining:
                    continue
                remaining.remove(neighbor)
                stack.append(neighbor)
                component.append(neighbor)
        components.append(component)

    require(bool(components), f'no disrupted source component found in {path.name}')
    source = max(components, key=len)
    require(len(source) >= 450, f'not enough disrupted source pixels in {path.name}')
    return source


def masked_difference(base: Path, current: Path, mask: list[tuple[int, int]]) -> float:
    image_a = Image.open(base).convert('RGB')
    image_b = Image.open(current).convert('RGB')
    values = [
        sum(abs(image_a.getpixel((x, y))[i] - image_b.getpixel((x, y))[i]) for i in range(3)) / 3.0
        for x, y in mask
    ]
    return sum(values) / len(values)


def darkened_fraction(base: Path, current: Path, mask: list[tuple[int, int]]) -> float:
    image_a = Image.open(base).convert('RGB')
    image_b = Image.open(current).convert('RGB')
    darkened = sum(
        1
        for x, y in mask
        if max(image_a.getpixel((x, y))) >= 45 and max(image_b.getpixel((x, y))) < 22
    )
    return darkened / len(mask)


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
        time.sleep(0.7)
        contact = capture_canvas(driver, '01-contact')
        source_pixels = warm_source_pixels(contact)
        center_x = sum(x for x, _ in source_pixels) / len(source_pixels)
        contact_side = [(x, y) for x, y in source_pixels if x >= center_x + 2]
        opposite_side = [(x, y) for x, y in source_pixels if x <= center_x - 2]
        require(len(contact_side) >= 180 and len(opposite_side) >= 180, 'source hemisphere masks are too small')

        trigger(driver)
        started_at = time.monotonic()
        captures: dict[str, Path] = {'contact': contact}
        names = ['02-150ms', '03-350ms', '04-700ms', '05-1100ms', '06-1600ms']
        for target, name in zip(CAPTURE_TARGETS, names):
            wait_until(started_at, target)
            captures[name] = capture_canvas(driver, name)

        localized = {}
        for name in ['02-150ms', '03-350ms', '04-700ms']:
            localized[name] = {
                'contact_side_difference': masked_difference(contact, captures[name], contact_side),
                'opposite_side_difference': masked_difference(contact, captures[name], opposite_side),
                'source_darkened_fraction': darkened_fraction(contact, captures[name], source_pixels),
            }
        frame_differences = {
            name: whole_frame_difference(contact, path)
            for name, path in captures.items()
            if name != 'contact'
        }
        energies = {name: image_energy(path) for name, path in captures.items()}
        payload = {
            'capture_targets_seconds': CAPTURE_TARGETS,
            'source_pixels': len(source_pixels),
            'contact_side_pixels': len(contact_side),
            'opposite_side_pixels': len(opposite_side),
            'localized_phase_metrics': localized,
            'whole_frame_difference': frame_differences,
            'non_dark_pixels': energies,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))

        require(
            localized['02-150ms']['source_darkened_fraction'] <= 0.035,
            '150ms impact hold must not dissolve the original source surface',
        )
        require(
            localized['03-350ms']['contact_side_difference'] >=
            localized['03-350ms']['opposite_side_difference'] * 1.08,
            '350ms contact compression must remain localized to the physical contact side',
        )
        require(
            localized['04-700ms']['contact_side_difference'] >=
            localized['04-700ms']['opposite_side_difference'] * 1.03,
            '700ms local ejecta onset must preserve contact-side localization',
        )
        require(frame_differences['03-350ms'] >= 0.10, '350ms contact-compression stage must differ visibly from contact')
        require(frame_differences['04-700ms'] >= 0.12, '700ms local-ejecta stage must advance beyond contact')
        require(frame_differences['05-1100ms'] >= 0.12, '1100ms disruption handoff must remain visible')
        require(frame_differences['06-1600ms'] >= 0.10, '1600ms result/fragments must remain visible')
        for name, energy in energies.items():
            require(energy >= 400, f'{name} capture is unexpectedly empty')
        print('actual disruption browser visual regression: ok')
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
