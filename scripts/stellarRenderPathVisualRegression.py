#!/usr/bin/env python3
from __future__ import annotations

from PIL import Image, ImageDraw

import stellarPhotosphereVisualRegression as base


def validate(metrics: dict[str, dict[str, float | int]], delta: float) -> None:
    baseline = metrics['baseline']
    current = metrics['current']

    base.require(
        delta <= 4.0,
        f'stellar render-path refactor changed the mobile image too much: mean absolute delta={delta:.4f}',
    )

    for metric, relative_tolerance, absolute_tolerance in (
        ('bright_fraction', 0.12, 0.002),
        ('very_bright_fraction', 0.12, 0.002),
    ):
        baseline_value = float(baseline[metric])
        current_value = float(current[metric])
        tolerance = max(abs(baseline_value) * relative_tolerance, absolute_tolerance)
        base.require(
            abs(current_value - baseline_value) <= tolerance,
            f'{metric} drifted beyond the visual-preservation budget: '
            f'baseline={baseline_value:.6f} current={current_value:.6f} tolerance={tolerance:.6f}',
        )

    baseline_luma = float(baseline['bright_mean_luma'])
    current_luma = float(current['bright_mean_luma'])
    base.require(
        abs(current_luma - baseline_luma) <= 6.0,
        'photosphere bright-region luminance changed too much during the render-path refactor: '
        f'baseline={baseline_luma:.4f} current={current_luma:.4f}',
    )

    baseline_contrast = float(baseline['surface_neighbor_contrast'])
    current_contrast = float(current['surface_neighbor_contrast'])
    contrast_tolerance = max(abs(baseline_contrast) * 0.15, 0.3)
    base.require(
        abs(current_contrast - baseline_contrast) <= contrast_tolerance,
        'photosphere local surface contrast changed too much during the render-path refactor: '
        f'baseline={baseline_contrast:.4f} current={current_contrast:.4f} '
        f'tolerance={contrast_tolerance:.4f}',
    )


def make_contact_sheet(baseline_path, current_path) -> None:
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
    draw.text((left_x, margin), 'Baseline / main v0.24.5', fill=(235, 238, 245))
    draw.text((right_x, margin), 'Current / dedicated stellar path', fill=(235, 238, 245))
    sheet.paste(baseline, (left_x, margin + label_height))
    sheet.paste(current, (right_x, margin + label_height))
    sheet.save(base.OUTPUT_DIR / 'mobile-ab-contact-sheet.png')


base.validate = validate
base.make_contact_sheet = make_contact_sheet
base.main()
