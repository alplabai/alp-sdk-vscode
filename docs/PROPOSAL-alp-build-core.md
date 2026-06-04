<!-- SPDX-License-Identifier: Apache-2.0 -->

# Agreement: the `alp` CLI consumes the SDK's emitted build plan

**Audience:** the alp-sdk (firmware) team + the alp-sdk-vscode (IDE/CLI) team.
**Status:** agreement reached. This records the settled split after the SDK
team's review; it supersedes the earlier RFC framing in this file.

**TL;DR:** The `alp` CLI takes build orchestration to the top — it owns
materialise / execute / schedule / cache / progress UX / envelope and invokes
`west` / `bitbake` / `cmake` directly. It does **not** re-implement the planner.
Per the SDK team's counter-offer, the CLI **consumes
`alp_orchestrate.py --emit build-plan`** — the planner stays the SDK's single
source of truth. Both sides accept this; the only scheduled new work on the SDK
side is the `--emit build-plan` command (plus an answer on the conf→build
wiring). The CLI's implementation plan is in
[`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md).

> **History.** Round 1 (our RFC): "extract `alp_orchestrate.py` into a shared
> `alp-build-core` Rust crate consumed by both `west alp-build` and the CLI."
> Round 2 (we withdrew that): "the CLI owns orchestration and re-implements the
> planner in Rust; you don't need to orchestrate for us." Round 3 (SDK reply,
> accepted here): "agreed on the split — but don't mirror the planner; consume
> our `--emit build-plan` instead." This document is the Round-3 settlement.

---

## 1. The settled split

| Concern | Owner |
|---|---|
| Parse/validate `board.yaml`; per-core slice resolution; partition allocation; IPC/DTS/sysbuild/TF-M derivation; **contents** of all generated files | **SDK** — via `--emit build-plan` |
| `metadata/**`, the builders (`west`/`bitbake`/`cmake`), Yocto layer, vendor glue | **SDK** — unchanged |
| Materialise (write the plan's files), execute (run each slice), schedule (parallel/cache), progress UX, JSON envelope, exit codes | **CLI** |
| `west alp-build` | **SDK** — stays native (see §3.3) |

The CLI is still the top-level driver of the build; it *fetches* the plan rather
than *computing* it.

## 2. Why we accepted the `--emit build-plan` offer

The SDK's pushback was right, and the new facts changed our calculus:

- **The planner is not stable schema logic.** It doubled (1547 → 3066 lines) in
  three weeks — partition allocation, sysbuild, TF-M secure-boot. Mirroring it in
  Rust is a standing tax on a fast-moving, vendor-heavy surface; a parity harness
  would *detect* drift, not *remove* the re-implementation cost.
- **"One machine-readable source per fact"** is the SDK's core design rule.
  Consuming the emit honors it; a second Rust planner would violate it.
- **The "no Python" prize is small.** `west` and `bitbake` are Python; every
  build host already has a Python-bearing SDK checkout. One sub-second,
  cacheable `--emit build-plan` subprocess is not a real dependency cost.

## 3. What we accept from the SDK response

### 3.1 `--emit build-plan` — yes, with one refinement

Please emit exactly the `BuildPlan` JSON we spec'd, with **one addition: carry
the generated-file _contents_** (`GeneratedFile { path, contents }`) for both
`shared_artefacts` and per-slice `config_artefacts`. That keeps the CLI's
materialise step pure IO (byte-write) and keeps **all** content-derivation
(IPC/DTS/partitions/sysbuild/TF-M) inside your emit, where it belongs. Shape is
in [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md) §3.

### 3.2 Parity pinned to release tags — agreed

We will track released tags / `schema_version`s, never `dev`. Goldens against a
churning integration branch would just train everyone to rubber-stamp `--bless`.
We rely on your release-notes/CHANGELOG heads-up (§4.3) to know when to re-bless.

### 3.3 `west alp-build` stays native — agreed

We withdraw the shim suggestion. Standalone `west` usage (hand-written firmware,
no IDE/CLI) is a first-class consumer path, and a shim would invert the
dependency direction (an SDK `west` command depending on a binary from our repo).
Both paths coexist; the parity harness keeps them honest.

### 3.4 Do not freeze the command shape (C3) — understood

We will **not** treat today's `west build -b <board> <app>` as frozen. The
command comes from the emit (§3.1) and will grow (e.g. `--sysbuild
--sysbuild-config`) as Phase 3 lands. A CHANGELOG heads-up on command-shape
changes (your commitment §4.3) keeps our harness green.

## 4. Open item + your commitments

**Open (blocks our C1):** the conf→build wiring (per-slice `alp.conf` /
`local.conf` / `cmake-args.txt` consumption). You committed to an answer before
our C1; current leanings (Zephyr `EXTRA_CONF_FILE` in a `generated/` subdir to
avoid the double-GLOB trap + sysbuild overlays; Yocto `require` fragment with
weak `?=`; baremetal cmake-args splat) are captured in
[`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md) §7.

**Your committed seams:** `board.yaml` schema-version bumps; `schema_version` on
`e1m_modules`; CHANGELOG heads-up on per-slice command shape / build-dir / env /
metadata layout; the C4 answer before C1; `--emit build-plan` (with our contents
refinement).

## 5. Sequencing

C0 (lock the emit schema together + consume it + `alp build --plan`, no
execution) can start now in parallel with you scheduling `--emit build-plan`. C1
(single-core Zephyr, real materialise + execute) waits on the C4 answer. Full
phase breakdown in [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md) §5.

## 6. Follow-up requests (CLI side → SDK, 2026-06-04)

Status from our side since the ADR: the consumer is **done and verified** — our
`alp build --plan-from <FILE>` parses your real `--emit build-plan` output (run
on `dev` against `examples/audio/i2s-tone/board.yaml`) and re-serializes it
**semantically identical**; `alp build --materialise` byte-writes the plan's
artefacts (path-traversal-guarded, idempotent). Two things from you unblock the
rest:

1. **Cut a tagged release that includes `--emit build-plan` (ADR 0014).** The
   emit is on `dev` (`ebaa3dd`); per the ADR we pin to **release tags**, not
   `dev`. A tag lets us (a) bump our submodule pin to it, (b) wire the live
   `alp build --plan` (invoke `--emit build-plan` directly), and (c) start the
   parity harness against a stable golden. Until then `--plan` returns a clear
   "awaiting a tagged release" message and we consume via `--plan-from`.
2. **Confirm C4 (conf→build wiring)** — the one item you committed to answer
   before our C1. Your leanings are captured (Zephyr `EXTRA_CONF_FILE` in a
   `generated/` subdir + sysbuild overlays; Yocto `require` fragment with weak
   `?=`; baremetal cmake-args splat). Once it lands we wire **execute** (run each
   slice's `ToolStep`) so the per-slice config is actually applied identically.

Neither blocks you on us: consume + materialise are shipped on our `dev`
([`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md) §5, phases C0 + C1-materialise).

## 7. Future evolution (for discussion): a Rust planner crate

This is **not** a reversal of ADR 0014 — the JSON emit is shipping and our
consumer + materialise are done and verified. It is a forward option to weigh
once the conditions below hold. The `BuildPlan` JSON schema is the insulating
contract, so the planner's _implementation_ can evolve without reworking the
consumer. (This revisits round 1's "shared crate" with the new context: a proven
contract, a phased migration, and an SDK-repo home that resolves the west
dependency-inversion concern.)

### Two variants — only one changes the consumer

- **A — crate replaces the Python planner, still emits JSON.** The SDK rewrites
  the planner as a Rust crate that produces the same `--emit build-plan` output.
  The CLI is unchanged (still consumes JSON via subprocess). No consumer-side
  win; purely the SDK's internal choice — we don't need it.
- **B — the CLI _links_ the crate (Cargo dependency).** The CLI computes the
  plan **in-process**. This is the variant worth discussing, because it delivers
  real wins:
  - **Offline, Python-free, instant planning** — the IDE can show the build plan
    / enrich `board.yaml` editing without the user having bootstrapped the SDK +
    a Python env. Removes today's subprocess + Python-checkout friction at plan
    time.
  - **Compile-time-checked contract** — a fast-moving planner is _safer_ to
    consume as typed Rust (breakage = compile error) than as hand-maintained
    JSON (`schemaVersion` + CHANGELOG discipline, caught only at runtime/parity).
  - **Richer model** — the crate can expose the planner's intermediate model
    (topology, carve-outs, "why this board target") for IDE features the lean
    emit deliberately drops.

### The crux: who owns the moving Rust

B's only real cost is ownership of a fast-moving planner in Rust (~3.5k lines,
doubled in three weeks: partition allocator, sysbuild, TF-M):

- **SDK owns it** — the right home (hardware knowledge lives there), but the SDK
  is a Python team; this is exactly what round 1 rejected. Viable only with
  genuine Rust appetite and/or a planner that is stabilizing.
- **CLI owns it** — that is the round-2 "planner mirror": a second source of
  truth + a standing re-implementation tax. Rejected then, rejected now.

So B is gated on two SDK-side conditions, not a technical blocker: **(1) Rust
appetite on the SDK team, and (2) the planner stabilizing** enough that a Rust
port is not chasing daily churn.

### Migration path (nothing already built is wasted)

Phased + reversible, with the `BuildPlan` JSON schema as the stable seam:

1. **Today** — Python planner → JSON emit → CLI consumer (shipped, verified).
2. **Variant A** — the SDK moves the planner into a Rust crate (in the SDK repo,
   SDK-owned); the emit becomes `crate::build_plan(...).to_json()`. The CLI is
   untouched; west keeps consuming as today.
3. **Variant B** — the CLI adds the crate as a Cargo dependency and computes the
   plan in-process; our `BuildPlan` types become the crate's _output type_
   (reused, not rewritten). The emit stays for west / CI / non-Rust callers.

The west path stays clean: the crate lives in the **SDK** repo, so west calling
its own repo's Rust (a thin binary or a pyo3 binding) is intra-repo — no
cross-repo dependency inversion (the concern that kept `west alp-build` native).

### The ask (a conversation, not a decision)

Two questions for the SDK team:

1. Is there **appetite to own a Rust planner crate**, given the planner's pace?
2. Is the planner **stabilizing** (partition / sysbuild / TF-M settling) enough
   that a port would not be chasing churn?

If both are "yes", B is the cleanest end-state and we would co-design the crate
boundary — a pure `fn build_plan(board_yaml, metadata) -> BuildPlan` published
from the SDK repo, consumed by the CLI (link) **and** the SDK's own
`west alp-build` (binary / pyo3) — one brain, in Rust, two surfaces. If either is
"no", the JSON emit stays the right answer and we revisit later; the consumer we
shipped works unchanged in every case.
