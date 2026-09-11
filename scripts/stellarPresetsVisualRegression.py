#!/usr/bin/env python3
"""Capture the real preset picker and moving multicolor stars in both space modes."""
import json
import re
from pathlib import Path

from PIL import Image
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait

from productionCameraHandoffVisualRegression import make_driver, BASE_URL

def visible_stars(path, bottom):
    image = Image.open(path).convert('RGB')
    # Exclude the top status, left tracking icons and collapsed bottom controls.
    bright = {(x, y) for y in range(80, min(image.height, bottom))
              for x in range(60, image.width - 15)
              if min(image.getpixel((x, y))) > 120
              and max(image.getpixel((x, y))) > 200}
    count = 0
    while bright:
        pending = [bright.pop()]
        size = 0
        while pending:
            x, y = pending.pop()
            size += 1
            for neighbor in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                if neighbor in bright:
                    bright.remove(neighbor)
                    pending.append(neighbor)
        if size >= 4:
            count += 1
    return count


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
            driver.find_element(By.CLASS_NAME, 'panel-toggle').click()
            canvas = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '.simulation-view canvas'))
            def unobscured_bottom():
                return driver.execute_script('''
                  const canvas=arguments[0].getBoundingClientRect();
                  const toggle=document.querySelector('.panel-toggle').getBoundingClientRect();
                  return Math.floor(toggle.top-canvas.top)-2;
                ''', canvas)
            # A screenshot command can span the panel's collapse transition.
            # Wait for finite UI animations, then use both sampled bounds.
            driver.execute_async_script('''
              const done=arguments[0];
              Promise.all(document.getAnimations().filter(a=>a.effect && a.effect.getTiming().iterations!==Infinity)
                .map(a=>a.finished.catch(()=>{}))).then(()=>requestAnimationFrame(()=>requestAnimationFrame(done)));
            ''')
            driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
            initial_bottom = unobscured_bottom()
            canvas.screenshot(str(OUT / f'{preset}-{mode}-initial.png'))
            initial_bottom = min(initial_bottom, unobscured_bottom())
            start = next(b for b in driver.find_elements(By.TAG_NAME, 'button') if b.is_displayed() and b.text.strip() == 'Start')
            start.click()
            def elapsed(d):
                match = re.search(r'Elapsed time\s+(\d+\.\d+)', d.find_element(By.CLASS_NAME, 'viewport-speed-menu').text, re.I)
                return float(match.group(1)) if match else 0
            wait.until(lambda d: elapsed(d) >= 3)
            next(b for b in driver.find_elements(By.TAG_NAME, 'button') if b.is_displayed() and b.text.strip() == 'Pause').click()
            moving_bottom = unobscured_bottom()
            canvas.screenshot(str(OUT / f'{preset}-{mode}-moving.png'))
            moving_bottom = min(moving_bottom, unobscured_bottom())
            driver.save_screenshot(str(OUT / f'{preset}-{mode}-ui.png'))
            for stage in ('initial', 'moving'):
                visible = visible_stars(OUT / f'{preset}-{mode}-{stage}.png', initial_bottom if stage == 'initial' else moving_bottom)
                assert visible == count, f'{preset}/{mode}/{stage}: expected {count} visible stars, got {visible}'
            results.append({'preset': preset, 'mode': mode, 'elapsed': elapsed(driver)})
    (OUT / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))
finally:
    driver.quit()
