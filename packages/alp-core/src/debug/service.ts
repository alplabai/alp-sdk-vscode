// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { toPosix } from "../paths";

import {
  DebugAdapterKind,
  DebugDoctorRequest,
  DebugGenerationTraceDecision,
  DebugGenerationTraceReport,
  DebugInspectReport,
  DebugLaunchPreview,
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
  DebuggerExtensionsState,
  DoctorCheck,
  DoctorReport,
  LaunchConfigurationDraft,
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

/**
 * The extension that contributes each debug type — the ONE copy in the repo.
 *
 * Keyed by the DEBUG TYPE (`contributes.debuggers[].type`), not by the
 * extension name: `lldb` is contributed by vadimcn.vscode-lldb, whose *name* is
 * CodeLLDB. Verified against marus25.cortex-debug v1.12.1, ms-vscode.cpptools
 * v1.33.4 and vadimcn.vscode-lldb v1.12.2.
 *
 * Preflight, doctor and the surface all read this map, so re-pointing an entry
 * moves every message and every install prompt at once. It used to be written
 * out by hand in each of those places, which is how "native-host needs
 * Cortex-Debug" survived a green suite.
 */
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

/** Which `debuggerExtensions` flag reports the presence of each adapter. */
const DEBUG_ADAPTER_EXTENSION_FLAG: Record<
  DebugAdapterKind,
  keyof DebuggerExtensionsState
> = {
  "cortex-debug": "cortexDebug",
  cppdbg: "cppTools",
  lldb: "codeLLDB",
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

  checks.push(...nativeHostPlatformChecks(profile.targetKind, runtime));

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
      checks.push(
        createExtensionCheck("cortexDebugExtension", "cortex-debug", context),
      );
      checks.push(createBackendCheck(request.server, runtime));
      break;
    case "yocto-userspace":
      checks.push(createExtensionCheck("cppToolsExtension", "cppdbg", context));
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
      checks.push(createExtensionCheck("codeLLDBExtension", "lldb", context));
      // Doctor and preflight must agree on the host dead end, or doctor reports
      // a healthy native-host setup on the very box where F5 cannot work.
      checks.push(...nativeHostPlatformChecks(request.targetKind, runtime));
      // Informational, never a warn: CodeLLDB SHIPS its own LLDB (lldb/bin/ inside
      // vadimcn.vscode-lldb v1.12.2) and never consults PATH, so an lldb on PATH
      // is neither needed nor used. Warning about it put "Install LLDB or
      // lldb-dap" into `nextSteps` on every stock Windows box and made doctor
      // contradict `createServerToolCheck`, which now passes the same condition.
      checks.push({
        name: "lldb",
        status: "pass",
        detail:
          runtime.lldbExecutable ??
          "vadimcn.vscode-lldb ships its own LLDB, so none is needed on PATH.",
      });
      break;
  }

  return createDoctorReport(context.generatedAt, request, checks);
}

