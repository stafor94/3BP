#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

from PIL import Image
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

import actualDisruptionVisualRegression as regression

OUTPUT_DIR = Path('actual-disruption-mobile-visual-artifacts')
VIEWPORT_WIDTH = int(os.environ.get('MOBILE_DISRUPTION_VIEWPORT_WIDTH', '412'))
VIEWPORT_HEIGHT = int(os.environ.get('MOBILE_DISRUPTION_VIEWPORT_HEIGHT', '860'))
URL = os.environ.get(
    'MOBILE_DISRUPTION_VISUAL_TEST_URL',
    'http://127.0.0.1:4173/3BP/?visual-regression=actual-disruption&camera-framing=collision',
)
LATE_FRAMES = ('05-1050ms', '06-1500ms', '07-1880ms', '08-2200ms', '09-2600ms')


def make_mobile_driver():
    driver = regression.make_driver()
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


def warm_edge_fraction(path: Path, margin_fraction: float = 0.03) -> float:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    margin_x = max(1, int(width * margin_fraction))
    margin_y = max(1, int(height * margin_fraction))
    warm = 0
    edge_warm = 0
    for y in range(height):
        for x in range(width):
            if not regression.is_warm(image.getpixel((x, y)), 24):
                continue
            warm += 1
            if x < margin_x or x >= width - margin_x or y < margin_y or y >= height - margin_y:
                edge_warm += 1
    return edge_warm / max(1, warm)


def bright_impact_pixel_count(path: Path) -> int:
    """Count only bright impact-VFX-like pixels, not the warm solid-body surface."""
    image = Image.open(path).convert('RGB')
    width, height = image.size
    x0, x1 = int(width * 0.08), int(width * 0.94)
    y0, y1 = int(height * 0.12), int(height * 0.88)
    return sum(
        1
        for y in range(y0, y1)
        for x in range(x0, x1)
        if (
            (pixel := image.getpixel((x, y)))[0] >= 160
            and pixel[1] >= 100
            and pixel[2] >= 70
        )
    )


