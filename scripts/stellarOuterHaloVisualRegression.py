#!/usr/bin/env python3
"""Latest-main A/B supplement; all photographic and soft-rim gates run first."""
from __future__ import annotations
import base64
import json
import math
import os
import shutil
import statistics
from contextlib import contextmanager
from pathlib import Path
from PIL import Image, ImageDraw
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
import stellarPhotographicVisualRegression as photo

BASELINE = '076fb962267658e58cf56c8699423567fca155a5'
OUT = photo.OUT
prod, base = photo.production, photo.base

@contextmanager
def latest_preview():
    root = Path('/tmp/3bp-outer-halo-baseline')
    base.run(['git', 'worktree', 'add', '--detach', str(root), BASELINE])
    try:
        os.symlink(base.ROOT / 'node_modules', root / 'node_modules', target_is_directory=True)
        # Identical test-only initial conditions; real App/renderer on both refs.
        fixture = Path('src/visualRegression/productionCameraHandoffFixture.ts')
        shutil.copy2(base.ROOT / fixture, root / fixture)
        base.run([str(base.ROOT / 'node_modules/.bin/vite'), 'build'], cwd=root)
        with base.preview_server(root, base.BASELINE_PORT, OUT / 'outer-baseline-preview.log') as url:
            yield url
    finally:
        base.subprocess.run(['git', 'worktree', 'remove', '--force', str(root)], cwd=base.ROOT, check=False)


def angular(path, reference, geo):
    a, b = Image.open(path).convert('RGB'), Image.open(reference).convert('RGB')
    cx, cy, r = [geo[k] for k in ('center_x', 'center_y', 'equivalent_radius_px')]
    values = []
    for i in range(144):
        t = math.tau * (i + .5) / 144
        x, y = cx + r * 1.7 * math.cos(t), cy + r * 1.7 * math.sin(t)
        if not (1 <= x < a.width - 2 and 1 <= y < a.height - 2):
            return None  # Extreme halo may leave the mobile viewport.
        values.append(base.luminance(photo.rgb_at(a, x, y)) - base.luminance(photo.rgb_at(b, x, y)))
    modes = {str(k): 2 * abs(sum(v * complex(math.cos(k * math.tau * (i+.5)/144),
                  math.sin(k * math.tau * (i+.5)/144)) for i,v in enumerate(values))) / 144
             for k in (1, 2, 5, 9)}
    return {'mean_255': statistics.mean(values), 'modes_255': modes}


def pair_scene(driver, url):
    prod.configure_production_storage(driver, url)
    driver.get(url + '?visual-regression=production-camera-handoff&production-stellar-fixture=halo-pair')
    WebDriverWait(driver, 20).until(lambda d: len(d.find_elements(By.CSS_SELECTOR, '.body-tracking-button')) == 2)
    toggle = driver.find_element(By.CSS_SELECTOR, '.control-panel .panel-toggle')
    if toggle.get_attribute('aria-expanded') == 'true': toggle.click()
    prod.wait_frames(driver, 72)
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    prod.p2runner.apply_batch_zoom(driver, canvas, -10, settle_frames=36)
    return canvas


def timing(driver):
    # No PNG readback while measuring. Same SwiftShader runner, paired trials;
    # rAF intervals are frame pacing, not an isolated shader GPU timer.
    samples = driver.execute_async_script('''
      const done = arguments[arguments.length-1];
      const values=[]; let prev; let warm=30;
      function tick(t) {
        if(prev !== undefined && warm-- <= 0) values.push(t-prev);
        prev=t;
        if(values.length >= 120) done(values); else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    ''')
    values = sorted(samples)
    return {'median_ms': statistics.median(values), 'p95_ms': values[int(len(values)*.95)], 'samples_ms': samples}


