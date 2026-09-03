#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import stellarPhotospherePass2VisualRegression as p2


def apply_batch_zoom(
    driver,
    canvas,
    wheel_steps: int,
    delta: float = 100.0,
    settle_frames: int = 45,
) -> None:
    driver.execute_async_script(
        '''
        const element = arguments[0];
        let remaining = Math.abs(arguments[1]);
        const signedDelta = arguments[1] > 0 ? arguments[2] : -arguments[2];
        let settleFrames = arguments[3];
        const done = arguments[arguments.length - 1];
        const rect = element.getBoundingClientRect();
        const clientX = rect.left + rect.width * 0.5;
        const clientY = rect.top + rect.height * 0.5;

        const settle = () => {
          if (settleFrames-- <= 0) { done(); return; }
          requestAnimationFrame(settle);
        };
        const step = () => {
          if (remaining-- <= 0) {
            requestAnimationFrame(settle);
            return;
          }
          element.dispatchEvent(new WheelEvent('wheel', {
            deltaY: signedDelta,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            view: window,
          }));
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        ''',
        canvas,
        wheel_steps,
        delta,
        settle_frames,
    )


def measure_candidate(driver, root_url: str, wheel_steps: int, path: Path) -> float:
    canvas = p2.prepare_focus_scene(driver, root_url, p2.STAR_STAGES['solar'])
    apply_batch_zoom(driver, canvas, wheel_steps, settle_frames=24)
    image = p2.screenshot_canvas(canvas, path)
    return float(p2.locate_photosphere(image)['bright_photosphere_diameter_px'])


def calibrate_zoom_steps(
    driver,
    root_url: str,
    target: tuple[float, float],
) -> tuple[int, float]:
    temp_path = p2.OUTPUT_DIR / 'zoom-calibration.png'
    initial = measure_candidate(driver, root_url, 0, temp_path)
    if target[0] <= initial <= target[1]:
        return 0, initial

    direction = -1 if initial < target[0] else 1
    previous_steps = 0
    previous_diameter = initial
    steps = 0

    while abs(steps) < 72:
        previous_steps = steps
        previous_diameter = measure_candidate(driver, root_url, steps, temp_path)
        steps += direction * 4
        diameter = measure_candidate(driver, root_url, steps, temp_path)
        if target[0] <= diameter <= target[1]:
            return steps, diameter

        crossed = (
            direction < 0 and diameter > target[1]
        ) or (
            direction > 0 and diameter < target[0]
        )
        if not crossed:
            continue

        for offset in range(1, 4):
            candidate = previous_steps + direction * offset
            candidate_diameter = measure_candidate(driver, root_url, candidate, temp_path)
            if target[0] <= candidate_diameter <= target[1]:
                return candidate, candidate_diameter

        raise AssertionError(
            f'zoom calibration crossed {target[0]:.0f}-{target[1]:.0f}px without a valid step: '
            f'{previous_diameter:.1f}px at {previous_steps}, {diameter:.1f}px at {steps}'
        )

    raise AssertionError(
        f'zoom calibration could not reach {target[0]:.0f}-{target[1]:.0f}px within 72 steps'
    )


def capture_state(
    driver,
    root_url: str,
    revision: str,
    star: str,
    level: str,
    wheel_steps: int,
) -> Path:
    canvas = p2.prepare_focus_scene(driver, root_url, p2.STAR_STAGES[star])
    apply_batch_zoom(driver, canvas, wheel_steps, settle_frames=45)
    path = p2.OUTPUT_DIR / f'{revision}-{star}-{level}-mobile.png'
    p2.screenshot_canvas(canvas, path)
    return path


p2.calibrate_zoom_steps = calibrate_zoom_steps
p2.capture_state = capture_state

if __name__ == '__main__':
    p2.main()
