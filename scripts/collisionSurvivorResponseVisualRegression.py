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

OUTPUT_DIR = Path('collision-survivor-stage4-visual-artifacts')
BASE_URL = 'http://127.0.0.1:4173/3BP/'
VIEWPORT = (900, 700)
SCENARIOS = ('representative', 'head-on', 'oblique')
BASELINES = ('stage3', 'stage4')
PRE_CAPTURE = ('tm0100', -0.1)
POST_CAPTURES = (
    ('t0000', 0.0),
    ('t0050', 0.05),
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


def wait_two_frames(driver: webdriver.Chrome) -> None:
    driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        requestAnimationFrame(() => requestAnimationFrame(done));
        """
    )


def seek(driver: webdriver.Chrome, seconds_after_impact: float) -> None:
    driver.execute_async_script(
        """
        const target = arguments[0];
        const done = arguments[arguments.length - 1];
        window.__seekNonStellarDestructionVisual(target);
        requestAnimationFrame(() => requestAnimationFrame(done));
        """,
        seconds_after_impact,
    )


def reset(driver: webdriver.Chrome) -> None:
    driver.execute_script(
        """
        window.__survivorImpactResponseMetrics = {};
        window.__resetNonStellarDestructionVisual();
        """
    )
    wait_two_frames(driver)


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


def read_response_metrics(driver: webdriver.Chrome) -> dict[str, object]:
    raw = driver.execute_script(
        'return window.__survivorImpactResponseMetrics || {};'
    )
    return raw if isinstance(raw, dict) else {}


def strongest_response(metrics: dict[str, object]) -> dict[str, object] | None:
    candidates = [value for value in metrics.values() if isinstance(value, dict)]
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda item: float(item.get('baseCompression', 0)) + float(item.get('baseShear', 0)),
    )


def capture_run(
    driver: webdriver.Chrome,
    scenario: str,
    baseline: str,
) -> dict[str, object]:
    query = urlencode({
        'visual-regression': 'non-stellar-destruction',
        'ejecta-scenario': scenario,
        'ejecta-baseline': 'stage3',
        'survivor-response-baseline': baseline,
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
    require(harness.get_attribute('data-ejecta-baseline') == 'stage3', 'physics baseline routing mismatch')
    require(
        harness.get_attribute('data-physics-source') == 'fragmentAwareEngine.stepBodies',
        'Stage 3/4 A/B must use the same production Stage 3 physics source',
    )

    run_dir = OUTPUT_DIR / scenario / baseline
    run_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    telemetry: dict[str, dict[str, object] | None] = {}

    # Independent deterministic pre-impact snapshot. The actual post-impact A/B
    # below uses the production real-time renderer path so existing collision/VFX
    # wall-clock lifecycles are exercised rather than synthetically reconstructed.
    seek(driver, PRE_CAPTURE[1])
    pre_path = run_dir / f'{PRE_CAPTURE[0]}.png'
    capture_canvas(driver, pre_path)
    paths[PRE_CAPTURE[0]] = pre_path
    telemetry[PRE_CAPTURE[0]] = strongest_response(read_response_metrics(driver))

    reset(driver)
    time.sleep(0.15)
    trigger(driver)
    harness = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="non-stellar-destruction"]')
    debris_count = int(harness.get_attribute('data-physical-debris-count') or '0')
    require(debris_count > 0, f'{scenario}/{baseline} did not create mass-bearing debris')

    started_at = time.monotonic()
    for name, target in POST_CAPTURES:
        wait_until(started_at, target)
        path = run_dir / f'{name}.png'
        capture_canvas(driver, path)
        paths[name] = path
        telemetry[name] = strongest_response(read_response_metrics(driver))

    energies = {name: non_dark_pixels(path) for name, path in paths.items()}
    for name, energy in energies.items():
        require(energy >= 120, f'{scenario}/{baseline}/{name} capture is unexpectedly empty')

    first_response = telemetry['t0000'] or telemetry['t0050'] or telemetry['t0100']
    require(first_response is not None, f'{scenario}/{baseline} did not publish survivor response telemetry')
    if baseline == 'stage3':
        require(not bool(first_response.get('enabled')), f'{scenario} Stage 3 baseline response must be disabled')
        require(float(first_response.get('compression', 0)) == 0, f'{scenario} Stage 3 compression changed')
        require(float(first_response.get('shear', 0)) == 0, f'{scenario} Stage 3 shear changed')
    else:
        require(bool(first_response.get('enabled')), f'{scenario} Stage 4 response was not enabled')
        require(bool(first_response.get('eligible')), f'{scenario} Stage 4 response was not physically eligible')
        require(float(first_response.get('recoilSpeed', 0)) > 0, f'{scenario} survivor has no measured physical recoil')
        require(float(first_response.get('compression', 0)) > 0, f'{scenario} Stage 4 has no contact compression')
        settled = telemetry['t1000'] or telemetry['t1500']
        require(settled is not None, f'{scenario} Stage 4 settle telemetry missing')
        require(float(settled.get('compression', 1)) <= 1e-8, f'{scenario} compression did not settle')
        require(float(settled.get('shear', 1)) <= 1e-8, f'{scenario} shear did not settle')

    return {
        'physics_source': 'fragmentAwareEngine.stepBodies',
        'physical_debris_count_at_resolve': debris_count,
        'non_dark_pixels': energies,
        'telemetry': telemetry,
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
            for name, _ in (PRE_CAPTURE, *POST_CAPTURES):
                stage3 = Path(str(runs[scenario]['stage3']['paths'][name]))
                stage4 = Path(str(runs[scenario]['stage4']['paths'][name]))
                comparisons[scenario][name] = frame_difference(stage3, stage4)

            require(
                max(
                    comparisons[scenario]['t0000'],
                    comparisons[scenario]['t0100'],
                    comparisons[scenario]['t0300'],
                    comparisons[scenario]['t0500'],
                ) >= 0.001,
                f'{scenario} Stage 4 survivor response is not visibly distinct from Stage 3',
            )

        response_at_contact: dict[str, dict[str, object]] = {}
        for scenario in SCENARIOS:
            telemetry = runs[scenario]['stage4']['telemetry']
            response = telemetry['t0000'] or telemetry['t0050'] or telemetry['t0100']
            require(isinstance(response, dict), f'{scenario} missing Stage 4 response profile')
            response_at_contact[scenario] = response

        require(
            float(response_at_contact['head-on']['headOn']) >
            float(response_at_contact['oblique']['headOn']) >
            float(response_at_contact['representative']['headOn']),
            'head-on/oblique/grazing response geometry ordering is wrong',
        )
        require(
            float(response_at_contact['head-on']['baseShear']) <
            float(response_at_contact['oblique']['baseShear']) <
            float(response_at_contact['representative']['baseShear']),
            'grazing survivor response must carry more tangential shear than head-on',
        )

        payload = {
            'viewport': {'width': VIEWPORT[0], 'height': VIEWPORT[1]},
            'capture_seconds_relative_to_first_physical_result': {
                PRE_CAPTURE[0]: PRE_CAPTURE[1],
                **{name: target for name, target in POST_CAPTURES},
            },
            'runs': runs,
            'stage3_vs_stage4_mean_pixel_difference': comparisons,
            'stage4_contact_response': response_at_contact,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('collision survivor Stage3/Stage4 browser A/B regression: ok')
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
