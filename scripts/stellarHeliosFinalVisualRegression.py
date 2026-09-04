#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

import stellarProductionIntegrationVisualRegressionRunner as pass5runner

pass5 = pass5runner.pass5

OUTPUT_DIR = Path('stellar-pass6-helios-artifacts')
FIXTURE_VOLUME = 0.017264
FIXTURE_RADIUS = FIXTURE_VOLUME ** (1.0 / 3.0)
EXPECTED_HELIOS_ID = 'pass6-helios'
EXPECTED_MASS = 8.0
LEVELS = ('normal', 'enlarged', 'extreme')
FINAL_BASELINE_REF = '5fb23b52690703c17a8b8da500ff1eb9aa8a4c6d'


def require(condition: bool, message: str) -> None:
    pass5.require(condition, message)


def helios_url(root_url: str) -> str:
    return (
        f'{root_url}?visual-regression=production-camera-handoff'
        '&production-stellar-fixture=helios-final'
    )


def configure_storage(driver, root_url: str) -> None:
    driver.get(root_url)
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script('return document.readyState === "complete"')
    )
    driver.execute_script(
        '''
        localStorage.setItem('3bp-space-mode', '3d');
        localStorage.setItem('3bp-body-count', '4');
        localStorage.setItem('3bp-preset', 'quadNested');
        localStorage.setItem('3bp-trail-enabled', 'true');
        localStorage.setItem('3bp-trail-duration', '10');
        localStorage.setItem('3bp-language', 'en');
        localStorage.setItem('3bp-collision-watch-enabled', 'false');
        '''
    )


def current_telemetry(driver) -> dict[str, object]:
    return pass5.current_telemetry(driver)


def prepare_helios_scene(driver, root_url: str):
    driver.get(helios_url(root_url))
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.find_elements(By.CSS_SELECTOR, '.app-shell')
        and browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')
        and len(browser.find_elements(By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button')) >= 4
        and len(browser.find_elements(By.CSS_SELECTOR, '.control-panel .body-card')) >= 4
        and browser.find_elements(By.CSS_SELECTOR, '.control-panel .panel-toggle')
    )

    canvas = driver.find_element(By.CSS_SELECTOR, '.simulation-view canvas')
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: browser.execute_script(
            'return arguments[0].width > 0 && arguments[0].height > 0',
            canvas,
        )
    )

    tracking_buttons = driver.find_elements(By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button')
    require(len(tracking_buttons) >= 4, 'Helios fixture must expose Helios plus at least three companion bodies')
    tracking_button = tracking_buttons[0]
    if tracking_button.get_attribute('aria-pressed') != 'true':
        tracking_button.click()

    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: current_telemetry(browser).get('mode') == 'tracking'
        and current_telemetry(browser).get('resolvedTrackedBodyId') == EXPECTED_HELIOS_ID
    )

    trail_toggle = driver.find_element(By.CSS_SELECTOR, '.trail-section .trail-toggle input[type="checkbox"]')
    require(trail_toggle.is_selected(), 'Helios reproduction must use the real production trail/orbit-line renderer')

    # Let the actual physics loop advance the production quadNested orbital scene
    # long enough to retain visible trajectory arcs, then pause before capturing.
    start_button = driver.find_element(By.CSS_SELECTOR, '.control-panel .panel-content .start-button')
    start_button.click()
    WebDriverWait(driver, 20, poll_frequency=0.05).until(
        lambda browser: float(current_telemetry(browser).get('simulationTime') or 0.0) >= 0.85
    )
    start_button.click()
    pass5.wait_frames(driver, 18)

    telemetry = current_telemetry(driver)
    require(float(telemetry.get('simulationTime') or 0.0) >= 0.85, 'production orbital scene did not advance')
    require(abs(float(telemetry.get('trackedBodyMass') or 0.0) - EXPECTED_MASS) <= 1e-9, 'tracked Helios mass is not 8 M_sun')
    require(
        abs(float(telemetry.get('trackedBodyRadius') or 0.0) - FIXTURE_RADIUS) <= 1e-9,
        f'tracked Helios radius is not cbrt({FIXTURE_VOLUME})={FIXTURE_RADIUS:.10f}',
    )

    toggle = driver.find_element(By.CSS_SELECTOR, '.control-panel .panel-toggle')
    if toggle.get_attribute('aria-expanded') == 'true':
        toggle.click()
    WebDriverWait(driver, 10, poll_frequency=0.05).until(
        lambda browser: 'collapsed' in browser.find_element(
            By.CSS_SELECTOR, '.control-panel'
        ).get_attribute('class').split()
    )
    pass5.wait_frames(driver, 54)

    context = {
        'body_tracking_buttons': len(driver.find_elements(By.CSS_SELECTOR, '.body-tracking-rail .body-tracking-button')),
        'body_cards': len(driver.find_elements(By.CSS_SELECTOR, '.control-panel .body-card')),
        'trail_enabled': trail_toggle.is_selected(),
        'simulation_time': float(telemetry.get('simulationTime') or 0.0),
    }
    return canvas, context


