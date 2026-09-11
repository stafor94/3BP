#!/usr/bin/env python3
"""Runtime image bounds and production outcomes; visual inspection remains required."""
import json
from pathlib import Path
payload = json.loads(Path('visual-regression-artifacts/metrics.json').read_text())
assert payload['production'], 'production engine frames required'
for scenario in payload['scenarios']:
    samples = scenario['samples']
    kind = scenario['scenario']
    if kind == 'solid':
        continue
    final_stars = [b for b in samples[-1]['state'] if b['type'] == 'star']
    assert len(final_stars) == (2 if kind in ['partial', 'hit-run'] else 1), f'{kind}: incorrect survivors'
    for frame in samples:
        m = frame['metrics']
        assert m['largest_component_width'] < m['roi_width'] * .9, f'{kind}: oversized flash footprint'
        assert m['hot_neutral_fraction'] < .3, f'{kind}: screen-filling white veil'
    # Compare the two frames bracketing the actual 2->1 solver handoff.
    if kind in ['oblique', 'head-on']:
        pre = next(f for f in samples if f['time'] == .0235)['metrics']
        post = next(f for f in samples if f['time'] == .0245)['metrics']
        if pre['largest_component_width'] > 0:
            assert .70 < post['largest_component_width'] / pre['largest_component_width'] < 1.3, f'{kind}: handoff width jump'
print('production stellar image bounds / handoff gate passed; qualitative review is separate')
