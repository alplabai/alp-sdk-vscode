<!-- SPDX-License-Identifier: Apache-2.0 -->

# Note to the SDK team: the `alp` CLI is taking build orchestration

**Audience:** the alp-sdk (firmware) team.
**Author:** the alp-sdk-vscode (IDE + native `alp` CLI) team.
**Status:** decided direction (CLI side). This asks **nothing** new of you; it
records what we are building and the small, already-existing contract we depend
on, so there are no surprises.

**TL;DR:** We are moving build orchestration **into the `alp` CLI**. The CLI sits
at the top, computes the build plan from `board.yaml` + your metadata, and
invokes `west` / `bitbake` / `cmake` directly. `scripts/alp_orchestrate.py` stops
being a runtime dependency for the CLI/IDE — we read it only as a **reference
spec**. **You do not need to orchestrate on our behalf, extract a shared crate,
or keep a "build brain" wired for us.** What we need from you is only that the
data + tools you already ship stay stable and versioned. Our implementation plan
is in [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md).

> This supersedes the earlier RFC framing ("extract `alp_orchestrate.py` into a
> shared `alp-build-core` crate that both `west alp-build` and the CLI consume").
> After reading the orchestrator end to end, that coordination is unnecessary:
> the executor is trivial and the planner is schema logic we already own. The CLI
> can own orchestration unilaterally without forking any vendor execution logic.

---

## 1. Why we no longer need you to orchestrate

We read `scripts/alp_orchestrate.py` (1547 lines) in full. It is a **planner with
a trivial executor**, not a vendor-execution engine:

- The entire build executor is three commands (`alp_orchestrate.py:1440-1465`):
  `west build -b <board> <app>` · `bitbake <image|app>` · `cmake -S <app> -B
  <dir>` — each run with `cwd = build/<core>-<os>/`, `env += ALP_SDK_ROOT`, output
  to `build.log`. **No signing / `imgtool` / `objcopy` / partition packaging in
  the build path.**
- The "brain" is the **planner**: `board.yaml` → per-core slices (backend, board,
  machine, toolchain, app, build dir), IPC carve-outs, DTS reservations, boot
  order, helper MCUs. That is **schema semantics over data you own** — and our
  Rust `alp-core` already parses `board.yaml` v2 + the SoM catalogue, so it is an
  extension of existing code, not a port of yours.
- Flash (`scripts/flash_backends/`, `west alp-flash`) is a **separate**, in-code
  "subsequent PRs" concern — still stubs. We leave it with you.

So the CLI can drive builds directly without reimplementing anything
vendor-specific. We are **not** forking your build logic — there is no execution
logic to fork; we reproduce a command sequence.

## 2. What this means for the SDK side

| Thing | Before | After |
|---|---|---|
| `alp_orchestrate.py` as the CLI/IDE's build brain | runtime dependency (via `west alp-build`) | **reference only** — not called by the CLI |
| `west alp-build` | owns orchestration | **your call**: keep as-is for `west` users, or make it a thin shim over `alp build` later |
| `metadata/**`, `board.yaml` schema | SDK-owned data | **unchanged** — still yours, still the source of truth |
| `west` workspace, `meta-alp-sdk`, vendor CMake toolchains | the actual builders | **unchanged** — we invoke them, never replace them |
| Yocto layer / CMake helpers / vendor glue | SDK | **unchanged** |

Nothing in your repo has to change for the CLI to work. `west alp-build` and
`alp_orchestrate.py` can stay exactly as they are; the CLI simply no longer
routes through them.

## 3. The contract we depend on (please keep these stable)

We consume four stable seams that already exist. None is new work for you — the
ask is only **stability + versioning**.

### C1 — `board.yaml` schema (the planner's primary input)

We vendor your board schema (`schemas/board.schema.json`) and track it. Per-core
`os`, app/image, peripherals, libraries, IPC, and SoM `sku` are what the planner
reads. Breaking shape changes should bump the schema version (as today).

### C2 — `metadata/**` (per-core type → backend + targets)

`metadata/e1m_modules/<E1M-…>{.yaml | /som.yaml}` (sku, family, display_name,
topology, cores, boot_order), `metadata/chips/`, `metadata/soc-spec/`. The
per-core **type → backend** mapping and board/machine/toolchain resolution come
from here — exactly where hardware knowledge belongs. Please keep the
`schema_version` on the e1m_modules YAMLs. (Our CLI already parses both the flat
and the `…/som.yaml` directory layouts.)

### C3 — the build tools' invocation contract

We invoke `west build` / `bitbake` / `cmake` the way the orchestrator does today.
If you change the per-slice command shape (flags, build-dir convention, env), a
heads-up keeps our parity harness green.

### C4 — per-slice config → build consumption (the one open item)

The orchestrator writes `alp.conf` / `local.conf` / `cmake-args.txt` per slice,
but the build command does not yet obviously consume them ("Phase 3 wires this
up" in-code). **When you finalize how that config feeds each build, tell us** —
we will materialize and apply it identically. This is the only place where your
roadmap and ours genuinely intersect.

## 4. How we keep honest (parity harness)

`alp_orchestrate.py` is deterministic and supports `--emit
{system-manifest|ipc-contract-h|dts-reservations}` plus per-slice config
materialization. We diff the CLI's plan against the script's output (config +
shared artefacts + `system-manifest.yaml` + the exact per-slice command) for a
`board.yaml` × SoM fixture matrix — committed goldens, `--bless` to refresh, in
the spirit of our existing `cli-rs/contract/run.sh`. **Your script stays the
reference of record**; if it changes, our harness flags the drift. This is how we
guarantee we match your intent without depending on your code at runtime.

## 5. What we'd value from you (optional, not blocking)

1. A pointer to the **intended per-slice config → build wiring** (C4) so we match
   it from day one.
2. A heads-up if the **per-slice command shape** (C3) or **metadata layout** (C2)
   changes in a release.
3. Later, if useful to `west` users: we are happy to make `west alp-build` a thin
   shim over `alp build` so there is one orchestration path — but that is your
   call and not required for us.

That's all. We own the orchestration; you keep owning the hardware knowledge and
the builders. See [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md) for the
phased plan and the exact `BuildPlan` shape we compute.
