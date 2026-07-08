# Debug Support Matrix and Launch Design

Last revised: 2026-05-14

This document defines how debugging should work across the ALP SDK
extension, the ALP SDK itself, and the supported target classes.

The key design rule is simple:

**The extension does not become a debugger. It becomes a debugger-aware
orchestrator that can generate, validate, inspect, and launch the right
debug configuration for the active target.**

## 1. Why Debug Is a First-Class Requirement

The ALP SDK is not only a configuration/generation product. It is also
used for:

- SoM bring-up
- peripheral driver development
- firmware integration
- bridge firmware flashing and recovery
- validation on real hardware

That means the product must support workflows such as:

- build + flash + halt
- flash and debug
- attach to a running target
- place breakpoints and step code
- inspect memory/registers/peripherals
- inspect effective config and generated build decisions
- capture enough environment state to troubleshoot failed debug sessions

Without these flows the SDK remains usable for generation, but not for
real bring-up or low-level firmware development.

## 2. Supported Debug Classes

The product should not treat all debug scenarios as the same class of
problem. There are three classes.

### 2.1 MCU Debug

Used for:

- Zephyr targets
- bare-metal targets
- SWD/JTAG bring-up
- flash / halt / single-step / breakpoint workflows

Primary adapter strategy:

- `marus25.cortex-debug`

Companion IDE viewers:

- `mcu-debug.peripheral-viewer` for SVD-backed peripheral/register views
- `mcu-debug.memory-view` for low-level memory inspection

Primary server/probe backends:

- `J-Link`
- `OpenOCD`
- `pyOCD` (optional)

### 2.2 Linux Userspace Debug

Used for:

- Yocto userspace applications
- remote symbolized debug over SSH / `gdbserver`

Primary adapter strategy:

- `cppdbg` + `gdbserver`

Optional later strategy:

- `lldb-dap`

### 2.3 Host / Native Debug

Used for:

- `native_sim`
- host-side tools
- generator helpers and local binaries

Primary adapter strategy:

- `CodeLLDB`

## 3. Debug Support Matrix

| Target class | OS/backend | Primary tool | Probe/server | Breakpoints | Flash support | Attach support | Current repo state | Planned product support |
| ------------ | ---------- | ------------ | ------------ | ----------- | ------------- | -------------- | ------------------ | ----------------------- |
| MCU | Zephyr | `cortex-debug` | J-Link | Yes | Yes | Yes | Indirect/manual | First-class |
| MCU | Zephyr | `cortex-debug` | OpenOCD | Yes | Yes | Yes | Indirect/manual | First-class |
| MCU | Zephyr | `cortex-debug` | pyOCD | Yes | Yes | Yes | Not documented | Optional |
| MCU | baremetal | `cortex-debug` | J-Link | Yes | Yes | Yes | Indirect/manual | First-class |
| MCU | baremetal | `cortex-debug` | OpenOCD | Yes | Yes | Yes | Indirect/manual | First-class |
| MCU | baremetal | `cortex-debug` | pyOCD | Yes | Yes | Yes | Not documented | Optional |
| Linux userspace | Yocto | `cppdbg` | `gdbserver` | Yes | n/a | Yes | Not productized | First-class |
| Linux userspace | Yocto | `CodeLLDB` | `lldb-dap` / remote | Partial | n/a | Yes | Not documented | Deferred |
| Host/native | `native_sim` | `CodeLLDB` | local | Yes | n/a | Yes | Not productized | First-class |
| Bridge recovery | Zephyr/baremetal host -> GD32 | External tools | J-Link / OpenOCD | Tool-dependent | Yes | Partial | Documented manually | First-class flashing, later debug assist |
| Host-driven bridge recovery | Zephyr/baremetal host -> GD32 | SDK SWD bit-bang | none external | No debugger semantics today | Yes | No | Partial code/documentation | Recovery feature, not primary debug path |

### 3.1 Support-Level Definitions

- First-class: actively maintained end-to-end flow with explicit product
  ownership.
- Optional: supported path when available, but not required for
  baseline release readiness.
- Deferred: planned/documented path without immediate release
  commitment.

Maintenance rule: when debug capabilities change, this matrix and its
support level labels must be updated in the same change set.

## 4. What the Current Repos Already Tell Us

The current repositories already point toward the correct strategy.

### 4.1 Signals already present

- The SDK recommends `marus25.cortex-debug` in the upstream VS Code
  workspace recommendations.
- The docs already treat J-Link and OpenOCD as expected SWD tools for
  flashing the GD32 bridge and related bring-up work.
- HIL docs mention J-Link, `pyocd`, and `gdbserver` as part of the real
  lab/tooling environment.

### 4.2 What is still missing

- Launch profile generation is still placeholder-heavy and does not yet
  resolve project-specific device/probe values automatically.
- Debug commands exist (`inspect`, `doctor`, `configure profile`) but
  are still MVP-level and need richer UX flows.
