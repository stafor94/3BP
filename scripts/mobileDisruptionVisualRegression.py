#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image

import actualDisruptionVisualRegression as regression

OUTPUT_DIR = Path('actual-disruption-mobile-visual-artifacts')
VIEWPORT_WIDTH = int(os.environ.get('MOBILE_DISRUPTION_VIEWPORT_WIDTH', '412'))
VIEWPORT_HEIGHT = int(os.environ.get('MOBILE_DISRUPTION_VIEWPORT_HEIGHT', '860'))


def make_mobile_driver():
    driver = original_make_driver()
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


def main() -> None:
    regression.OUTPUT_DIR = OUTPUT_DIR
    regression.URL = f'{regression.URL}&camera-framing=tracked'
    regression.make_driver = make_mobile_driver
    regression.main()

    metrics = json.loads((OUTPUT_DIR / 'metrics.json').read_text(encoding='utf-8'))
    impact_path = OUTPUT_DIR / '01-impact.png'
    width, height = Image.open(impact_path).size
    regression.require(
        390 <= width <= 430 and 800 <= height <= 900,
        f'mobile disruption canvas must stay near the requested phone viewport, got {width}x{height}',
    )

    warm_pixels = metrics['tracking_warm_pixels']
    final_warm = max(1, int(warm_pixels['09-2600ms']))
    flash_ratio = int(warm_pixels['02-260ms']) / max(1, int(warm_pixels['impact']))
    regression.require(
        flash_ratio <= 0.35,
        'mobile contact flash obscures too much of the colliding bodies',
    )

    fracture_components = regression.warm_components(
        OUTPUT_DIR / '04-700ms.png',
        24,
        minimum_area=4,
    )
    final_components = regression.warm_components(
        OUTPUT_DIR / '09-2600ms.png',
        24,
        minimum_area=12,
    )
    final_area = max(1, len(final_components[0]) if final_components else final_warm)
    identifiable_chunks = [
        component
        for component in fracture_components
        if 4 <= len(component) <= final_area * 0.20
    ]
    regression.require(
        len(identifiable_chunks) >= 3,
        'mobile FRACTURE no longer exposes multiple identifiable solid chunk components',
    )

    fracture_energy_fraction = (
        int(metrics['non_dark_pixels']['04-700ms']) / max(1, width * height)
    )
    regression.require(
        fracture_energy_fraction <= 0.03,
        'mobile fine debris expands across too much of the viewport',
    )

    remnant_core_ratio = int(warm_pixels['05-1050ms']) / final_warm
    remnant_forming_ratio = int(warm_pixels['06-1500ms']) / final_warm
    regression.require(
        remnant_core_ratio >= 0.20,
        'mobile remnant core becomes too small to remain readable',
    )
    regression.require(
        remnant_forming_ratio >= 0.45,
        'mobile forming remnant loses too much visible structure',
    )

    edge_fractions = {
        name: warm_edge_fraction(OUTPUT_DIR / f'{name}.png')
        for name in ('05-1050ms', '06-1500ms', '07-1880ms', '08-2200ms', '09-2600ms')
    }
    regression.require(
        max(edge_fractions.values()) <= 0.01,
        'mobile moving disruption is visibly clipped at the viewport edge',
    )

    payload = {
        'viewport': {'width': width, 'height': height},
        'camera_framing': 'tracked-result',
        'contact_flash_warm_ratio_to_impact': flash_ratio,
        'identifiable_fracture_chunk_components': len(identifiable_chunks),
        'fracture_non_dark_viewport_fraction': fracture_energy_fraction,
        'remnant_core_warm_ratio_to_final': remnant_core_ratio,
        'remnant_forming_warm_ratio_to_final': remnant_forming_ratio,
        'warm_edge_fraction': edge_fractions,
    }
    (OUTPUT_DIR / 'mobile-metrics.json').write_text(
        json.dumps(payload, indent=2),
        encoding='utf-8',
    )
    print(json.dumps(payload, indent=2))
    print('mobile actual disruption visual regression: ok')


original_make_driver = regression.make_driver


if __name__ == '__main__':
    main()
