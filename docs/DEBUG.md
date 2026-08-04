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
  targetKind: DebugTargetKind;
  adapter: DebugAdapterKind;
  server: DebugServerKind;
  executablePath: string;
}
```

That is the whole of it. `DebugProfile` describes the session the extension is
REPORTING ON, not a launch configuration. The rule for what may live here: a
field belongs only when the extension itself must READ it to grade a fact about
this machine. `executablePath` qualifies — `createExecutableCheck` stats the
ELF. A value the extension only wants to SEE in launch.json does not; that is
tan's output.

It used to carry `device`, `interface`, `svdFile`, `openOcdConfigFiles`,
`targetId`, `miMode`, `miDebuggerPath`, `miDebuggerServerAddress`,
`setupCommands`, `cwd`, `name` and `os` as well, all hardcoded constants of
`(targetKind, server)` — see §12 for why grading those was #339. `name` is the
one worth naming twice: it said `Alp: Zephyr Debug (J-Link)` (the suffix from
`serverLabel(server)`, so one string per target/server pair) while the pinned
tan 0.4.0 writes `ALP: Zephyr Debug (J-Link)`, so the extension's copy of tan's
merge key had already drifted from it — which is exactly the stranded-duplicate
defect §12's orphan rescue repairs, and that rescue reads the spelling off the
customer's own file and off `tan debug-config --preview`, never off a profile.
The configuration keys are tan's; §10 shows what it writes.

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
  ]
}
```

No `preLaunchTask` key: this is the one profile the extension asks for without
one — see §10.6.

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

VS Code renders a provider-contributed task's label as `${source}: ${name}`,
so those labels resolve only while something contributes them — an
unresolvable `preLaunchTask` aborts the pre-launch and
`vscode.debug.startDebugging` returns `false` with no useful error, pointing
the user at a `launch.json` that looks perfectly fine.

`tan` emits the key only when told to: `debug-config` writes `preLaunchTask`
only for a `--pre-launch-task <TASK>` the caller passes, and drops the key
otherwise. The extension passes it from `debugConfigArgs`
(`src/debug/service.ts`), mapping the target class to a label via
`preLaunchTaskFor` (`src/tasks/service.ts`) — without that, §10.1–10.3 and
§10.5 would start a debug session against an ELF nothing had built.

The extension contributes all four labels (`src/tasks/service.ts` holds the
string contract, `src/tasks/vscodeAdapter.ts` the VS Code seam, task type +
source `alp`):

| label                             | referenced by  | runs                                           |
| --------------------------------- | -------------- | ---------------------------------------------- |
| `alp: build active target`        | §10.1, §10.2   | `tan build`                                    |
| `alp: build baremetal target`     | §10.3          | `tan build`                                    |
| `alp: build native_sim target`    | §10.5          | `tan build`                                    |
| `alp: deploy and start gdbserver` | no profile     | nothing — reports the manual step, exits **1** |

The three build labels run the identical command because `tan build` has no
per-target selector: it builds every slice `board.yaml` declares. Three labels
exist because three debug-target classes reference them under different names.

