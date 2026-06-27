#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# THE MAIN PROOF — "does compilation actually work?"
#
# Builds (and, where the example declares a console harness, RUNS) the chosen
# alp SDK example(s) on native_sim/native/64 via twister, using the host gcc
# (ZEPHYR_TOOLCHAIN_VARIANT=host). This is the exact mechanism the SDK's
# pr-twister.yml uses: the SDK is wired in as EXTRA_ZEPHYR_MODULES and twister
# cross/host-compiles real first-party code — not a build-plan envelope.
#
# Exit 0  == every selected example built (and any console harness passed).
set -euo pipefail

: "${ALP_SDK:?SDK not mounted}" "${ZEPHYR_BASE:?}" "${ZEPHYRPROJECT:?}"
EXAMPLES="${DEVBOX_EXAMPLES:-examples/peripheral-io/hello-world}"

cd "$ZEPHYRPROJECT"
export EXTRA_ZEPHYR_MODULES="$ALP_SDK"
export ZEPHYR_TOOLCHAIN_VARIANT=host

roots=()
for e in $EXAMPLES; do
  if [ -d "$ALP_SDK/$e" ]; then
    roots+=(--testsuite-root "$ALP_SDK/$e")
  else
    echo "WARN: example '$e' not found under \$ALP_SDK — skipping" >&2
  fi
done
if [ "${#roots[@]}" -eq 0 ]; then
  echo "FATAL: no buildable examples resolved from DEVBOX_EXAMPLES='$EXAMPLES'" >&2
  exit 1
fi

echo "== twister · native_sim/native/64 · host gcc =="
echo "   modules: $EXTRA_ZEPHYR_MODULES"
echo "   suites : $EXAMPLES"
set -x
python3 "$ZEPHYR_BASE/scripts/twister" \
  "${roots[@]}" \
  -p native_sim/native/64 \
  --inline-logs \
  --no-detailed-test-id \
  --outdir "$ZEPHYRPROJECT/twister-out"
rc=$?
set +x

# twister returns non-zero if zero tests were selected/built; treat that as a
# failure of the proof (we expected real compiles to happen).
if [ "$rc" -ne 0 ]; then
  echo "native_sim build/run FAILED (twister rc=$rc)" >&2
  exit "$rc"
fi
echo "native_sim build/run PASSED"
