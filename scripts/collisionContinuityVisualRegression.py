#!/usr/bin/env python3
from __future__ import annotations
import json
import os
import shutil
import time
from pathlib import Path
from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('collision-continuity-visual-artifacts')
URL = os.environ.get('COLLISION_CONTINUITY_VISUAL_TEST_URL', 'http://127.0.0.1:4173/3BP/?visual-regression=actual-disruption')
CAPTURES = [
    ('02-first-contact', 0.05),
    ('03-maximum-impact', 0.14),
    ('04-source-handoff', 0.26),
    ('05-remnant-first-visible', 0.58),
    ('06-forming-mid', 1.20),
    ('07-settling-start', 1.92),
    ('08-stable', 2.65),
]
VISIBLE_OPACITY = 0.55
RESULT_ID = 'moving-disruption-source+moving-disruption-impactor'

def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)

def make_driver() -> webdriver.Chrome:
    options = Options()
    for arg in ('--headless=new','--window-size=900,700','--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-webgl','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars'):
        options.add_argument(arg)
    chrome_binary = shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium') or shutil.which('chromium-browser')
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

def telemetry(driver: webdriver.Chrome) -> dict:
    return driver.execute_script("return {remnant: JSON.parse(JSON.stringify(window.__collisionContinuityMetrics || {})), effects: JSON.parse(JSON.stringify(window.__collisionEffectContinuityMetrics || {}))};")

def foreground_components(path: Path, threshold: int = 72, minimum_area: int = 18):
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.08), int(width * 0.94)
    y0, y1 = int(height * 0.12), int(height * 0.88)
    candidates = {(x,y) for y in range(y0,y1) for x in range(x0,x1) if max(image.getpixel((x,y))) >= threshold}
    components = []
    remaining = set(candidates)
    while remaining:
        seed = remaining.pop(); stack = [seed]; component = [seed]
        while stack:
            x,y = stack.pop()
            for neighbor in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if neighbor not in remaining: continue
                remaining.remove(neighbor); stack.append(neighbor); component.append(neighbor)
        if len(component) >= minimum_area: components.append(component)
    return sorted(components, key=len, reverse=True)

def component_aspect(component) -> float:
    xs = [p[0] for p in component]; ys = [p[1] for p in component]
    width = max(xs)-min(xs)+1; height = max(ys)-min(ys)+1
    return max(width,height) / max(1,min(width,height))

def trigger(driver: webdriver.Chrome) -> None:
    driver.execute_async_script("""
      const done = arguments[arguments.length - 1]; window.__startMovingDisruptionVisual();
      const poll = () => { if (document.body.dataset.visualStage !== 'destruction') { requestAnimationFrame(poll); return; } requestAnimationFrame(() => requestAnimationFrame(done)); }; requestAnimationFrame(poll);
    """)

def reset(driver: webdriver.Chrome) -> None:
    driver.execute_async_script("""
      const done = arguments[arguments.length - 1]; window.__resetMovingDisruptionVisual();
      const poll = () => { if (document.body.dataset.visualStage !== 'contact') { requestAnimationFrame(poll); return; } requestAnimationFrame(() => requestAnimationFrame(done)); }; requestAnimationFrame(poll);
    """)

def wait_until(started_at: float, target_seconds: float) -> None:
    remaining = target_seconds - (time.monotonic() - started_at)
    if remaining > 0: time.sleep(remaining)

def active_effect_aspects(snapshot: dict) -> list[float]:
    return [float(value['finalSilhouetteAspectRatio']) for value in snapshot.get('effects', {}).values() if float(value.get('opacity',0)) > 0.02]

