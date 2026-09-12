#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUTPUT_DIR = Path('visual-regression-artifacts')
URL = os.environ.get(
    'VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=stellar-topology',
)


@dataclass
class FrameMetrics:
    width: int
    height: int
    roi_width: int
    roi_height: int
    hot_neutral_pixels: int
    hot_neutral_fraction: float
    largest_component_area: int
    largest_component_width: int
    largest_component_height: int
    largest_component_cx: float
    largest_component_cy: float
    saturated_bright_pixels: int
    saturated_bright_fraction: float
    clipped_white_fraction: float


def assert_condition(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def connected_components(mask: list[list[bool]]) -> list[tuple[int, int, int, float, float]]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    visited = [[False] * width for _ in range(height)]
    components: list[tuple[int, int, int, float, float]] = []

    for y in range(height):
        for x in range(width):
            if not mask[y][x] or visited[y][x]:
                continue
            queue = deque([(x, y)])
            visited[y][x] = True
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            sum_x = 0
            sum_y = 0

            while queue:
                cx, cy = queue.popleft()
                count += 1
                sum_x += cx
                sum_y += cy
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)

                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx = cx + dx
                        ny = cy + dy
                        if nx < 0 or nx >= width or ny < 0 or ny >= height:
                            continue
                        if visited[ny][nx] or not mask[ny][nx]:
                            continue
                        visited[ny][nx] = True
                        queue.append((nx, ny))

            components.append((
                count,
                max_x - min_x + 1,
                max_y - min_y + 1,
                sum_x / count,
                sum_y / count,
            ))

    components.sort(reverse=True, key=lambda component: component[0])
    return components


