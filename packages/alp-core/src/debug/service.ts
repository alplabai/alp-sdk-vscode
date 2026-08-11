// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { toPosix } from "../paths";

import {
  DebugAdapterKind,
  DebugConfigurationGrade,
  DebugDoctorSection,
  DebugGenerationTraceDecision,
  DebugGenerationTraceReport,
  DebugInspectReport,
  DebugPreflightReport,
  DebugProfile,
  DebugResolvedValue,
  DebugRuntimeCapabilities,
  DebugServerChoice,
  DebugServerKind,
  DebugSupportBundlePayload,
  DebugTargetChoice,
  DebugTargetKind,
  DebugWorkspaceContext,
  PreflightCheck,
  PreflightStatus,
} from "./models";
import type { DoctorEnvelopeData } from "../cli/doctorEnvelope";
import { ManifestSlice } from "../systemManifest/models";

export interface DebugPreflightDependencies {
  pathExists(path: string): boolean;
}

const MCU_SERVER_CHOICES: ReadonlyArray<DebugServerChoice> = [
  { label: "J-Link", server: "jlink" },
  { label: "OpenOCD", server: "openocd" },
  { label: "pyOCD", server: "pyocd" },
];

const YOCTO_SERVER_CHOICES: ReadonlyArray<DebugServerChoice> = [
  { label: "gdbserver", server: "gdbserver" },
];

const NATIVE_SERVER_CHOICES: ReadonlyArray<DebugServerChoice> = [
  { label: "local", server: "none" },
];

export const DEBUG_TARGET_CHOICES: ReadonlyArray<DebugTargetChoice> = [
  {
    label: "Zephyr MCU",
    description: "cortex-debug with J-Link, OpenOCD, or pyOCD",
    targetKind: "zephyr-mcu",
  },
  {
    label: "Baremetal MCU",
    description: "cortex-debug with J-Link, OpenOCD, or pyOCD",
    targetKind: "baremetal-mcu",
  },
  {
    label: "Yocto userspace",
    description: "cppdbg with gdbserver",
    targetKind: "yocto-userspace",
  },
  {
    label: "Native host",
    description: "CodeLLDB for native_sim and host tools",
    targetKind: "native-host",
  },
];

export const DEBUG_ADAPTER_EXTENSION_ID: Record<DebugAdapterKind, string> = {
  "cortex-debug": "marus25.cortex-debug",
  cppdbg: "ms-vscode.cpptools",
  lldb: "vadimcn.vscode-lldb",
};

/**
 * Debug type each target class launches with. `createDebugProfile` reads it, so
 * the `type` written into launch.json and the extension checks above cannot
 * name different adapters for the same target.
 */
export const DEBUG_TARGET_ADAPTER: Record<DebugTargetKind, DebugAdapterKind> = {
  "zephyr-mcu": "cortex-debug",
  "baremetal-mcu": "cortex-debug",
  "yocto-userspace": "cppdbg",
  // `lldb`, not `codelldb`: CodeLLDB (vadimcn.vscode-lldb) registers its debug
  // type as `lldb` in its own `contributes.debuggers` — `codelldb` is the
  // extension's NAME and has never been a debug type. This value is written
  // verbatim into launch.json as `type`, so `codelldb` made VS Code refuse the
  // session with "configured debug type 'codelldb' is not supported".
  // native_sim is the only target that needs neither probe nor board, so this
  // is the first debug session a customer ever runs.
  "native-host": "lldb",
};

/** Whether a debug target is the native_sim / native-host host-binary class
 *  (CodeLLDB, no on-chip probe) — the class that needs the native_sim GPIO
 *  overlay generated before launch. On-target (Zephyr/baremetal MCU, Yocto
 *  userspace) profiles never match, so overlay generation never fires for an
 *  SWD/J-Link/OpenOCD/pyOCD/gdbserver debug session. */
export function isNativeHostTarget(targetKind: DebugTargetKind): boolean {
  return targetKind === "native-host";
}

export function serverChoicesForTarget(
  targetKind: DebugTargetKind,
): ReadonlyArray<DebugServerChoice> {
  switch (targetKind) {
    case "zephyr-mcu":
    case "baremetal-mcu":
      return MCU_SERVER_CHOICES;
    case "yocto-userspace":
      return YOCTO_SERVER_CHOICES;
    case "native-host":
      return NATIVE_SERVER_CHOICES;
  }
}

