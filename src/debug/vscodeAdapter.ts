// SPDX-License-Identifier: Apache-2.0

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import { runDoctor } from "../alpCli/doctor";
import type { CliOutcome } from "../alpCli/models";
import {
  collectRuntimeCapabilitiesFromCommands,
  createDebugWorkspaceContext,
} from "@alp-sdk/core/debug/adapterCore";
import {
  DebugRuntimeCapabilities,
  DebugWorkspaceContext,
} from "@alp-sdk/core/debug/models";
import type { DoctorEnvelopeData } from "@alp-sdk/core/cli/doctorEnvelope";

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
  return {
    ...collectRuntimeCapabilitiesFromCommands(
      collectProjectContext(),
      commandOnPath,
    ),
    // The one host fact the pure debug service cannot read for itself, and the
    // one that decides whether `native-host` is debuggable at all: native_sim
    // builds a Linux executable, so the target is a dead end on win32. Supplied
    // here rather than in adapterCore's PATH probe because it is the OS, not a
    // tool — see DebugRuntimeCapabilities.hostPlatform.
    hostPlatform: process.platform,
  };
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Run plain `tan doctor` — target-agnostic, so it takes no `targetKind`/
 * `server` (#376): "can this machine and project build and debug at all" is
 * one question, not one per debug target. Per-target readiness stays
 * `alp.debugPreflight`'s job (`buildDebugPreflightReport`, in-process).
 *
 * Delegates to the ONE shared doctor spawn (`../alpCli/doctor`) so this slice
 * and the Dependencies panel (`src/deps/vscodeAdapter.ts`) never drift into
 * two ways of running the same command.
 *
 * Returns `outcome` alongside the convenience fields: `alp.debugDoctor`'s
 * degraded path needs the full `CliOutcome` to route its toast through
 * `planCliOutcome` (never a bare, buttonless sentence built off `message`
 * alone) — see `runDoctor`'s own doc.
 */
export async function runDebugDoctor(
  context: vscode.ExtensionContext,
  cwd: string,
  options: { signal?: AbortSignal; interactive?: boolean } = {},
): Promise<{
  data: DoctorEnvelopeData | null;
  message: string;
  detail?: string;
  outcome: CliOutcome;
}> {
  return runDoctor(
    context,
    ["doctor"],
    cwd,
    options.signal,
    options.interactive === true,
  );
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