def bright_local_components(
    path: Path,
    anchor_component: list[tuple[int, int]],
    padding: int = 10,
) -> list[list[tuple[int, int]]]:
    """Find bright chunk highlights near the remnant even when they touch its warm surface."""
    image = Image.open(path).convert('RGB')
    width, height = image.size
    xs = [x for x, _ in anchor_component]
    ys = [y for _, y in anchor_component]
    x0 = max(0, min(xs) - padding)
    x1 = min(width - 1, max(xs) + padding)
    y0 = max(0, min(ys) - padding)
    y1 = min(height - 1, max(ys) + padding)
    candidates = {
        (x, y)
        for y in range(y0, y1 + 1)
        for x in range(x0, x1 + 1)
        if (
            (pixel := image.getpixel((x, y)))[0] >= 120
            and pixel[1] >= 70
            and pixel[2] >= 35
        )
    }
    components: list[list[tuple[int, int]]] = []
    remaining = set(candidates)
    while remaining:
        seed = remaining.pop()
        stack = [seed]
        component = [seed]
        while stack:
            x, y = stack.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor not in remaining:
                    continue
                remaining.remove(neighbor)
                stack.append(neighbor)
                component.append(neighbor)
        components.append(component)
    return sorted(components, key=len, reverse=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    regression.OUTPUT_DIR = OUTPUT_DIR
    driver = make_mobile_driver()
    try:
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.get(URL)
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: browser.execute_script(
                'return typeof window.__startMovingDisruptionVisual === "function"'
            )
        )
        WebDriverWait(driver, 15, poll_frequency=0.05).until(
            lambda browser: len(browser.find_elements(By.CSS_SELECTOR, '.simulation-view canvas')) == 1
        )
        time.sleep(0.7)

        impact = regression.capture_canvas(driver, '01-impact')
        impact_components = regression.warm_components(impact, 24)
        regression.require(bool(impact_components), 'mobile impact capture has no collision body component')

        regression.trigger(driver)
        started_at = time.monotonic()
        captures: dict[str, Path] = {'impact': impact}
        for name, target in regression.CAPTURES:
            regression.wait_until(started_at, target)
            captures[name] = regression.capture_canvas(driver, name)

        width, height = Image.open(impact).size
        regression.require(
            390 <= width <= 430 and 800 <= height <= 900,
            f'mobile disruption canvas must stay near the requested phone viewport, got {width}x{height}',
        )

        tracking_components = {
            name: regression.warm_components(
                path,
                24,
                12 if name in regression.EARLY_PARTICLE_HANDOFF_FRAMES else 24,
            )
            for name, path in captures.items()
        }
        warm_pixels = {
            name: regression.warm_pixel_count(path, 24)
            for name, path in captures.items()
        }
        full_brightness_components = {
            name: regression.warm_components(path, 38)
            for name, path in captures.items()
        }
        for name, components in tracking_components.items():
            regression.require(bool(components), f'{name}: mobile collision system disappeared')
        for name in regression.EARLY_PARTICLE_HANDOFF_FRAMES:
            regression.require(
                warm_pixels[name] >= 28,
                f'{name}: mobile early disruption handoff lost too much visible material',
            )

        final_full_area = max(1, len(full_brightness_components['09-2600ms'][0]))
        full_disc_ratio: dict[str, float] = {}
        full_disc_counts: dict[str, int] = {}
        for name in ('06-1500ms', '07-1880ms', '08-2200ms', '09-2600ms'):
            components = full_brightness_components[name]
            primary_area = len(components[0]) if components else 0
            full_disc_ratio[name] = primary_area / final_full_area
            full_disc_counts[name] = sum(
                1 for component in components if len(component) >= final_full_area * 0.65
            )

        regression.require(
            full_disc_ratio['06-1500ms'] <= 1.45,
            'mobile 1500ms frame contains excessive source/result full-disc area',
        )
        regression.require(
            full_disc_ratio['07-1880ms'] <= 1.18,
            'mobile 1880ms frame still reads as multiple full bodies',
        )
        regression.require(
            full_disc_ratio['08-2200ms'] <= 1.10,
            'mobile 2200ms late handoff still contains duplicate source-sized area',
        )
        regression.require(
            full_disc_counts['07-1880ms'] <= 1 and full_disc_counts['08-2200ms'] <= 1,
            'mobile disruption contains multiple source-sized full-brightness components',
        )

        # The continuity fix intentionally keeps a source-sized result body visible
        # at 260ms. Warm-pixel area therefore cannot be used as a proxy for flash
        # coverage because it counts that preserved body as "flash". Measure only
        # high-intensity impact-like pixels and keep the allowance relative to the
        # visible solid-body area instead.
        bright_pixels = {
            name: bright_impact_pixel_count(captures[name])
            for name in ('impact', '02-260ms')
        }
        bright_excess = max(0, bright_pixels['02-260ms'] - bright_pixels['impact'])
        flash_bright_excess_ratio = bright_excess / max(1, warm_pixels['impact'])
        flash_bright_fraction_of_260ms = bright_pixels['02-260ms'] / max(1, warm_pixels['02-260ms'])
        regression.require(
            flash_bright_excess_ratio <= 0.06,
            'mobile contact flash adds too much bright area over the colliding-body baseline',
        )
        regression.require(
            flash_bright_fraction_of_260ms <= 0.08,
            'mobile contact flash obscures too much of the visible 260ms collision mass',
        )

        # Source-side chunks intentionally overlap the real remnant during handoff.
        # A warm connected-component test would merge those chunks into the body and
        # incorrectly report that they disappeared. Check the separate bright chunk
        # highlights inside the local remnant region instead.
        fracture_highlights = bright_local_components(
            captures['04-700ms'],
            tracking_components['04-700ms'][0],
        )
        identifiable_chunks = [
            component
            for component in fracture_highlights
            if 4 <= len(component) <= 100
        ]
        regression.require(
            len(identifiable_chunks) >= 3,
            'mobile FRACTURE no longer exposes multiple identifiable local chunk highlights',
        )

        energies = {name: regression.image_energy(path) for name, path in captures.items()}
        fracture_energy_fraction = energies['04-700ms'] / max(1, width * height)
        regression.require(
            fracture_energy_fraction <= 0.03,
            'mobile fine debris expands across too much of the viewport',
        )
        for name, energy in energies.items():
            regression.require(energy >= 400, f'{name}: mobile capture is unexpectedly empty')

        final_warm = max(1, warm_pixels['09-2600ms'])
        remnant_core_ratio = warm_pixels['05-1050ms'] / final_warm
        remnant_forming_ratio = warm_pixels['06-1500ms'] / final_warm
        regression.require(
            remnant_core_ratio >= 0.20,
            'mobile remnant core becomes too small to remain readable',
        )
        regression.require(
            remnant_forming_ratio >= 0.45,
            'mobile forming remnant loses too much visible structure',
        )

        edge_fractions = {
            name: warm_edge_fraction(captures[name])
            for name in LATE_FRAMES
        }
        regression.require(
            max(edge_fractions.values()) <= 0.01,
            'mobile moving disruption is visibly clipped at the viewport edge',
        )

        late_center_errors: dict[str, float] = {}
        for name in LATE_FRAMES:
            component = tracking_components[name][0]
            center_x, center_y = regression.centroid(component)
            late_center_errors[name] = math.hypot(
                (center_x - width * 0.5) / width,
                (center_y - height * 0.5) / height,
            )
        regression.require(
            max(late_center_errors.values()) <= 0.18,
            'mobile collision-camera framing does not keep the moving remnant readable',
        )

        differences = {
            name: regression.frame_difference(impact, path)
            for name, path in captures.items()
            if name != 'impact'
        }
        regression.require(differences['03-520ms'] >= 0.10, 'mobile 520ms fracture is not visibly distinct')
        regression.require(differences['04-700ms'] >= 0.12, 'mobile 700ms breakup is not visibly distinct')
        regression.require(differences['05-1050ms'] >= 0.12, 'mobile 1050ms remnant handoff is not visible')
        regression.require(differences['06-1500ms'] >= 0.10, 'mobile 1500ms remnant formation is not visible')

        payload = {
            'viewport': {'width': width, 'height': height},
            'camera_framing': 'collision-camera',
            'contact_flash_bright_pixels': bright_pixels,
            'contact_flash_bright_excess_ratio_to_impact_warm': flash_bright_excess_ratio,
            'contact_flash_bright_fraction_of_260ms_warm': flash_bright_fraction_of_260ms,
            'identifiable_fracture_chunk_highlights': len(identifiable_chunks),
            'fracture_non_dark_viewport_fraction': fracture_energy_fraction,
            'remnant_core_warm_ratio_to_final': remnant_core_ratio,
            'remnant_forming_warm_ratio_to_final': remnant_forming_ratio,
            'full_brightness_disc_equivalent_ratio_to_final': full_disc_ratio,
            'full_brightness_source_sized_component_count': full_disc_counts,
            'late_center_error_fraction': late_center_errors,
            'warm_edge_fraction': edge_fractions,
            'tracking_warm_pixels': warm_pixels,
            'non_dark_pixels': energies,
        }
        (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(json.dumps(payload, indent=2))
        print('mobile actual disruption visual regression: ok')
    except Exception:
        try:
            driver.save_screenshot(str(OUTPUT_DIR / 'failure-page.png'))
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == '__main__':
    main()
