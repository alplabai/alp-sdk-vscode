// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";
import {
  DebugRuntimeCapabilities,
  DebugWorkspaceContext,
  DebuggerExtensionsState,
} from "./models";

export interface DebugWorkspaceDependencies {
  generatedAt: string;
  boardYamlExists(path: string): boolean;
  debuggerExtensions: DebuggerExtensionsState;
}

export type CommandOnPath = (command: string) => boolean;

export function createDebugWorkspaceContext(
  project: ProjectContext,
  dependencies: DebugWorkspaceDependencies,
): DebugWorkspaceContext {
  return {
    generatedAt: dependencies.generatedAt,
    ...project,
    boardYamlExists: project.boardYamlPath
      ? dependencies.boardYamlExists(project.boardYamlPath)
      : false,
    debuggerExtensions: dependencies.debuggerExtensions,
  };
}

export function collectRuntimeCapabilitiesFromCommands(
  project: ProjectContext,
  commandOnPath: CommandOnPath,
): DebugRuntimeCapabilities {
  return {
    pythonAvailable: commandOnPath(project.pythonBinary),
    jlinkExecutable: firstAvailable(
      ["JLinkGDBServerCL", "JLinkGDBServer"],
      commandOnPath,
    ),
    openOcdExecutable: firstAvailable(["openocd"], commandOnPath),
    pyocdExecutable: firstAvailable(["pyocd"], commandOnPath),
    gdbExecutable: firstAvailable(["gdb", "arm-none-eabi-gdb"], commandOnPath),
    lldbExecutable: firstAvailable(["lldb-dap", "lldb"], commandOnPath),
  };
}

function firstAvailable(
  commands: readonly string[],
  commandOnPath: CommandOnPath,
): string | null {
  for (const command of commands) {
    if (commandOnPath(command)) {
      return command;
    }
  }

  return null;
}
