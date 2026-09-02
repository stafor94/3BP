#!/usr/bin/env python3

import spaceBackgroundVisualRegression as visual

visual.BASELINE_REF = '9768b95d32040cb97f598f98f36ff6bc707280ee'
visual.VARIANT_LABELS = {
    'baseline': 'Baseline / 0.24.2',
    'current': 'Pass 6 / 0.24.3',
}

if __name__ == '__main__':
    visual.main()
