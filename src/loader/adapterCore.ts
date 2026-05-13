// SPDX-License-Identifier: Apache-2.0

import { LoaderBatchEntry, LoaderPlan, ScriptExecutionResult } from "./models";

export interface SpawnSyncResultLike {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

export type SpawnSyncLike = (
  command: string,
  args: string[],
  options: { encoding: "utf8" },
) => SpawnSyncResultLike;

export interface LoaderFileInspectorDependencies {
  existsSync(path: string): boolean;
  statSync(path: string): { size: number };
}

export function boardYamlExistsWithDependencies(
  boardPath: string | null,
  existsSync: (path: string) => boolean,
): boolean {
  return boardPath ? existsSync(boardPath) : false;
}

export function executeLoaderPlanWithSpawn(
  pythonBinary: string,
  plan: LoaderPlan,
  spawnSync: SpawnSyncLike,
): ScriptExecutionResult {
  const result = spawnSync(pythonBinary, [plan.scriptPath, ...plan.args], {
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function inspectGeneratedFileWithDependencies(
  plan: LoaderPlan,
  dependencies: LoaderFileInspectorDependencies,
): LoaderBatchEntry {
  if (!dependencies.existsSync(plan.outputPath)) {
    return {
      emit: plan.emit,
      outputPath: plan.outputPath,
      exists: false,
      size: 0,
    };
  }

  const stat = dependencies.statSync(plan.outputPath);
  return {
    emit: plan.emit,
    outputPath: plan.outputPath,
    exists: true,
    size: stat.size,
  };
}
