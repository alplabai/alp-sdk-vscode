// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { ProjectSettings } from "@alp-sdk/core/project/models";
import { resolveProjectContext } from "@alp-sdk/core/project/service";
import { executeValidatorPlanWithSpawn } from "@alp-sdk/core/validation/adapterCore";
import { ValidationOutcome } from "@alp-sdk/core/validation/models";
import {
  analyzeValidationResult,
  createValidatorPlan,
} from "@alp-sdk/core/validation/service";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliFormat,
  CliGlobalFlags,
  CliIssue,
  ValidateCommandData,
  ValidateCommandResult,
} from "../../models";
import { createEnvelope } from "../envelope";

export function runValidateCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<ValidateCommandData> {
  try {
    const workspaceRoot = path.resolve(input.cwd, flags.projectPath ?? ".");
    const settings: ProjectSettings = {
      sdkPath: flags.sdkRoot ?? "",
      pythonPath: "",
      boardYamlPath: flags.boardYamlPath ?? "board.yaml",
      westCwd: "",
    };
    const context = resolveProjectContext(
      {
        workspaceFolders: [workspaceRoot],
        settings,
        platform: input.platform,
      },
      input.pathExists,
    );

    if (!context.boardYamlPath || !input.pathExists(context.boardYamlPath)) {
      return createValidationFailure(
        flags.format,
        context,
        "board-yaml-missing",
        "board.yaml path could not be resolved or the file does not exist.",
      );
    }

    if (!context.sdkRoot) {
      return createValidationFailure(
        flags.format,
        context,
        "sdk-root-unresolved",
        "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
      );
    }

    const plan = createValidatorPlan(context, context.boardYamlPath);
    const execution = executeValidatorPlanWithSpawn(
      context,
      plan,
      input.spawnSync,
    );
    const validation = analyzeValidationResult(execution);
    const commandResult: ValidateCommandResult = {
      context,
      validation,
      commandLine: plan.commandLine,
    };

    return formatValidateResult(commandResult, flags);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI validation failure.";
    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.internalFailure,
      textLines: ["validate: internal failure", message],
      envelope: createEnvelope(
        "validate",
        {
          root: null,
          boardYaml: null,
        },
        {
          schemaVersion: "1",
          outcome: "failed",
          issueCount: 1,
          commandLine: "",
          boardYamlPath: "",
        },
        [
          {
            code: "validate.internal-failure",
            severity: "error",
            message,
          },
        ],
        CLI_EXIT_CODE.internalFailure,
      ),
    };
  }
}

function createValidationFailure(
  format: CliFormat,
  context: { workspaceRoot: string | null; boardYamlPath: string | null },
  issueCode: string,
  message: string,
): CliExecutionResult<ValidateCommandData> {
  return {
    format,
    exitCode: CLI_EXIT_CODE.validationFailure,
    textLines: ["validate: validation failure", message],
    envelope: createEnvelope(
      "validate",
      {
        root: context.workspaceRoot,
        boardYaml: context.boardYamlPath,
      },
      {
        schemaVersion: "1",
        outcome: "failed",
        issueCount: 1,
        commandLine: "",
        boardYamlPath: context.boardYamlPath ?? "",
      },
      [
        {
          code: `validate.${issueCode}`,
          severity: "error",
          message,
        },
      ],
      CLI_EXIT_CODE.validationFailure,
    ),
  };
}

function formatValidateResult(
  commandResult: ValidateCommandResult,
  flags: CliGlobalFlags,
): CliExecutionResult<ValidateCommandData> {
  const exitCode = validationOutcomeExitCode(commandResult.validation.outcome);
  const issues = toCliIssues(
    commandResult.validation.outcome,
    commandResult.validation.issues,
  );
  const payload: ValidateCommandData = {
    schemaVersion: "1",
    outcome: commandResult.validation.outcome,
    issueCount: issues.length,
    commandLine: commandResult.commandLine,
    boardYamlPath: commandResult.context.boardYamlPath ?? "",
  };

  const textLines = formatValidateText(commandResult, issues, flags);

  return {
    format: flags.format,
    exitCode,
    textLines,
    envelope: createEnvelope(
      "validate",
      {
        root: commandResult.context.workspaceRoot,
        boardYaml: commandResult.context.boardYamlPath,
      },
      payload,
      issues,
      exitCode,
    ),
  };
}

function toCliIssues(
  outcome: ValidationOutcome,
  issues: readonly {
    message: string;
    severity: "warning" | "error" | "suggestion";
  }[],
): CliIssue[] {
  const mapped = issues.map((issue) => ({
    code: `validate.${outcome}`,
    severity: issue.severity,
    message: issue.message,
  }));

  if (mapped.length > 0) {
    return mapped;
  }

  if (outcome === "clean") {
    return [];
  }

  return [
    {
      code: `validate.${outcome}`,
      severity: "error",
      message: `Validation ended with outcome '${outcome}'.`,
    },
  ];
}

function formatValidateText(
  commandResult: ValidateCommandResult,
  issues: readonly CliIssue[],
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines: string[] = [];
  if (commandResult.validation.outcome === "clean") {
    lines.push("validate: clean");
    if (!flags.quiet) {
      lines.push(`board.yaml: ${commandResult.context.boardYamlPath ?? ""}`);
    }
  } else {
    lines.push(`validate: ${commandResult.validation.outcome}`);
    if (!flags.quiet) {
      for (const issue of issues) {
        lines.push(`[${issue.severity}] ${issue.message}`);
      }
    }
  }

  if (flags.verbose) {
    lines.push(`cmd: ${commandResult.commandLine}`);
  }

  return lines;
}

function validationOutcomeExitCode(outcome: ValidationOutcome): number {
  if (outcome === "clean") {
    return CLI_EXIT_CODE.success;
  }

  if (
    outcome === "missing-preset" ||
    outcome === "schema-violation" ||
    outcome === "hardware-revision"
  ) {
    return CLI_EXIT_CODE.validationFailure;
  }

  return CLI_EXIT_CODE.runtimeFailure;
}
