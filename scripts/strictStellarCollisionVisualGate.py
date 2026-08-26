#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

METRICS_PATH = Path('visual-regression-artifacts/metrics.json')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    payload = json.loads(METRICS_PATH.read_text(encoding='utf-8'))
    frames = payload['frames']
    separate = frames['separate']
    peak = frames['peak']
    retained = frames['remnant-retained']
    faded = frames['remnant-faded']

    require(
        peak['largest_component_width'] >= separate['largest_component_width'] * 2.1,
        'impact peak still reads as two exposed stellar discs; the neutral mask is not wide enough: '
        f"separate={separate['largest_component_width']}px peak={peak['largest_component_width']}px",
    )
    require(
        peak['largest_component_height'] >= separate['largest_component_height'] * 1.5,
        'impact peak lacks enough vertical burst/shock coverage: '
        f"separate={separate['largest_component_height']}px peak={peak['largest_component_height']}px",
    )
    require(
        peak['largest_component_area'] >= separate['largest_component_area'] * 2.8,
        'impact peak does not occupy enough real screen area to hide the topology handoff: '
        f"separate={separate['largest_component_area']}px peak={peak['largest_component_area']}px",
    )
    require(
        peak['saturated_bright_fraction'] <= separate['saturated_bright_fraction'] * 0.25,
        'orange/blue source silhouettes remain too readable at impact peak: '
        f"separate={separate['saturated_bright_fraction']:.5f} peak={peak['saturated_bright_fraction']:.5f}",
    )

    require(
        retained['largest_component_width'] >= separate['largest_component_width'] * 1.75,
        'first remnant frame exposes a single-star topology before the mask has cleared: '
        f"separate={separate['largest_component_width']}px retained={retained['largest_component_width']}px",
    )
    require(
        retained['largest_component_area'] >= separate['largest_component_area'] * 2.0,
        'first remnant frame is not sufficiently covered by the retained impact envelope: '
        f"separate={separate['largest_component_area']}px retained={retained['largest_component_area']}px",
    )
    require(
        retained['saturated_bright_fraction'] <= separate['saturated_bright_fraction'] * 0.8,
        'remnant photosphere becomes too legible while the topology mask should still dominate',
    )

    # The settled remnant photosphere is intentionally white-hot, so its own pixels remain
    # in the hot-neutral mask after the impact envelope is gone. Requiring the total hot
    # pixel count to fall close to zero therefore misclassifies a healthy single remnant as
    # lingering impact VFX. Verify retirement by requiring a strong drop in brightness and,
    # more importantly, contraction of the connected mask back toward a single-star footprint.
    require(
        faded['hot_neutral_pixels'] <= retained['hot_neutral_pixels'] * 0.72,
        'impact envelope remains too bright after its reveal window: '
        f"retained={retained['hot_neutral_pixels']}px faded={faded['hot_neutral_pixels']}px",
    )
    require(
        faded['largest_component_width'] <= retained['largest_component_width'] * 0.72,
        'impact envelope remains too wide after its reveal window: '
        f"retained={retained['largest_component_width']}px faded={faded['largest_component_width']}px",
    )
    require(
        faded['largest_component_height'] <= retained['largest_component_height'] * 0.60,
        'impact envelope remains too tall after its reveal window: '
        f"retained={retained['largest_component_height']}px faded={faded['largest_component_height']}px",
    )
    require(
        faded['largest_component_area'] <= retained['largest_component_area'] * 0.68,
        'impact envelope retains too much screen area after its reveal window: '
        f"retained={retained['largest_component_area']}px faded={faded['largest_component_area']}px",
    )

    print('strict stellar collision visual gate: ok')


if __name__ == '__main__':
    main()