def analyze(path: Path) -> FrameMetrics:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    cx = width // 2
    cy = height // 2

    half_width = min(150, max(width // 3, 80))
    half_height = min(110, max(height // 3, 70))
    left = max(0, cx - half_width)
    upper = max(0, cy - half_height)
    right = min(width, cx + half_width)
    lower = min(height, cy + half_height)
    roi = image.crop((left, upper, right, lower))
    roi_width, roi_height = roi.size

    hot_mask = [[False] * roi_width for _ in range(roi_height)]
    hot_count = 0
    saturated_count = 0
    bright_count = 0
    clipped_count = 0

    pixels = roi.load()
    for y in range(roi_height):
        for x in range(roi_width):
            r, g, b = pixels[x, y]
            maximum = max(r, g, b)
            minimum = min(r, g, b)
            spread = maximum - minimum
            luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if luminance >= 100:
                bright_count += 1
            if minimum >= 250:
                clipped_count += 1

            is_hot_neutral = luminance >= 178 and spread <= 58
            if is_hot_neutral:
                hot_mask[y][x] = True
                hot_count += 1

            if luminance >= 92 and spread >= 72:
                saturated_count += 1

    components = connected_components(hot_mask)
    largest = components[0] if components else (0, 0, 0, 0.0, 0.0)
    area = max(roi_width * roi_height, 1)

    return FrameMetrics(
        width=width,
        height=height,
        roi_width=roi_width,
        roi_height=roi_height,
        hot_neutral_pixels=hot_count,
        hot_neutral_fraction=hot_count / area,
        largest_component_area=largest[0],
        largest_component_width=largest[1],
        largest_component_height=largest[2],
        largest_component_cx=largest[3],
        largest_component_cy=largest[4],
        saturated_bright_pixels=saturated_count,
        saturated_bright_fraction=saturated_count / area,
        clipped_white_fraction=clipped_count / max(bright_count, 1),
    )


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
    driver = (
        webdriver.Chrome(service=Service(driver_binary), options=options)
        if driver_binary else webdriver.Chrome(options=options)
    )
    # Freeze only this test page's presentation clock. WebDriver screenshot and
    # React commit latency must not age the short topology-retention window.
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source': """
        window.__stellarTestClock = { nowMs: 0, realNow: performance.now.bind(performance) };
        Object.defineProperty(performance, 'now', {
            value: () => window.__stellarTestClock.nowMs,
        });
    """})
    return driver


def advance_presentation(driver: webdriver.Chrome, milliseconds: float) -> None:
    driver.execute_async_script("""
        window.__stellarTestClock.nowMs += arguments[0];
        const done = arguments[arguments.length - 1];
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
    """, milliseconds)


def set_stage(driver: webdriver.Chrome, stage: str) -> float:
    # Commit the new topology and render it while presentation time is frozen.
    # Keep real elapsed time only as runner-latency diagnostics.
    elapsed_ms = driver.execute_async_script(
        """
        const stage = arguments[0];
        const done = arguments[arguments.length - 1];
        const startedAt = window.__stellarTestClock.realNow();
        window.__setStellarVisualStage(stage);

        const waitForCommit = () => {
          if (document.body.dataset.visualStage !== stage) {
            requestAnimationFrame(waitForCommit);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(() => {
            done(window.__stellarTestClock.realNow() - startedAt);
          }));
        };
        requestAnimationFrame(waitForCommit);
        """,
        stage,
    )
    return float(elapsed_ms)


def capture_canvas(driver: webdriver.Chrome, name: str) -> tuple[Path, FrameMetrics]:
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    path = OUTPUT_DIR / f'{name}.png'
    result = canvas.screenshot(str(path))
    assert_condition(bool(result) and path.exists(), f'failed to capture browser canvas for {name}')
    metrics = analyze(path)
    return path, metrics


def runtime_probes(driver, output, width):
    """Real RAF playback plus pause/speed changes, using the production renderer."""
    import base64
    import time
    from selenium.webdriver.common.action_chains import ActionChains
    from PIL import ImageChops
    results = []
    for speed in [.02, 1.0]:
        driver.execute_script("window.__collisionTest.reset('oblique')")
        driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
        driver.execute_script('window.__collisionTest.advance(.012)')
        driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
        canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
        before = output / f'{width}-{speed}-pause-before.png'
        after = output / f'{width}-{speed}-pause-after.png'
        canvas.screenshot(str(before))
        frozen_time = driver.execute_script('return window.__collisionTest.time')
        time.sleep(.5)
        canvas.screenshot(str(after))
        assert driver.execute_script('return window.__collisionTest.time') == frozen_time
        a, b = Image.open(before).convert('RGB'), Image.open(after).convert('RGB')
        box = (a.width//3, a.height//3, a.width*2//3, a.height*2//3)
        pause_changed_pixels = sum(max(pixel) > 2 for pixel in ImageChops.difference(a.crop(box), b.crop(box)).getdata())
        if 'baseline' not in str(output):
            assert pause_changed_pixels == 0, f'paused stellar surface/gas advanced: {pause_changed_pixels} pixels'
        # Resume from mid-contact, then change speed without resetting time/state.
        driver.execute_script('window.__collisionTest.play(arguments[0])', speed)
        WebDriverWait(driver, 30).until(lambda d: d.execute_script('return window.__collisionTest.time') > .018)
        time_before = driver.execute_script('window.__collisionTest.play(arguments[0]); return window.__collisionTest.time', speed * 2)
        WebDriverWait(driver, 30).until(lambda d: d.execute_script('return window.__collisionTest.time') > .03)
        driver.execute_script('window.__collisionTest.pause()')
        assert driver.execute_script('return window.__collisionTest.time') >= time_before
        # Record a complete collision as actual rendered video, including an orbit.
        driver.execute_script("window.__collisionTest.reset('oblique')")
        driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
        if speed == 1.0:
            ActionChains(driver).move_to_element(canvas).click_and_hold().move_by_offset(90, 55).release().perform()
        driver.execute_script('''
          const canvas=document.querySelector('.simulation-view canvas');
          window.__videoChunks=[]; window.__frameTimes=[]; window.__playbackStates=[];
          window.__recorder=new MediaRecorder(canvas.captureStream(20), {mimeType:'video/webm'});
          window.__recorder.ondataavailable=e=>window.__videoChunks.push(e.data);
          window.__recorder.start();
          let last=performance.now();
          const sample=now=>{window.__frameTimes.push(now-last);last=now;
            window.__playbackStates.push({time:window.__collisionTest.time,
              stars:window.__collisionTest.bodies.filter(b=>b.bodyType==='star').map(b=>({
                id:b.id,position:b.position,radius:b.radius,phase:b.stellarCollisionPresentation?.phase}))});
            if(window.__recorder.state==='recording') requestAnimationFrame(sample)};
          requestAnimationFrame(sample);
          window.__collisionTest.play(arguments[0]);
        ''', speed)
        WebDriverWait(driver, 60).until(lambda d: d.execute_script('return window.__collisionTest.time') >= .2)
        driver.execute_script('window.__collisionTest.pause()')
        video = driver.execute_async_script('''
          const done=arguments[0]; window.__recorder.onstop=()=>{
            const reader=new FileReader(); reader.onload=()=>done(reader.result.split(',')[1]);
            reader.readAsDataURL(new Blob(window.__videoChunks,{type:'video/webm'}));
          }; requestAnimationFrame(()=>requestAnimationFrame(()=>window.__recorder.stop()));
        ''')
        (output / f'{width}-{speed}-playback.webm').write_bytes(base64.b64decode(video))
        driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
        canvas.screenshot(str(output / f'{width}-{speed}-playback-end.png'))
        (output / f'{width}-{speed}-render-state.json').write_text(json.dumps(driver.execute_script('return window.__collisionTest.renderState'), indent=2))
        if 'baseline' not in str(output):
            assert driver.execute_script('return window.__collisionTest.renderState.every(b=>b.visible && b.stellarShader && b.opacity > .99 && b.emission > 0)'), 'settled stellar photosphere is hidden or unlit'
        states = driver.execute_script('return window.__playbackStates')
        assert all(state['stars'] for state in states), 'physical stars disappeared during playback'
        assert all(b['time'] >= a['time'] for a, b in zip(states, states[1:])), 'playback time reversed'
        (output / f'{width}-{speed}-playback-states.json').write_text(json.dumps(states, indent=2))
        durations = sorted(driver.execute_script('return window.__frameTimes').copy())
        results.append({'speed':speed, 'pause_changed_pixels':pause_changed_pixels,
                        'ci_frame_ms_median':durations[len(durations)//2],
                        'ci_frame_ms_p95':durations[min(len(durations)-1, int(len(durations)*.95))]})
    return results


def main() -> None:
    # Drive the production engine + SimulationView, never hand-place deeply
    # overlapping stars. Both revisions use this exact fixture and camera.
    from productionCameraHandoffVisualRegression import make_driver as make_production_driver
    import time
    output = Path(os.environ.get('STELLAR_CONTINUITY_OUTPUT', 'visual-regression-artifacts'))
    output.mkdir(parents=True, exist_ok=True)
    url = os.environ.get('VISUAL_TEST_URL', 'http://127.0.0.1:4173/3BP/?visual-regression=stellar-continuity')
    driver = make_production_driver()
    rows = []
    try:
        for width, height in [(900, 700), (390, 844)]:
            driver.set_window_size(width, height)
            for kind in ['oblique', 'head-on', 'partial', 'hit-run', 'solid']:
                driver.get(url)
                WebDriverWait(driver, 20).until(lambda d: d.execute_script('return !!window.__collisionTest'))
                driver.execute_script('window.__collisionTest.reset(arguments[0])', kind)
                time.sleep(0.15)
                previous = 0.0
                samples = []
                for target in [0, .001, .006, .012, .020, .0235, .0245, .03, .07, .15, .20]:
                    if target > previous:
                        driver.execute_script('window.__collisionTest.advance(arguments[0])', target - previous)
                    WebDriverWait(driver, 10).until(lambda d: abs(d.execute_script('return window.__collisionTest.time') - target) < 1e-8)
                    driver.execute_async_script('const done=arguments[0]; requestAnimationFrame(()=>requestAnimationFrame(done));')
                    path = output / f'{width}-{kind}-{target}.png'
                    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
                    canvas.screenshot(str(path))
                    state = driver.execute_script('return window.__collisionTest.bodies.map(b=>({id:b.id,type:b.bodyType,outcome:b.stellarCollisionOutcome,position:b.position,radius:b.radius}))')
                    metric = asdict(analyze(path))
                    samples.append({'time':target, 'frame':path.name, 'metrics':metric, 'state':state})
                    previous = target
                errors = [entry for entry in driver.get_log('browser') if 'WebGL' in entry['message'] and entry['level'] == 'SEVERE']
                assert not errors, f'WebGL runtime errors: {errors}'
                rows.append({'width':width,'height':height,'scenario':kind,'samples':samples})
            probes = runtime_probes(driver, output, width)
            (output / f'{width}-runtime.json').write_text(json.dumps(probes, indent=2))
        (output / 'metrics.json').write_text(json.dumps({'production':True, 'scenarios':rows}, indent=2))
    finally:
        driver.quit()
    print('production stellar collision captures generated; run strict gate and inspect images')


if __name__ == '__main__':
    main()
