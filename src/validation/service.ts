// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import {
    ValidationIssue,
    ValidationOutcome,
    ValidationResult,
    ValidationSeverity,
    ValidationWorkspaceContext,
    ValidatorExecutionResult,
    ValidatorPlan,
} from "./models";

export function isBoardYamlPath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === "board.yaml";
}

export function createValidatorPlan(
  context: ValidationWorkspaceContext,
  inputPath: string,
): ValidatorPlan {
  if (!context.sdkRoot) {
    throw new Error(
      "Alp: alp-sdk root is unresolved. Set `alpSdk.path` when multiple workspace folders could match an SDK checkout.",
    );
  }

  const scriptPath = path.join(
    context.sdkRoot,
    "scripts",
    "validate_board_yaml.py",
  );
  const args = ["--input", inputPath];

  return {
    inputPath,
    scriptPath,
    args,
    commandLine: `${context.pythonBinary} ${scriptPath} ${args.join(" ")}`,
  };
}

export function analyzeValidationResult(
  execution: ValidatorExecutionResult,
): ValidationResult {
  const outcome = classifyValidationOutcome(execution.status);
  return {
    outcome,
    issues: parseValidationIssues(
      execution.stderr,
      severityForOutcome(outcome),
    ),
  };
}

function classifyValidationOutcome(status: number | null): ValidationOutcome {
  if (status === 0) return "clean";
  if (status === 2) return "missing-preset";
  if (status === 3) return "hardware-revision";
  if (status === 1) return "schema-violation";
  return "failed";
}

function severityForOutcome(outcome: ValidationOutcome): ValidationSeverity {
  return outcome === "missing-preset" ? "warning" : "error";
}

function parseValidationIssues(
  stderr: string,
  severity: ValidationSeverity,
): ValidationIssue[] {
  return stderr
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter(
      (line) =>
        !/^\s*\S+:\s+missing-preset/.test(line) &&
        !/^\s*\S+:\s+hardware-revision/.test(line),
    )
    .map((message) => ({
      message: message.trim(),
      severity,
    }));
}
