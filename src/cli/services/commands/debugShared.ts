// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import {
  collectRuntimeCapabilitiesFromCommands,
  createDebugWorkspaceContext,
} from "../../../debug/adapterCore";
import {
  DebugRuntimeCapabilities,
  DebugServerKind,
  DebugTargetKind,
  DebugWorkspaceContext,
} from "../../../debug/models";
import { serverChoicesForTarget } from "../../../debug/service";
import { ProjectContext, ProjectSettings } from "../../../project/models";
import { resolveProjectContext } from "../../../project/service";
import { CliExecutionInput, CliGlobalFlags } from "../../models";

export interface CliDebugContext {
  generatedAt: string;
  workspaceRoot: string;
  projectContext: ProjectContext;
  debugContext: DebugWorkspaceContext;
}

export function resolveCliDebugContext(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliDebugContext {
  const workspaceRoot = path.resolve(input.cwd, flags.projectPath ?? ".");
  const settings: ProjectSettings = {
    sdkPath: flags.sdkRoot ?? "",
    pythonPath: "",
    boardYamlPath: flags.boardYamlPath ?? "board.yaml",
    westCwd: "",
  };

  const projectContext = resolveProjectContext(
    {
      workspaceFolders: [workspaceRoot],
      settings,
      platform: input.platform,
    },
    input.pathExists,
  );

  const generatedAt = new Date().toISOString();
  const debugContext = createDebugWorkspaceContext(projectContext, {
    generatedAt,
    boardYamlExists: input.pathExists,
    debuggerExtensions: {
      cortexDebug: true,
      cppTools: true,
      codeLLDB: true,
    },
  });

  return {
    generatedAt,
    workspaceRoot,
    projectContext,
    debugContext,
  };
}

export function parseTargetKind(raw: string | null): DebugTargetKind {
  if (!raw) {
    return "native-host";
  }

  if (
    raw === "zephyr-mcu" ||
    raw === "baremetal-mcu" ||
    raw === "yocto-userspace" ||
    raw === "native-host"
  ) {
    return raw;
  }

  throw new Error(
    `Unsupported --target-kind '${raw}'. Allowed values: zephyr-mcu, baremetal-mcu, yocto-userspace, native-host.`,
  );
}

export function parseServerKind(raw: string | null): DebugServerKind {
  if (!raw) {
    return "none";
  }

  if (
    raw === "jlink" ||
    raw === "openocd" ||
    raw === "pyocd" ||
    raw === "gdbserver" ||
    raw === "none"
  ) {
    return raw;
  }

  throw new Error(
    `Unsupported --server '${raw}'. Allowed values: jlink, openocd, pyocd, gdbserver, none.`,
  );
}

export function isServerSupportedForTarget(
  targetKind: DebugTargetKind,
  server: DebugServerKind,
): boolean {
  return serverChoicesForTarget(targetKind).some(
    (choice) => choice.server === server,
  );
}

export function commandExistsOnPath(
  input: Omit<CliExecutionInput, "argv">,
  command: string,
): boolean {
  const resolver = input.platform === "win32" ? "where" : "which";
  const result = input.spawnSync(resolver, [command], { encoding: "utf8" });
  return result.status === 0;
}

export function collectRuntimeCapabilitiesForCli(
  context: ProjectContext,
  input: Omit<CliExecutionInput, "argv">,
): DebugRuntimeCapabilities {
  return collectRuntimeCapabilitiesFromCommands(context, (command) =>
    commandExistsOnPath(input, command),
  );
}
