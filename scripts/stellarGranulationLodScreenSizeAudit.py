#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image

import stellarPhotosphereVisualRegression as base
import stellarGranulationLodVisualRegression as lod

OUTPUT_DIR = Path('stellar-granulation-lod-artifacts')
CORE_THRESHOLD = 180.0
FULL_SWEEP_SAMPLES = 24


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


def measure_surface_noise(path: Path) -> tuple[float, float]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    pixels = image.load()
    high_frequency_sum = 0.0
    sample_count = 0
    lane_count = 0

    for y in range(1, height - 1):
        for x in range(1, width - 1):
            current = luma(pixels[x, y])
            if current < 145.0:
                continue
            neighbors = (
                luma(pixels[x - 1, y]),
                luma(pixels[x + 1, y]),
                luma(pixels[x, y - 1]),
                luma(pixels[x, y + 1]),
            )
            if min(neighbors) < 125.0:
                continue
            neighbor_mean = sum(neighbors) / 4.0
            high_frequency_sum += abs(current - neighbor_mean)
            sample_count += 1
            brighter_neighbors = sum(value >= current + 2.0 for value in neighbors)
            if neighbor_mean >= current + 2.5 and brighter_neighbors >= 3:
                lane_count += 1

    base.require(sample_count > 100, f'{path.name}: insufficient resolved photosphere samples')
    return high_frequency_sum / sample_count, lane_count / sample_count


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


def capture_full_zoom_sweep() -> list[dict[str, float]]:
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    samples: list[dict[str, float]] = []
    try:
        canvas = lod.prepare_scene(driver, base.CURRENT_URL)
        lod.apply_zoom(driver, canvas, -8, settle_frames=30)
        for index in range(FULL_SWEEP_SAMPLES):
            path = OUTPUT_DIR / f'zoom-full-{index:02d}.png'
            base.require(bool(canvas.screenshot(str(path))) and path.exists(), 'full zoom sweep capture failed')
            diameter = measure_star_diameter(path)
            high_frequency, lane_presence = measure_surface_noise(path)
            samples.append({
                'diameter': diameter,
                'high_frequency': high_frequency,
                'lane_presence': lane_presence,
            })
            if index < FULL_SWEEP_SAMPLES - 1:
                lod.apply_zoom(driver, canvas, 1, delta=100.0, settle_frames=5)
    finally:
        driver.quit()
    return samples


def validate_full_zoom_sweep(samples: list[dict[str, float]]):
    for previous, current in zip(samples, samples[1:]):
        previous_diameter = previous['diameter']
        current_diameter = current['diameter']
        base.require(
            current_diameter <= previous_diameter + 1.0,
            'full zoom sweep: apparent stellar diameter grew while zooming out: '
            f'{previous_diameter:.2f}px -> {current_diameter:.2f}px',
        )
        base.require(
            current_diameter >= previous_diameter * 0.82,
            'full zoom sweep: apparent stellar diameter jumped between adjacent samples: '
            f'{previous_diameter:.2f}px -> {current_diameter:.2f}px',
        )

        previous_hf = previous['high_frequency']
        current_hf = current['high_frequency']
        base.require(
            current_hf <= previous_hf * 1.35 + 0.40,
            'full zoom sweep: high-frequency surface energy spiked during zoom-out: '
            f'{previous_hf:.3f} -> {current_hf:.3f}',
        )
        base.require(
            abs(current['lane_presence'] - previous['lane_presence']) <= 0.065,
            'full zoom sweep: intergranular lane visibility popped between adjacent samples: '
            f"{previous['lane_presence']:.5f} -> {current['lane_presence']:.5f}",
        )

    start = samples[0]
    end = samples[-1]
    peak_lane = max(sample['lane_presence'] for sample in samples)
    peak_high_frequency = max(sample['high_frequency'] for sample in samples)
    base.require(
        end['diameter'] <= start['diameter'] * 0.45,
        'full zoom sweep did not cross enough screen-space scale for the LOD transition: '
        f"{start['diameter']:.1f}px -> {end['diameter']:.1f}px",
    )
    base.require(
        end['lane_presence'] <= max(peak_lane * 0.85, 0.01),
        'full zoom sweep did not retire thin intergranular lanes after their mid-scale visibility peak: '
        f"peak={peak_lane:.5f} end={end['lane_presence']:.5f}",
    )
    base.require(
        end['high_frequency'] <= peak_high_frequency * 0.95 + 0.05,
        'full zoom sweep did not reduce high-frequency surface energy after its mid-scale peak: '
        f"peak={peak_high_frequency:.3f} end={end['high_frequency']:.3f}",
    )


def main():
    baseline = validate_three_distances('baseline')
    current = validate_three_distances('current')

    for level in ('large', 'normal', 'small'):
        base.require(
            abs(current[level] - baseline[level]) <= 3.0,
            f'{level}: Pass 3 changed the bright photosphere diameter versus Pass 2: '
            f"{baseline[level]:.2f}px -> {current[level]:.2f}px",
        )

    full_sweep = capture_full_zoom_sweep()
    validate_full_zoom_sweep(full_sweep)

    print('stellar granulation screen-size audit: ok')
    print(
        '  current diameters: ' +
        ', '.join(f'{level}={current[level]:.1f}px' for level in ('large', 'normal', 'small'))
    )
    print(
        '  full zoom diameters: ' +
        ' -> '.join(f"{sample['diameter']:.1f}px" for sample in full_sweep)
    )
    print(
        '  full zoom lane presence: ' +
        ' -> '.join(f"{sample['lane_presence']:.4f}" for sample in full_sweep)
    )


if __name__ == '__main__':
    main()
