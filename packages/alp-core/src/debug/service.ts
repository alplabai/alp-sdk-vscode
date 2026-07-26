// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { toPosix } from "../paths";

import {
  DebugDoctorRequest,
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
  DoctorCheck,
  DoctorReport,
  PreflightCheck,
  PreflightStatus,
} from "./models";
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
  doctor?: DoctorReport;
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
    doctor: input.doctor
      ? {
          ...input.doctor,
          summary: { ...input.doctor.summary },
          checks: input.doctor.checks.map((check) => ({ ...check })),
          nextSteps: [...input.doctor.nextSteps],
        }
      : undefined,
    notes: input.notes ? [...input.notes] : [],
  };
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

  checks.push(
    ...createProfileConfigurationChecks(profile, context, dependencies),
  );

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
  };
}

/** Fold a "launchConfig" failure into an already-built preflight report when
 *  the caller has spotted `<resolved-…>` placeholders left in the launch.json
 *  configuration `tan debug-config` just wrote. The in-process preflight
 *  report can't see this itself — it only checks host readiness (adapters and
 *  tools installed) — so the surface layer (src/debug.ts) that DID diff the
 *  written configuration against `launchConfigPlaceholders` calls this to
 *  fold its finding back in, rather than overriding `canLaunch` directly and
 *  leaving `checks`/`summary`/`nextSteps` to disagree with it. Reuses the same
 *  summary/canLaunch/nextSteps arithmetic `buildDebugPreflightReport` uses, so
 *  the result is indistinguishable from a report that had the check all
 *  along. Returns `report` unchanged when `placeholders` is empty. */
export function foldLaunchConfigPlaceholders(
  report: DebugPreflightReport,
  placeholders: readonly string[],
): DebugPreflightReport {
  if (placeholders.length === 0) return report;

  const checks: PreflightCheck[] = [
    ...report.checks,
    {
      name: "launchConfig",
      status: "fail",
      detail: placeholders.join(", "),
      fix: "Build the project first, or set these by hand.",
    },
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
  };
}

