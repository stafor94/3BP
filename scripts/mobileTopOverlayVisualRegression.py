#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('mobile-top-overlay-visual-artifacts')
URL = os.environ.get(
    'MOBILE_TOP_OVERLAY_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/',
)
VIEWPORTS = ((500, 701), (390, 844), (320, 700))
EXPECTED_VERSION = json.loads(Path('package.json').read_text(encoding='utf-8'))['version']


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=700,900')
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


def rect(driver: webdriver.Chrome, selector: str) -> dict[str, float]:
    element = driver.find_element(By.CSS_SELECTOR, selector)
    return driver.execute_script(
        '''
        const r = arguments[0].getBoundingClientRect();
        return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height};
        ''',
        element,
    )


def overlaps(a: dict[str, float], b: dict[str, float]) -> bool:
    return not (
        a['right'] <= b['left']
        or b['right'] <= a['left']
        or a['bottom'] <= b['top']
        or b['bottom'] <= a['top']
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    driver = make_driver()
    metrics: dict[str, object] = {}
    try:
        driver.set_page_load_timeout(20)
        for width, height in VIEWPORTS:
            driver.execute_cdp_cmd(
                'Emulation.setDeviceMetricsOverride',
                {
                    'width': width,
                    'height': height,
                    'deviceScaleFactor': 1,
                    'mobile': True,
                },
            )
            driver.get(URL)
            WebDriverWait(driver, 15, poll_frequency=0.05).until(
                lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
            )
            WebDriverWait(driver, 15, poll_frequency=0.05).until(
                lambda browser: all(
                    browser.find_element(By.CSS_SELECTOR, selector).is_displayed()
                    for selector in ('.viewport-badge', '.screen-app-version', '.language-picker')
                )
            )

            badge = rect(driver, '.viewport-badge')
            version = rect(driver, '.screen-app-version')
            language = rect(driver, '.language-picker')
            label = f'{width}x{height}'

            require(not overlaps(badge, version), f'{label}: time/speed badge overlaps version badge')
            require(not overlaps(version, language), f'{label}: version badge overlaps language control')
            require(version['top'] >= 0 and version['bottom'] <= height, f'{label}: version is clipped vertically')
            require(version['left'] >= 0 and version['right'] <= width, f'{label}: version is clipped horizontally')
            require(version['height'] >= 8, f'{label}: version became unreadably short')
            require(
                driver.find_element(By.CSS_SELECTOR, '.screen-app-version').text.strip() == f'v{EXPECTED_VERSION}',
                f'{label}: rendered version does not match package.json',
            )

            screenshot = OUTPUT_DIR / f'top-overlay-{label}.png'
            require(driver.save_screenshot(str(screenshot)), f'{label}: failed to capture screenshot')
            metrics[label] = {
                'badge': badge,
                'version': version,
                'language': language,
                'badge_version_overlap': overlaps(badge, version),
                'version_language_overlap': overlaps(version, language),
            }
    finally:
        driver.quit()

    (OUTPUT_DIR / 'metrics.json').write_text(
        json.dumps(metrics, indent=2, sort_keys=True),
        encoding='utf-8',
    )
    print('mobile top overlay visual regression passed')


if __name__ == '__main__':
    main()
