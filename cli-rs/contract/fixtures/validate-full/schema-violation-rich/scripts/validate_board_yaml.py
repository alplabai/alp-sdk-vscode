# SPDX-License-Identifier: Apache-2.0
# Hermetic contract stub: emits a rich `error[ALP-B*]` diagnostic block on
# stderr and exits 1 (schema-violation), exercising the rich-block parser.
import sys

sys.stderr.write(
    "error[ALP-B005]: SoM SKU 'E1M-NX9999' does not resolve\n"
    "  --> board.yaml:3:8\n"
    "   |\n"
    " 3 | som: {sku: E1M-NX9999}\n"
    "   |          ^^^^^^^^^^^^\n"
    "   = hint: did you mean E1M-NX9?\n"
    "   = see: docs/diagnostics/ALP-B005.md\n"
)
sys.exit(1)
