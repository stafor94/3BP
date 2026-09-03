#!/usr/bin/env python3
from pathlib import Path

import stellarPhotospherePass1VisualRegression as pass1

# Keep the historical workflow entrypoint/artifact path while replacing the
# obsolete requirement that a cellular lane network must exist.
pass1.BASELINE_REF = '09153897130cd25d35820174b2b81b5dea5b80c7'
pass1.OUTPUT_DIR = Path('stellar-photosphere-visual-artifacts')


if __name__ == '__main__':
    pass1.main()
