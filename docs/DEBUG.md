# Debug Support Matrix and Launch Design

Last revised: 2026-07-27

## Companion extensions (bundled)

Alp IDE declares two hard `extensionDependencies`. VS Code installs both with
Alp IDE and will not enable Alp IDE without them:

- `redhat.vscode-yaml` — board.yaml schema validation. Nothing to do with
  debugging; it is required because schema-aware editing is the extension's
  other half.
- `marus25.cortex-debug` — the adapter every generated MCU launch config names.
  Without it the configuration Alp IDE writes is inert.

**cortex-debug brings the rest of the debug surface itself.** Its own manifest
(v1.12.1, identical on the Marketplace and Open VSX) declares:

```
Microsoft.VisualStudio.Code.ExtensionDependencies =
  mcu-debug.debug-tracker-vscode,mcu-debug.memory-view,
  mcu-debug.rtos-views,mcu-debug.peripheral-viewer
```

So the memory inspector, the RTOS thread views, and the SVD peripheral view are
all force-installed transitively and cannot be removed while cortex-debug is
present. Listing any of them here would be redundant — and listing
`peripheral-viewer` as "optional" would be false, since nothing can opt out of
it.

**Installed is not the same as attached, and which one you get depends on the
debug type.** Each of these views gates itself on the running session, so the
`native-host` profile — the only one that emits `type: lldb` — reaches a
different set than the MCU profiles do. Measured against the installed
manifests:

| View | Extension | Gate | On a `type: lldb` session |
| ---- | --------- | ---- | ------------------------- |
| MEMORY | `mcu-debug.memory-view` 0.0.29 | `activationEvents`: `cortex-debug`, `mcu-debug`, `cppdbg`, `cspy`, `gdb`, three vendor gdb targets — no `lldb` | does not auto-activate |
| xRTOS | `mcu-debug.rtos-views` 0.0.16 | same shape, no `lldb` | does not auto-activate |
| XPeripherals | `mcu-debug.peripheral-viewer` 1.6.1 | `onDebug` + `when: mcu-debug.peripheral-viewer.hadData` | activates, view stays hidden |
| Cortex Live Watch | `marus25.cortex-debug` 1.12.1 | `when: debugType == cortex-debug` | not rendered |

Only XPeripherals matches the "installed but empty" description, and only
because its activation is `onDebug` rather than a debug-type list; it stays
hidden until SVDs ship (alp-sdk#948). MEMORY and xRTOS are a different case on
this path — absent rather than empty, because CodeLLDB's debug type is not in
their activation lists. The underlying capability is still there: a CodeLLDB
session advertises `supportsReadMemoryRequest: true` and serves `readMemory`,
so the panel works once opened by command; it just does not come up on its own.

None of this is Alp IDE's to change — the activation lists belong to the
mcu-debug extensions — but a customer told to "open the Memory view" on
native_sim will not find it waiting for them, and that is worth saying here
rather than leaving to be rediscovered.

`extensionDependencies` is a hard gate: an id missing from the registry a given
editor installs from makes Alp IDE impossible to install at all, not merely
degraded. `scripts/check-extension-deps.mjs` runs in CI against **both** the VS
Code Marketplace and Open VSX so that cannot happen silently.

Engine floors are all below this extension's own `^1.85.0` (cortex-debug
`^1.69.0`; the mcu-debug family `^1.75.0`), so none of this locks out a
supported VS Code.

### Recommended (`package.json` `extensionPack`)

Installed alongside, removable — each serves a target class a given project may
never touch:

- `ms-vscode.cpptools` — C/C++ IntelliSense + `cppdbg` (Yocto/A-core remote gdb)
- `vadimcn.vscode-lldb` — CodeLLDB (native_sim host debug)

`ms-vscode.cpptools` in particular can never be promoted to a hard dependency:
it is not published on Open VSX (404), so requiring it would make Alp IDE
impossible to install on VSCodium / code-server / Windsurf.

## One-click debug: `Alp: Debug`

