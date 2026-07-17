<!-- SPDX-License-Identifier: Apache-2.0 -->

# Note to the alp-sdk team — generic build engine (evidence) + Wave C unblock

**Audience:** the alp-sdk (firmware) team.
**From:** the alp-sdk-vscode (IDE / native `alp` CLI) team.
**Date:** 2026-06-04.

**TL;DR — two things, in order:** (1) a strategic, _your-call_ proposal (a
generic, data-driven build engine) now backed by a spike series, and (2) two
concrete asks that unblock our live build (a tagged release + the C4 answer).
**Nothing here changes ADR 0014** — the `--emit build-plan` we agreed on ships
as-is and our consumer already works against it.

---

## 1. Generic engine north star — now evidence-backed (your call)

We explored making the planner a **generic, policy-driven engine** where the
fast-moving rules live in **data** (facts / rules / templates) and the engine
code stays small + stable. We then ran a spike series purely to test
_feasibility_ — not to ask you to do anything yet.

**Pushed evidence:** branch
[`spike/partition-allocator-rust`](https://github.com/alplabai/alp-sdk-vscode/tree/spike/partition-allocator-rust).
Nine datapoints, each parity-checked against **your own test expectations**,
clippy `-D warnings` clean:

- storage partition allocator — **7/7 parity**;
- `resolve_memory_map` derivation — **no per-SoC branching** (new silicon = SoC
  JSON data);
- IPC carve-out allocator (the hardest) — **7/7 parity**, FNV-1a pinned to
  canonical vectors;
- registry tables — `sku→family` is genuine data, `silicon→Kconfig` is a pure
  rule (no table);
- the **real** `E1M-AEN801.yaml` + `socs/.../e7.json` deserialize into structs
  (incl. real `TBD` values, the 3-core `topology`, TCM-suffixed banks);
- a `{{#each}}` template renders a DTS overlay + a Kconfig fragment from data;
- a **policy-as-data engine** — zero hardcoded rules; the default policy
  reproduces your exact offsets + `0x400` endpoint mask, changing the policy
  _data_ changes the output (top-down, mask, page, prefix), and an unknown
  strategy is a hard load error;
- **engine → `BuildPlan`** — the real SoM `topology` assembles into a `BuildPlan`
  our shipped consumer (`parse_build_plan`) accepts (round-trip).

So the whole chain — **real metadata → generic policy-driven engine →
consumer-valid `BuildPlan`** — is proven feasible. What remains is _volume_
(porting every chip→Kconfig + DTS / sysbuild / TF-M template at full fidelity) +
real-hardware validation, not open feasibility questions.

This is a **north star, not a request to change anything now.** Two questions:

1. Is there **appetite to own a Rust planner crate** (it lives in your repo; both
   `west alp-build` and our CLI consume it — one brain, two surfaces)?
2. Is the planner **stabilizing** (partition / sysbuild / TF-M settling) enough
   that a port would not chase churn?

Full design + the migration seam (the `BuildPlan` contract insulates the
consumer; nothing already shipped is wasted): `docs/PROPOSAL-alp-build-core.md`
§7–§8.

## 2. Wave C unblock — two concrete asks (after the above)

Our CLI-side Wave C is **done + verified against your real emit** — consume,
materialise, and execute are all built (`alp build --plan` / `--materialise` /
`--native`). Two things from you close the loop on real hardware:

1. **Cut a tagged release that includes `--emit build-plan`** (ADR 0014; it's on
   your `dev` at `ebaa3dd`). We pin to **release tags, not `dev`** — a tag lets
   us bump our submodule pin, wire the live `alp build --plan`, and start the
   parity harness against a stable golden.
2. **Confirm C4 (conf→build wiring)** — the item you committed to answer before
   our C1. Your leanings are captured (Zephyr `EXTRA_CONF_FILE` in a
   `generated/` subdir + sysbuild overlays; Yocto `require` fragment with weak
   `?=`; baremetal cmake-args splat). Once it lands we wire execute so the
   per-slice config is actually applied.

Neither blocks you on us. When both land, **consume → materialise → execute
closes end-to-end on silicon.**
