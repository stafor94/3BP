#!/usr/bin/env python3
from __future__ import annotations

from PIL import Image, ImageDraw

import stellarPhotosphereVisualRegression as base


def analyze(path):
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
    high_frequency_sum = 0.0
    high_frequency_count = 0
    lane_pixels = 0
    hue_r = 0.0
    hue_g = 0.0
    hue_b = 0.0
    hue_count = 0

    def luma_at(x: int, y: int) -> float:
        return base.luminance(pixels[x, y])

    for y in range(1, roi_height - 1):
        for x in range(1, roi_width - 1):
            r, g, b = pixels[x, y]
            current_luma = base.luminance((r, g, b))
            if current_luma >= 90:
                bright_pixels += 1
                bright_luma_sum += current_luma
            if current_luma >= 180:
                very_bright_pixels += 1
            if current_luma >= 105:
                channel_sum = max(r + g + b, 1)
                hue_r += r / channel_sum
                hue_g += g / channel_sum
                hue_b += b / channel_sum
                hue_count += 1

            right_luma = luma_at(x + 1, y)
            down_luma = luma_at(x, y + 1)
            if current_luma >= 150 and right_luma >= 150:
                neighbor_delta_sum += abs(current_luma - right_luma)
                neighbor_delta_count += 1
            if current_luma >= 150 and down_luma >= 150:
                neighbor_delta_sum += abs(current_luma - down_luma)
                neighbor_delta_count += 1

            left_luma = luma_at(x - 1, y)
            up_luma = luma_at(x, y - 1)
            neighbors = (left_luma, right_luma, up_luma, down_luma)
            neighbor_mean = sum(neighbors) / 4.0
            if current_luma >= 120 and min(neighbors) >= 105:
                high_frequency_sum += abs(current_luma - neighbor_mean)
                high_frequency_count += 1
                brighter_neighbors = sum(value >= current_luma + 2.0 for value in neighbors)
                if neighbor_mean >= current_luma + 2.5 and brighter_neighbors >= 3:
                    lane_pixels += 1

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
        'high_frequency_energy': high_frequency_sum / max(high_frequency_count, 1),
        'lane_presence': lane_pixels / max(high_frequency_count, 1),
        'hue_r': hue_r / max(hue_count, 1),
        'hue_g': hue_g / max(hue_count, 1),
        'hue_b': hue_b / max(hue_count, 1),
    }


def validate(metrics, delta):
    baseline = metrics['baseline']
    current = metrics['current']

    base.require(
        delta >= 0.08,
        f'cellular photosphere A/B is effectively unchanged: mean absolute delta={delta:.4f}',
    )

    for metric, relative_tolerance, absolute_tolerance in (
        ('bright_fraction', 0.10, 0.002),
        ('very_bright_fraction', 0.12, 0.002),
    ):
        baseline_value = float(baseline[metric])
        current_value = float(current[metric])
        tolerance = max(abs(baseline_value) * relative_tolerance, absolute_tolerance)
        base.require(
            abs(current_value - baseline_value) <= tolerance,
            f'{metric} drifted beyond the photosphere-only budget: '
            f'baseline={baseline_value:.6f} current={current_value:.6f} tolerance={tolerance:.6f}',
        )

    baseline_luma = float(baseline['bright_mean_luma'])
    current_luma = float(current['bright_mean_luma'])
    base.require(
        abs(current_luma - baseline_luma) <= max(abs(baseline_luma) * 0.10, 4.0),
        'photosphere mean brightness changed by more than the Pass 2 budget: '
        f'baseline={baseline_luma:.4f} current={current_luma:.4f}',
    )

    base.require(
        float(current['surface_neighbor_contrast']) >= float(baseline['surface_neighbor_contrast']) * 1.03,
        'cellular photosphere does not gain enough local surface contrast: '
        f"baseline={baseline['surface_neighbor_contrast']:.4f} current={current['surface_neighbor_contrast']:.4f}",
    )
    base.require(
        float(current['high_frequency_energy']) >= float(baseline['high_frequency_energy']) * 1.03,
        'cellular photosphere does not gain enough smaller-scale spatial structure: '
        f"baseline={baseline['high_frequency_energy']:.4f} current={current['high_frequency_energy']:.4f}",
    )
    base.require(
        float(current['lane_presence']) >= float(baseline['lane_presence']) * 1.02,
        'intergranular lane-like local minima are not measurably more present than baseline: '
        f"baseline={baseline['lane_presence']:.6f} current={current['lane_presence']:.6f}",
    )

    hue_delta = sum(
        (float(current[channel]) - float(baseline[channel])) ** 2
        for channel in ('hue_r', 'hue_g', 'hue_b')
    ) ** 0.5
    base.require(
        hue_delta <= 0.025,
        f'stellar temperature-derived hue drifted too far during Pass 2: hue delta={hue_delta:.5f}',
    )


def make_contact_sheet(baseline_path, current_path):
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
    draw.text((left_x, margin), 'Baseline / Pass 1 main', fill=(235, 238, 245))
    draw.text((right_x, margin), 'Current / Pass 2 cellular photosphere', fill=(235, 238, 245))
    sheet.paste(baseline, (left_x, margin + label_height))
    sheet.paste(current, (right_x, margin + label_height))
    sheet.save(base.OUTPUT_DIR / 'mobile-ab-contact-sheet.png')


base.analyze = analyze
base.validate = validate
base.make_contact_sheet = make_contact_sheet
base.main()
