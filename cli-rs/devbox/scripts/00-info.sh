#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Preflight: print the pinned toolchain + assert the SDK is mounted, and stamp
# the exact SDK SHA the rest of the suite is about to verify (the submodule is
# known to drift — see the repo's CI-skew note — so we record what we built).
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "== alp devbox · toolchain =="
printf '  %-8s %s\n' "alp"    "$(alp --version 2>/dev/null || echo MISSING)"
printf '  %-8s %s\n' "west"   "$(west --version 2>/dev/null || echo MISSING)"
printf '  %-8s %s\n' "cmake"  "$(cmake --version 2>/dev/null | head -1 || echo MISSING)"
printf '  %-8s %s\n' "ninja"  "$(ninja --version 2>/dev/null || echo MISSING)"
printf '  %-8s %s\n' "gcc"    "$(gcc --version 2>/dev/null | head -1 || echo MISSING)"
printf '  %-8s %s\n' "gdb"    "$(gdb --version 2>/dev/null | head -1 || echo MISSING)"
printf '  %-8s %s\n' "zephyr" "$(cat "$ZEPHYR_BASE/VERSION" 2>/dev/null | tr '\n' ' ' || echo '?') @ $ZEPHYR_BASE"
if command -v renode >/dev/null 2>&1; then
  printf '  %-8s %s\n' "renode" "$(renode --version 2>/dev/null | head -1 || echo present)"
fi
if [ -n "${ZEPHYR_SDK_INSTALL_DIR:-}" ]; then
  printf '  %-8s %s\n' "arm-sdk" "$ZEPHYR_SDK_INSTALL_DIR"
fi

echo
bold "== SDK under test =="
if [ ! -d "$ALP_SDK" ] || [ -z "$(ls -A "$ALP_SDK" 2>/dev/null)" ]; then
  echo "  FATAL: SDK not mounted at $ALP_SDK" >&2
  echo "         run with:  -v <repo>/alp-sdk-upstream:/work/alp-sdk:ro" >&2
  exit 2
fi
printf '  %-8s %s\n' "path" "$ALP_SDK"
# Prefer a SHA passed from the host (the submodule's .git is a file pointing
# into the parent repo, which isn't visible inside a bind-mount — so in-container
# `git` usually can't resolve it). The Makefile computes it host-side.
if [ -n "${DEVBOX_SDK_SHA:-}" ]; then
  printf '  %-8s %s\n' "sha"  "$DEVBOX_SDK_SHA (host-stamped)"
elif git -C "$ALP_SDK" rev-parse --git-dir >/dev/null 2>&1; then
  printf '  %-8s %s\n' "sha"  "$(git -C "$ALP_SDK" describe --tags --always --dirty 2>/dev/null || git -C "$ALP_SDK" rev-parse --short HEAD)"
else
  printf '  %-8s %s\n' "sha"  "(unknown — pass -e DEVBOX_SDK_SHA=\$(git -C alp-sdk-upstream describe --tags --always))"
fi
printf '  %-8s %s\n' "emit" "$([ -f "$ALP_SDK/scripts/alp_orchestrate.py" ] && echo 'scripts/alp_orchestrate.py present' || echo 'NO orchestrator — handoff leg will be limited')"
