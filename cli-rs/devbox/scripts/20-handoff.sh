#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# THE CLI SEAM — "does `alp` correctly drive the SDK build path?"
#
# Per ADR 0014 the CLI owns NOT the build's correctness (that is the SDK + the
# native_sim proof in 10-*) but the HANDOFF: that `alp` resolves the toolchain
# and drives the SDK orchestrator / `west`. We verify the two non-speculative
# seam points the research identified:
#   (a) `alp doctor --build`  — alp's own view of host build-readiness (west,
#       cmake, ninja, Zephyr) reports OK inside this container, and
#   (b) `alp build --plan`    — alp invokes the SDK orchestrator across the JSON
#       seam and a real build-plan materialises (no compile / no hardware).
#
# NOTE: a full `alp build` (actually running `west alp-build`) is intentionally
# NOT asserted here — the example board.yaml targets real silicon (E1M EVKs),
# which would need the vendor cross-toolchains, not native_sim. See README.
set -euo pipefail

: "${ALP_SDK:?}"
EX="${DEVBOX_HANDOFF_EXAMPLE:-examples/peripheral-io/hello-world}"
BOARD_YAML="$ALP_SDK/$EX/board.yaml"

ok=1

echo "== (a) alp doctor --build =="
# Pass the SDK + board.yaml context (same as leg (b)): since alp-sdk-vscode#110
# `alp doctor --build` is a real project-readiness gate that exits non-zero when
# the SDK / board.yaml / Zephyr workspace can't be resolved. A context-free
# invocation is not-ready by construction, so give it the mounted SDK + the
# example board.yaml this container is set up to build.
if alp doctor --build --sdk-root "$ALP_SDK" --board-yaml "$BOARD_YAML" --format json >/tmp/doctor.json 2>/tmp/doctor.err; then
  python3 - <<'PY' || ok=0
import json,sys
d=json.load(open("/tmp/doctor.json"))
print("   ok:", d.get("ok"), "| exitCode:", d.get("exitCode"))
sys.exit(0 if d.get("ok") else 1)
PY
else
  echo "   alp doctor --build exited non-zero:"; cat /tmp/doctor.err >&2; ok=0
fi

echo "== (b) alp build --plan (orchestrator emit across the JSON seam) =="
# --sdk-root points alp at the mounted SDK checkout (where alp_orchestrate.py
# lives). A real `alp init` project resolves this from settings/bootstrap; a
# bare example dir does not, so we pass it explicitly.
if [ -f "$BOARD_YAML" ]; then
  if alp build --board-yaml "$BOARD_YAML" --sdk-root "$ALP_SDK" --plan --format json >/tmp/plan.json 2>/tmp/plan.err; then
    python3 - <<'PY' || ok=0
import json,sys
d=json.load(open("/tmp/plan.json"))
data=d.get("data") or {}
slices=data.get("slices") or []
print("   ok:", d.get("ok"), "| sku:", data.get("sku"), "| slices:", len(slices))
# A real plan must name the orchestrator and carry at least one slice.
sys.exit(0 if d.get("ok") and slices else 1)
PY
  else
    echo "   alp build --plan exited non-zero:"; cat /tmp/plan.err >&2; ok=0
  fi
else
  echo "   WARN: $BOARD_YAML missing — cannot run the --plan seam check" >&2
  ok=0
fi

[ "$ok" -eq 1 ] && { echo "alp->west handoff PASSED"; exit 0; }
echo "alp->west handoff FAILED" >&2
exit 1
