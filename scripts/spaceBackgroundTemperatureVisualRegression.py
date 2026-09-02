#!/usr/bin/env python3

import spaceBackgroundVisualRegression as visual

visual.BASELINE_REF = '38637551e8ef53bccafb64540a76502a40397b45'
visual.VARIANT_LABELS = {
    'baseline': 'Baseline / 0.24.3',
    'current': 'Temperature color / 0.24.4',
}

if __name__ == '__main__':
    visual.main()