export function createInspectReport(
  context: DebugWorkspaceContext,
): DebugInspectReport {
  return {
    schemaVersion: "1",
    generatedAt: context.generatedAt,
    context: { ...context },
    resolvedValues: collectResolvedValues(context),
  };
}

export function createGenerationTraceReport(
  generatedAt: string,
  workflow: string,
  decisions: readonly DebugGenerationTraceDecision[],
): DebugGenerationTraceReport {
  return {
    schemaVersion: "1",
    generatedAt,
    workflow,
    decisions: decisions.map((decision) => ({ ...decision })),
  };
}

export function createSupportBundlePayload(input: {
  generatedAt: string;
  inspect: DebugInspectReport;
  preflight?: DebugPreflightReport;
  trace?: DebugGenerationTraceReport;
  doctor?: DebugDoctorSection;
  notes?: string[];
}): DebugSupportBundlePayload {
  return {
    schemaVersion: "1",
    generatedAt: input.generatedAt,
    inspect: {
      ...input.inspect,
      context: { ...input.inspect.context },
      resolvedValues: input.inspect.resolvedValues.map((value) => ({
        ...value,
      })),
    },
    preflight: input.preflight
      ? {
          ...input.preflight,
          summary: { ...input.preflight.summary },
          checks: input.preflight.checks.map((check) => ({ ...check })),
          nextSteps: [...input.preflight.nextSteps],
        }
      : undefined,
    trace: input.trace
      ? {
          ...input.trace,
          decisions: input.trace.decisions.map((decision) => ({ ...decision })),
        }
      : undefined,
    doctor: input.doctor ? copyDoctorSection(input.doctor) : undefined,
    notes: input.notes ? [...input.notes] : [],
  };
}

function copyDoctorSection(doctor: DebugDoctorSection): DebugDoctorSection {
  if (doctor.kind === "unavailable") {
    return { ...doctor };
  }
  return {
    kind: "envelope",
    data: {
      ...doctor.data,
      summary: { ...doctor.data.summary },
      checks: doctor.data.checks.map((check) => ({ ...check })),
      // #474: `nextSteps` is now rendered, so it gets the same defensive copy
      // the rest of this payload has always had -- riding the spread would
      // hand every consumer of the bundle the SAME array the panel holds.
      ...(doctor.data.nextSteps
        ? { nextSteps: [...doctor.data.nextSteps] }
        : {}),
    },
  };
}

/**
 * Assemble the doctor half of a debug report/bundle from one `tan doctor`
 * spawn's result (#376) — `data` verbatim on success (see `DebugDoctorSection`
 * for what "verbatim" protects), or the resolver's own message carried whole
 * when tan could not be resolved or run.
 *
 * `unavailableDetail` is `CliOutcome.unavailable.detail` — the raw errno /
 * resolver text behind `unavailableMessage`. Callers that write it to a FILE
 * (the support bundle) or a PANEL (channel-grade text) pass it through; a
 * caller that shows a TOAST (`alp.debugDoctor`'s degraded path) must not —
 * see `DebugDoctorSection`'s own doc for why.
 *
 * Never a second in-process doctor: an unavailable run becomes ONE message
 * (plus, where the caller allows it, the detail behind it) — not a rebuilt
 * check list. See the callers in `src/debug.ts`.
 */
export function buildDebugDoctorSection(
  data: DoctorEnvelopeData | null,
  unavailableMessage: string,
  unavailableDetail?: string,
): DebugDoctorSection {
  if (data) return { kind: "envelope", data };
  return unavailableDetail
    ? {
        kind: "unavailable",
        error: unavailableMessage,
        detail: unavailableDetail,
      }
    : { kind: "unavailable", error: unavailableMessage };
}

export function serializeInspectReport(report: DebugInspectReport): string {
  return JSON.stringify(report, null, 2);
}

export function serializeGenerationTraceReport(
  report: DebugGenerationTraceReport,
): string {
  return JSON.stringify(report, null, 2);
}

