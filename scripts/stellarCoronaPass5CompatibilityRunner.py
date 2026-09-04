#!/usr/bin/env python3
from __future__ import annotations

import stellarCoronaVisualRegression as corona


_original_validate_state = corona.validate_state


def validate_state_with_pass5_surface_lod(
    star: str,
    level: str,
    baseline_surface: dict[str, float | int],
    current_surface: dict[str, float | int],
    baseline_corona: dict[str, float],
    corona_metric: dict[str, float],
) -> None:
    """Apply the current photosphere-first surface and compact-corona gates.

    Pass 4 originally required photosphere granulation contrast to remain almost
    identical to the Pass 3 baseline because that pass was corona-only. Pass 5 is
    explicitly allowed to retune screen-space photosphere LOD, so that historical
    invariant is no longer valid. Validate the current surface against the
    established topology/detail envelope, then run the original Pass 4 validator
    with only its stale contrast baseline neutralized. Corona, footprint, luma,
    hue, extent, decay, edge, rebound, and luminosity-response gates stay intact.
    """
    contrast = float(current_surface['granulation_contrast'])
    lower, upper = {
        'normal': (0.10, 1.80),
        'enlarged': (0.20, 2.80),
        'extreme': (0.26, 3.60),
    }[level]
    corona.p2.base.require(
        lower <= contrast <= upper,
        f'{star}/{level}: Pass 5 photosphere granulation {contrast:.3f} outside {lower:.2f}-{upper:.2f}',
    )
    corona.p2.base.require(
        float(current_surface['broad_variation_std']) >= 0.48,
        f'{star}/{level}: flat smooth disk; mid-scale plasma structure vanished',
    )
    corona.p2.base.require(
        float(current_surface['high_frequency_energy']) <= 2.60,
        f'{star}/{level}: Pass 5 surface has excessive high-frequency energy',
    )
    corona.p2.base.require(
        float(current_surface['local_minima_fraction']) <= 0.10,
        f'{star}/{level}: Pass 5 surface has excessive local minima',
    )
    corona.p2.base.require(
        float(current_surface['dark_residual_fraction']) <= 0.34,
        f'{star}/{level}: Pass 5 dark trough coverage is excessive',
    )
    corona.p2.base.require(
        float(current_surface['largest_dark_component_fraction']) <= 0.20,
        f'{star}/{level}: Pass 5 connected dark structure is too dominant',
    )
    corona.p2.base.require(
        float(current_surface['largest_dark_component_span_fraction']) <= 0.70,
        f'{star}/{level}: Pass 5 dark topology spans too much of the disk',
    )

    pass4_baseline_surface = dict(baseline_surface)
    pass4_baseline_surface['granulation_contrast'] = contrast
    _original_validate_state(
        star,
        level,
        pass4_baseline_surface,
        current_surface,
        baseline_corona,
        corona_metric,
    )


corona.validate_state = validate_state_with_pass5_surface_lod


if __name__ == '__main__':
    corona.main()
