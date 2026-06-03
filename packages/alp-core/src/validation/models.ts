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
  /** ALP-B* diagnostic code (e.g. "ALP-B005"), present when emitted by the rich validator. */
  code?: string;
  /** 1-based line number within board.yaml when the validator pinpoints a location. */
  line?: number;
  /** 1-based column number within board.yaml when the validator pinpoints a location. */
  col?: number;
}

export interface ValidationResult {
  outcome: ValidationOutcome;
  issues: ValidationIssue[];
}