`alp.debug` (Build & Flash view → **Debug**, or the command palette) is the
first-class entry point: it prompts for the target/server, writes/refreshes the
launch profile, ensures the required debug-adapter extension is present, then
calls `vscode.debug.startDebugging`. For `cortex-debug` that check can only fail
if a user DISABLED it — as an `extensionDependency` it cannot be missing, and
`vscode.extensions.getExtension` reports disabled and absent identically. The
prompt currently offers **Install**, which is a no-op in that state; the
cppdbg/CodeLLDB adapters are `extensionPack` entries and can genuinely be
absent, where Install is the right action.
`alp.configureDebugProfile` still writes the profile without starting a session.



This document defines how debugging should work across the Alp SDK
extension, the Alp SDK itself, and the supported target classes.

The key design rule is simple:

**The extension does not become a debugger. It becomes a debugger-aware
orchestrator that can generate, validate, inspect, and launch the right
debug configuration for the active target.**

## 1. Why Debug Is a First-Class Requirement

The Alp SDK is not only a configuration/generation product. It is also
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

- `CodeLLDB` (vadimcn.vscode-lldb — debug type `lldb`)

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
4. **Generate or provide debug configurations instead of reinventing a
   debugger.**
5. **Make debug preflight and troubleshooting part of the product.**

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
writes or updates `launch.json` entries. The configuration itself comes from
`tan debug-config` (tan-cli#67), which resolves `device` / `gdbPath` /
`serverpath` / `searchDir` / `configFiles` from the build's own `runners.yaml`
and writes the file; the extension keeps **no** second draft, because two
drafts in two languages is exactly what shipped users a `launch.json` that
could not start a session (#339). Requires `tan` >= the pinned
`SUPPORTED_CLI_VERSION` (`src/alpCli/service.ts`) — an older binary carries no
`data.configuration` and the command reports version skew instead of writing.

What stays in-process is the readiness report: it probes which debugger
extensions are installed, host state a separate process cannot observe
(`docs/EXTENSION_CLI_INTEGRATION.md` §4a).

## 9. Shared Debug Model

The shared core should own a debug-profile model so UI, CLI, and any
future LSP commands can all consume the same resolved configuration.

```ts
type DebugTargetKind =
  | "zephyr-mcu"
  | "baremetal-mcu"
  | "yocto-userspace"
  | "native-host";
// VS Code *debug type* strings, as registered in each adapter extension's own
// `contributes.debuggers` — not extension names: `cortex-debug` is
// marus25.cortex-debug, `cppdbg` is ms-vscode.cpptools, and `lldb` is
// vadimcn.vscode-lldb (the extension is *named* CodeLLDB; `codelldb` is not a
// debug type at all).
type DebugAdapterKind = "cortex-debug" | "cppdbg" | "lldb";
type DebugServerKind = "jlink" | "openocd" | "pyocd" | "gdbserver" | "none";

interface DebugProfile {
  id: string;
  name: string;
  os: "zephyr" | "baremetal" | "yocto" | "host";
  targetKind: DebugTargetKind;
  adapter: DebugAdapterKind;
  server: DebugServerKind;
  executablePath: string;
}
```

That is the whole of it. `DebugProfile` describes the session the extension is
REPORTING ON, not a launch configuration: `executablePath` is here because
`buildDebugPreflightReport` stats the ELF, which is a fact about this machine.
It used to carry `device`, `interface`, `svdFile`, `openOcdConfigFiles`,
`targetId`, `miMode`, `miDebuggerPath`, `miDebuggerServerAddress`,
`setupCommands` and `cwd` as well, all hardcoded constants of
`(targetKind, server)` — see §12 for why grading those was #339. The
configuration keys are tan's; §10 shows what it writes.

## 10. MVP Launch Profiles

These are the minimum launch profile families the product should be
able to generate.

### 10.1 Zephyr + Cortex-Debug + J-Link

```json
{
  "name": "Alp: Zephyr Debug (J-Link)",
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
  "name": "Alp: Zephyr Debug (OpenOCD)",
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
  "name": "Alp: Baremetal Debug (J-Link)",
  "type": "cortex-debug",
  "request": "launch",
  "servertype": "jlink",
  "cwd": "${workspaceFolder}",
  "executable": "${workspaceFolder}/build/baremetal/app.elf",
  "device": "<resolved-device>",
  "interface": "swd",
  "runToEntryPoint": "main",
  "preLaunchTask": "alp: build baremetal target"
}
```

No `svdFile` key: cortex-debug *opens* that path, so an unresolved
`"<resolved-svd>"` placeholder would be read as a filename and kill a session
that preflight only warned about. The key is emitted only once a real file
resolves (see §12).

### 10.4 Yocto Userspace + cppdbg + gdbserver

```json
{
  "name": "Alp: Yocto Remote Debug",
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
  "name": "Alp: Native Sim Debug",
  "type": "lldb",
  "request": "launch",
  "program": "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
  "cwd": "${workspaceFolder}",
  "preLaunchTask": "alp: build native_sim target"
}
```

`vadimcn.vscode-lldb` registers the debug type `lldb` in
`contributes.debuggers`; `CodeLLDB` is the extension's *name* and `codelldb` is
never a debug type — VS Code rejects such a config with `configured debug type
'codelldb' is not supported`.

Driven end to end against a real CodeLLDB 1.12.2 adapter and a `native_sim`
build of Zephyr v4.4.0, this configuration verifies a source breakpoint, hits
it inside the application's own `main`, and reports live locals with real
values:

```
stopped reason=breakpoint
  main            @ samples/basic/blinky/src/main.c:44
  bg_thread_main  @ kernel/init.c:347
  z_thread_entry  @ lib/os/thread_entry.c:60
  posix_arch_thread_entry @ arch/posix/core/thread.c:124
locals: ret = 0 (int)   led_state = false (bool)
```

Two behaviours are worth knowing before they surprise someone:

- **The first `stopped` event is not yours.** `zephyr.exe` is a dynamically
  linked host executable, so the run stops at the loader rendezvous
  (`__GI__dl_debug_state`) before reaching application code, and it stops first
  in the native simulator's own `main`
  (`scripts/native_simulator/common/src/main.c`) rather than the application's.
  A client that assumes the first stop is its breakpoint reports the wrong
  location.
- **Scalar locals carry `memoryReference: 0x0`.** Zephyr builds `-Os`, so
  `ret` and `led_state` live in registers with no address to hand out. Their
  *values* are correct and are not `<optimized out>` — but "view memory of this
  variable" has nothing to point at. Reading by address works normally
  (`readMemory` at `rsp`/`rip`/`rbp` returns bytes), which is the Memory view's
  primary mode anyway.

See the companion-extensions section above for which debug views attach to an
`lldb` session and which do not.

### 10.6 The `preLaunchTask` names above

Every profile in §10 references a pre-launch task by label. VS Code renders a
provider-contributed task's label as `${source}: ${name}`, so those labels
resolve only while something contributes them — an unresolvable
`preLaunchTask` aborts the pre-launch and `vscode.debug.startDebugging`
returns `false` with no useful error, pointing the user at a `launch.json`
that looks perfectly fine.

The extension contributes all four (`src/tasks/service.ts` holds the string
contract, `src/tasks/vscodeAdapter.ts` the VS Code seam, task type + source
`alp`):

| label                             | runs                                          |
| --------------------------------- | --------------------------------------------- |
| `alp: build active target`        | `tan build`                                   |
| `alp: build baremetal target`     | `tan build`                                   |
| `alp: build native_sim target`    | `tan build`                                   |
| `alp: deploy and start gdbserver` | nothing — reports the manual step, exits **1** |

The three build labels run the identical command because `tan build` has no
per-target selector: it builds every slice `board.yaml` declares. Three labels
exist because three debug-target classes reference them under different names.

`alp: deploy and start gdbserver` has no `tan` equivalent — the extension has
no deploy story, and §10.4's profile ships `miDebuggerServerAddress:
"<host>:<port>"` for the user to fill in by hand. It deliberately fails rather
than faking success, so VS Code raises its "the preLaunchTask terminated with
exit code 1 — Debug Anyway / Show Errors" dialog with the manual step named,
instead of dropping the user into a cppdbg session with no gdbserver on the
other end.

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

- `tan inspect`
- `tan trace`
- `tan doctor`
- `tan support-bundle`

## 12. Debug Preflight Requirements

Before launching any debug session, the product should be able to
validate:

- active OS/backend
- target class
- build output exists and ELF path is valid
- expected debugger extension is installed
- selected probe/server tool exists
- required paths such as the OpenOCD config are valid
- target connection info exists for remote userspace debug

**Where each of those is decided (#339).** Bullets 3–5 are the extension's:
`buildDebugPreflightReport` in `packages/alp-core/src/debug/service.ts` grades
them as `buildArtifact`, `adapterExtension` and `serverTool`, alongside
`workspaceRoot`, `boardYaml` and the native-host `hostPlatform` gate this list
predates. That is an OWNERSHIP split, not an observability one — only
`adapterExtension` is out of a separate process's reach (which debugger
extensions this VS Code host has installed); tan reads the build tree, so
bullet 3 is perfectly observable from outside.

Bullets 1–2 get no check in that function at all. The active OS/backend and the
target class come out of the picker and are carried as the report's own
`targetKind` / `server` metadata; the one judgement made about the pair,
`serverCompatibility`, lives in `buildDoctorReport`.

The last two are configuration VALUES, and `tan debug-config` resolves them
from the build's own `runners.yaml` — so they are graded against the
configuration tan actually wrote, by `foldLaunchConfigPlaceholders`, and
nowhere else.

That split is the fix for #339, not a refactor. The preflight report used to
grade a second, in-process draft as well: `createDebugProfile` filled `device`
with the hardcoded literal `"<resolved-device>"`, `openOcdConfigFiles` with
`"<resolved-openocd-board-cfg>"` and so on, so the matching checks failed for
every project on earth — including one whose `launch.json` tan had fully
resolved. The customer got a working `launch.json` and a "not launchable"
verdict with a Start Anyway gate in front of it. `DebugProfile` no longer
carries any configuration value, and `createDebugProfile` no longer invents
one; a check named after a `launch.json` key must come from the fold.

Two consequences worth stating:

- **A path-EXISTENCE check on the OpenOCD cfg is not in either half.** The old
  one lived on the draft, whose only entry was the placeholder, so it never
  once ran. Running it against tan's resolved path is new behaviour, not
  restored coverage, and it would misfire the moment `runners.yaml` was
  recorded on another host (a container/WSL build leaves `serverpath` and
  `configFiles` pointing at `/home/…` paths that do not exist on the Windows
  box reading them). Tracked separately.
- **`svdFile` no longer produces a check at all.** It was a constant `warn`:
  `createDebugProfile("baremetal-mcu", …)` set `svdFile: "<resolved-svd>"` — a
  hardcoded placeholder, so the check never resolved — and every other profile
  left the field unset, which warned too. It never once opened the output
  channel on its own, for two reasons: the check was added only for
  `adapter === "cortex-debug"`, so `yocto-userspace` (cppdbg) and `native-host`
  (lldb) never got it; and on the two targets that did, `canLaunch` was already
  `false` for every server the picker offers, so the `!report.canLaunch` half of
  `Alp: Debug preflight`'s `if (!report.canLaunch || report.summary.warn > 0)`
  had already fired. What makes keeping it out matter is FORWARD-looking: a
  resolved preflight now reports `canLaunch: true`, so from here a surviving
  constant `warn` would be the sole reason the channel is forced open, on every
  run. The rule below is what keeps it out: `svdFile` is **optional and
  warn-only**. cortex-debug reads it to populate the peripheral/register view
  and nothing else, so a missing SVD leaves that view empty while breakpoints,
  stepping and memory reads all work. It must never appear in a launch-blocking
  check or in the fields a customer is told to supply. (alp-sdk ships no `.svd`
  and carries no path to one, alp-sdk#948; when it does, tan writes the key and
  the fold is what would see an unresolved one.)

Where a value genuinely cannot be filled — `baremetal-mcu` has no Zephyr build,
so there is no `runners.yaml` to read, and `yocto-userspace` needs a remote
`<host>:<port>` nothing can derive — **tan owns the wording**. It emits the
placeholder and the note "Placeholder fields such as `<resolved-device>` still
need project-specific resolution."; the extension logs that note verbatim and
names the key in its own check. Neither is duplicated here.

If preflight fails, the product should not attempt a debug launch. It
should explain the failure and offer the next action. Only `fail` checks
block; `warn` checks are reported and the launch proceeds.

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
