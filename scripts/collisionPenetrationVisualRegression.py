#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-penetration-visual-artifacts')
BASE_URL = os.environ.get(
    'COLLISION_PENETRATION_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=absorption-continuity',
)
CONTACT_STEPS = [0, 4, 8, 12, 15]
PHYSICS_DT = 0.0015
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


def mode_url(phase_one: bool) -> str:
    separator = '&' if '?' in BASE_URL else '?'
    if not phase_one:
        return BASE_URL
    return f'{BASE_URL}{separator}penetration-baseline=phase1'


def open_mode(driver: webdriver.Chrome, phase_one: bool) -> None:
    driver.get(mode_url(phase_one))
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return typeof window.__setAbsorptionContinuityVisualStep === "function"'
        )
    )
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
    )
    expected = 'phase1' if phase_one else 'after'
    WebDriverWait(driver, 15, poll_frequency=0.05).until(
        lambda browser: browser.find_element(
            By.CSS_SELECTOR,
            '[data-visual-regression="absorption-continuity"]',
        ).get_attribute('data-penetration-baseline') == expected
    )
    time.sleep(0.45)


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


def diagnostics(driver: webdriver.Chrome) -> dict[str, float | int | str]:
    root = driver.find_element(By.CSS_SELECTOR, '[data-visual-regression="absorption-continuity"]')
    return {
        'mode': root.get_attribute('data-penetration-baseline') or '',
        'impactor_radius': float(root.get_attribute('data-impactor-radius') or 0),
        'primary_radius': float(root.get_attribute('data-primary-radius') or 0),
        'source_separation': float(root.get_attribute('data-source-separation') or 0),
        'penetration_depth': float(root.get_attribute('data-penetration-depth') or 0),
        'normalized_penetration': float(root.get_attribute('data-normalized-penetration') or 0),
        'remnant_id': root.get_attribute('data-remnant-id') or '',
        'mass_effect_count': int(root.get_attribute('data-mass-effect-count') or 0),
        'solid_fragment_count': int(root.get_attribute('data-solid-fragment-count') or 0),
    }


def capture_canvas(driver: webdriver.Chrome, name: str) -> str:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / f'{name}.png'
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'failed to capture {name}')
    require(path.stat().st_size > 1000, f'capture {name} is unexpectedly small')
    return str(path)


def capture_contact_sequence(driver: webdriver.Chrome, phase_one: bool) -> dict[int, dict[str, object]]:
    label = 'phase1' if phase_one else 'after'
    open_mode(driver, phase_one)
    samples: dict[int, dict[str, object]] = {}
    for step in CONTACT_STEPS:
        set_visual_step(driver, step)
        sample = diagnostics(driver)
        sample['simulation_time_s'] = step * PHYSICS_DT
        sample['image'] = capture_canvas(driver, f'{label}-{step:02d}-step')
        samples[step] = sample
    return samples


def capture_after_handoff_timeline(driver: webdriver.Chrome) -> dict[str, object]:
    set_visual_step(driver, 16)
    timeline: dict[str, object] = {
        't0': {
            'diagnostics': diagnostics(driver),
            'image': capture_canvas(driver, 'after-16-outcome-t0'),
        }
    }
    started = time.monotonic()
    for target_seconds, label in [(0.1, 't-plus-0.1s'), (0.3, 't-plus-0.3s'), (0.5, 't-plus-0.5s')]:
        remaining = target_seconds - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)
        handoff = driver.execute_script(
            'return Object.values(window.__collisionSolidHandoffMetrics || {})[0] || null;'
        )
        timeline[label] = {
            'wall_time_s': target_seconds,
            'handoff': handoff,
            'image': capture_canvas(driver, f'after-{label}'),
        }
    return timeline


def peak(samples: dict[int, dict[str, object]], intact_only: bool = False) -> float:
    values = []
    initial_radius = float(samples[0]['impactor_radius'])
    for sample in samples.values():
        if intact_only and float(sample['impactor_radius']) < initial_radius * 0.7:
            continue
        values.append(float(sample['normalized_penetration']))
    return max(values, default=0.0)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)

        phase_one = capture_contact_sequence(driver, True)
        after = capture_contact_sequence(driver, False)
        phase_one_peak = peak(phase_one)
        phase_one_intact_peak = peak(phase_one, True)
        after_peak = peak(after)
        after_intact_peak = peak(after, True)

        require(
            phase_one_intact_peak >= 0.45,
            f'phase-1 browser fixture no longer reproduces deep intact penetration: {phase_one_intact_peak:.4f}',
        )
        require(
            after_peak <= MAX_NORMALIZED_PENETRATION + 0.002,
            f'after browser state exceeded normalized penetration cap: {after_peak:.4f}',
        )
        require(
            after_intact_peak <= MAX_NORMALIZED_PENETRATION + 0.002,
            f'after intact collider exceeded normalized penetration cap: {after_intact_peak:.4f}',
        )
        require(
            after_intact_peak <= phase_one_intact_peak * 0.45,
            f'intact browser penetration did not materially improve: {phase_one_intact_peak:.4f} -> {after_intact_peak:.4f}',
        )

        handoff_timeline = capture_after_handoff_timeline(driver)
        t0_diag = handoff_timeline['t0']['diagnostics']
        require(bool(t0_diag['remnant_id']), 'step 16 must resolve to a physical remnant')
        require(
            int(t0_diag['mass_effect_count']) > 0,
            'phase-1 mass-bearing ejecta continuity must remain present after penetration correction',
        )

        payload = {
            'physics_dt': PHYSICS_DT,
            'contact_steps': CONTACT_STEPS,
            'phase1': phase_one,
            'after': after,
            'phase1_peak_normalized_penetration': phase_one_peak,
            'phase1_peak_intact_normalized_penetration': phase_one_intact_peak,
            'after_peak_normalized_penetration': after_peak,
            'after_peak_intact_normalized_penetration': after_intact_peak,
            'handoff_timeline': handoff_timeline,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('collision penetration browser A/B regression: ok')
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