`alp: deploy and start gdbserver` has no `tan` equivalent — the extension has
no deploy story, and §10.4's profile ships `miDebuggerServerAddress:
"<host>:<port>"` for the user to fill in by hand. It deliberately fails rather
than faking success, so running it from the Tasks picker names the manual step
and exits 1 instead of implying a deploy happened.

That exit is also why §10.4's profile references no task at all. A profile
naming it would raise VS Code's "the preLaunchTask terminated with exit code 1
— Debug Anyway / Show Errors" dialog on **every** F5 — including one where the
customer has already copied the binary across, started `gdbserver` on the
target and filled in the address, which is the setup that works. The label
stays registered so the Tasks picker can still spell out the manual step.

### 10.7 `alpSdk.svdPath`

The SDK ships no `.svd` of its own (§9, alp-sdk#948, licence-blocked) — a
customer who wants cortex-debug's Peripherals / register view has to supply
one. `alpSdk.svdPath` is that setting: an empty-by-default path to a vendor
`.svd` file, threaded into `debugConfigArgs` (`src/debug/service.ts`) as
`--svd <value>`, the same conditional-push shape as `--core` and
`--pre-launch-task`. tan-cli#214 is the producer; before it, `resolution.svd`
had no source at all and the key was always dropped (§9, §12).

**Read once, passed to both the preview and the real write** —
`writeLaunchProfile` (`src/debug.ts`) reads it through `readSvdPath`
(`src/project/vscodeAdapter.ts`, the same resource-scoped `alpSdk.*` reader
`readProjectSettings` uses) a single time, so the preview stays a preview of
the command that actually runs.

**Relative paths anchor on the workspace root, not by this extension's
doing.** `runDebugConfig` always spawns tan with `cwd = context.workspaceRoot`,
and tan's own `--svd` resolution joins a relative argument against its process
cwd — the two facts compose into "workspace-relative", with no path-joining
logic added here. tan then applies the same `workspace_relative` rewrite it
gives `executable`: a path that lands inside the project is emitted as
`${workspaceFolder}/…` so a committed `launch.json` stays portable; one
outside it (the normal case — a vendor SVD usually lives in the vendor SDK,
not the project) stays absolute.

**Not re-derived, and not defended against.** No `fs.existsSync` gates the
value before it is sent — `debugConfigArgs` pushes it verbatim, per this
repo's standing "tan owns the facts" rule (`packages/alp-core/src/deps/
planner.ts`). The consequence is worth stating plainly because it is sharper
than the usual "warn and drop" shape the rest of this file describes for SVD
resolution failures: **a value that does not name a readable file makes `tan`
refuse the WHOLE `debug-config` command and write no `launch.json` at all** —
never a fallback to dropping just the SVD key. A typo here breaks Configure
Debug Profile / F5 outright, not merely the peripheral view. `runDebugConfig`
narrows the resulting failure toast to name `alpSdk.svdPath` (with an
`openSettings` action) whenever `--svd` was actually on the argv, so the
symptom does not read as "debug is broken" with nothing to point at
(`test/debug.svdFailureHint.test.js`).

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
`targetKind` / `server` metadata; the one judgement about the pair —
compatibility between them — was never reachable in practice, on either side
of the fork: the extension's own `pickServer` only ever offers a legal server
for the chosen target class, and tan rejects an illegal pair before building
its report. `buildDoctorReport`, the in-process report that carried this dead
`serverCompatibility` check, is deleted rather than migrated (#376); nothing
replaces it.

The last two are configuration VALUES. Both are graded by
`foldLaunchConfigPlaceholders` and nowhere else, against the `launch.json`
entry tan MERGED into rather than the draft it reported — see "Which
configuration is graded" below — but they differ in whether tan can fill them, and that
difference is not cosmetic. Bullet 6 it resolves: on a Zephyr build
`tan debug-config --server openocd` reads the OpenOCD paths out of the build's
own `runners.yaml`, driven on tan 0.4.0 to `"configFiles":
["/home/dev/board/e1m_aen801.cfg"]` with a matching `serverpath` and
`searchDir`. Bullet 7 it cannot: `yocto-userspace` comes out
`"miDebuggerServerAddress": "<host>:<port>"` with `"miDebuggerPath":
"<resolved-gdb>"` against that same fully populated `runners.yaml` — the file
makes no difference to it. So the fold sees a resolved value in the first case
and a surviving placeholder in the second, and the next step it prints has to
differ accordingly — see the end of this section.

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
- **`svdFile` no longer produces a check at all.** Only the two cortex-debug
  target classes ever drew one, because it was added only for
  `adapter === "cortex-debug"`:
  `yocto-userspace` (cppdbg) and `native-host` (lldb) never got it. On both that
  did it was a constant `warn` — `createDebugProfile("baremetal-mcu", …)` set
  `svdFile: "<resolved-svd>"`, a hardcoded placeholder that never resolved, and
  `zephyr-mcu` left the field unset, which `isResolvedValue(undefined)` warned on
  too. It never once opened the output channel on its own: on those same two
  targets `canLaunch` was already `false` for every server the picker offers, so
  the `!report.canLaunch` half of `Alp: Debug preflight`'s
  `if (!report.canLaunch || report.summary.warn > 0)` had already fired. What
  makes keeping it out matter is FORWARD-looking: a
  resolved preflight now reports `canLaunch: true`, so from here a surviving
  constant `warn` would be the sole reason the channel is forced open, on every
  run. The rule below is what keeps it out: `svdFile` is **optional and
  warn-only**. cortex-debug reads it to populate the peripheral/register view
  and nothing else, so a missing SVD leaves that view empty while breakpoints,
  stepping and memory reads all work. It must never appear in a launch-blocking
  check or in the fields a customer is told to supply. (alp-sdk ships no `.svd`
  of its own, alp-sdk#948, licence-blocked; `alpSdk.svdPath` — §10.7 — is a
  second, independent source that does not wait on it, and once tan resolves
  either one the fold is what would see a still-unresolved SVD.)

**Which configuration is graded.** The `launch.json` entry on disk, found by the
`name` tan reports — not `data.configuration` from the envelope. tan MERGES its
draft into the customer's file, and the merge preserves a value they hand-filled
while the draft it reported still carries the placeholder it could not resolve.
Driven on tan 0.4.0, `--server pyocd` against a board registering only
`jlink`/`openocd`, with `"targetId": "cortex_m55"` already in the file: exit 0,
`replaced: true`, envelope `"targetId": "<resolved-target-id>"`, file
`"targetId": "cortex_m55"`. Grading the envelope reports `canLaunch: false`
naming `targetId` for a session that would have worked — #339's own symptom
pointed the other way. The same holds inside an array: tan's merge keeps an
all-placeholder incoming `configFiles` from overwriting the customer's list, so
the envelope reports `configFiles[0]` unresolved where the file holds a real
`.cfg`.

`gradeWrittenLaunchConfig` (`src/debug/service.ts`) does the read-back and the
lookup; `packages/alp-core` stays pure and the fold keeps taking placeholders as
data. The entry is found by tan's own configuration `name`, never by an
`ALP:`/`Alp:` prefix guess — guessing the spelling is the defect the orphan
rescue in that same file exists to repair. When the file is missing, does not
parse (JSONC included), or holds no entry under that name, the fold still runs
against the envelope, which is the pre-#403 behaviour and still catches every
placeholder tan itself left. `DebugPreflightReport.configurationGraded` says
which happened — `"launchJson"`, `"cliEnvelope"` or `"none"` — so a fallback
verdict is never mistaken for a reading of the file, and a failed read can never
pass for a clean one. Covered by `test/debug.gradedConfig.test.js`.

Grading the file rather than the envelope widens what is graded, and the
widening is deliberate: the object is the whole merged entry, so keys tan never
wrote are graded too. A hand-added `"gdbTarget": "<host>:3333"` fails the
preflight and is named. That entry is what F5 launches and the adapter reads
`<host>:3333` as a literal, so a customer is better served by the check than by
a session that dies on it. The `fix` for such a key reads "Build the project
first, or set `gdbTarget` in launch.json by hand." — no build resolves a key of
the customer's own, but the hand-edit half names the right key.

Two targets are where a value genuinely cannot be filled. `baremetal-mcu` has
no Zephyr build, so no `runners.yaml` of its own to read, and all three servers
come out with `"device": "<resolved-device>"` even with a fully populated one
sitting in the tree; `yocto-userspace` needs a remote `<host>:<port>` and a
cross-gdb path that nothing local derives. The wording is SPLIT between the two processes, and it
is worth being exact about which half is whose:

- **tan owns the general note.** It emits the placeholder and, alongside it,
  "Placeholder fields such as `<resolved-device>` still need project-specific
  resolution."; `logUnlaunchableDetail` logs that note verbatim rather than
  writing a second version of it. This document does not restate it either.
- **The extension owns the per-key next step**, because it is the half that
  knows the key and the target class. `foldLaunchConfigPlaceholders` writes the
  failing check's `fix`, and that string must fit the target. On the two above
  no build will ever produce the value, so "Build the project first" alone would
  be advice that cannot terminate — handing a customer a next step that cannot
  work is #339's own defect in a different hat. The fold therefore branches on
  `report.targetKind` and says what they must supply instead (`placeholderFix`,
  covered by `test/debug.service.test.js`).

  `zephyr-mcu` keeps the default, and it offers the hand-edit alongside the
  build because the build half is right often rather than always: a SUCCESSFUL
  Zephyr build whose board registers no runner for the chosen server also leaves
  the placeholder standing. Driven on tan 0.4.0 against a `runners.yaml` listing
  only `jlink` and `openocd`, `--server pyocd` exits 0 with `"targetId":
  "<resolved-target-id>"` and this note, which `logUnlaunchableDetail` logs
  verbatim: "This build registers no 'pyocd' runner (runners.yaml: `["jlink",
  "openocd"]`), so its fields could not be resolved."

If preflight fails, the product should not attempt a debug launch. It
should explain the failure and offer the next action. Only `fail` checks
block; `warn` checks are reported and the launch proceeds.

Current implementation status:

- `Alp: Debug preflight` emits a structured preflight report with
  actionable checks.
- `Alp: Debug doctor` emits environment diagnostics from `tan doctor`, target-
  agnostic — it no longer prompts for a target/server pair, and the
  compatibility check that once paired with it (`serverCompatibility`) is gone
  with `buildDoctorReport` (#376; see line 612 above).
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
