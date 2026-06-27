#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# DEBUG VIA SIMULATION (honest version) — host-gdb on the native_sim ELF.
#
# native_sim/native/64 compiles the firmware to a NATIVE host executable
# (zephyr.exe), so it is debuggable with plain host gdb — no JTAG, no probe, no
# hardware. This is the single realistic, non-misleading "debug in simulation"
# story available today: we attach gdb, break at main, run, and inspect the
# stack to prove the image is debuggable end-to-end.
#
# (For the real Alif/Renesas/NXP silicon, faithful debug needs an EVK; see the
# README + the advisory generic-Cortex Renode leg in 40-*.)
set -euo pipefail

: "${ZEPHYRPROJECT:?}"

ELF="$(find "$ZEPHYRPROJECT/twister-out" -name 'zephyr.exe' 2>/dev/null | head -1)"
if [ -z "$ELF" ]; then
  echo "no native_sim ELF found under twister-out — run 10-build-native-sim.sh first" >&2
  exit 1
fi
echo "== host-gdb · native_sim ELF =="
echo "   elf: $ELF"

# `start` == tbreak main + run, so we stop AT main without running the (looping)
# app to completion. Then prove we can inspect program state.
# `info registers` (no register name) is arch-neutral — the ELF is whatever the
# container's host arch is (x86_64 or aarch64), so we must not name an x86 reg.
gdb -batch -nx \
    -ex 'set pagination off' \
    -ex 'start' \
    -ex 'bt' \
    -ex 'info registers' \
    -ex 'info locals' \
    -ex 'kill' \
    -ex 'quit' \
    "$ELF" 2>&1 | tee /tmp/gdb.log

if grep -qE 'Temporary breakpoint .* main|in main ' /tmp/gdb.log; then
  echo "host-gdb debug-sim PASSED (stopped at main, inspected state)"
  exit 0
fi
echo "host-gdb debug-sim FAILED (did not stop at main — see /tmp/gdb.log)" >&2
exit 1
