// SPDX-License-Identifier: Apache-2.0

import {
  DebugResolvedValue,
} from "../../../debug/models";
import { createInspectReport } from "../../../debug/service";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliGlobalFlags,
  CliIssue,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";
import { resolveCliDebugContext } from "./debugShared";

interface InspectCommandData {
  schemaVersion: "1";
  generatedAt: string;
  focusPath: string | null;
  showOrigin: boolean;
  resolvedValues: DebugResolvedValue[];
}

export function runInspectCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<InspectCommandData> {
  try {
    const resolved = resolveCliDebugContext(flags, input);
    const report = createInspectReport(resolved.debugContext);
    const issues: CliIssue[] = [];

    if (!resolved.debugContext.boardYamlExists) {
      issues.push({
        code: "inspect.board-yaml-missing",
        severity: "warning",
        message:
          "board.yaml path could not be resolved or the file does not exist.",
      });
    }

    const focusPath = flags.inspectPath;
    const resolvedValues = filterResolvedValues(report.resolvedValues, focusPath);

    if (focusPath && resolvedValues.length === 0) {
      issues.push({
        code: "inspect.path-not-found",
        severity: "warning",
        message: `No resolved values match --path '${focusPath}'.`,
      });
    }

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines: formatInspectTextLines(
        resolvedValues,
        focusPath,
        flags.showOrigin,
        flags,
      ),
      envelope: createEnvelope(
        "inspect",
        {
          root: resolved.projectContext.workspaceRoot,
          boardYaml: resolved.projectContext.boardYamlPath,
        },
        {
          schemaVersion: "1",
          generatedAt: report.generatedAt,
          focusPath,
          showOrigin: flags.showOrigin,
          resolvedValues,
        },
        issues,
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected CLI inspect failure.";
    return createFailureResult(
      "inspect",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["inspect: internal failure", message],
      [
        {
          code: "inspect.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        focusPath: flags.inspectPath,
        showOrigin: flags.showOrigin,
        resolvedValues: [],
      },
    );
  }
}

function filterResolvedValues(
  values: readonly DebugResolvedValue[],
  focusPath: string | null,
): DebugResolvedValue[] {
  if (!focusPath) {
    return values.map((value) => ({ ...value }));
  }

  return values
    .filter(
      (value) =>
        value.key === focusPath ||
        value.key.startsWith(`${focusPath}.`) ||
        value.key.startsWith(`${focusPath}[`),
    )
    .map((value) => ({ ...value }));
}

function formatInspectTextLines(
  values: readonly DebugResolvedValue[],
  focusPath: string | null,
  showOrigin: boolean,
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines = [`inspect: resolved values=${values.length}`];
  if (focusPath) {
    lines.push(`path=${focusPath}`);
  }

  if (!flags.quiet) {
    for (const value of values) {
      const renderedValue = formatValue(value.value);
      if (showOrigin) {
        lines.push(
          `${value.key}=${renderedValue} source=${value.source} detail=${JSON.stringify(value.detail)}`,
        );
      } else {
        lines.push(`${value.key}=${renderedValue}`);
      }
    }
  }

  return lines;
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "<undefined>";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  const raw = JSON.stringify(value);
  return raw ?? String(value);
}