def sample_16ms_continuity(driver: webdriver.Chrome) -> dict:
    reset(driver); trigger(driver); started_at = time.monotonic(); samples = []; next_target = 0.0
    while next_target <= 1.0 + 1e-9:
        wait_until(started_at, next_target); snapshot = telemetry(driver); remnant = snapshot.get('remnant',{}).get(RESULT_ID)
        samples.append({'target_ms': round(next_target*1000), 'remnant': remnant, 'effect_aspects': active_effect_aspects(snapshot)})
        next_target += 0.016
    previous_radius = None; first_visible = None; max_step = 0.0; max_effect_aspect = 0.0
    for sample in samples:
        if sample['effect_aspects']: max_effect_aspect = max(max_effect_aspect, max(sample['effect_aspects']))
        remnant = sample['remnant']
        if not remnant: continue
        radius = float(remnant['equivalentRadius'])
        if previous_radius is not None: max_step = max(max_step, abs(radius-previous_radius)/max(previous_radius,1e-9))
        previous_radius = radius
        if first_visible is None and float(remnant['opacity']) >= VISIBLE_OPACITY: first_visible = remnant
    require(first_visible is not None, '16ms sample never reached meaningful remnant visibility')
    source_radius = float(first_visible['sourceLastVisibleBoundingRadius']); first_radius = float(first_visible['equivalentRadius'])
    ratio = first_radius/source_radius; stable_growth = float(first_visible['physicalRadius'])/first_radius - 1
    require(0.90 <= ratio <= 1.05, f'first meaningful remnant radius ratio must be 90-105%, received {ratio:.4f}')
    require(stable_growth <= 0.03, f'visible remnant growth must be <=3%, received {stable_growth*100:.2f}%')
    require(max_step < 0.02, f'16ms adjacent-frame radius step must stay <2%, received {max_step*100:.2f}%')
    require(max_effect_aspect <= 2.02, f'non-stellar final impact silhouette exceeded 2:1: {max_effect_aspect:.3f}')
    return {'sample_count':len(samples),'first_visible_radius_ratio_to_source':ratio,'first_visible_bounding_ratio_to_source':float(first_visible['boundingRadius'])/source_radius,'visible_growth_to_stable':stable_growth,'max_adjacent_16ms_radius_step':max_step,'max_final_effect_silhouette_aspect':max_effect_aspect,'first_visible':first_visible,'samples':samples}

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True); driver = make_driver()
    try:
        driver.set_page_load_timeout(20); driver.set_script_timeout(10); driver.get(URL)
        WebDriverWait(driver,15,poll_frequency=0.05).until(lambda b: b.execute_script('return typeof window.__startMovingDisruptionVisual === "function"'))
        WebDriverWait(driver,15,poll_frequency=0.05).until(lambda b: len(b.find_elements(By.CSS_SELECTOR,'.simulation-view canvas')) == 1)
        time.sleep(0.7)
        captures = {'01-pre-impact': capture_canvas(driver,'01-pre-impact')}; snapshots = {'01-pre-impact':telemetry(driver)}
        trigger(driver); started_at = time.monotonic()
        for name,target in CAPTURES:
            wait_until(started_at,target); captures[name]=capture_canvas(driver,name); snapshots[name]=telemetry(driver)
        early_aspects = {}
        for name in ('02-first-contact','03-maximum-impact'):
            components = foreground_components(captures[name]); require(bool(components),f'{name}: no visible collision component')
            early_aspects[name] = component_aspect(components[0]); require(early_aspects[name] <= 2.25,f'{name}: captured collision cluster still reads as a pillar ({early_aspects[name]:.3f}:1)')
        visible_snapshots = []
        for name,snapshot in snapshots.items():
            remnant = snapshot.get('remnant',{}).get(RESULT_ID)
            if remnant and float(remnant.get('opacity',0)) >= VISIBLE_OPACITY: visible_snapshots.append((name,remnant))
        require(bool(visible_snapshots),'captured sequence has no meaningful remnant frame')
        first_name,first_remnant = visible_snapshots[0]; source_radius=float(first_remnant['sourceLastVisibleBoundingRadius']); first_radius=float(first_remnant['equivalentRadius']); first_ratio=first_radius/source_radius
        require(0.90 <= first_ratio <= 1.05,f'{first_name}: source->remnant radius continuity failed ({first_ratio:.4f})')
        require(float(first_remnant['boundingRadius'])/source_radius <= 1.08,f'{first_name}: first visible bounding radius is too different from source')
        visible_growth=float(first_remnant['physicalRadius'])/first_radius-1; require(visible_growth <= 0.03,f'{first_name}: remnant still visibly grows by {visible_growth*100:.2f}% after reveal')
        frame_samples=sample_16ms_continuity(driver)
        payload={'capture_targets_seconds':{'01-pre-impact':0.0,**{name:target for name,target in CAPTURES}},'capture_pixel_aspect_ratio':early_aspects,'first_meaningful_capture':first_name,'first_visible_radius_ratio_to_source':first_ratio,'first_visible_bounding_ratio_to_source':float(first_remnant['boundingRadius'])/source_radius,'visible_growth_to_stable':visible_growth,'snapshots':snapshots,'frame_level_16ms':frame_samples}
        (OUTPUT_DIR/'metrics.json').write_text(json.dumps(payload,indent=2),encoding='utf-8')
        print(json.dumps({'impact_pillar_pixel_aspect':early_aspects,'source_to_first_visible_radius_ratio':first_ratio,'source_to_first_visible_bounding_ratio':float(first_remnant['boundingRadius'])/source_radius,'visible_growth_percent':visible_growth*100,'max_adjacent_16ms_radius_step_percent':frame_samples['max_adjacent_16ms_radius_step']*100,'max_final_effect_silhouette_aspect':frame_samples['max_final_effect_silhouette_aspect']},indent=2))
        print('collision frame continuity browser visual regression: ok')
    except Exception:
        try: driver.save_screenshot(str(OUTPUT_DIR/'failure-page.png'))
        except Exception: pass
        raise
    finally: driver.quit()

if __name__ == '__main__': main()
