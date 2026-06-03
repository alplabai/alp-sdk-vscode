# SPDX-License-Identifier: Apache-2.0
# Hermetic contract stub: emits legacy FAIL/WARN diagnostics on stderr and
# exits 2 (missing-preset), exercising the legacy line parser + continuation.
import sys

sys.stderr.write(
    "FAIL som preset: no preset for E1M-NX9999\n"
    "     expected shared definition at metadata/boards/E1M-NX9999.yaml\n"
    "WARN hw_compat: minor version mismatch\n"
    "board.yaml: missing-preset\n"
)
sys.exit(2)
