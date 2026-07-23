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

/**
 * Async twin of {@link executeValidatorPlanWithSpawn}. The injected spawner
 * returns a promise so the caller (the LSP server) never blocks its event loop
 * on the validator subprocess. Cancellation is the caller's concern — it owns
 * the child's lifetime and decides whether to act on a late result — so this
 * function stays a pure plan→result mapping with no signal of its own.
 */
export type SpawnAsyncLike = (
  command: string,
  args: string[],
) => Promise<SpawnSyncResultLike>;

export async function executeValidatorPlanAsync(
  context: ValidationWorkspaceContext,
  plan: ValidatorPlan,
  spawnAsync: SpawnAsyncLike,
): Promise<ValidatorExecutionResult> {
  const result = await spawnAsync(context.pythonBinary, [
    plan.scriptPath,
    ...plan.args,
  ]);

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
