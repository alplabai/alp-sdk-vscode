#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
#   ADVISORY — generic Cortex-M boot-smoke under Renode.  NOT a release gate.
#
# ============================================================================
#  HONESTY BANNER (read this before trusting a green here)
#  This boots a GENERIC Cortex-M core (default: nRF52840 = Cortex-M4) under
#  Renode and checks that a Zephyr hello_world prints over UART.  It is a
#  deliberate STAND-IN for the Alif / Renesas / NXP M-cores — it is NOT the
#  real silicon, and not even the same ARM profile (the alp M-cores are
#  Cortex-M33 / M55 = ARMv8-M; this stand-in is ARMv7-M):
#    * NO Ethos-U NPU (Alif), NO DRP-AI (Renesas) is modeled.
#    * NO heterogeneous Cortex-A + Cortex-M boot / RPMsg is modeled.
#    * A green here proves "a generic ARM Cortex-M boots Zephyr in simulation",
#      NOT that the vendor SoC, its accelerators, or dual-OS bring-up work.
#  This mirrors the SDK's own pr-renode-dual-os.yml: advisory, continue-on-error,
#  never blocking.  Faithful silicon debug needs a real EVK (nightly HIL).
# ============================================================================
#
# Deliberately NOT `set -e`: this leg must never fail the suite.
set -uo pipefail

echo "============================================================"
echo " ADVISORY · generic Cortex-M Renode boot-smoke (NOT real silicon)"
echo "============================================================"

if ! command -v renode >/dev/null 2>&1 || [ -z "${ZEPHYR_SDK_INSTALL_DIR:-}" ]; then
  echo "SKIP: this image has no Renode / arm-zephyr-eabi toolchain."
  echo "      build the 'devbox-renode' target to enable this leg."
  exit 0
fi

# A board BOTH Renode (ships a .repl) and Zephyr (has the board) support, with a
# UART Renode models well enough to print. nRF52840 is the most robust such combo
# (Renode even ships a ready demo for it). Override via env for a different core,
# e.g. a Cortex-M33 board's repl for a closer stand-in.
BOARD="${RENODE_BOARD:-nrf52840dk/nrf52840}"
# The Renode platform .repl on disk — we strip its network SVD fetch below.
REPL_SRC="${RENODE_REPL_SRC:-/opt/renode/platforms/cpus/nrf52840.repl}"
UART="${RENODE_UART:-sysbus.uart0}"
APP="$ZEPHYR_BASE/samples/hello_world"
# NOTE: keep every path that Renode dereferences via `@<path>` (the ELF, the
# repl, the UART log) HYPHEN-FREE. Renode 1.16.1's monitor tokenizer mis-parses a
# `-` inside an `@` path and LoadELF then fails with "Parameters did not match
# the signature". (Hence /tmp/renodebuild, not /tmp/renode-build.)
BUILD=/tmp/renodebuild
ELF="$BUILD/zephyr/zephyr.elf"

echo "== build · $BOARD · Zephyr samples/hello_world (arm-zephyr-eabi) =="
rm -rf "$BUILD"
if ! ZEPHYR_TOOLCHAIN_VARIANT=zephyr west build -b "$BOARD" -d "$BUILD" "$APP" >/tmp/renode-build.log 2>&1; then
  echo "ADVISORY: cross-build for $BOARD failed (non-blocking). tail:"
  tail -20 /tmp/renode-build.log
  exit 0
fi
[ -f "$ELF" ] || { echo "ADVISORY: no ELF at $ELF (non-blocking)"; exit 0; }
echo "   built $ELF (real arm-zephyr-eabi cross-compile)"

echo "== boot · Renode =="
# Renode 1.16.1 quirk: a repl's `ApplySVD @<url>` fetches an SVD from
# dl.antmicro.com and attaches it to sysbus; that attach then breaks the
# subsequent `sysbus LoadELF` ("Parameters did not match the signature"). The SVD
# only adds peripheral register *names* for debugging — the firmware boots fine
# without it — so strip that one line into a local repl. This also makes the boot
# fully offline + deterministic (no network at all).
REPL_LOCAL=/tmp/platformnosvd.repl   # hyphen-free: Renode dereferences it via @
grep -v 'ApplySVD' "$REPL_SRC" > "$REPL_LOCAL"

# Headless: --console --disable-xwt + a script that file-backs the UART so we can
# read it without a GUI, runs a slice of emulated time, then quits.
cat > /tmp/boot.resc <<RESC
using sysbus
mach create "generic-cortex-m"
machine LoadPlatformDescription @$REPL_LOCAL
sysbus LoadELF @$ELF
$UART CreateFileBackend @/tmp/renodeuart.log true
emulation RunFor "0.25"
quit
RESC

: > /tmp/renodeuart.log
timeout 90 renode --console --disable-xwt /tmp/boot.resc >/tmp/renode-console.log 2>&1 || true

echo "--- UART capture ---"
cat /tmp/renodeuart.log 2>/dev/null || true
if grep -q "Hello World" /tmp/renodeuart.log 2>/dev/null; then
  echo "ADVISORY OK: generic Cortex-M ($BOARD) booted Zephyr + printed Hello World under Renode."
else
  echo "ADVISORY: no 'Hello World' captured (non-blocking)."
  echo "          renode console tail:"; tail -20 /tmp/renode-console.log 2>/dev/null || true
fi
exit 0
