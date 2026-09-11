#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from urllib.parse import urlencode

from PIL import Image, ImageChops, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-ejecta-stage3-visual-artifacts')
BASE_URL = 'http://127.0.0.1:4173/3BP/'
VIEWPORT = (900, 700)
SCENARIOS = ('representative', 'head-on', 'oblique')
BASELINES = ('stage2', 'stage3')
CAPTURE_TIMES = (
    ('t0000', 0.0),
    ('t0100', 0.1),
    ('t0200', 0.2),
    ('t0300', 0.3),
    ('t0500', 0.5),
    ('t0800', 0.8),
    ('t1000', 1.0),
    ('t1500', 1.5),
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument(f'--window-size={VIEWPORT[0]},{VIEWPORT[1]}')
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


def frame_difference(a: Path, b: Path) -> float:
    diff = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def non_dark_pixels(path: Path) -> int:
    image = Image.open(path).convert('RGB')
    return sum(1 for pixel in image.getdata() if max(pixel) >= 40)


def capture_canvas(driver: webdriver.Chrome, path: Path) -> None:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {path}')


def wait_until(started_at: float, target_seconds: float) -> None:
    remaining = target_seconds - (time.monotonic() - started_at)
    if remaining > 0:
        time.sleep(remaining)


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


def capture_run(
    driver: webdriver.Chrome,
    scenario: str,
    baseline: str,
) -> dict[str, object]:
    query = urlencode({
        'visual-regression': 'non-stellar-destruction',
        'ejecta-scenario': scenario,
        'ejecta-baseline': baseline,
        'survivor-response-baseline': 'stage3',
    })
    driver.get(f'{BASE_URL}?{query}')
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__startNonStellarDestructionVisual === "function"'
        )
    )
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
    )
    harness = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="non-stellar-destruction"]')
    require(harness.get_attribute('data-ejecta-scenario') == scenario, 'scenario routing mismatch')
    require(harness.get_attribute('data-ejecta-baseline') == baseline, 'baseline routing mismatch')
    expected_source = (
        'fragmentAwareEngineStageTwo.stepBodies'
        if baseline == 'stage2'
        else 'fragmentAwareEngine.stepBodies'
    )
    require(harness.get_attribute('data-physics-source') == expected_source, 'physics source mismatch')

    # Use the same production renderer/camera and the same real-time playback path
    # for both stages. Stage 4 survivor geometry is explicitly disabled here so
    # the historical Stage 2 -> Stage 3 ejecta baseline remains executable.
    time.sleep(0.35)
    trigger(driver)
    harness = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="non-stellar-destruction"]')
    debris_count = int(harness.get_attribute('data-physical-debris-count') or '0')
    require(debris_count > 0, f'{scenario}/{baseline} did not create mass-bearing debris')

    run_dir = OUTPUT_DIR / scenario / baseline
    run_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    started_at = time.monotonic()
    for name, target in CAPTURE_TIMES:
        wait_until(started_at, target)
        path = run_dir / f'{name}.png'
        capture_canvas(driver, path)
        paths[name] = path

    energies = {name: non_dark_pixels(path) for name, path in paths.items()}
    motion_from_t0 = {
        name: frame_difference(paths['t0000'], path)
        for name, path in paths.items()
        if name != 't0000'
    }
    for name, energy in energies.items():
        require(energy >= 120, f'{scenario}/{baseline}/{name} capture is unexpectedly empty')
    require(
        motion_from_t0['t0500'] >= 0.02,
        f'{scenario}/{baseline} collision region did not visibly evolve through +0.5s',
    )

    return {
        'physics_source': expected_source,
        'physical_debris_count_at_resolve': debris_count,
        'non_dark_pixels': energies,
        'difference_from_t0': motion_from_t0,
        'paths': {name: str(path) for name, path in paths.items()},
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        runs: dict[str, dict[str, dict[str, object]]] = {}
        for scenario in SCENARIOS:
            runs[scenario] = {}
            for baseline in BASELINES:
                runs[scenario][baseline] = capture_run(driver, scenario, baseline)

        comparisons: dict[str, dict[str, float]] = {}
        for scenario in SCENARIOS:
            comparisons[scenario] = {}
            for name, _ in CAPTURE_TIMES:
                stage2 = Path(str(runs[scenario]['stage2']['paths'][name]))
                stage3 = Path(str(runs[scenario]['stage3']['paths'][name]))
                comparisons[scenario][name] = frame_difference(stage2, stage3)

        # Stage 3 intentionally preserves the established very-head-on velocity
        # distribution, while representative/grazing and oblique cases must be
        # visibly distinct from the executable Stage-2 baseline.
        for scenario in ('representative', 'oblique'):
            require(
                max(comparisons[scenario]['t0100'], comparisons[scenario]['t0300'], comparisons[scenario]['t0500']) >= 0.01,
                f'{scenario} Stage-3 ejecta is visually indistinguishable from Stage 2',
            )

        payload = {
            'viewport': {'width': VIEWPORT[0], 'height': VIEWPORT[1]},
            'capture_seconds_after_first_physical_result': {
                name: target for name, target in CAPTURE_TIMES
            },
            'runs': runs,
            'stage2_vs_stage3_mean_pixel_difference': comparisons,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('collision ejecta Stage2/Stage3 browser A/B regression: ok')
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