- Explicit first-class support claims for `cortex-debug`, `cppdbg`, and
  `CodeLLDB` still need end-to-end workflow hardening.
- Shared inspect/trace/support-bundle models now exist in the core, but
  export workflows and guided support-bundle UX are still pending.

## 5. Product Strategy

The correct product strategy is:

1. **Use `cortex-debug` as the primary MCU debug story.**
2. **Use `cppdbg` + `gdbserver` as the primary Yocto userspace debug
   story.**
3. **Use `CodeLLDB` as the primary host/native debug story.**
4. **Use MemoryView and MCU Peripheral Viewer for low-level memory,
   register, and peripheral inspection.**
5. **Generate or provide debug configurations instead of reinventing a
   debugger.**
6. **Make debug preflight and troubleshooting part of the product.**

## 6. Surface Ownership

The debug product needs clear surface ownership so behavior does not
split across UI, CLI, and LSP in inconsistent ways.

| Capability | VS Code UI | CLI | LSP |
| ---------- | ---------- | --- | --- |
| Select debug target/profile | Primary | Secondary through flags | No |
| Generate launch configuration | Primary | Secondary through export/generate commands | No |
| Start or attach debug session | Primary | Secondary for headless preparation flows | No |
| Run preflight / doctor | Entry point and result rendering | Primary automation surface | Explain-only hooks |
| Inspect effective config | Preview and troubleshooting panel | Primary text/JSON surface | Inline explain/peek surface |
| Inspect generation trace | Preview and troubleshooting panel | Primary text/JSON surface | Inline explain/peek surface |
| Export support bundle | Guided action | Primary automation surface | No |
| Hover / completion / quick fix | No | No | Primary |
| Explain why a field resolved a certain way | Secondary read-only UI view | Secondary textual output | Primary inline/editor surface |

### 6.1 VS Code UI Ownership

The UI owns guided and interactive flows:

- choose the active debug target
- select probe/server type
- preview launch configuration before write
- trigger `flash + debug` or `attach`
- render doctor/preflight failures in a guided way
- expose debug summaries and support-bundle export

### 6.2 CLI Ownership

The CLI owns automation and headless flows:

- emit inspect output
- emit generation traces
- run doctor/preflight checks in CI or terminals
- export support bundles
- generate debug configuration artifacts without opening VS Code

### 6.3 LSP Ownership

The LSP owns editor intelligence only:

- diagnostics
- hover and completion
- quick fixes
- field-level explainability
- navigation to preset origins, generated artifacts, and related
  config sources

## 7. LSP Scope and Non-Goals

The LSP should help the user understand debug-relevant configuration,
but it must not become a debug launcher.

### 7.1 LSP Scope

The LSP may:

- explain resolved debug-related values
- show preset origin and inheritance details
- provide quick fixes for invalid or incomplete debug-relevant config
- navigate from config fields to referenced presets or generated output
- expose command-backed read-only previews for inspect and trace data

### 7.2 LSP Non-Goals

The LSP must not:

- start debug sessions
- generate or mutate `launch.json` directly as editor side effects
- own probe detection or tool discovery logic
- run flashing operations
- become the primary surface for doctor or support-bundle export

If the user needs to launch, attach, flash, or export, the LSP should
delegate to UI or CLI entry points rather than reimplementing them.

## 8. Launch Configuration Design

Two product approaches are valid:

1. generate `launch.json` entries on demand
2. provide dynamic debug configurations through a VS Code debug
   provider

The recommended path is:

- MVP: generate `launch.json` profiles and keep them inspectable
- later: add dynamic profile generation once the model stabilizes

Current implementation follows the MVP path: `alp.configureDebugProfile`
writes or updates `launch.json` entries from generated launch drafts.

## 9. Shared Debug Model

The shared core should own a debug-profile model so UI, CLI, and any
future LSP commands can all consume the same resolved configuration.

```ts
type DebugTargetKind =
  | "zephyr-mcu"
  | "baremetal-mcu"
  | "yocto-userspace"
  | "native-host";
type DebugAdapterKind = "cortex-debug" | "cppdbg" | "codelldb";
type DebugServerKind = "jlink" | "openocd" | "pyocd" | "gdbserver" | "none";

interface DebugProfile {
  id: string;
  name: string;
  os: "zephyr" | "baremetal" | "yocto" | "host";
  targetKind: DebugTargetKind;
  adapter: DebugAdapterKind;
  server: DebugServerKind;
  executablePath: string;
  cwd: string;
  preLaunchTask?: string;
  device?: string;
  interface?: "swd" | "jtag";
  svdFile?: string;
  openOcdConfigFiles?: string[];
  targetId?: string;
  miMode?: "gdb";
  miDebuggerPath?: string;
  miDebuggerServerAddress?: string;
  setupCommands?: Array<{ text: string }>;
  remoteHost?: string;
  remotePort?: number;
}
```

## 10. MVP Launch Profiles

These are the minimum launch profile families the product should be
able to generate.

### 10.1 Zephyr + Cortex-Debug + J-Link

