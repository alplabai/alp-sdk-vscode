// SPDX-License-Identifier: Apache-2.0

import {
    ValidationWorkspaceContext,
    ValidatorExecutionResult,
    ValidatorPlan,
} from "./models";

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

export function executeValidatorPlanWithSpawn(
  context: ValidationWorkspaceContext,
  plan: ValidatorPlan,
  spawnSync: SpawnSyncLike,
): ValidatorExecutionResult {
  const result = spawnSync(
    context.pythonBinary,
    [plan.scriptPath, ...plan.args],
    {
      encoding: "utf8",
    },
  );

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
