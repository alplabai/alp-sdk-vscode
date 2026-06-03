# SPDX-License-Identifier: Apache-2.0
# Hermetic contract stub: stands in for the real SDK validator so the harness
# can exercise the spawn path deterministically (no PyYAML / SDK required).
# Clean board -> exit 0, no diagnostics.
import sys

sys.exit(0)
