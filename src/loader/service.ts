// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import {
    EmitMode,
    LoaderBatchEntry,
    LoaderBatchSummary,
    LoaderPlan,
    LoaderWorkspaceContext,
} from "./models";

export const DEFAULT_OUTPUT: Readonly<Record<EmitMode, string>> = {
  "zephyr-conf": "build/generated/alp.conf",
  "dts-overlay": "build/generated/alp.overlay",
  "cmake-args": "build/generated/alp-cmake-args.txt",
  "yocto-conf": "build/generated/alp-yocto.conf",
};

export const ALL_EMIT_MODES: readonly EmitMode[] = [
  "zephyr-conf",
  "dts-overlay",
  "cmake-args",
  "yocto-conf",
];

export function createLoaderPlan(
  context: LoaderWorkspaceContext,
  emit: EmitMode,
): LoaderPlan {
  const workspaceRoot = requireWorkspaceRoot(context.workspaceRoot);
  const sdkRoot = requireSdkRoot(context.sdkRoot);
  const boardPath = requireBoardYamlPath(context.boardYamlPath);
  const outputPath = path.join(workspaceRoot, DEFAULT_OUTPUT[emit]);
  const scriptPath = path.join(sdkRoot, "scripts", "alp_project.py");
  const args = ["--input", boardPath, "--emit", emit, "--output", outputPath];

  return {
    emit,
    outputPath,
    scriptPath,
    args,
    commandLine: `${context.pythonBinary} ${scriptPath} ${args.join(" ")}`,
  };
}

export function summarizeLoaderBatch(
  workspaceRoot: string,
  entries: readonly LoaderBatchEntry[],
): LoaderBatchSummary {
  const written: string[] = [];
  const failed: EmitMode[] = [];

  for (const entry of entries) {
    if (entry.exists && entry.size > 0) {
      written.push(path.relative(workspaceRoot, entry.outputPath));
    } else {
      failed.push(entry.emit);
    }
  }

  return { written, failed };
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (!workspaceRoot) {
    throw new Error("Alp: no workspace folder is open.");
  }
  return workspaceRoot;
}

function requireSdkRoot(sdkRoot: string | null): string {
  if (!sdkRoot) {
    throw new Error(
      "Alp: alp-sdk root is unresolved. Set `alpSdk.path` to the directory that contains scripts/alp_project.py (required when workspace layout is ambiguous).",
    );
  }
  return sdkRoot;
}

function requireBoardYamlPath(boardYamlPath: string | null): string {
  if (!boardYamlPath) {
    throw new Error("Alp: no workspace folder is open.");
  }
  return boardYamlPath;
}
