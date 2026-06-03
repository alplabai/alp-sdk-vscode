// SPDX-License-Identifier: Apache-2.0

import * as cp from "child_process";
import { collectProjectContext } from "../project/vscodeAdapter";
import { executeValidatorPlanWithSpawn } from "@alp-sdk/core/validation/adapterCore";
import {
  ValidationWorkspaceContext,
  ValidatorExecutionResult,
  ValidatorPlan,
} from "@alp-sdk/core/validation/models";

export function collectValidationWorkspaceContext(): ValidationWorkspaceContext {
  return collectProjectContext();
}

export function executeValidatorPlan(
  context: ValidationWorkspaceContext,
  plan: ValidatorPlan,
): ValidatorExecutionResult {
  return executeValidatorPlanWithSpawn(context, plan, cp.spawnSync);
}
