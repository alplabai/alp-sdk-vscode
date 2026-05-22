// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { parseBoardModel } from "../configurator/service";
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

/**
 * Parse validator stderr output into structured issues.
 *
 * Handles two formats:
 *
 * 1. **Legacy** (`validate_board_yaml.py`):
 *    ```
 *    FAIL som preset: no preset for E1M-NX9999
 *         expected shared definition at metadata/boards/...
 *    WARN hw_compat: minor version mismatch
 *    hint: upgrade sdk to 0.5
 *    ```
 *
 * 2. **Rich ALP-B* blocks** (`alp_cli/validator.py`, Rust-style):
 *    ```
 *    error[ALP-B005]: SoM SKU 'E1M-NX9999' does not resolve
 *      --> board.yaml:3:8
 *       |
 *     3 | som: {sku: E1M-NX9999}
 *       |          ^^^^^^^^^^^^
 *       = hint: did you mean E1M-NX9?
 *       = see: docs/diagnostics/ALP-B005.md
 *    ```
 */
function parseValidationIssues(
  stderr: string,
  severity: ValidationSeverity,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = stderr.split(/\r?\n/);

  // Final summary lines emitted by validate_board_yaml.py main() — not actionable.
  const SUMMARY_RE = /^\S.*\.yaml:\s+(missing-preset|hardware|capability)/;
  // ALP-B* block header: `error[ALP-B001]: message`
  const RICH_HEADER_RE = /^(error|warning|note)\[(ALP-[A-Z]\d+)\]:\s*(.+)/;
  // Arrow line inside a rich block: `  --> path:line:col`
  const ARROW_RE = /^\s+-->\s+\S+:(\d+):(\d+)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim() || SUMMARY_RE.test(line)) {
      i++;
      continue;
    }

    // ── Rich ALP-B* block ──────────────────────────────────────────────────
    const richMatch = RICH_HEADER_RE.exec(line);
    if (richMatch) {
      const [, sevStr, code, message] = richMatch;
      const issue: ValidationIssue = {
        message: message.trim(),
        severity:
          sevStr === "error"
            ? "error"
            : sevStr === "warning"
              ? "warning"
              : "suggestion",
        code,
      };
      // Peek at the next line for the `-->` location arrow.
      if (i + 1 < lines.length) {
        const arrowMatch = ARROW_RE.exec(lines[i + 1]);
        if (arrowMatch) {
          issue.line = parseInt(arrowMatch[1], 10);
          issue.col = parseInt(arrowMatch[2], 10);
          // Skip through the rest of the block (source, underline, hint, see).
          i += 2;
          while (i < lines.length && /^\s+[|0-9^= ]/.test(lines[i])) {
            i++;
          }
          issues.push(issue);
          continue;
        }
      }
      issues.push(issue);
      i++;
      continue;
    }

    // ── Legacy FAIL / WARN lines ───────────────────────────────────────────
    const failMatch = /^(FAIL|WARN)\s+(.+)/.exec(line);
    if (failMatch) {
      const [, level, rest] = failMatch;
      const issueSeverity: ValidationSeverity =
        level === "WARN" ? "warning" : severity;
      // Collect indented continuation lines (aligned under the FAIL text).
      const parts: string[] = [rest.trim()];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
        i++;
        parts.push(lines[i].trim());
      }
      issues.push({
        message: parts.join("  "),
        severity: issueSeverity,
      });
      i++;
      continue;
    }

    // ── Hint / suggestion lines ────────────────────────────────────────────
    if (/^\s*(hint|suggestion|suggest):/i.test(line)) {
      issues.push({ message: line.trim(), severity: "suggestion" });
      i++;
      continue;
    }

    // Skip indented block continuation lines and OK/status lines.
    i++;
  }

  return issues;
}

/**
 * Pure-TypeScript structural pre-check for board.yaml.
 * Runs without invoking the Python validator and catches v2-specific
 * issues (bare top-level `os:`, missing `cores:` block) that would
 * otherwise block the build silently or surface only in the Python output.
 *
 * Returns a `clean` outcome when no structural issues are found.
 */
export function validateBoardYamlLocally(
  boardYamlText: string,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const model = parseBoardModel(boardYamlText);

  if (model.schema_version >= 2) {
    if (model.os !== undefined) {
      issues.push({
        message:
          "board.yaml v2: top-level 'os:' is not valid; move it into a 'cores:' block",
        severity: "error",
      });
    }
    if (!model.cores || Object.keys(model.cores).length === 0) {
      issues.push({
        message:
          "board.yaml v2: 'cores:' block is required and must have at least one entry",
        severity: "error",
      });
    }
  }

  const outcome: ValidationOutcome =
    issues.length === 0 ? "clean" : "schema-violation";
  return { outcome, issues };
}
