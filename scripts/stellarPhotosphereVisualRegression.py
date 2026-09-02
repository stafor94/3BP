#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path.cwd()
OUTPUT_DIR = Path('stellar-photosphere-visual-artifacts')
CURRENT_URL = os.environ.get('STELLAR_PHOTOSPHERE_CURRENT_URL', 'http://127.0.0.1:4173/3BP/')
BASELINE_REF = os.environ.get(
    'STELLAR_PHOTOSPHERE_BASELINE_REF',
    'ca5568cd7f6bac13f63680c45593e0c24913cc96',
)
BASELINE_PORT = 4183
VIEWPORT_WIDTH = 390
VIEWPORT_HEIGHT = 844


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run(command: list[str], cwd: Path = ROOT) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def wait_for_url(url: str, process: subprocess.Popen[str] | None = None) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f'preview exited before becoming ready: {url}')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise TimeoutError(f'preview did not become ready: {url}')


@contextmanager
def baseline_preview(ref: str):
    worktree = Path('/tmp/3bp-stellar-photosphere-baseline')
    log_path = OUTPUT_DIR / 'baseline-preview.log'
    if worktree.exists():
        shutil.rmtree(worktree, ignore_errors=True)

    run(['git', 'fetch', 'origin', 'main', '--depth=50'])
    run(['git', 'worktree', 'add', '--detach', str(worktree), ref])
    process: subprocess.Popen[str] | None = None
    log_handle = None
    try:
        node_modules = ROOT / 'node_modules'
        require(node_modules.exists(), 'root node_modules is required for baseline build')
        os.symlink(node_modules, worktree / 'node_modules', target_is_directory=True)
        run([str(node_modules / '.bin' / 'vite'), 'build'], cwd=worktree)
        log_handle = log_path.open('w', encoding='utf-8')
        process = subprocess.Popen(
            ['npm', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', str(BASELINE_PORT)],
            cwd=worktree,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
        root_url = f'http://127.0.0.1:{BASELINE_PORT}/3BP/'
        wait_for_url(root_url, process)
        yield root_url
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        if log_handle is not None:
            log_handle.close()
        try:
            if (worktree / 'node_modules').is_symlink():
                (worktree / 'node_modules').unlink()
        except FileNotFoundError:
            pass
        subprocess.run(['git', 'worktree', 'remove', '--force', str(worktree)], cwd=ROOT, check=False)
        shutil.rmtree(worktree, ignore_errors=True)


def make_driver() -> webdriver.Chrome:
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=900,900')
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
        if driver_binary
        else webdriver.Chrome(options=options)
    )
    driver.execute_cdp_cmd(
        'Page.addScriptToEvaluateOnNewDocument',
        {
            'source': '''
                (() => {
                  let state = 0x52d9a31b >>> 0;
                  Math.random = () => {
                    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                    return state / 4294967296;
                  };
                })();
            ''',
        },
    )
    driver.execute_cdp_cmd(
        'Emulation.setDeviceMetricsOverride',
        {
            'width': VIEWPORT_WIDTH,
            'height': VIEWPORT_HEIGHT,
            'deviceScaleFactor': 1,
            'mobile': True,
        },
    )
    return driver


def harness_url(root_url: str) -> str:
    return f'{root_url}?visual-regression=stellar-topology'


def capture(driver: webdriver.Chrome, label: str, root_url: str) -> Path:
    driver.get(harness_url(root_url))
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script('return typeof window.__setStellarVisualStage === "function"')
    )
    driver.execute_async_script(
        '''
        const done = arguments[arguments.length - 1];
        window.__setStellarVisualStage('separate');
        const waitForStage = () => {
          if (document.body.dataset.visualStage !== 'separate') {
            requestAnimationFrame(waitForStage);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)));
        };
        requestAnimationFrame(waitForStage);
        ''',
    )
    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return arguments[0].width > 0 && arguments[0].height > 0',
            canvas,
        )
    )
    path = OUTPUT_DIR / f'{label}-mobile.png'
    require(bool(canvas.screenshot(str(path))) and path.exists(), f'{label}: failed to capture mobile canvas')
    return path


def luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def analyze(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    crop_half_height = min(190, height // 3)
    roi = image.crop((0, height // 2 - crop_half_height, width, height // 2 + crop_half_height))
    pixels = roi.load()
    roi_width, roi_height = roi.size

    bright_pixels = 0
    very_bright_pixels = 0
    bright_luma_sum = 0.0
    neighbor_delta_sum = 0.0
    neighbor_delta_count = 0

    for y in range(roi_height):
        for x in range(roi_width):
            current_luma = luminance(pixels[x, y])
            if current_luma >= 90:
                bright_pixels += 1
                bright_luma_sum += current_luma
            if current_luma >= 180:
                very_bright_pixels += 1
            if x + 1 < roi_width:
                neighbor_luma = luminance(pixels[x + 1, y])
                if current_luma >= 150 and neighbor_luma >= 150:
                    neighbor_delta_sum += abs(current_luma - neighbor_luma)
                    neighbor_delta_count += 1
            if y + 1 < roi_height:
                neighbor_luma = luminance(pixels[x, y + 1])
                if current_luma >= 150 and neighbor_luma >= 150:
                    neighbor_delta_sum += abs(current_luma - neighbor_luma)
                    neighbor_delta_count += 1

    area = max(roi_width * roi_height, 1)
    return {
        'width': width,
        'height': height,
        'roi_width': roi_width,
        'roi_height': roi_height,
        'bright_fraction': bright_pixels / area,
        'very_bright_fraction': very_bright_pixels / area,
        'bright_mean_luma': bright_luma_sum / max(bright_pixels, 1),
        'surface_neighbor_contrast': neighbor_delta_sum / max(neighbor_delta_count, 1),
    }


def mean_absolute_delta(baseline_path: Path, current_path: Path) -> float:
    baseline = Image.open(baseline_path).convert('RGB')
    current = Image.open(current_path).convert('RGB')
    require(baseline.size == current.size, 'baseline/current mobile captures must have identical dimensions')
    width, height = baseline.size
    crop_half_height = min(190, height // 3)
    box = (0, height // 2 - crop_half_height, width, height // 2 + crop_half_height)
    diff = ImageChops.difference(baseline.crop(box), current.crop(box))
    return sum(ImageStat.Stat(diff).mean) / 3.0


def make_contact_sheet(baseline_path: Path, current_path: Path) -> None:
    baseline = Image.open(baseline_path).convert('RGB')
    current = Image.open(current_path).convert('RGB')
    label_height = 34
    margin = 12
    sheet = Image.new(
        'RGB',
        (baseline.width * 2 + margin * 3, baseline.height + label_height + margin * 2),
        (12, 14, 20),
    )
    draw = ImageDraw.Draw(sheet)
    left_x = margin
    right_x = margin * 2 + baseline.width
    draw.text((left_x, margin), 'Baseline / main v0.24.4', fill=(235, 238, 245))
    draw.text((right_x, margin), 'Current / stellar photosphere-corona', fill=(235, 238, 245))
    sheet.paste(baseline, (left_x, margin + label_height))
    sheet.paste(current, (right_x, margin + label_height))
    sheet.save(OUTPUT_DIR / 'mobile-ab-contact-sheet.png')


def validate(metrics: dict[str, dict[str, float | int]], delta: float) -> None:
    baseline = metrics['baseline']
    current = metrics['current']
    require(delta >= 0.08, f'stellar visual A/B is effectively unchanged: mean absolute delta={delta:.4f}')
    require(
        current['bright_fraction'] <= baseline['bright_fraction'] * 1.35 + 0.002,
        'stellar refinement expands the bright footprint too aggressively: '
        f"baseline={baseline['bright_fraction']:.5f} current={current['bright_fraction']:.5f}",
    )
    require(
        current['very_bright_fraction'] <= baseline['very_bright_fraction'] * 1.30 + 0.002,
        'stellar refinement creates an excessive saturated/white-hot footprint: '
        f"baseline={baseline['very_bright_fraction']:.5f} current={current['very_bright_fraction']:.5f}",
    )
    require(
        current['surface_neighbor_contrast'] >= baseline['surface_neighbor_contrast'] * 1.01,
        'photosphere does not gain measurable local surface structure in the main-sequence scene: '
        f"baseline={baseline['surface_neighbor_contrast']:.4f} current={current['surface_neighbor_contrast']:.4f}",
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wait_for_url(CURRENT_URL)
    driver = make_driver()
    try:
        with baseline_preview(BASELINE_REF) as baseline_url:
            baseline_path = capture(driver, 'baseline', baseline_url)
        current_path = capture(driver, 'current', CURRENT_URL)
    finally:
        driver.quit()

    metrics = {
        'baseline': analyze(baseline_path),
        'current': analyze(current_path),
    }
    delta = mean_absolute_delta(baseline_path, current_path)
    validate(metrics, delta)
    make_contact_sheet(baseline_path, current_path)

    payload = {
        'baseline_ref': BASELINE_REF,
        'viewport': {'width': VIEWPORT_WIDTH, 'height': VIEWPORT_HEIGHT, 'mobile': True},
        'scene': 'stellar-topology/separate (two main-sequence stars)',
        'mean_absolute_delta': delta,
        'metrics': metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    print(
        'stellar photosphere mobile A/B: ok '
        f"delta={delta:.4f}, surface contrast "
        f"{metrics['baseline']['surface_neighbor_contrast']:.4f} -> "
        f"{metrics['current']['surface_neighbor_contrast']:.4f}"
    )


if __name__ == '__main__':
    main()
