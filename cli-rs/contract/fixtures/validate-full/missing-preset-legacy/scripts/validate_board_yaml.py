# SPDX-License-Identifier: Apache-2.0
# Hermetic contract stub: emits legacy FAIL/WARN diagnostics on stderr and
# exits 1 -- the only non-clean code v0.10+ validate_board_yaml.py emits --
# exercising the legacy line parser + continuation. (#172)
import sys

sys.stderr.write(
    "FAIL som preset: no preset for E1M-NX9999\n"
    "     expected shared definition at metadata/boards/E1M-NX9999.yaml\n"
    "WARN hw_compat: minor version mismatch\n"
    "board.yaml: missing-preset\n"
)
sys.exit(1)