def calibrate_zoom_steps(driver, root_url: str) -> dict[str, int]:
    canvas, _ = prepare_helios_scene(driver, root_url)
    temp = OUTPUT_DIR / 'helios-zoom-calibration.png'
    image = pass5.capture_canvas(driver, canvas, temp)
    diameter = float(pass5.p2.locate_photosphere(image)['bright_photosphere_diameter_px'])
    low, high = pass5.LEVEL_TARGETS['normal']
    require(low <= diameter <= high, f'Helios normal size {diameter:.1f}px misses {low:.0f}-{high:.0f}px')

    steps = {'normal': 0}
    step_count = 0
    while ('enlarged' not in steps or 'extreme' not in steps) and step_count < 72:
        pass5.apply_single_zoom(driver, canvas, settle_frames=8)
        step_count += 1
        diameter = float(
            pass5.p2.locate_photosphere(pass5.capture_canvas(driver, canvas, temp))[
                'bright_photosphere_diameter_px'
            ]
        )
        for level in ('enlarged', 'extreme'):
            target_low, target_high = pass5.LEVEL_TARGETS[level]
            if level not in steps and target_low <= diameter <= target_high:
                steps[level] = step_count
                print(f'Final Helios zoom calibration {level}: {step_count} -> {diameter:.1f}px')
    require('enlarged' in steps and 'extreme' in steps, 'Helios zoom calibration did not cover all levels')
    return steps


def capture_state(driver, root_url: str, level: str, wheel_steps: int):
    canvas, context = prepare_helios_scene(driver, root_url)
    pass5.validate_production_ui(driver)
    if wheel_steps:
        pass5.p2runner.apply_batch_zoom(driver, canvas, -wheel_steps, delta=100.0, settle_frames=36)

    metric_path = OUTPUT_DIR / f'helios-{level}-metric.png'
    scene_path = OUTPUT_DIR / f'helios-{level}-scene.png'
    ui_path = OUTPUT_DIR / f'helios-{level}-ui.png'

    # Keep a raw production-canvas PNG for direct visual inspection, then use the
    # established Pass 5 metric capture path (which only masks overlapping DOM
    # chrome when Selenium cannot read the WebGL buffer directly).
    pass5runner._original_capture_canvas(driver, canvas, scene_path)
    pass5.capture_canvas(driver, canvas, metric_path)
    pass5.capture_full_ui(driver, ui_path)

    telemetry = current_telemetry(driver)
    require(telemetry.get('mode') == 'tracking', f'Helios/{level}: production tracking camera was lost')
    require(telemetry.get('resolvedTrackedBodyId') == EXPECTED_HELIOS_ID, f'Helios/{level}: tracked body changed')
    require(abs(float(telemetry.get('trackedBodyRadius') or 0.0) - FIXTURE_RADIUS) <= 1e-9, f'Helios/{level}: fixture radius drifted')
    return metric_path, scene_path, ui_path, telemetry, context


def make_contact_sheet(paths: dict[str, Path], output: Path) -> None:
    images = [Image.open(paths[level]).convert('RGB') for level in LEVELS]
    label_height = 30
    margin = 8
    width = sum(image.width for image in images) + margin * (len(images) + 1)
    height = max(image.height for image in images) + label_height + margin * 2
    sheet = Image.new('RGB', (width, height), (8, 10, 16))
    draw = ImageDraw.Draw(sheet)
    x = margin
    for level, image in zip(LEVELS, images):
        draw.text((x + 4, margin + 7), f'Helios 8 M_sun / {level} / production UI', fill=(238, 241, 248))
        sheet.paste(image, (x, margin + label_height))
        x += image.width + margin
    sheet.save(output)


def validate_hot_hue(level: str, surface: dict[str, float | int]) -> None:
    red = float(surface['hue_r'])
    blue = float(surface['hue_b'])
    require(blue >= red - 0.010, f'Helios/{level}: 8 M_sun star lost blue-white temperature identity')


