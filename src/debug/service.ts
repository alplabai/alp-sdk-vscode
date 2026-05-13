// SPDX-License-Identifier: Apache-2.0

import {
    DebugDoctorRequest,
    DebugInspectReport,
    DebugLaunchPreview,
    DebugRuntimeCapabilities,
    DebugServerChoice,
    DebugServerKind,
    DebugTargetChoice,
    DebugTargetKind,
    DebugWorkspaceContext,
    DoctorCheck,
    DoctorReport,
    LaunchConfigurationDraft,
} from "./models";

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
  return { ...context };
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
        : "Open a workspace containing an ALP project.",
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

export function createLaunchPreview(
  generatedAt: string,
  targetKind: DebugTargetKind,
  server: DebugServerKind,
): DebugLaunchPreview {
  return {
    generatedAt,
    targetKind,
    server,
    notes: [
      "This is a draft launch configuration generated by the extension.",
      "Placeholder fields such as <resolved-device> still need project-specific resolution.",
      "The long-term target is to resolve these values from the shared debug model.",
    ],
    launch: {
      version: "0.2.0",
      configurations: [createLaunchDraft(targetKind, server)],
    },
  };
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

function createLaunchDraft(
  targetKind: DebugTargetKind,
  server: DebugServerKind,
): LaunchConfigurationDraft {
  if (!supportsServerForTarget(targetKind, server)) {
    throw new Error(
      `Unsupported debug backend '${server}' for target '${targetKind}'.`,
    );
  }

  switch (targetKind) {
    case "zephyr-mcu": {
      const base: LaunchConfigurationDraft = {
        name: `ALP: Zephyr Debug (${serverLabel(server)})`,
        type: "cortex-debug",
        request: "launch",
        cwd: "${workspaceFolder}",
        executable: "${workspaceFolder}/build/app/zephyr/zephyr.elf",
        runToEntryPoint: "main",
        preLaunchTask: "alp: build active target",
      };
      switch (server) {
        case "openocd":
          return {
            ...base,
            servertype: "openocd",
            configFiles: ["<resolved-openocd-board-cfg>"],
          };
        case "pyocd":
          return {
            ...base,
            servertype: "pyocd",
            targetId: "<resolved-target-id>",
          };
        case "jlink":
          return {
            ...base,
            servertype: "jlink",
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
        name: `ALP: Baremetal Debug (${serverLabel(server)})`,
        type: "cortex-debug",
        request: "launch",
        servertype: server,
        cwd: "${workspaceFolder}",
        executable: "${workspaceFolder}/build/baremetal/app.elf",
        device: "<resolved-device>",
        interface: "swd",
        svdFile: "<resolved-svd>",
        preLaunchTask: "alp: build baremetal target",
      };
    case "yocto-userspace":
      return {
        name: "ALP: Yocto Remote Debug",
        type: "cppdbg",
        request: "launch",
        program: "${workspaceFolder}/build/yocto/app",
        cwd: "${workspaceFolder}",
        MIMode: "gdb",
        miDebuggerServerAddress: "<host>:<port>",
        miDebuggerPath: "<resolved-gdb>",
        setupCommands: [{ text: "-enable-pretty-printing" }],
        preLaunchTask: "alp: deploy and start gdbserver",
      };
    case "native-host":
      return {
        name: "ALP: Native Sim Debug",
        type: "codelldb",
        request: "launch",
        program: "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
        cwd: "${workspaceFolder}",
        preLaunchTask: "alp: build native_sim target",
      };
  }

  throw new Error(`Unsupported debug target '${targetKind}'.`);
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

function countChecks(
  checks: readonly DoctorCheck[],
  status: DoctorCheck["status"],
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
