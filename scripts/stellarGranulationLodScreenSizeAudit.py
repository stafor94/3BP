#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image

import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-granulation-lod-artifacts')
CORE_THRESHOLD = 180.0


def luma(rgb: tuple[int, int, int]) -> float:
    return base.luminance(rgb)


def longest_run(values) -> int:
    best = 0
    current = 0
    for value in values:
        if value:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def measure_star_diameter(path: Path) -> float:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    pixels = image.load()
    half_diameters: list[float] = []

    for left, right in ((0, width // 2), (width // 2, width)):
        horizontal = 0
        for y in range(height):
            horizontal = max(
                horizontal,
                longest_run(
                    luma(pixels[x, y]) >= CORE_THRESHOLD
                    for x in range(left, right)
                ),
            )

        vertical = 0
        for x in range(left, right):
            vertical = max(
                vertical,
                longest_run(
                    luma(pixels[x, y]) >= CORE_THRESHOLD
                    for y in range(height)
                ),
            )

        half_diameters.append((horizontal + vertical) * 0.5)

    base.require(
        min(half_diameters) >= 8.0,
        f'{path.name}: could not resolve both stellar photospheres: {half_diameters}',
    )
    return sum(half_diameters) / len(half_diameters)


def validate_three_distances(side: str) -> dict[str, float]:
    diameters = {
        level: measure_star_diameter(OUTPUT_DIR / f'{side}-{level}-mobile.png')
        for level in ('large', 'normal', 'small')
    }

    base.require(
        diameters['large'] >= diameters['normal'] * 1.35,
        f'{side}: large capture is not meaningfully larger than normal: {diameters}',
    )
    base.require(
        diameters['normal'] >= diameters['small'] * 1.20,
        f'{side}: normal capture is not meaningfully larger than small: {diameters}',
    )
    return diameters


def validate_zoom_sweep() -> list[float]:
    diameters = [
        measure_star_diameter(OUTPUT_DIR / f'zoom-sweep-{index:02d}.png')
        for index in range(13)
    ]

    for previous, current in zip(diameters, diameters[1:]):
        base.require(
            current <= previous + 1.0,
            'zoom sweep: apparent stellar diameter grew while zooming out: '
            f'{previous:.2f}px -> {current:.2f}px',
        )
        base.require(
            current >= previous * 0.90,
            'zoom sweep: apparent stellar diameter jumped between adjacent zoom samples: '
            f'{previous:.2f}px -> {current:.2f}px',
        )

    base.require(
        diameters[-1] <= diameters[0] * 0.82,
        'zoom sweep did not cover enough screen-space range to exercise LOD transitions: '
        f'{diameters[0]:.2f}px -> {diameters[-1]:.2f}px',
    )
    return diameters


def main():
    baseline = validate_three_distances('baseline')
    current = validate_three_distances('current')

    for level in ('large', 'normal', 'small'):
        base.require(
            abs(current[level] - baseline[level]) <= 3.0,
            f'{level}: Pass 3 changed the bright photosphere diameter versus Pass 2: '
            f"{baseline[level]:.2f}px -> {current[level]:.2f}px",
        )

    sweep = validate_zoom_sweep()
    print('stellar granulation screen-size audit: ok')
    print(
        '  current diameters: ' +
        ', '.join(f'{level}={current[level]:.1f}px' for level in ('large', 'normal', 'small'))
    )
    print(
        '  zoom sweep diameters: ' +
        ' -> '.join(f'{value:.1f}px' for value in sweep)
    )


if __name__ == '__main__':
    main()