def validate_fixture_context(level: str, context: dict[str, object]) -> None:
    require(int(context['body_tracking_buttons']) >= 4, f'Helios/{level}: surrounding bodies disappeared from tracking UI')
    require(int(context['body_cards']) >= 4, f'Helios/{level}: surrounding bodies disappeared from production UI')
    require(bool(context['trail_enabled']), f'Helios/{level}: production orbit/trail rendering is disabled')
    require(float(context['simulation_time']) >= 0.85, f'Helios/{level}: production orbital scene did not advance')


def main() -> None:
    require(abs(FIXTURE_RADIUS ** 3 - FIXTURE_VOLUME) <= 1e-12, 'Helios fixture radius no longer represents volume 0.017264')
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pass5.p2.base.wait_for_url(pass5.p2.base.CURRENT_URL)
    driver = pass5.p2.base.make_driver()
    metric_paths: dict[str, Path] = {}
    scene_paths: dict[str, Path] = {}
    ui_paths: dict[str, Path] = {}
    telemetry: dict[str, dict[str, object]] = {}
    contexts: dict[str, dict[str, object]] = {}
    try:
        configure_storage(driver, pass5.p2.base.CURRENT_URL)
        zoom_steps = calibrate_zoom_steps(driver, pass5.p2.base.CURRENT_URL)
        print(f'Final Helios production zoom steps: {zoom_steps}')
        for level in LEVELS:
            metric_path, scene_path, ui_path, state, context = capture_state(
                driver,
                pass5.p2.base.CURRENT_URL,
                level,
                zoom_steps[level],
            )
            metric_paths[level] = metric_path
            scene_paths[level] = scene_path
            ui_paths[level] = ui_path
            telemetry[level] = state
            contexts[level] = context
    finally:
        driver.quit()

    surface = {level: pass5.p2.analyze(path) for level, path in metric_paths.items()}
    radial = {level: pass5.p3.analyze_radial(path) for level, path in metric_paths.items()}
    corona = {level: pass5.corona.analyze_corona(path) for level, path in metric_paths.items()}

    make_contact_sheet(ui_paths, OUTPUT_DIR / 'helios-production-mobile-1x3.png')
    payload = {
        'baseline_ref': FINAL_BASELINE_REF,
        'viewport': {
            'width': pass5.p2.base.VIEWPORT_WIDTH,
            'height': pass5.p2.base.VIEWPORT_HEIGHT,
            'mobile': True,
        },
        'scene': 'real App + SimulationView + production renderer + tracking + quadNested companions + production trails',
        'helios': {
            'mass_msun': EXPECTED_MASS,
            'volume_radius_cubed': FIXTURE_VOLUME,
            'radius': FIXTURE_RADIUS,
        },
        'zoom_steps': zoom_steps,
        'surface': surface,
        'radial': radial,
        'corona': corona,
        'camera_telemetry': telemetry,
        'production_context': contexts,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    for level in LEVELS:
        pass5.validate_surface('hot', level, surface[level])
        pass5.p3.validate_radial('hot', level, radial[level])
        pass5.validate_corona('hot', level, corona[level])
        validate_hot_hue(level, surface[level])
        validate_fixture_context(level, contexts[level])

    enlarged_surface = surface['enlarged']
    enlarged_radial = radial['enlarged']
    enlarged_corona = corona['enlarged']
    print('Final Helios 8 M_sun reproduction acceptance: ok')
    print(f'  volume={FIXTURE_VOLUME:.6f}, radius={FIXTURE_RADIUS:.10f}')
    print(
        '  enlarged topology/span={:.3f}, gran={:.3f}, center/limb={:.3f}, corona extent={:.3f}, edge/shoulder={:.3f}, hue B-R={:.4f}'.format(
            float(enlarged_surface['largest_dark_component_span_fraction']),
            float(enlarged_surface['granulation_contrast']),
            float(enlarged_radial['center_to_inner_limb_ratio']),
            enlarged_corona['extent_fraction'],
            enlarged_corona['edge_to_shoulder_p90'],
            float(enlarged_surface['hue_b']) - float(enlarged_surface['hue_r']),
        )
    )
    print(f'  direct scene PNGs: {[str(scene_paths[level]) for level in LEVELS]}')
    print(f'  production UI sheet: {OUTPUT_DIR / "helios-production-mobile-1x3.png"}')
    print('stellar final Helios production regression: ok')


if __name__ == '__main__':
    main()
