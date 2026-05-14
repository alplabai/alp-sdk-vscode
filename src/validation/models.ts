// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";

export type ValidationOutcome =
  | "clean"
  | "missing-preset"
  | "schema-violation"
  | "hardware-revision"
  | "failed";

export type ValidationSeverity = "error" | "warning" | "suggestion";

export interface ValidationWorkspaceContext extends ProjectContext {}

export interface ValidatorPlan {
  inputPath: string;
  scriptPath: string;
  args: string[];
  commandLine: string;
}

export interface ValidatorExecutionResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ValidationIssue {
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  outcome: ValidationOutcome;
  issues: ValidationIssue[];
}
