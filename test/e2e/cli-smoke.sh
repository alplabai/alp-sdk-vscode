#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Functional smoke test of the real `tan` CLI — the engine behind the extension's
# build/validate/generate/debug buttons — against a real SDK checkout. Proves the
# commands actually produce output, not just that they are registered.
#
#   Usage: test/e2e/cli-smoke.sh [<sdk-root>]
#   <sdk-root> defaults to a sibling `../alp-sdk` checkout.
#
# Requires a `tan` binary — a sibling `../tan-cli/python/dist/tan/tan[.exe]`
# freeze, a `$TAN` override, or `tan` on PATH — plus Python 3.10+. Does NOT cover
# the west/Zephyr compile or on-hardware flash/debug (toolchain- and bench-gated);
# those are constructed-and-driven by the in-host e2e, not run here.
set -o pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
SDK="${1:-$repo/../alp-sdk}"

ALP="${TAN:-}"
if [ -z "$ALP" ]; then
  # python/dist/tan/ is where python/scripts/build_binary.sh's PyInstaller
  # onedir freeze lands. The launcher must stay beside its _internal/ sibling,
  # so it is run in place. (This used to look under target/{release,debug} —
  # cargo output; tan-cli has had no Cargo.toml since v0.5.0, tan-cli#269.)
  for c in "$repo/../tan-cli/python/dist/tan/tan.exe" "$repo/../tan-cli/python/dist/tan/tan"; do
    [ -x "$c" ] && { ALP="$c"; break; }
  done
fi
[ -z "$ALP" ] && command -v tan >/dev/null 2>&1 && ALP="tan"
[ -z "$ALP" ] && { echo "no tan CLI — freeze it in ../tan-cli (cd python && bash scripts/build_binary.sh), set \$TAN, or put tan on PATH (pip install ./python)"; exit 2; }
[ -d "$SDK" ] || { echo "SDK root not found: $SDK"; exit 2; }
echo "tan: $("$ALP" --version 2>&1 | head -1)   sdk: $SDK"

WS="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/alp-cli-smoke.$$")"
mkdir -p "$WS"; trap 'rm -rf "$WS"' EXIT
"$ALP" init --project "$WS" --sdk-root "$SDK" --template zephyr-app --name p >/dev/null 2>&1
PROJ="$WS/p"
[ -f "$PROJ/board.yaml" ] || { echo "alp init did not produce board.yaml"; exit 1; }

PASS=0; FAIL=0
ok() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then PASS=$((PASS+1)); echo "PASS  $n"; else FAIL=$((FAIL+1)); echo "FAIL  $n"; fi; }
okj() { local n="$1"; shift; if "$@" 2>&1 | grep -q '"ok": *true'; then PASS=$((PASS+1)); echo "PASS  $n"; else FAIL=$((FAIL+1)); echo "FAIL  $n"; fi; }

okj "validate"            "$ALP" validate --project "$PROJ" --sdk-root "$SDK" --format json
okj "generate --all"      "$ALP" generate --project "$PROJ" --sdk-root "$SDK" --all --format json
for t in zephyr-conf dts-overlay cmake-args yocto-conf; do
  ok "generate $t"        "$ALP" generate --project "$PROJ" --sdk-root "$SDK" --target "$t"
done
okj "inspect"             "$ALP" inspect --project "$PROJ" --sdk-root "$SDK" --format json
okj "diff"                "$ALP" diff --project "$PROJ" --sdk-root "$SDK" --format json
okj "trace"               "$ALP" trace --project "$PROJ" --sdk-root "$SDK" --format json
okj "doctor native-host"  "$ALP" doctor --project "$PROJ" --sdk-root "$SDK" --target-kind native-host --server none --format json
okj "support-bundle"      "$ALP" support-bundle --project "$PROJ" --sdk-root "$SDK" --format json
ok  "presets"             "$ALP" presets --sdk-root "$SDK"
ok  "examples"            "$ALP" examples --sdk-root "$SDK"
ok  "pinmux aen"          "$ALP" pinmux --sdk-root "$SDK" --sku E1M-AEN801
ok  "explain zephyr-app"  "$ALP" explain --sdk-root "$SDK" --template zephyr-app
ok  "debug-config native" "$ALP" debug-config --project "$PROJ" --sdk-root "$SDK" --target-kind native-host --server none
ok  "generated alp.conf"  test -s "$PROJ/build/generated/alp.conf"

echo "===== cli-smoke: $PASS passed, $FAIL failed ====="
[ "$FAIL" -eq 0 ]