```json
{
  "name": "ALP: Zephyr Debug (J-Link)",
  "type": "cortex-debug",
  "request": "launch",
  "servertype": "jlink",
  "cwd": "${workspaceFolder}",
  "executable": "${workspaceFolder}/build/app/zephyr/zephyr.elf",
  "device": "<resolved-device>",
  "interface": "swd",
  "runToEntryPoint": "main",
  "preLaunchTask": "alp: build active target"
}
```

### 10.2 Zephyr + Cortex-Debug + OpenOCD

```json
{
  "name": "ALP: Zephyr Debug (OpenOCD)",
  "type": "cortex-debug",
  "request": "launch",
  "servertype": "openocd",
  "cwd": "${workspaceFolder}",
  "executable": "${workspaceFolder}/build/app/zephyr/zephyr.elf",
  "configFiles": ["<resolved-openocd-board-cfg>"],
  "runToEntryPoint": "main",
  "preLaunchTask": "alp: build active target"
}
```

### 10.3 Baremetal + Cortex-Debug + J-Link

```json
{
  "name": "ALP: Baremetal Debug (J-Link)",
  "type": "cortex-debug",
  "request": "launch",
  "servertype": "jlink",
  "cwd": "${workspaceFolder}",
  "executable": "${workspaceFolder}/build/baremetal/app.elf",
  "device": "<resolved-device>",
  "interface": "swd",
  "svdFile": "<resolved-svd>",
  "runToEntryPoint": "main",
  "preLaunchTask": "alp: build baremetal target"
}
```

### 10.4 Yocto Userspace + cppdbg + gdbserver

```json
{
  "name": "ALP: Yocto Remote Debug",
  "type": "cppdbg",
  "request": "launch",
  "program": "${workspaceFolder}/build/yocto/app",
  "cwd": "${workspaceFolder}",
  "MIMode": "gdb",
  "miDebuggerServerAddress": "<host>:<port>",
  "miDebuggerPath": "<resolved-gdb>",
  "setupCommands": [
    { "text": "-enable-pretty-printing" }
  ],
  "preLaunchTask": "alp: deploy and start gdbserver"
}
```

### 10.5 Native Sim / Host Binary + CodeLLDB

```json
{
  "name": "ALP: Native Sim Debug",
  "type": "codelldb",
  "request": "launch",
  "program": "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
  "cwd": "${workspaceFolder}",
  "preLaunchTask": "alp: build native_sim target"
}
```

## 11. Product Commands to Support Debug

The extension should eventually expose these commands:

- `Alp: Configure debug profile`
- `Alp: Debug preflight`
- `Alp: Start debug`
- `Alp: Flash and debug`
- `Alp: Attach to running target`
- `Alp: Debug doctor`
- `Alp: Open debug panel`
- `Alp: Export support bundle`

The CLI should eventually expose:

- `alp inspect`
- `alp trace`
- `alp doctor`
- `alp support-bundle`

## 12. Debug Preflight Requirements

Before launching any debug session, the product should be able to
validate:

- active OS/backend
- target class
- build output exists and ELF path is valid
- expected debugger extension is installed
- selected probe/server tool exists
- required paths such as SVD or OpenOCD config are valid
- target connection info exists for remote userspace debug

If preflight fails, the product should not attempt a debug launch. It
should explain the failure and offer the next action.

Current implementation status:

- `Alp: Debug preflight` emits a structured preflight report with
  actionable checks.
- `Alp: Debug doctor` emits environment and compatibility diagnostics.
- `Alp: Configure debug profile` remains draft-oriented (`launch.json`
  generation) and does not start debugger sessions.

## 13. Support-Bundle Design

When a user files a debug issue, the product should be able to export a
bundle containing:

- effective config summary
- selected debug profile
- build artifact paths
- tool versions
- extension version
- selected probe/server type
- debug preflight results
- recent trace output

This bundle must avoid secrets and user-sensitive credentials by
default.

Current implementation status:

- `Alp: Export support bundle` writes a JSON bundle under
  `.alp-support/` including inspect snapshot, doctor summary, and
  preflight results.

## 14. Recommended Delivery Order

### Phase A — Foundation

1. Add the shared debug model.
2. Add debug support matrix to docs.
3. Add generated `launch.json` support for Zephyr + J-Link.
4. Add debug preflight for Zephyr + J-Link.

### Phase B — Core MCU Coverage

1. Add OpenOCD support.
2. Add baremetal launch generation.
3. Add VS Code debug-profile selection UI.
4. Add support-bundle export.

### Phase C — Broader Target Coverage

1. Add Yocto userspace remote debug.
2. Add native_sim / CodeLLDB generation.
3. Add debug panel and inspect/trace integration.

## 15. Recommended First Deliverable

The first shippable debug milestone should be:

- Zephyr targets
- `cortex-debug`
- J-Link
- generated `launch.json`
- debug preflight
- basic troubleshooting output

This gives the product a credible hardware-debug story quickly without
forcing it to solve every target class at once.
