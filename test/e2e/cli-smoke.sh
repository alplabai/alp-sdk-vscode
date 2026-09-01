#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Functional smoke test of the real `tan` CLI — the engine behind the extension's
# build/validate/generate/debug buttons — against a real SDK checkout. Proves the
# commands actually produce output, not just that they are registered.
#
# MANUAL ONLY (#612). No workflow invokes this — it needs the pinned `tan`
# binary and a real alp-sdk checkout on the runner, and would red on every
# unrelated PR the moment upstream ships a new tan. Run it by hand after a
# tan-cli or alp-sdk pin bump, via `pnpm run test:e2e:cli:manual`. #629
# proposes a SCHEDULED job that re-derives the surface record from this same
# binary; if this script is ever wired into CI, that is where it belongs, not
# a per-PR gate.
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
# Same command-substitution capture as `hasj` below, for the same reason: a
# grep piped straight from "$@" inherits tan's own exit code under
# `set -o pipefail`, and every command this checks is expected to exit 0 --
# today. Capturing first means a future call that legitimately expects
# `ok:true` from a non-zero exit (as `hasj` already has to handle for the
# refusal/dry-run checks below) is not a silent trap waiting in a helper that
# looks like it only reads text.
okj() {
  local n="$1"
  shift
  local out
  out="$("$@" 2>&1)"
  if printf '%s' "$out" | grep -q '"ok": *true'; then
    PASS=$((PASS + 1))
    echo "PASS  $n"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL  $n"
  fi
}
# Asserts a specific substring of the ENVELOPE — a code, a field — appears,
# regardless of exit status. `ok`/`okj` cannot tell "the command ran and
# happened to fail" from "the command produced the one specific answer this
# check exists to prove"; some of what this script drives (an expected
# refusal, a dry-run's promise that nothing was written) is exactly that
# distinction (#612).
#
# Output captured through a command SUBSTITUTION, not the `"$@" | grep`
# pipe `ok`/`okj` use — under `set -o pipefail` that pipe's exit status is
# the RIGHTMOST non-zero code among every stage, so a deliberately-refused
# command (tan exits non-zero) would win over a grep that DID find its match
# and exited 0, failing this check on the exact envelopes it exists to read.
# `$(...)` does not have that problem: nothing here inspects its exit status,
# only the text it captured.
hasj() {
  local n="$1" pattern="$2"
  shift 2
  local out
  out="$("$@" 2>&1)"
  if printf '%s' "$out" | grep -q "$pattern"; then
    PASS=$((PASS + 1))
    echo "PASS  $n"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL  $n"
  fi
}

okj "validate"            "$ALP" validate --project "$PROJ" --sdk-root "$SDK" --format json
okj "generate --all"      "$ALP" generate --project "$PROJ" --sdk-root "$SDK" --all --format json
for t in zephyr-conf dts-overlay cmake-args yocto-conf; do
  ok "generate $t"        "$ALP" generate --project "$PROJ" --sdk-root "$SDK" --target "$t"
done
okj "inspect"             "$ALP" inspect --project "$PROJ" --sdk-root "$SDK" --format json
okj "diff"                "$ALP" diff --project "$PROJ" --sdk-root "$SDK" --format json
okj "trace"               "$ALP" trace --project "$PROJ" --sdk-root "$SDK" --format json
# NOT `okj`: `$PROJ` is a fresh scaffold with no Zephyr workspace bootstrapped,
# so `workspace`/`westResolved` fail on every host this ever runs on — `ok`
# can structurally never be `true` here, deliberately (measured while fixing
# #612; this was `okj` before and would fail on every real run). What this
# line exists to prove is that doctor produced a REAL per-tool report, not
# that the report is all-green.
hasj "doctor json reports real per-tool checks" '"hostPython"' \
                          "$ALP" doctor --project "$PROJ" --sdk-root "$SDK" --format json