export function serializeSupportBundlePayload(
  payload: DebugSupportBundlePayload,
): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * HOST READINESS ONLY — it grades nothing that belongs in the launch
 * configuration itself (#339).
 *
 * `tan debug-config` is the single author of launch.json (#387) and resolves
 * the probe/tool values from the build's own `runners.yaml`. This report used
 * to grade a SECOND, in-process draft instead: `createDebugProfile` handed it
 * `device: "<resolved-device>"` — a hardcoded literal, identical for every
 * project — and the resulting `device` check failed unconditionally. So on the
 * first-blink path tan wrote a launch.json that runs as-is and this told the
 * customer it was not launchable, putting a "Start Anyway" gate in front of a
 * working profile. The placeholders had left the file and stayed in the
 * verdict.
 *
 * The division of labour is EXTENSION_CLI_INTEGRATION.md §4a: tan owns the
 * configuration, the extension owns the host — which debugger extension is
 * installed, whether the server tool is on PATH, the host platform, whether
 * the build artefact exists. All four are here. It is an OWNERSHIP split, not
 * an observability one: only `adapterExtension` is genuinely out of a separate
 * process's reach, and tan reads the build tree as happily as this does.
 * The configuration's own values are graded by `foldLaunchConfigPlaceholders`,
 * and nowhere else.
 *
 * So the report it returns carries `configurationGraded: "none"`, and only the
 * fold sets it. A caller that does not fold — the preflight command, the
 * troubleshooting panel, the support bundle — gets a `canLaunch` that means
 * "the host is ready", and the field beside it is what says so.
 */
export function buildDebugPreflightReport(
  generatedAt: string,
  context: DebugWorkspaceContext,
  profile: DebugProfile,
  runtime: DebugRuntimeCapabilities,
  dependencies: DebugPreflightDependencies,
): DebugPreflightReport {
  const checks: PreflightCheck[] = [
    {
      name: "workspaceRoot",
      status: context.workspaceRoot ? "pass" : "fail",
      detail: context.workspaceRoot ?? "No workspace folder is open.",
      fix: context.workspaceRoot
        ? undefined
        : "Open a workspace containing an Alp project.",
    },
    {
      name: "boardYaml",
      status: context.boardYamlExists ? "pass" : "fail",
      detail: context.boardYamlPath ?? "board.yaml path is unresolved.",
      fix: context.boardYamlExists
        ? undefined
        : "Create board.yaml or configure alpSdk.boardYamlPath.",
    },
    createAdapterCheck(profile, context),
    createServerToolCheck(profile.server, runtime),
    createExecutableCheck(profile, context, dependencies),
  ];

  // #374: the ONLY host-OS gate. Empty for every other target and host.
  checks.push(...nativeHostPlatformChecks(profile.targetKind, runtime));

  return {
    generatedAt,
    targetKind: profile.targetKind,
    server: profile.server,
    profileId: profile.id,
    summary: {
      pass: countPreflightChecks(checks, "pass"),
      warn: countPreflightChecks(checks, "warn"),
      fail: countPreflightChecks(checks, "fail"),
    },
    checks,
    nextSteps: uniquePreflightNextSteps(checks),
    canLaunch: countPreflightChecks(checks, "fail") === 0,
    // Nothing above read a configuration, so say so rather than let
    // `canLaunch: true` be read as "this launch.json runs".
    configurationGraded: "none",
  };
}

/**
 * Fold the unresolved values left in the launch configuration
 * `tan debug-config` just wrote into an already-built preflight report.
 *
 * This is the ONLY configuration-value check the extension makes (#339).
 * `buildDebugPreflightReport` above is host readiness and nothing else, so the
 * caller folds its finding back in here rather than overriding `canLaunch`
 * directly and leaving `checks`/`summary`/`nextSteps` to disagree with it.
 * Reuses the same summary/canLaunch/nextSteps arithmetic, so the result is
 * indistinguishable from a report that had the check all along.
 *
 * IT GRADES PLACEHOLDERS AS DATA, and `graded` says which configuration they
 * were read out of. The fold cannot go and look itself — this package is pure,
 * with no `fs` — and it must not assume: `gradeWrittenLaunchConfig` in
 * src/debug/service.ts prefers the entry in the customer's `.vscode/launch.json`
 * and falls back to tan's envelope draft, which are not the same object. tan
 * MERGES, so a `targetId` the customer hand-filled survives while the draft it
 * composed still carries `<resolved-target-id>`; grading the draft then reports
 * a file that launches as unlaunchable, which is #339's own symptom pointed the
 * other way. `graded` is carried into the report so a reader can tell a verdict
 * about the file from a worst case about the draft.
 *
 * ONE CHECK PER KEY, NAMED AFTER THE KEY. `logUnlaunchableDetail` builds the
 * toast out of failing check NAMES, so a single check called `launchConfig`
 * would tell a customer to "resolve: launchConfig" — the name of a check, not
 * of anything in their file. Named per key it reads "resolve: device", which
 * is the field cortex-debug will choke on and the field they can fill in. The
 * placeholder itself stays in `detail`, which is where the log line finds it.
 *
 * Adds no CHECK when `placeholders` is empty — a fully resolved configuration
 * must not gain one, or the first-blink path is back behind a Start Anyway
 * click. It still records `graded`, because it did grade it and found nothing:
 * that field says WHICH configuration was read, not whether it was faulty, and
 * the surfaces that never read one keep `"none"`.
 *
 * The next step comes from `placeholderFix`, which needs the report's
 * `targetKind` — see there for why one sentence does not fit all four.
 */
export function foldLaunchConfigPlaceholders(
  report: DebugPreflightReport,
  placeholders: ReadonlyArray<{ key: string; value: string }>,
  graded: Exclude<DebugConfigurationGrade, "none">,
): DebugPreflightReport {
  if (placeholders.length === 0) {
    return { ...report, configurationGraded: graded };
  }

  const checks: PreflightCheck[] = [
    ...report.checks,
    ...placeholders.map((placeholder): PreflightCheck => {
      // Empty `key` means the placeholder was a bare string, not a value under
      // a configuration key — nothing to name it after, so keep the generic id.
      const name = placeholder.key || "launchConfig";
      return {
        name,
        status: "fail",
        detail: placeholder.value,
        fix: placeholderFix(report.targetKind, name),
      };
    }),
  ];

  return {
    ...report,
    checks,
    summary: {
      pass: countPreflightChecks(checks, "pass"),
      warn: countPreflightChecks(checks, "warn"),
      fail: countPreflightChecks(checks, "fail"),
    },
    nextSteps: uniquePreflightNextSteps(checks),
    canLaunch: countPreflightChecks(checks, "fail") === 0,
    configurationGraded: graded,
  };
}

/**
 * The next step for an unresolved launch.json key — which is not the same
 * sentence on every target class (#339).
 *
 * "Build the project first" is only advice where a build would in fact produce
 * the value. On `zephyr-mcu` it CAN: `tan debug-config` reads `device`,
 * `configFiles`, `targetId` and `gdbPath` out of the build's own
 * `runners.yaml`, so a placeholder seen before the build is gone after one —
 * PROVIDED the board registers a runner for the server that was picked. Where
 * it does not, a successful build leaves the placeholder standing and tan says
 * why, in a note `logUnlaunchableDetail` logs verbatim: driven on tan 0.4.0
 * against a `runners.yaml` listing only `jlink` and `openocd`, `--server pyocd`
 * exits 0 with `"targetId": "<resolved-target-id>"` and *"This build registers
 * no 'pyocd' runner (runners.yaml: [\"jlink\", \"openocd\"]), so its fields
 * could not be resolved."* So the default sentence offers the hand-edit as well
 * as the build, and it has to: on `zephyr-mcu` the build half is right often,
 * not always.
 *
 * On the two targets below a placeholder survives a SUCCESSFUL build
 * unconditionally, and there "build first" alone would send the customer around
 * a loop that cannot terminate — #339's own defect wearing a different hat,
 * something that reads like a way forward and is not one. Driven against tan
 * 0.4.0:
 *
 * - `baremetal-mcu` has no Zephyr build and so no `runners.yaml` of its own to
 *   read; all three servers write `"device": "<resolved-device>"` even with a
 *   fully populated one sitting in the tree. Only the customer knows the part.
 * - `yocto-userspace` writes `"miDebuggerServerAddress": "<host>:<port>"` and
 *   `"miDebuggerPath": "<resolved-gdb>"` against that same populated
 *   `runners.yaml` — the file makes no difference to that output. Both describe
 *   a remote target and the cross-toolchain reaching it, neither of which a
 *   local build produces.
 *
 * `native-host` takes the default and never exercises it: tan's configuration
 * for it carries no placeholder to fold.
 */
function placeholderFix(targetKind: DebugTargetKind, key: string): string {
  switch (targetKind) {
    case "baremetal-mcu":
      return `Set "${key}" in launch.json by hand — a baremetal build writes no runners.yaml, so building cannot resolve it.`;
    case "yocto-userspace":
      return `Set "${key}" in launch.json by hand — the remote target address and the cross-gdb reaching it come from your target, not from a build.`;
    default:
      return `Build the project first, or set "${key}" in launch.json by hand.`;
  }
}

/** Per-slice executable path from the system manifest: prefer the built
 *  artefact (post-build), else the standard output under the slice's build_dir.
 *  Returns undefined when the slice carries no build_dir, so the caller falls
 *  back to the generic single-core default. */
function sliceExecutablePath(
  targetKind: DebugTargetKind,
  slice: ManifestSlice,
): string | undefined {
  if (slice.output_artefact) {
    return `\${workspaceFolder}/${slice.output_artefact}`;
  }
  if (!slice.build_dir) return undefined;
  const dir = slice.build_dir;
  switch (targetKind) {
    case "zephyr-mcu":
      return `\${workspaceFolder}/${dir}/zephyr/zephyr.elf`;
    case "native-host":
      return `\${workspaceFolder}/${dir}/zephyr/zephyr.exe`;
    case "baremetal-mcu":
      return `\${workspaceFolder}/${dir}/app.elf`;
    case "yocto-userspace":
      return `\${workspaceFolder}/${dir}/app`;
  }
}

/**
 * What the extension knows about the session it is about to REPORT ON — not a
 * launch configuration, and no longer anything close to one (#339).
 *
 * It returns exactly what `buildDebugPreflightReport` reads: which target
 * class and server were picked, which debug-adapter extension that needs, and
 * where the build artefact should be. The nine configuration fields it used to
 * invent — `device`, `targetId`, `openOcdConfigFiles`, `svdFile`, `interface`,
 * `miMode`, `miDebuggerPath`, `miDebuggerServerAddress`, `setupCommands` — plus
 * `cwd`, `name` and `os` are gone. They were not all placeholders
 * (`interface: "swd"`,
 * `miMode: "gdb"` and the `-enable-pretty-printing` `setupCommands` were
 * concrete, and `miDebuggerServerAddress` was `"<host>:<port>"`, not a
 * `<resolved-…>` token), but they were all CONSTANTS of `(targetKind, server)`:
 * a second derivation of what `tan debug-config` resolves from the build's
 * `runners.yaml`, one that no project input could reach. Three of them
 * (`interface`, `miMode`, `setupCommands`), `cwd`, `name` and `os` had no
 * reader at all once #387 deleted `debugProfileToLaunchDraft`; the rest were
 * read only by the preflight checks that graded them, and grading a constant
 * placeholder is precisely the defect #339 reports. `name` was worse than
 * unread — it said `Alp: Zephyr Debug (J-Link)` while the pinned tan 0.4.0
 * writes `ALP: Zephyr Debug (J-Link)`, so anything that had trusted it as
 * tan's merge key would have appended a duplicate. That is the very defect
 * `planOrphanRescue` in src/debug/service.ts repairs, and it learns the
 * spelling from the customer's file and from `tan debug-config --preview`,
 * never from here. The `launch.json` entry tan merged into is the only thing
 * worth grading, and `foldLaunchConfigPlaceholders` grades that.
 */
export function createDebugProfile(
  targetKind: DebugTargetKind,
  server: DebugServerKind,
  slice?: ManifestSlice,
): DebugProfile {
  if (!supportsServerForTarget(targetKind, server)) {
    throw new Error(
      `Unsupported debug backend '${server}' for target '${targetKind}'.`,
    );
  }

  // Prefer the per-core path from the manifest slice; else the single-core
  // default. Heterogeneous projects build to build/<core_id>-<os>/, so the old
  // fixed build/app/... path was wrong for any non-default core.
  const exe = (fallback: string): string =>
    (slice && sliceExecutablePath(targetKind, slice)) || fallback;

  const base = {
    id: `alp:${targetKind}:${server}`,
    targetKind,
    server,
    adapter: DEBUG_TARGET_ADAPTER[targetKind],
  } as const;

  switch (targetKind) {
    case "zephyr-mcu":
      return {
        ...base,
        executablePath: exe("${workspaceFolder}/build/app/zephyr/zephyr.elf"),
      };
    case "baremetal-mcu":
      return {
        ...base,
        executablePath: exe("${workspaceFolder}/build/baremetal/app.elf"),
      };
    case "yocto-userspace":
      return {
        ...base,
        executablePath: exe("${workspaceFolder}/build/yocto/app"),
      };
    case "native-host":
      return {
        ...base,
        executablePath: exe(
          "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
        ),
      };
  }
}

function resolveBackendExecutable(
  server: DebugServerKind,
  runtime: DebugRuntimeCapabilities,
): string | null {
  switch (server) {
    case "jlink":
      return runtime.jlinkExecutable;
    case "openocd":
      return runtime.openOcdExecutable;
    case "pyocd":
      return runtime.pyocdExecutable;
    case "gdbserver":
      return runtime.gdbExecutable;
    case "none":
      return runtime.lldbExecutable;
  }
}

function supportsServerForTarget(
  targetKind: DebugTargetKind,
  server: DebugServerKind,
): boolean {
  return serverChoicesForTarget(targetKind).some(
    (choice) => choice.server === server,
  );
}

function collectResolvedValues(
  context: DebugWorkspaceContext,
): DebugResolvedValue[] {
  return [
    {
      key: "workspaceRoot",
      value: context.workspaceRoot,
      source: context.workspaceRoot ? "workspace" : "unresolved",
      detail: context.workspaceRoot
        ? "Resolved from the active workspace folder."
        : "No workspace folder is open.",
    },
    {
      key: "sdkRoot",
      value: context.sdkRoot,
      source: context.sdkRoot ? "workspace" : "unresolved",
      detail: context.sdkRoot
        ? "Resolved alp-sdk root used for scripts and schemas."
        : "Set alpSdk.path when automatic discovery is ambiguous.",
    },
    {
      key: "boardYamlPath",
      value: context.boardYamlPath,
      source: context.boardYamlPath ? "setting" : "unresolved",
      detail: context.boardYamlPath
        ? "Resolved board.yaml path from project settings."
        : "board.yaml path is unresolved.",
    },
    {
      key: "boardYamlExists",
      value: context.boardYamlExists,
      source: "runtime",
      detail: context.boardYamlExists
        ? "board.yaml exists at the resolved path."
        : "board.yaml is missing at the resolved path.",
    },
    {
      key: "westCwd",
      value: context.westCwd,
      source: context.westCwd ? "setting" : "default",
      detail: context.westCwd
        ? "Working directory used for west commands."
        : "Defaults to the workspace root.",
    },
    {
      key: "pythonBinary",
      value: context.pythonBinary,
      source:
        context.pythonBinary === "python3" || context.pythonBinary === "python"
          ? "default"
          : "setting",
      detail: "Interpreter used for loader and validation scripts.",
    },
  ];
}

function countPreflightChecks(
  checks: readonly PreflightCheck[],
  status: PreflightStatus,
): number {
  return checks.filter((check) => check.status === status).length;
}

function uniquePreflightNextSteps(checks: readonly PreflightCheck[]): string[] {
  const nextSteps = new Set<string>();
  for (const check of checks) {
    if (check.status === "pass" || !check.fix) continue;
    nextSteps.add(check.fix);
  }
  return [...nextSteps];
}

function createAdapterCheck(
  profile: DebugProfile,
  context: DebugWorkspaceContext,
): PreflightCheck {
  switch (profile.adapter) {
    case "cortex-debug":
      return {
        name: "adapterExtension",
        status: context.debuggerExtensions.cortexDebug ? "pass" : "fail",
        detail: context.debuggerExtensions.cortexDebug
          ? "marus25.cortex-debug is installed."
          : "marus25.cortex-debug is not installed.",
        fix: context.debuggerExtensions.cortexDebug
          ? undefined
          : "Install marus25.cortex-debug.",
      };
    case "cppdbg":
      return {
        name: "adapterExtension",
        status: context.debuggerExtensions.cppTools ? "pass" : "fail",
        detail: context.debuggerExtensions.cppTools
          ? "ms-vscode.cpptools is installed."
          : "ms-vscode.cpptools is not installed.",
        fix: context.debuggerExtensions.cppTools
          ? undefined
          : "Install ms-vscode.cpptools.",
      };
    case "lldb":
      return {
        name: "adapterExtension",
        status: context.debuggerExtensions.codeLLDB ? "pass" : "fail",
        detail: context.debuggerExtensions.codeLLDB
          ? "vadimcn.vscode-lldb is installed."
          : "vadimcn.vscode-lldb is not installed.",
        fix: context.debuggerExtensions.codeLLDB
          ? undefined
          : "Install vadimcn.vscode-lldb.",
      };
  }
}

function createServerToolCheck(
  server: DebugProfile["server"],
  runtime: DebugRuntimeCapabilities,
): PreflightCheck {
  // `none` is not a tool name — it is the native-host "there is no debug
  // server" marker. CodeLLDB (vadimcn.vscode-lldb v1.12.2) SHIPS its own LLDB
  // (lldb/bin/lldb.exe, liblldb, lldb-server) and never consults PATH, so
  // probing `where lldb-dap` / `where lldb` failed this check on every stock
  // machine and put F5 on "Alp: Native Sim Debug" behind a Start Anyway click —
  // while rendering "No none executable was found on PATH." and interpolating
  // "Install none and make sure it is on PATH." into the customer toast. The
  // extension's own presence is the real requirement, and `adapterExtension`
  // already covers it.
  if (server === "none") {
    return {
      name: "serverTool",
      status: "pass",
      detail:
        "No debug server is needed: vadimcn.vscode-lldb ships its own LLDB (checked by adapterExtension).",
    };
  }

  const executable = resolveBackendExecutable(server, runtime);
  return {
    name: "serverTool",
    status: executable ? "pass" : "fail",
    detail: executable ?? `No ${server} executable was found on PATH.`,
    fix: executable
      ? undefined
      : `Install ${server} and make sure it is on PATH.`,
  };
}

/**
 * native_sim is a POSIX-architecture board: Zephyr's own board documentation
 * says it builds "a normal Linux executable". So `native-host` is not a
 * missing-tool problem on Windows, it is a dead end — the Zephyr build cannot
 * emit a Windows binary, and one built under WSL is a Linux ELF that a
 * Windows-side CodeLLDB cannot launch. Nothing the customer installs on
 * Windows clears it, so this FAILS (blocking `canLaunch`) rather than warns.
 *
 * It is deliberately the ONLY host-OS gate here: every other target class
 * debugs over a probe or a remote gdbserver and is perfectly launchable from
 * Windows, so this returns an empty list for them and on every non-Windows
 * host. `buildDebugPreflightReport` is its only caller now — `buildDoctorReport`
 * used to call it too (#374), before #376 deleted the in-process doctor
 * entirely rather than migrating this gate a second time.
 *
 * Wording contract (see src/notify/models.ts): `fix` reaches the customer
 * through `nextSteps` and the toast detail, so it carries no errno, no path
 * and no internal check id. "Reopen … in WSL" is the same affordance
 * `src/bootstrap.ts` already offers for the same host dead end.
 */
function nativeHostPlatformChecks(
  targetKind: DebugTargetKind,
  runtime: DebugRuntimeCapabilities,
): PreflightCheck[] {
  if (!isNativeHostTarget(targetKind)) return [];
  if (runtime.hostPlatform !== "win32") return [];
  return [
    {
      name: "hostPlatform",
      status: "fail",
      detail:
        "native_sim builds a Linux executable, so it cannot run on this Windows host.",
      fix: "Reopen the folder in WSL, or build and debug native_sim on a Linux or macOS host.",
    },
  ];
}

function createExecutableCheck(
  profile: DebugProfile,
  context: DebugWorkspaceContext,
  dependencies: DebugPreflightDependencies,
): PreflightCheck {
  const resolvedPath = resolveWorkspacePath(profile.executablePath, context);
  if (!resolvedPath) {
    return {
      name: "buildArtifactPath",
      status: "fail",
      detail: `Executable path is unresolved: ${profile.executablePath}`,
      fix: "Resolve executable path placeholders before launch.",
    };
  }

  const exists = dependencies.pathExists(resolvedPath);
  return {
    name: "buildArtifact",
    status: exists ? "pass" : "fail",
    detail: resolvedPath,
    fix: exists ? undefined : "Build the selected target before launch.",
  };
}

function isResolvedValue(value: string | undefined): boolean {
  return Boolean(value && !value.includes("<resolved"));
}

function resolveWorkspacePath(
  value: string,
  context: DebugWorkspaceContext,
): string | null {
  if (!isResolvedValue(value)) {
    return null;
  }

  const workspaceRoot = context.workspaceRoot;
  if (!workspaceRoot) {
    return null;
  }

  if (value.startsWith("${workspaceFolder}/")) {
    return toPosix(
      path.join(workspaceRoot, value.slice("${workspaceFolder}/".length)),
    );
  }

  if (value.startsWith("${workspaceFolder}")) {
    return toPosix(
      path.join(workspaceRoot, value.slice("${workspaceFolder}".length)),
    );
  }

  if (value.startsWith("/")) {
    return value;
  }

  return toPosix(path.join(workspaceRoot, value));
}
