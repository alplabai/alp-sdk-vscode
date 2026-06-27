# alp devbox — hardware-free build / debug-sim verification

A Podman/Docker container that answers one question the unit + contract tests
**cannot**: *does the alp toolchain actually compile firmware, for real, end to
end?* — with **no target hardware**.

It does **real cross/host compilation** of first-party alp SDK examples (not a
build-plan envelope), proves the `alp` CLI hands off to the SDK build path, and
gives the one honest "debug in simulation" story available today.

## What it proves

| Leg | Gating? | What a green means |
|-----|---------|--------------------|
| **1. native_sim build+run** | ✅ gating | The SDK's Zephyr example(s) **actually compile and run** on `native_sim/native/64` via twister (host gcc), wired in exactly as the SDK's `pr-twister.yml` does (`EXTRA_ZEPHYR_MODULES`). Real code, real compiler, real run. |
| **2. alp→west handoff** | ✅ gating | `alp doctor --build` reports the host toolchain ready, and `alp build --plan` drives the SDK orchestrator across the ADR-0014 JSON seam to a real build-plan. Proves the **CLI** seam, which the SDK alone can't (it has no `alp` binary). |
| **3. host-gdb debug-sim** | ✅ gating | The `native_sim` build is a native host ELF, so plain host **gdb** attaches, breaks at `main`, and inspects state — debug with no probe, no JTAG, no hardware. |
| **4. generic-Cortex Renode** | ⚠️ advisory | A **generic** Cortex-M (nRF52840, Cortex-M4) boots Zephyr under Renode and prints `Hello World` over emulated UART. A **STAND-IN**, *not* the real silicon — see the honesty box below. |

### ⚠️ Honesty box — what leg 4 is NOT

The Renode leg boots a **generic ARM Cortex-M core** (nRF52840 / Cortex-M4 by
default), not an Alif / Renesas / NXP SoC — and not even the same ARM profile
(the alp M-cores are Cortex-M33 / M55 = ARMv8-M). It deliberately models **none**
of what makes those parts interesting:

- **No** Ethos-U NPU (Alif), **no** DRP-AI (Renesas).
- **No** heterogeneous Cortex-A + Cortex-M boot / RPMsg handshake.

A green there means *"a generic ARM Cortex-M boots Zephyr in simulation"* —
nothing about the vendor silicon, its accelerators, or dual-OS bring-up. This
mirrors the SDK's own `pr-renode-dual-os.yml`: **advisory, continue-on-error,
never a gate.** Faithful silicon debug requires a real EVK (the SDK's nightly HIL
path). Renode here is **1.16.1** (first release with a native arm64 build); the
SDK's own x86 CI pins 1.15.3 — independent of this stand-in.

## Run it

Requires Podman (or set `ENGINE=docker`). From this directory:

```bash
make verify          # build the gating image + run legs 1–3 vs the checked-out SDK
make verify-renode   # also build the arm+Renode image + run the advisory leg 4
make shell           # poke around inside (SDK mounted at /work/alp-sdk)
```

`make verify` prints a summary and exits non-zero iff a **gating** leg fails
(the advisory Renode result never affects the exit code).

## How it's wired (and why)

- **The SDK is bind-mounted, not baked in.** `-v <repo>/alp-sdk-upstream:/work/alp-sdk:ro`
  — the proof reflects the **exact checked-out submodule SHA** (printed by the
  preflight) and survives SDK edits without an image rebuild. The submodule is
  known to drift in CI, so the suite stamps the SHA it verified.
- **`alp` is compiled inside the image.** The host's `cli-rs/target/release/alp`
  is a macOS mach-o and can't run in a linux container, so stage 1 cargo-builds
  the linux `alp` from this repo's `cli-rs` workspace.
- **native_sim uses host gcc** (`ZEPHYR_TOOLCHAIN_VARIANT=host`), exactly like
  `pr-twister.yml` — no multi-GB Zephyr SDK on the gating path. The arm
  toolchain + Renode live **only** in the separate `devbox-renode` target, so
  that heavy/fiddly leg can never break the core proof.

## Where this lives, and why (CLI vs SDK)

Per **ADR 0014** the **SDK** owns the build (`alp_orchestrate.py` + `west
alp-build`); the **CLI** consumes it across the JSON seam. So the *canonical*
home for a real-compile gate is the SDK — which already has it in
`pr-twister.yml`. This devbox is the **CLI-side** counterpart: it reuses the
SDK's exact native_sim recipe to get a reproducible local/dev proof, and adds the
**one thing only the CLI repo can prove** — that `alp` itself drives that build
path (leg 2). It does **not** re-implement the SDK's toolchain matrix; the Zephyr
pin is the SDK's (`v4.4.0`), passed as a build arg.

It is a **dev/CI artifact only** — `cli-rs/**` is excluded from the VSIX, so this
never ships to users.

## Tunables (build args / env)

| Knob | Default | Purpose |
|------|---------|---------|
| `--build-arg ZEPHYR_VERSION` | `v4.4.0` | Zephyr release (track the SDK's `west.yml`). |
| `-e DEVBOX_EXAMPLES` | `peripheral-io/hello-world uart-hello-world` | which example suites leg 1 builds. |
| `-e DEVBOX_HANDOFF_EXAMPLE` | `peripheral-io/hello-world` | board.yaml leg 2 plans. |
| `-e RENODE_BOARD` / `RENODE_REPL_SRC` / `RENODE_UART` | `nrf52840dk/nrf52840` | generic core for leg 4 (must be a board both Renode and Zephyr support; the repl's `ApplySVD` network fetch is stripped for an offline boot). |
