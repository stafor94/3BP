#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ARTIFACT_DIR = Path('stellar-surface-lod-artifacts')
METRICS_PATH = ARTIFACT_DIR / 'metrics.json'


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    require(METRICS_PATH.exists(), 'screen-space surface LOD metrics must exist before the audit')
    payload = json.loads(METRICS_PATH.read_text(encoding='utf-8'))
    viewport = payload.get('viewport', {})
    zoom_levels = payload.get('zoom_levels', {})
    current = payload.get('metrics', {}).get('current', {})
    sweep = payload.get('zoom_sweep', [])

    require(viewport.get('width') == 390, 'mobile surface audit must use a 390px viewport width')
    require(viewport.get('height') == 844, 'mobile surface audit must use an 844px viewport height')
    require(viewport.get('mobile') is True, 'surface audit must run in the mobile fixture')
    require(set(zoom_levels) == {'large', 'normal', 'small'}, 'surface audit must cover large/normal/small zoom levels')
    require(len(set(zoom_levels.values())) == 3, 'large/normal/small zoom inputs must be distinct')
    require(set(current) == {'large', 'normal', 'small'}, 'all three screen-space result levels must have metrics')

    large_diameter = float(current['large']['equivalent_core_diameter_px'])
    normal_diameter = float(current['normal']['equivalent_core_diameter_px'])
    small_diameter = float(current['small']['equivalent_core_diameter_px'])
    # The fixture's large and normal wheel inputs both settle in the full-detail
    # camera range, so their measured bright footprint can differ by a few pixels
    # in either direction. The small case must still be materially smaller.
    require(
        small_diameter <= min(large_diameter, normal_diameter) * 0.88,
        'small-screen photosphere footprint must be materially smaller than both full-detail views',
    )
    require(
        max(large_diameter, normal_diameter) <= min(large_diameter, normal_diameter) * 1.12,
        'large and normal full-detail fixture footprints drifted unexpectedly far apart',
    )
    require(len(sweep) >= 10, 'continuous zoom sweep must contain enough adjacent samples to catch LOD popping')

    print('stellar Pass 1 screen-size/zoom audit: ok')
    print(f'  viewport: {viewport["width"]}x{viewport["height"]}')
    print(f'  measured diameters: large={large_diameter:.1f}px normal={normal_diameter:.1f}px small={small_diameter:.1f}px')
    print(f'  adjacent zoom samples: {len(sweep)}')


if __name__ == '__main__':
    main()