def sequence(driver, canvas, revision):
    # Capture successive rendered frames during a deterministic zoom and pan of
    # a paused scene. No physics clock mismatch, Selenium waits, or PNG repaint.
    driver.execute_cdp_cmd('Input.dispatchMouseEvent', {'type':'mousePressed','x':195,'y':422,'button':'right','clickCount':1})
    records = driver.execute_async_script('''
      const canvas=arguments[0], done=arguments[arguments.length-1];
      const rect=canvas.getBoundingClientRect(); const frames=[]; let i=0;
      function tick() {
        const x=rect.left+rect.width*.5, y=rect.top+rect.height*.5;
        if(i < 18) canvas.dispatchEvent(new WheelEvent('wheel',
          {deltaY:i<9?-18:18,bubbles:true,cancelable:true,clientX:x,clientY:y}));
        if(i>18 && i<34) canvas.dispatchEvent(new PointerEvent('pointermove',
          {pointerId:1,pointerType:'mouse',button:2,buttons:2,bubbles:true,clientX:x+(i-18)*1.5,clientY:y+(i-18)*.4}));
        frames.push({image:canvas.toDataURL('image/png'),
          state:(window.__productionCameraHandoffHistory||[]).at(-1)});
        if(++i >= 40) done(frames); else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    ''', canvas)
    driver.execute_cdp_cmd('Input.dispatchMouseEvent', {'type':'mouseReleased','x':219,'y':428.4,'button':'right','clickCount':1})
    images=[]
    for i, record in enumerate(records):
        path=OUT / f'{revision}-motion-{i:02d}.png'
        path.write_bytes(base64.b64decode(record.pop('image').split(',',1)[1]))
        im=Image.open(path).convert('RGB')
        photo.require(max(im.getextrema()[0]) >= 200, 'motion frame has no rendered luminous core')
        images.append(im)
    images[0].save(OUT / f'{revision}-motion.gif',save_all=True,append_images=images[1:],duration=80,loop=0)
    sheet=Image.new('RGB',(390*5,430*8),'#070a10')
    draw=ImageDraw.Draw(sheet)
    for i, im in enumerate(images):
        sheet.paste(im.crop((0,220,390,620)),((i%5)*390,(i//5)*430+25))
        draw.text(((i%5)*390+5,(i//5)*430+5),f'frame {i}',fill='white')
    sheet.save(OUT / f'{revision}-motion-strip.png')
    return records


def main():
    original=json.loads((OUT/'metrics.json').read_text())
    driver=base.make_driver()
    result={'baseline_sha':BASELINE,'viewport':[390,844],'steps':original['wheel_steps'],
            'timing_note':'120 rAF intervals after 30 warmup frames; SwiftShader, no capture; not phone GPU timing',
            'metrics':{},'timing':{},'motion':{}}
    try:
      with latest_preview() as before_url:
        for revision,url in [('main',before_url),('candidate',base.CURRENT_URL)]:
            prod.configure_production_storage(driver,url)
            paths={s:{} for s in photo.STARS}; uis={s:{} for s in photo.STARS}
            result['metrics'][revision]={}
            for star in photo.STARS:
                result['metrics'][revision][star]={}
                for level in photo.LEVELS:
                    scene,ui,state=photo.capture(driver,url,revision,star,level,original['wheel_steps'][level])
                    paths[star][level],uis[star][level]=scene,ui
                    geo=original['metrics']['reference'][star][level]['geometry']
                    metric=photo.analyze(scene,geo)
                    metric['angular']=angular(scene,OUT/f'reference-{star}-{level}-scene.png',geo)
                    metric['state']=state
                    result['metrics'][revision][star][level]=metric
            photo.contact(paths,OUT/f'{revision}-outer-stars-3x3.png',crop=True)
            photo.contact(uis,OUT/f'{revision}-outer-mobile-3x3.png')
            canvas=pair_scene(driver,url)
            prod.capture_full_ui(driver,OUT/f'{revision}-overlap-ui.png')
            prod.capture_canvas(driver,canvas,OUT/f'{revision}-overlap-scene.png')
            result['motion'][revision]=sequence(driver,canvas,revision)
        # Alternate baseline/candidate to reduce order and warmup bias.
        for trial,revision in enumerate(['main','candidate','candidate','main','main','candidate']):
            url=before_url if revision=='main' else base.CURRENT_URL
            prod.configure_production_storage(driver,url)
            prod.prepare_scene(driver,url,'hot')
            single=timing(driver)
            pair_scene(driver,url)
            overlap=timing(driver)
            result['timing'].setdefault(revision,[]).append({'single':single,'overlap':overlap})
    finally:
        driver.quit()
        (OUT/'outer-metrics.json').write_text(json.dumps(result,indent=2))
    # Existing historical gates already ran. These bound unintended change.
    errors=[]
    for star in photo.STARS:
      for level in photo.LEVELS:
        a,b=[result['metrics'][rev][star][level] for rev in ('candidate','main')]
        try:
          photo.require(max(abs(x-y) for x,y in zip(a['core_rgb'],b['core_rgb']))<=1,'white core changed')
          for radius in ('0.98','1.04','1.1','1.2'):
            photo.require(abs(a['radial_luma'][radius]-b['radial_luma'][radius])<=.01,'near rim changed')
          for radius in ('1.4','1.7','2.0','2.3'):
            photo.require(abs(a['radial_luma'][radius]-b['radial_luma'][radius])<=.015,'global halo brightness/extent changed')
        except AssertionError as e: errors.append(f'{star}/{level}: {e}')
    photo.require(not errors,'\n'.join(errors))
    print('Outer halo preservation gates passed; direct visual adoption decision still required.')

if __name__=='__main__': main()