export function buildDoctorReport(
  context: DebugWorkspaceContext,
  request: DebugDoctorRequest,
  runtime: DebugRuntimeCapabilities,
): DoctorReport {
  const checks: DoctorCheck[] = [
    {
      name: "workspaceRoot",
      status: context.workspaceRoot ? "pass" : "fail",
      detail: context.workspaceRoot ?? "No workspace folder is open.",
      fix: context.workspaceRoot
        ? undefined
        : "Open a workspace containing an Alp project.",
    },
    {
      name: "sdkRoot",
      status: context.sdkRoot ? "pass" : "fail",
      detail:
        context.sdkRoot ??
        "The extension could not resolve an alp-sdk checkout.",
      fix: context.sdkRoot
        ? undefined
        : "Configure alpSdk.path or open a workspace near an alp-sdk checkout.",
    },
    {
      name: "boardYaml",
      status: context.boardYamlExists ? "pass" : "fail",
      detail: context.boardYamlPath ?? "board.yaml path is unresolved.",
      fix: context.boardYamlExists
        ? undefined
        : "Create board.yaml or configure alpSdk.boardYamlPath.",
    },
    {
      name: "python",
      status: runtime.pythonAvailable ? "pass" : "warn",
      detail: `Interpreter probe: ${context.pythonBinary}`,
      fix: runtime.pythonAvailable
        ? undefined
        : "Install the configured Python interpreter or update alpSdk.pythonPath.",
    },
  ];

  if (!supportsServerForTarget(request.targetKind, request.server)) {
    checks.push({
      name: "serverCompatibility",
      status: "fail",
      detail: `${request.server} is not supported for ${request.targetKind}.`,
      fix: "Pick a supported backend for the selected target class.",
    });
    return createDoctorReport(context.generatedAt, request, checks);
  }

  switch (request.targetKind) {
    case "zephyr-mcu":
    case "baremetal-mcu":
      checks.push({
        name: "cortexDebugExtension",
        status: context.debuggerExtensions.cortexDebug ? "pass" : "fail",
        detail: context.debuggerExtensions.cortexDebug
          ? "marus25.cortex-debug is installed."
          : "marus25.cortex-debug is not installed.",
        fix: context.debuggerExtensions.cortexDebug
          ? undefined
          : "Install marus25.cortex-debug.",
      });
      checks.push(createBackendCheck(request.server, runtime));
      break;
    case "yocto-userspace":
      checks.push({
        name: "cppToolsExtension",
        status: context.debuggerExtensions.cppTools ? "pass" : "fail",
        detail: context.debuggerExtensions.cppTools
          ? "ms-vscode.cpptools is installed."
          : "ms-vscode.cpptools is not installed.",
        fix: context.debuggerExtensions.cppTools
          ? undefined
          : "Install ms-vscode.cpptools.",
      });
      checks.push({
        name: "gdb",
        status: runtime.gdbExecutable ? "pass" : "warn",
        detail:
          runtime.gdbExecutable ?? "No local gdb executable was found on PATH.",
        fix: runtime.gdbExecutable
          ? undefined
          : "Install gdb locally for symbolized remote debugging.",
      });
      break;
    case "native-host":
      checks.push({
        name: "codeLLDBExtension",
        status: context.debuggerExtensions.codeLLDB ? "pass" : "fail",
        detail: context.debuggerExtensions.codeLLDB
          ? "vadimcn.vscode-lldb is installed."
          : "vadimcn.vscode-lldb is not installed.",
        fix: context.debuggerExtensions.codeLLDB
          ? undefined
          : "Install vadimcn.vscode-lldb.",
      });
      checks.push({
        name: "lldb",
        status: runtime.lldbExecutable ? "pass" : "warn",
        detail:
          runtime.lldbExecutable ??
          "No local LLDB executable was found on PATH.",
        fix: runtime.lldbExecutable
          ? undefined
          : "Install LLDB or lldb-dap for native-host debug flows.",
      });
      break;
  }

  return createDoctorReport(context.generatedAt, request, checks);
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

  switch (targetKind) {
    case "zephyr-mcu": {
      const base: DebugProfile = {
        id: `alp:${targetKind}:${server}`,
        name: `Alp: Zephyr Debug (${serverLabel(server)})`,
        targetKind,
        adapter: "cortex-debug",
        server,
        os: "zephyr",
        executablePath: exe("${workspaceFolder}/build/app/zephyr/zephyr.elf"),
        cwd: "${workspaceFolder}",
      };

      switch (server) {
        case "openocd":
          return {
            ...base,
            openOcdConfigFiles: ["<resolved-openocd-board-cfg>"],
          };
        case "pyocd":
          return {
            ...base,
            targetId: "<resolved-target-id>",
          };
        case "jlink":
          return {
            ...base,
            device: "<resolved-device>",
            interface: "swd",
          };
        case "gdbserver":
        case "none":
          break;
      }
      break;
    }
    case "baremetal-mcu":
      return {
        id: `alp:${targetKind}:${server}`,
        name: `Alp: Baremetal Debug (${serverLabel(server)})`,
        targetKind,
        adapter: "cortex-debug",
        server,
        os: "baremetal",
        executablePath: exe("${workspaceFolder}/build/baremetal/app.elf"),
        cwd: "${workspaceFolder}",
        device: "<resolved-device>",
        interface: "swd",
        svdFile: "<resolved-svd>",
      };
    case "yocto-userspace":
      return {
        id: `alp:${targetKind}:${server}`,
        name: "Alp: Yocto Remote Debug",
        targetKind,
        adapter: "cppdbg",
        server,
        os: "yocto",
        executablePath: exe("${workspaceFolder}/build/yocto/app"),
        cwd: "${workspaceFolder}",
        miMode: "gdb",
        miDebuggerServerAddress: "<host>:<port>",
        miDebuggerPath: "<resolved-gdb>",
        setupCommands: [{ text: "-enable-pretty-printing" }],
      };
    case "native-host":
      return {
        id: `alp:${targetKind}:${server}`,
        name: "Alp: Native Sim Debug",
        targetKind,
        adapter: "codelldb",
        server,
        os: "host",
        executablePath: exe(
          "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
        ),
        cwd: "${workspaceFolder}",
      };
  }

  throw new Error(`Unsupported debug target '${targetKind}'.`);
}

