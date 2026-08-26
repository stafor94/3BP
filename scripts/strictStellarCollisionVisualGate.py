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

    # The current collision presentation intentionally avoids the old oversized
    # lens-flare/spike footprint. In the deterministic harness, the two peak-stage
    # source discs together span about 1.82x one separate-disc width. Requiring
    # 1.7x therefore still verifies that the connected neutral impact mask bridges
    # essentially the full two-star silhouette without demanding flare overshoot.
    require(
        peak['largest_component_width'] >= separate['largest_component_width'] * 1.7,
        'impact peak does not bridge enough of the two source silhouettes: '
        f"separate={separate['largest_component_width']}px peak={peak['largest_component_width']}px",
    )
    require(
        peak['largest_component_height'] >= separate['largest_component_height'] * 1.5,
        'impact peak lacks enough vertical burst/shock coverage: '
        f"separate={separate['largest_component_height']}px peak={peak['largest_component_height']}px",
    )
    require(
        peak['largest_component_area'] >= separate['largest_component_area'] * 2.0,
        'impact peak does not cover enough screen area to mask both source stars: '
        f"separate={separate['largest_component_area']}px peak={peak['largest_component_area']}px",
    )
    require(
        peak['saturated_bright_fraction'] <= separate['saturated_bright_fraction'] * 0.25,
        'orange/blue source silhouettes remain too readable at impact peak: '
        f"separate={separate['saturated_bright_fraction']:.5f} peak={peak['saturated_bright_fraction']:.5f}",
    )

    # The post-merge remnant presentation deliberately begins relaxing while the
    # topology veil is still handing off. Keep a substantial connected envelope,
    # but do not require the old flare-sized width after the 2->1 topology switch.
    require(
        retained['largest_component_width'] >= peak['largest_component_width'] * 0.68,
        'first remnant frame collapses too narrowly during topology handoff: '
        f"peak={peak['largest_component_width']}px retained={retained['largest_component_width']}px",
    )
    require(
        retained['largest_component_area'] >= peak['largest_component_area'] * 0.70,
        'first remnant frame loses too much impact-envelope coverage during handoff: '
        f"peak={peak['largest_component_area']}px retained={retained['largest_component_area']}px",
    )
    require(
        retained['saturated_bright_fraction'] <= separate['saturated_bright_fraction'] * 0.8,
        'remnant photosphere becomes too legible while the topology mask should still dominate',
    )

    # The retained-frame capture can shift by more than 100 ms between runners while React
    # commits and WebGL draws settle. Ratios against that frame therefore turn timing jitter
    # into false failures. The faded frame should instead have contracted to the known single
    # remnant footprint relative to the deterministic two-source baseline.
    require(
        faded['hot_neutral_pixels'] <= separate['hot_neutral_pixels'] * 0.85,
        'faded frame still contains too much hot-neutral coverage for a single remnant: '
        f"separate={separate['hot_neutral_pixels']}px faded={faded['hot_neutral_pixels']}px",
    )
    require(
        faded['largest_component_width'] <= separate['largest_component_width'] * 1.35,
        'impact envelope remains too wide after its reveal window: '
        f"separate={separate['largest_component_width']}px faded={faded['largest_component_width']}px",
    )
    require(
        faded['largest_component_height'] <= separate['largest_component_height'] * 1.35,
        'impact envelope remains too tall after its reveal window: '
        f"separate={separate['largest_component_height']}px faded={faded['largest_component_height']}px",
    )
    require(
        faded['largest_component_area'] <= separate['largest_component_area'] * 1.70,
        'impact envelope retains too much screen area after its reveal window: '
        f"separate={separate['largest_component_area']}px faded={faded['largest_component_area']}px",
    )

    print('strict stellar collision visual gate: ok')


if __name__ == '__main__':
    main()