export function createLaunchPreview(
  generatedAt: string,
  targetKind: DebugTargetKind,
  server: DebugServerKind,
  slice?: ManifestSlice,
): DebugLaunchPreview {
  const profile = createDebugProfile(targetKind, server, slice);

  return {
    generatedAt,
    targetKind,
    server,
    notes: [
      "This is a draft launch configuration generated by the extension.",
      "Placeholder fields such as <resolved-device> still need project-specific resolution.",
      slice
        ? `Executable path resolved from the system manifest slice '${slice.core_id}'.`
        : "The long-term target is to resolve these values from the shared debug model.",
    ],
    launch: {
      version: "0.2.0",
      configurations: [debugProfileToLaunchDraft(profile)],
    },
  };
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

  // No profile sets `svdFile`: alp-sdk publishes no `.svd` and no path to one
  // (alp-sdk#948) — see `createSvdCheck`.
  switch (targetKind) {
    case "zephyr-mcu": {
      const base: DebugProfile = {
        id: `alp:${targetKind}:${server}`,
        name: `Alp: Zephyr Debug (${serverLabel(server)})`,
        targetKind,
        adapter: DEBUG_TARGET_ADAPTER[targetKind],
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
        adapter: DEBUG_TARGET_ADAPTER[targetKind],
        server,
        os: "baremetal",
        executablePath: exe("${workspaceFolder}/build/baremetal/app.elf"),
        cwd: "${workspaceFolder}",
        device: "<resolved-device>",
        interface: "swd",
      };
    case "yocto-userspace":
      return {
        id: `alp:${targetKind}:${server}`,
        name: "Alp: Yocto Remote Debug",
        targetKind,
        adapter: DEBUG_TARGET_ADAPTER[targetKind],
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
        adapter: DEBUG_TARGET_ADAPTER[targetKind],
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

export function debugProfileToLaunchDraft(
  profile: DebugProfile,
): LaunchConfigurationDraft {
  switch (profile.targetKind) {
    case "zephyr-mcu": {
      const base: LaunchConfigurationDraft = {
        name: profile.name,
        type: profile.adapter,
        request: "launch",
        cwd: profile.cwd,
        executable: profile.executablePath,
        runToEntryPoint: "main",
        // Key present only when a real file RESOLVED — truthiness is not enough:
        // cortex-debug OPENS svdFile, so a `<resolved-svd>` string would be
        // taken as a filename and kill a session that preflight only warned on.
        ...(isResolvedValue(profile.svdFile)
          ? { svdFile: profile.svdFile }
          : {}),
      };

      if (profile.server === "openocd") {
        return {
          ...base,
          servertype: "openocd",
          configFiles: profile.openOcdConfigFiles,
        };
      }

      if (profile.server === "pyocd") {
        return {
          ...base,
          servertype: "pyocd",
          targetId: profile.targetId,
        };
      }

      return {
        ...base,
        servertype: "jlink",
        device: profile.device,
        interface: profile.interface,
      };
    }
    case "baremetal-mcu":
      return {
        name: profile.name,
        type: profile.adapter,
        request: "launch",
        servertype: profile.server,
        cwd: profile.cwd,
        executable: profile.executablePath,
        device: profile.device,
        interface: profile.interface,
        // Same rule as the zephyr-mcu draft above: omitted when unresolved.
        ...(isResolvedValue(profile.svdFile)
          ? { svdFile: profile.svdFile }
          : {}),
      };
    case "yocto-userspace":
      return {
        name: profile.name,
        type: profile.adapter,
        request: "launch",
        program: profile.executablePath,
        cwd: profile.cwd,
        MIMode: profile.miMode,
        miDebuggerServerAddress: profile.miDebuggerServerAddress,
        miDebuggerPath: profile.miDebuggerPath,
        setupCommands: profile.setupCommands,
      };
    case "native-host":
      return {
        name: profile.name,
        type: profile.adapter,
        request: "launch",
        program: profile.executablePath,
        cwd: profile.cwd,
      };
  }
}

/** OpenOCD's board config is a LIST whose entries also get a per-file existence
 *  check, so it sits outside `requiredPlaceholderFields`. This is the one
 *  customer-facing name both paths use, so they cannot word it differently. */
const OPENOCD_CONFIG_LABEL = "OpenOCD board config file";

/**
 * The profile fields that MUST resolve before a session can start, in one
 * place, so the preflight check and the customer-facing
 * `unresolvedRequiredFields` cannot drift on what "required" means.
 *
 * `name` is the internal `PreflightCheck` id (report/panel wiring, never shown
 * in a toast); `label` is what a customer is told to go and supply.
 *
 * Derived from the fields the profile ACTUALLY carries, because those are
 * exactly the keys `debugProfileToLaunchDraft` emits. Switching on `server`
 * instead was wrong for baremetal-mcu, which ignores `server` entirely and
 * always emits device+interface: baremetal-mcu + pyocd named "the pyOCD target
 * id" — a key not in the file — while the `<resolved-device>` that IS in the
 * file went unnamed.
 *
 * `svdFile` is deliberately absent: it is optional to cortex-debug and only
 * feeds the peripheral/register view, so it warns (`createSvdCheck`) and never
 * blocks. `openOcdConfigFiles` is a list whose entries also get a per-file
 * existence check, so it is handled separately by both callers.
 */
function requiredPlaceholderFields(profile: DebugProfile): ReadonlyArray<{
  name: string;
  label: string;
  value: string | undefined;
  fix: string;
}> {
  const fields = [
    {
      name: "device",
      // cortex-debug reads `device` for J-Link; baremetal-mcu emits it whatever
      // the server is, and telling a pyOCD user to supply a "J-Link device
      // name" would be a lie.
      label:
        profile.server === "jlink" ? "J-Link device name" : "probe device name",
      value: profile.device,
      fix: "Resolve J-Link device before launch.",
    },
    {
      name: "targetId",
      label: "pyOCD target id",
      value: profile.targetId,
      fix: "Resolve pyOCD targetId before launch.",
    },
    {
      name: "miDebuggerServerAddress",
      label: "gdbserver address (host:port)",
      value: profile.miDebuggerServerAddress,
      fix: "Resolve gdbserver address before launch.",
    },
    {
      name: "miDebuggerPath",
      label: "gdb executable path",
      value: profile.miDebuggerPath,
      fix: "Resolve local gdb path before launch.",
    },
  ];

  return fields.filter((field) => field.value !== undefined);
}

/**
 * Customer-facing names of the required fields this profile still carries as
 * `<placeholder>` — "J-Link device name", not the internal check id `device`.
 * Empty when the profile is launchable as far as its own fields go.
 *
 * These genuinely cannot be resolved here: alp-sdk metadata carries no J-Link
 * device name, no OpenOCD board config and no pyOCD target id, so the extension
 * has nothing to substitute. Naming them is all a surface can do, and it is
 * strictly better than the failing-check ids it would otherwise print.
 *
 * `svdFile` is never listed — it is optional, warns rather than fails, and a
 * customer being told to supply one for a breakpoint would be wrong.
 */
export function unresolvedRequiredFields(profile: DebugProfile): string[] {
  const unresolved = requiredPlaceholderFields(profile)
    .filter((field) => !isResolvedValue(field.value))
    .map((field) => field.label);

  // Presence, not `server === "openocd"`: baremetal-mcu emits no `configFiles`
  // key at all, whatever its servertype, so naming the OpenOCD board config
  // there would point the customer at a key that is not in their file.
  const configs = profile.openOcdConfigFiles;
  if (
    configs &&
    (configs.length === 0 || configs.some((file) => !isResolvedValue(file)))
  ) {
    unresolved.push(OPENOCD_CONFIG_LABEL);
  }

  return unresolved;
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
  return createExtensionCheck("adapterExtension", profile.adapter, context);
}

/** The one place an adapter-extension check is worded, for preflight and doctor
 *  alike. `name` is the caller's check id; everything else comes off
 *  `DEBUG_ADAPTER_EXTENSION_ID`, so no message can name an extension the
 *  profile does not actually launch with. */
function createExtensionCheck(
  name: string,
  adapter: DebugAdapterKind,
  context: DebugWorkspaceContext,
): PreflightCheck {
  const id = DEBUG_ADAPTER_EXTENSION_ID[adapter];
  const installed =
    context.debuggerExtensions[DEBUG_ADAPTER_EXTENSION_FLAG[adapter]];
  return {
    name,
    status: installed ? "pass" : "fail",
    detail: installed ? `${id} is installed.` : `${id} is not installed.`,
    fix: installed ? undefined : `Install ${id}.`,
  };
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
 * host. Both `buildDebugPreflightReport` and `buildDoctorReport` call it, so
 * the two cannot disagree about whether this box can run the target.
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

function createProfileConfigurationChecks(
  profile: DebugProfile,
  context: DebugWorkspaceContext,
  dependencies: DebugPreflightDependencies,
): PreflightCheck[] {
  const checks: PreflightCheck[] = requiredPlaceholderFields(profile).map(
    (field) => createResolvedValueCheck(field.name, field.value, field.fix),
  );

  // Same presence rule as `unresolvedRequiredFields`: only check the list when
  // the profile actually carries one, because that is when it is written.
  const configs = profile.openOcdConfigFiles;
  if (configs) {
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

  // cortex-debug is the only adapter that reads svdFile, and it reads it for
  // zephyr-mcu and baremetal-mcu alike.
  if (profile.adapter === "cortex-debug") {
    checks.push(createSvdCheck(profile));
  }

  return checks;
}

/**
 * SVD is OPTIONAL to cortex-debug: it populates the peripheral/register view
 * (mcu-debug.peripheral-viewer) and affects nothing else — the session starts,
 * breakpoints hit and memory reads work without it. So this WARNS and never
 * fails. It used to be a `fail` on baremetal-mcu, which put it in
 * `summary.fail` and so drove `canLaunch` false: a missing register view
 * blocked the launch outright. A missing SVD must never stop a customer
 * setting a breakpoint.
 *
 * Warn is the normal state right now and nothing in this repo can change it:
 * alp-sdk ships no `.svd` files and its metadata carries no path to one
 * (alp-sdk#948), and this is a thin extension — it must not vendor an SVD or
 * invent where one lives. So no profile sets `svdFile`; when the SDK starts
 * publishing per-SoC SVD metadata, `createDebugProfile` is where it gets read,
 * and `debugProfileToLaunchDraft` already emits the key only once it RESOLVES
 * (cortex-debug OPENS `svdFile`, so a placeholder is worse than no key).
 *
 * No `fix` on the unresolved branch: `uniquePreflightNextSteps` collects `fix`
 * from every non-pass check, so advice nobody can act on would be mixed into
 * `nextSteps` permanently — and the surface interpolates those into the toast
 * detail and into every support bundle. The explanation stays in `detail`.
 */
function createSvdCheck(profile: DebugProfile): PreflightCheck {
  const resolved = isResolvedValue(profile.svdFile);
  return {
    name: "svdFile",
    status: resolved ? "pass" : "warn",
    detail: resolved
      ? profile.svdFile!
      : "No SVD file is available, so the peripheral/register view will be empty. Debugging is otherwise unaffected.",
  };
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

/**
 * An UNRESOLVED placeholder this extension emitted, written `<like-this>`.
 *
 * The two brace styles in a launch configuration mean opposite things, and
 * that is the trap:
 *
 * - `${...}` is a VS Code **variable substitution** — `${workspaceFolder}`,
 *   `${env:HOME}`, `${command:...}`. VS Code expands these itself at launch, so
 *   `${workspaceFolder}/build/app/zephyr/zephyr.elf` is fully resolved as far as
 *   we are concerned and must keep passing. No `<` or `>` is involved.
 * - `<...>` is OUR "nobody filled this in yet" marker — `<resolved-device>`,
 *   `<resolved-target-id>`, `<resolved-openocd-board-cfg>`, `<resolved-gdb>`,
 *   and the two-token `<host>:<port>`. Nothing expands these. Handed to a debug
 *   adapter verbatim they are a literal device name / file path / TCP address,
 *   which fails at launch or, worse, silently mis-targets.
 *
 * So the test is any angle-bracket token, not the `<resolved` prefix: the old
 * `value.includes("<resolved")` passed `<host>:<port>` as resolved and let
 * `canLaunch` go true for a Yocto profile with an unusable gdbserver address.
 */
const UNRESOLVED_PLACEHOLDER = /<[^<>]*>/;

/** Exported so `launchJsonCore` decides "is this filled in?" with the SAME
 *  predicate the preflight checks use — the merge that protects a customer's
 *  hand-typed value must agree, key for key, with what preflight calls
 *  unresolved. */
export function isResolvedValue(value: string | undefined): boolean {
  return Boolean(value && !UNRESOLVED_PLACEHOLDER.test(value));
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