okj "support-bundle"      "$ALP" support-bundle --project "$PROJ" --sdk-root "$SDK" --format json
ok  "presets"             "$ALP" presets --sdk-root "$SDK"
ok  "examples"            "$ALP" examples --sdk-root "$SDK"
# Text mode writes its one-line summary to STDERR, not stdout (measured: 0
# stdout bytes on a real capability table) — `ok`'s exit-status-only check
# never saw that, so this asks `--format json` for the envelope and checks
# actual pad data landed, not just that the process exited 0.
hasj "pinmux aen returns real pad data" '"e1mPad"' \
                          "$ALP" --format json pinmux --sdk-root "$SDK" --sku E1M-AEN801
# V2N/V2M is the family whose capability table is EMPTY against the shipping
# SDK — not because metadata/pinmux/v2n.yaml has no pads (it has all 207 of
# them), but because every one of the 207 is still `e1m_pad: "TBD"`: tan
# resolves zero REAL pads out of 207 unresolved rows, and reports that as
# `ok:false`, exit 2, `pinmux.table-empty` at severity error. AEN801 alone
# never exercised this; assert the specific code tan actually emits, not
# merely "it failed somehow".
#
# `pinmux.table-empty` is `status: "reserved"`, `consumer: "none"` in the
# vendored contract (test/golden/tan-contract/envelope-contract.json) — no
# code in this extension binds it, so tan-cli renaming or dropping it is not
# a breaking wire change from their side. Binding to it HERE anyway is
# deliberate and different from binding to it in shipped product code: this
# script is a manual, run-by-hand re-verification tool (see the header), and
# a red the day tan-cli changes a reserved code is exactly the signal this
# tool exists to give — not a promise the wire is frozen.
hasj "pinmux v2n reports the empty table tan actually returns" \
                          '"code": *"pinmux.table-empty"' \
                          "$ALP" --format json pinmux --sdk-root "$SDK" --sku E1M-V2N101
ok  "explain zephyr-app"  "$ALP" explain --sdk-root "$SDK" --template zephyr-app
ok  "debug-config native" "$ALP" debug-config --project "$PROJ" --sdk-root "$SDK" --target-kind native-host --server none
ok  "generated alp.conf"  test -s "$PROJ/build/generated/alp.conf"
# `new-som --output-root` defaults to the SDK checkout itself; redirected to a
# scratch dir so a real defect in `--dry-run` cannot write into `$SDK` (this
# script only ever reads from it everywhere else). `--dry-run` is tan's own
# documented promise ("print the planned files; write nothing") — checked,
# not trusted: `written` must be the empty list its own envelope claims.
#
# Captured ONCE into a variable, not spawned once per assertion: `new-som`
# carries no captured envelope in the vendored contract corpus at all — it
# names two issue CODES there (`new-som.failed`, `new-som.internal-failure`)
# but no `envelopes.new-som` entry, unlike almost everything else this script
# checks. So `written`/`ok` are measured directly against the live pinned
# binary here, never against a frozen capture — which is this manual
# script's whole reason to exist — and there is nothing to gain by asking
# twice.
NEW_SOM_DRYRUN="$("$ALP" --format json new-som --sdk-root "$SDK" \
  --output-root "$WS/new-som" --sku E1M-CLISMOKE1 \
  --soc-ref smoke:smoke:smoke --family cli-smoke --dry-run 2>&1)"
if printf '%s' "$NEW_SOM_DRYRUN" | grep -q '"ok": *true'; then
  PASS=$((PASS + 1))
  echo "PASS  new-som dry-run"
else
  FAIL=$((FAIL + 1))
  echo "FAIL  new-som dry-run"
fi
if printf '%s' "$NEW_SOM_DRYRUN" | grep -q '"written": *\[\]'; then
  PASS=$((PASS + 1))
  echo "PASS  new-som dry-run writes nothing"
else
  FAIL=$((FAIL + 1))
  echo "FAIL  new-som dry-run writes nothing"
fi

echo "===== cli-smoke: $PASS passed, $FAIL failed ====="
[ "$FAIL" -eq 0 ]
