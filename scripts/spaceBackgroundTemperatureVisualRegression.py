#!/usr/bin/env python3

import spaceBackgroundVisualRegression as visual

visual.BASELINE_REF = '38637551e8ef53bccafb64540a76502a40397b45'
visual.VARIANT_LABELS = {
    'baseline': 'Baseline / 0.24.3',
    'current': 'Temperature color + display luma / 0.24.4',
}

_original_summarize = visual.summarize


def summarize_with_visibility_gate(metrics: dict[str, object]) -> dict[str, object]:
    summary = _original_summarize(metrics)
    for viewport_name in ('mobile', 'desktop'):
        delta = summary[viewport_name]['current_vs_baseline']
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
