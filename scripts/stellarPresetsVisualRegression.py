#!/usr/bin/env python3
"""Capture the real preset picker and moving multicolor stars in both space modes."""
import json
import re
from pathlib import Path

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait

from productionCameraHandoffVisualRegression import make_driver, BASE_URL

OUT = Path('stellar-presets-artifacts')
OUT.mkdir(exist_ok=True)
driver = make_driver()
results = []
try:
    driver.get(BASE_URL)
    for mode in ('2d', '3d'):
        for count, preset in ((2, 'binarySpectrum'), (3, 'tripleSpectrum'), (4, 'quadSpectrum')):
            driver.execute_script('''
              localStorage.setItem('3bp-language', 'en');
              localStorage.setItem('3bp-space-mode', arguments[0]);
              localStorage.setItem('3bp-body-count', String(arguments[1]));
              localStorage.setItem('3bp-preset', arguments[2]);
              localStorage.setItem('3bp-collision-watch-enabled', 'false');
            ''', mode, count, preset)
            driver.refresh()
            wait = WebDriverWait(driver, 30)
            picker = wait.until(lambda d: d.find_element(By.ID, 'preset'))
            assert Select(picker).first_selected_option.get_attribute('value') == preset
            # Select through the actual UI as well as checking saved-preset restoration.
            fallback = next(o.get_attribute('value') for o in Select(picker).options if o.get_attribute('value') != preset)
            Select(picker).select_by_value(fallback)
            Select(driver.find_element(By.ID, 'preset')).select_by_value(preset)
            canvas = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '.simulation-view canvas'))
            driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
            canvas.screenshot(str(OUT / f'{preset}-{mode}-initial.png'))
            start = next(b for b in driver.find_elements(By.TAG_NAME, 'button') if b.is_displayed() and b.text.strip() == 'Start')
            start.click()
            def elapsed(d):
                match = re.search(r'Elapsed time\s+(\d+\.\d+)', d.find_element(By.CLASS_NAME, 'viewport-speed-menu').text, re.I)
                return float(match.group(1)) if match else 0
            wait.until(lambda d: elapsed(d) >= 3)
            next(b for b in driver.find_elements(By.TAG_NAME, 'button') if b.is_displayed() and b.text.strip() == 'Pause').click()
            canvas.screenshot(str(OUT / f'{preset}-{mode}-moving.png'))
            driver.save_screenshot(str(OUT / f'{preset}-{mode}-ui.png'))
            results.append({'preset': preset, 'mode': mode, 'elapsed': elapsed(driver)})
    (OUT / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))
finally:
    driver.quit()
