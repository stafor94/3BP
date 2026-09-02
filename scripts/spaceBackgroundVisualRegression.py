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

from PIL import Image, ImageDraw, ImageStat
from selenium import webdriver
from selenium.webdriver import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path.cwd()
OUTPUT_DIR = Path('space-background-visual-artifacts')
CURRENT_URL = os.environ.get('SPACE_BACKGROUND_CURRENT_URL', 'http://127.0.0.1:4173/3BP/')
PASS3_REF = os.environ.get('SPACE_BACKGROUND_PASS3_REF', 'c4ed4833d1db74864479974363012ec2400c78fa')
PASS4_REF = os.environ.get('SPACE_BACKGROUND_PASS4_REF', '732578c2439e631df97129590d413c42057a4c9a')
VIEWPORTS = (
    ('mobile', 390, 844, True),
    ('desktop', 1280, 800, False),
)
VIEWPOINTS = (
    ('front', 0, 0),
    ('yaw-right', 120, 0),
    ('yaw-left', -120, 0),
    ('pitch-up', 0, -86),
    ('diagonal', 96, 68),
)
VARIANT_LABELS = {
    'pass3': 'Pass 3 / 0.23.0',
    'pass4': 'Pass 4 / 0.24.0',
    'current': 'Current / 0.24.1',
}


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
def baseline_preview(label: str, ref: str, port: int):
    worktree = Path('/tmp') / f'3bp-space-background-{label}'
    log_path = OUTPUT_DIR / f'{label}-preview.log'
    if worktree.exists():
        shutil.rmtree(worktree, ignore_errors=True)
    run(['git', 'worktree', 'add', '--detach', str(worktree), ref])
    process: subprocess.Popen[str] | None = None
    log_handle = None
    try:
        node_modules = ROOT / 'node_modules'
        require(node_modules.exists(), 'root node_modules is required for baseline builds')
        os.symlink(node_modules, worktree / 'node_modules', target_is_directory=True)
        run([str(node_modules / '.bin' / 'vite'), 'build'], cwd=worktree)
        log_handle = log_path.open('w', encoding='utf-8')
        process = subprocess.Popen(
            ['npm', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', str(port)],
            cwd=worktree,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
        url = f'http://127.0.0.1:{port}/3BP/'
        wait_for_url(url, process)
        yield url
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
    options.add_argument('--window-size=1400,950')
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
                  let state = 0x31b7d4a5 >>> 0;
                  Math.random = () => {
                    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                    return state / 4294967296;
                  };
                })();
            ''',
        },
    )
    return driver


def percentile(histogram: list[int], total: int, q: float) -> int:
    threshold = total * q
    accumulated = 0
    for value, count in enumerate(histogram):
        accumulated += count
        if accumulated >= threshold:
            return value
    return 255


def image_metrics(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB')
    gray = image.convert('L')
    histogram = gray.histogram()
    total = image.width * image.height
    return {
        'width': image.width,
        'height': image.height,
        'mean_luma': round(ImageStat.Stat(gray).mean[0], 4),
        'near_black_fraction': round(sum(histogram[:8]) / total, 6),
        'visible_low_mid_fraction': round(sum(histogram[10:80]) / total, 6),
        'bright_fraction': round(sum(histogram[128:]) / total, 6),
        'p50_luma': percentile(histogram, total, 0.50),
        'p90_luma': percentile(histogram, total, 0.90),
        'p95_luma': percentile(histogram, total, 0.95),
    }


def set_viewport(driver: webdriver.Chrome, width: int, height: int, mobile: bool) -> None:
    driver.execute_cdp_cmd(
        'Emulation.setDeviceMetricsOverride',
        {
            'width': width,
            'height': height,
            'deviceScaleFactor': 1,
            'mobile': mobile,
        },
    )


def capture_variant(label: str, url: str, driver: webdriver.Chrome, metrics: dict[str, object]) -> None:
    variant_metrics: dict[str, object] = {}
    for viewport_name, width, height, mobile in VIEWPORTS:
        viewport_dir = OUTPUT_DIR / label / viewport_name
        viewport_dir.mkdir(parents=True, exist_ok=True)
        set_viewport(driver, width, height, mobile)
        view_metrics: dict[str, object] = {}
        for index, (view_name, drag_x, drag_y) in enumerate(VIEWPOINTS, start=1):
            driver.get(url)
            canvas = WebDriverWait(driver, 20, poll_frequency=0.05).until(
                lambda browser: browser.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
            )
            WebDriverWait(driver, 20, poll_frequency=0.05).until(
                lambda browser: browser.execute_script(
                    'return arguments[0].width > 0 && arguments[0].height > 0',
                    canvas,
                )
            )
            if drag_x or drag_y:
                ActionChains(driver).move_to_element(canvas).click_and_hold().move_by_offset(
                    drag_x,
                    drag_y,
                ).pause(0.06).release().perform()
                time.sleep(0.35)
            else:
                time.sleep(0.18)

            screenshot = viewport_dir / f'{index:02d}-{view_name}.png'
            require(canvas.screenshot(str(screenshot)), f'{label}/{viewport_name}/{view_name}: screenshot failed')
            view_metrics[view_name] = image_metrics(screenshot)
        variant_metrics[viewport_name] = view_metrics
    metrics[label] = variant_metrics


def summarize(metrics: dict[str, object]) -> dict[str, object]:
    summary: dict[str, object] = {}
    for viewport_name, *_ in VIEWPORTS:
        viewport_summary: dict[str, object] = {}
        for label in ('pass3', 'pass4', 'current'):
            values = list(metrics[label][viewport_name].values())  # type: ignore[index,union-attr]
            viewport_summary[label] = {
                'mean_luma': round(sum(item['mean_luma'] for item in values) / len(values), 4),
                'near_black_fraction': round(sum(item['near_black_fraction'] for item in values) / len(values), 6),
                'visible_low_mid_fraction': round(sum(item['visible_low_mid_fraction'] for item in values) / len(values), 6),
                'bright_fraction': round(sum(item['bright_fraction'] for item in values) / len(values), 6),
            }
        pass4 = viewport_summary['pass4']
        current = viewport_summary['current']
        viewport_summary['current_vs_pass4'] = {
            'near_black_fraction_delta': round(current['near_black_fraction'] - pass4['near_black_fraction'], 6),
            'visible_low_mid_fraction_delta': round(current['visible_low_mid_fraction'] - pass4['visible_low_mid_fraction'], 6),
            'mean_luma_delta': round(current['mean_luma'] - pass4['mean_luma'], 4),
            'bright_fraction_delta': round(current['bright_fraction'] - pass4['bright_fraction'], 6),
        }
        summary[viewport_name] = viewport_summary
    return summary


def make_contact_sheet(viewport_name: str) -> None:
    thumb_width = 300 if viewport_name == 'desktop' else 190
    margin = 12
    label_height = 24
    source_paths = {
        label: sorted((OUTPUT_DIR / label / viewport_name).glob('*.png'))
        for label in ('pass3', 'pass4', 'current')
    }
    require(all(len(paths) == len(VIEWPOINTS) for paths in source_paths.values()), f'{viewport_name}: incomplete contact sheet sources')
    first = Image.open(source_paths['current'][0]).convert('RGB')
    ratio = thumb_width / first.width
    thumb_height = round(first.height * ratio)
    sheet = Image.new(
        'RGB',
        (
            margin + 3 * (thumb_width + margin),
            margin + label_height + len(VIEWPOINTS) * (thumb_height + label_height + margin),
        ),
        (8, 10, 16),
    )
    draw = ImageDraw.Draw(sheet)
    for column, label in enumerate(('pass3', 'pass4', 'current')):
        x = margin + column * (thumb_width + margin)
        draw.text((x, margin), VARIANT_LABELS[label], fill=(230, 234, 242))
        for row, path in enumerate(source_paths[label]):
            y = margin + label_height + row * (thumb_height + label_height + margin)
            image = Image.open(path).convert('RGB').resize((thumb_width, thumb_height))
            sheet.paste(image, (x, y))
            draw.text((x, y + thumb_height + 3), VIEWPOINTS[row][0], fill=(190, 196, 208))
    sheet.save(OUTPUT_DIR / f'{viewport_name}-comparison.png')


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wait_for_url(CURRENT_URL)
    metrics: dict[str, object] = {}
    driver = make_driver()
    try:
        capture_variant('current', CURRENT_URL, driver, metrics)
        with baseline_preview('pass3', PASS3_REF, 4174) as pass3_url:
            capture_variant('pass3', pass3_url, driver, metrics)
        with baseline_preview('pass4', PASS4_REF, 4175) as pass4_url:
            capture_variant('pass4', pass4_url, driver, metrics)
    finally:
        driver.quit()

    summary = summarize(metrics)
    payload = {
        'refs': {
            'pass3': PASS3_REF,
            'pass4': PASS4_REF,
            'current': os.environ.get('GITHUB_SHA', 'working-tree'),
        },
        'viewpoints': [name for name, *_ in VIEWPOINTS],
        'metrics': metrics,
        'summary': summary,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2, sort_keys=True), encoding='utf-8')
    for viewport_name, *_ in VIEWPORTS:
        make_contact_sheet(viewport_name)

    print('space background A/B capture completed')
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
