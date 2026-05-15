// SPDX-License-Identifier: Apache-2.0

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import {
    collectRuntimeCapabilitiesFromCommands,
    createDebugWorkspaceContext,
} from "@alp-sdk/core/debug/adapterCore";
import { DebugRuntimeCapabilities, DebugWorkspaceContext } from "@alp-sdk/core/debug/models";

export function collectWorkspaceDebugContext(): DebugWorkspaceContext {
  const project = collectProjectContext();

  return createDebugWorkspaceContext(project, {
    generatedAt: new Date().toISOString(),
    boardYamlExists: (path) => fs.existsSync(path),
    debuggerExtensions: {
      cortexDebug: hasExtension("marus25.cortex-debug"),
      cppTools: hasExtension("ms-vscode.cpptools"),
      codeLLDB: hasExtension("vadimcn.vscode-lldb"),
    },
  });
}

export function collectRuntimeCapabilities(): DebugRuntimeCapabilities {
  return collectRuntimeCapabilitiesFromCommands(
    collectProjectContext(),
    commandOnPath,
  );
}

export function launchJsonPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "launch.json");
}

export function readLaunchJson(workspaceRoot: string): string | null {
  const filePath = launchJsonPath(workspaceRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf-8");
}

export function writeLaunchJson(
  workspaceRoot: string,
  content: string,
): string {
  const filePath = launchJsonPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function writeSupportBundle(
  workspaceRoot: string,
  fileName: string,
  content: string,
): string {
  const outputPath = path.join(workspaceRoot, ".alp-support", fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf-8");
  return outputPath;
}

function hasExtension(extensionId: string): boolean {
  return vscode.extensions.getExtension(extensionId) !== undefined;
}

function commandOnPath(command: string): boolean {
  const resolver = process.platform === "win32" ? "where" : "which";
  const result = cp.spawnSync(resolver, [command], { encoding: "utf8" });
  return result.status === 0;
}
