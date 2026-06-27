#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Orchestrate the devbox verification suite and print a summary.
#
# Gating legs (failure => non-zero exit):
#   1. native_sim build+run   (10-build-native-sim.sh) — "compilation works"
#   2. alp->west handoff       (20-handoff.sh)          — the CLI seam
#   3. host-gdb debug-sim      (30-gdb-sim.sh)          — debuggable image
# Advisory leg (never affects exit):
#   4. generic-Cortex Renode   (40-renode-generic-cortex.sh) — STAND-IN, not silicon
set -uo pipefail

S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
declare -A R

run_gate() {
  local name="$1" file="$2"
  echo; echo "######## $name ########"
  if bash "$file"; then R["$name"]=PASS; else R["$name"]=FAIL; fi
}

# Preflight (hard fail: no point continuing without the SDK / toolchain).
bash "$S/00-info.sh" || exit 2

run_gate "native_sim build+run" "$S/10-build-native-sim.sh"
run_gate "alp->west handoff"    "$S/20-handoff.sh"
run_gate "host-gdb debug-sim"   "$S/30-gdb-sim.sh"

echo; echo "######## generic-Cortex Renode (ADVISORY) ########"
# Capture the leg's own stdout to classify it (it prints ADVISORY OK / SKIP:).
renode_out="$(bash "$S/40-renode-generic-cortex.sh" 2>&1)"
echo "$renode_out"
if grep -q "ADVISORY OK" <<<"$renode_out"; then   R["renode (advisory)"]="ok (Hello World booted)"
elif grep -q "^SKIP:" <<<"$renode_out"; then       R["renode (advisory)"]=skipped
else                                               R["renode (advisory)"]=advisory; fi

echo
echo "================= DEVBOX SUMMARY ================="
for k in "native_sim build+run" "alp->west handoff" "host-gdb debug-sim"; do
  printf '  %-22s %s\n' "$k" "${R[$k]:-?}"
done
printf '  %-22s %s\n' "renode (advisory)" "${R[renode (advisory)]:-skipped}  (stand-in, not real silicon)"
echo "================================================="

if [ "${R[native_sim build+run]:-FAIL}" = PASS ] \
   && [ "${R[alp->west handoff]:-FAIL}" = PASS ] \
   && [ "${R[host-gdb debug-sim]:-FAIL}" = PASS ]; then
  echo "RESULT: PASS — hardware-free build + handoff + debug-sim verified."
  exit 0
fi
echo "RESULT: FAIL — a gating leg did not pass (see above)." >&2
exit 1