function createDoctorReport(
  generatedAt: string,
  request: DebugDoctorRequest,
  checks: DoctorCheck[],
): DoctorReport {
  return {
    generatedAt,
    targetKind: request.targetKind,
    server: request.server,
    summary: {
      pass: countChecks(checks, "pass"),
      warn: countChecks(checks, "warn"),
      fail: countChecks(checks, "fail"),
    },
    checks,
    nextSteps: uniqueNextSteps(checks),
  };
}

function createBackendCheck(
  server: DebugServerKind,
  runtime: DebugRuntimeCapabilities,
): DoctorCheck {
  const executable = resolveBackendExecutable(server, runtime);
  return {
    name: `${server}Backend`,
    status: executable ? "pass" : "warn",
    detail: executable ?? `No ${server} executable was found on PATH.`,
    fix: executable
      ? undefined
      : `Install ${server} and make sure it is on PATH.`,
  };
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

function serverLabel(server: DebugServerKind): string {
  switch (server) {
    case "jlink":
      return "J-Link";
    case "openocd":
      return "OpenOCD";
    case "pyocd":
      return "pyOCD";
    case "gdbserver":
      return "gdbserver";
    case "none":
      return "local";
  }
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

function countChecks(
  checks: readonly DoctorCheck[],
  status: DoctorCheck["status"],
): number {
  return checks.filter((check) => check.status === status).length;
}

function countPreflightChecks(
  checks: readonly PreflightCheck[],
  status: PreflightStatus,
): number {
  return checks.filter((check) => check.status === status).length;
}

function uniqueNextSteps(checks: readonly DoctorCheck[]): string[] {
  const nextSteps = new Set<string>();
  for (const check of checks) {
    if (check.status === "pass" || !check.fix) continue;
    nextSteps.add(check.fix);
  }
  return [...nextSteps];
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
    case "codelldb":
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

function createProfileConfigurationChecks(
  profile: DebugProfile,
  context: DebugWorkspaceContext,
  dependencies: DebugPreflightDependencies,
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  if (profile.server === "jlink") {
    checks.push(
      createResolvedValueCheck(
        "device",
        profile.device,
        "Resolve J-Link device before launch.",
      ),
    );
  }

  if (profile.server === "openocd") {
    const configs = profile.openOcdConfigFiles ?? [];
    if (configs.length === 0) {
      checks.push({
        name: "openOcdConfig",
        status: "fail",
        detail: "OpenOCD config file list is empty.",
        fix: "Set openOcdConfigFiles before launch.",
      });
    } else {
      for (const configFile of configs) {
        const resolved = resolveWorkspacePath(configFile, context);
        if (!resolved) {
          checks.push({
            name: "openOcdConfig",
            status: "fail",
            detail: `OpenOCD config path is unresolved: ${configFile}`,
            fix: "Resolve OpenOCD config placeholders before launch.",
          });
          continue;
        }

        checks.push({
          name: "openOcdConfig",
          status: dependencies.pathExists(resolved) ? "pass" : "fail",
          detail: resolved,
          fix: dependencies.pathExists(resolved)
            ? undefined
            : "Provide a valid OpenOCD config file path.",
        });
      }
    }
  }

  if (profile.server === "pyocd") {
    checks.push(
      createResolvedValueCheck(
        "targetId",
        profile.targetId,
        "Resolve pyOCD targetId before launch.",
      ),
    );
  }

  if (profile.targetKind === "baremetal-mcu") {
    checks.push(
      createResolvedValueCheck(
        "svdFile",
        profile.svdFile,
        "Resolve SVD file path before launch.",
      ),
    );
  }

  if (profile.targetKind === "yocto-userspace") {
    checks.push(
      createResolvedValueCheck(
        "miDebuggerServerAddress",
        profile.miDebuggerServerAddress,
        "Resolve gdbserver address before launch.",
      ),
      createResolvedValueCheck(
        "miDebuggerPath",
        profile.miDebuggerPath,
        "Resolve local gdb path before launch.",
      ),
    );
  }

  return checks;
}

function createResolvedValueCheck(
  name: string,
  value: string | undefined,
  fix: string,
): PreflightCheck {
  const resolved = isResolvedValue(value);
  return {
    name,
    status: resolved ? "pass" : "fail",
    detail: value ?? "<unset>",
    fix: resolved ? undefined : fix,
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
