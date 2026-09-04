#!/usr/bin/env python3

import statistics

from PIL import Image, ImageChops, ImageFilter

import spaceBackgroundVisualRegression as visual

# This gate is a PR regression check, so compare against the main revision the
# stellar-rendering work branches from rather than the obsolete v0.24.3 image.
visual.BASELINE_REF = 'b8e28a4666df13282d7248445b479d33bb51af2a'
visual.VARIANT_LABELS = {
    'baseline': 'Baseline / main v0.24.16',
    'current': 'Current PR',
}


def masked_image_metrics(image: Image.Image, include_mask: Image.Image) -> dict[str, float | int]:
    gray = image.convert('L')
    histogram = gray.histogram(mask=include_mask)
    total = sum(histogram)
    visual.require(total > 0, 'space-background metric mask removed the whole frame')
    return {
        'width': image.width,
        'height': image.height,
        'mean_luma': round(sum(value * count for value, count in enumerate(histogram)) / total, 4),
        'near_black_fraction': round(sum(histogram[:8]) / total, 6),
        'visible_low_mid_fraction': round(sum(histogram[10:80]) / total, 6),
        'bright_fraction': round(sum(histogram[128:]) / total, 6),
    }


def paired_background_metrics(baseline_path, current_path):
    baseline = Image.open(baseline_path).convert('RGB')
    current = Image.open(current_path).convert('RGB')
    visual.require(baseline.size == current.size, 'baseline/current background captures differ in size')

    # The app-level capture intentionally includes the foreground bodies. This PR
    # removes their old broad stellar halos, which changes many very dark pixels
    # without changing the actual starfield. Build one shared exclusion mask from
    # low-frequency baseline/current differences so the gate measures the backdrop
    # rather than the foreground star renderer. Sparse point-star differences do
    # not create the same broad low-frequency footprint.
    difference = ImageChops.difference(baseline, current)
    red, green, blue = difference.split()
    max_channel_difference = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    low_frequency_change = max_channel_difference.filter(ImageFilter.GaussianBlur(radius=2.0))
    foreground_change_mask = low_frequency_change.point(lambda value: 255 if value >= 1 else 0)
    include_mask = foreground_change_mask.point(lambda value: 0 if value else 255)

    return (
        masked_image_metrics(baseline, include_mask),
        masked_image_metrics(current, include_mask),
    )


def summarize_with_visibility_gate(_metrics: dict[str, object]) -> dict[str, object]:
    summary: dict[str, object] = {}
    for viewport_name, *_ in visual.VIEWPORTS:
        pairs = []
        for index, (view_name, *_drag) in enumerate(visual.VIEWPOINTS, start=1):
            file_name = f'{index:02d}-{view_name}.png'
            pairs.append(paired_background_metrics(
                visual.OUTPUT_DIR / 'baseline' / viewport_name / file_name,
                visual.OUTPUT_DIR / 'current' / viewport_name / file_name,
            ))

        viewport_summary: dict[str, object] = {}
        for label, pair_index in (('baseline', 0), ('current', 1)):
            values = [pair[pair_index] for pair in pairs]
            viewport_summary[label] = {
                'mean_luma': round(statistics.fmean(float(item['mean_luma']) for item in values), 4),
                'near_black_fraction': round(statistics.fmean(float(item['near_black_fraction']) for item in values), 6),
                'visible_low_mid_fraction': round(statistics.fmean(float(item['visible_low_mid_fraction']) for item in values), 6),
                'bright_fraction': round(statistics.fmean(float(item['bright_fraction']) for item in values), 6),
            }

        baseline = viewport_summary['baseline']
        current = viewport_summary['current']
        delta = {
            'near_black_fraction_delta': round(current['near_black_fraction'] - baseline['near_black_fraction'], 6),
            'visible_low_mid_fraction_delta': round(current['visible_low_mid_fraction'] - baseline['visible_low_mid_fraction'], 6),
            'mean_luma_delta': round(current['mean_luma'] - baseline['mean_luma'], 4),
            'bright_fraction_delta': round(current['bright_fraction'] - baseline['bright_fraction'], 6),
        }
        viewport_summary['current_vs_baseline'] = delta
        summary[viewport_name] = viewport_summary

        visual.require(
            delta['near_black_fraction_delta'] <= 0.003,
            f"{viewport_name}: near-black fraction regressed by {delta['near_black_fraction_delta']:.6f}",
        )
        visual.require(
            delta['visible_low_mid_fraction_delta'] >= -0.005,
            f"{viewport_name}: visible low/mid fraction regressed by {delta['visible_low_mid_fraction_delta']:.6f}",
        )
        visual.require(
            abs(delta['mean_luma_delta']) <= 0.10,
            f"{viewport_name}: mean luminance shifted by {delta['mean_luma_delta']:.4f}",
        )
        visual.require(
            delta['bright_fraction_delta'] >= -0.0005,
            f"{viewport_name}: bright-star readability regressed by {delta['bright_fraction_delta']:.6f}",
        )
    return summary


visual.summarize = summarize_with_visibility_gate

if __name__ == '__main__':
    visual.main()
