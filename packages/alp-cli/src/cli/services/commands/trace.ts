// SPDX-License-Identifier: Apache-2.0

import { DebugGenerationTraceDecision } from "@alp-sdk/core/debug/models";
import { createGenerationTraceReport } from "@alp-sdk/core/debug/service";
import { EmitMode } from "@alp-sdk/core/loader/models";
import { ALL_EMIT_MODES, createLoaderPlan } from "@alp-sdk/core/loader/service";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliGlobalFlags,
  CliIssue,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";
import { resolveCliDebugContext } from "./debugShared";

interface TraceCommandData {
  schemaVersion: "1";
  generatedAt: string;
  workflow: string;
  focusPath: string | null;
  target: EmitMode | null;
  decisions: DebugGenerationTraceDecision[];
}

export function runTraceCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<TraceCommandData> {
  try {
    const resolved = resolveCliDebugContext(flags, input);

    if (!resolved.projectContext.sdkRoot) {
      return createFailureResult(
        "trace",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["trace: alp-sdk root is unresolved."],
        [
          {
            code: "trace.sdk-root-unresolved",
            severity: "error",
            message:
              "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
          },
        ],
        createEmptyTraceData(
          resolved.generatedAt,
          flags.inspectPath,
          flags.target,
        ),
      );
    }

    if (
      !resolved.projectContext.boardYamlPath ||
      !input.pathExists(resolved.projectContext.boardYamlPath)
    ) {
      return createFailureResult(
        "trace",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["trace: board.yaml path is unresolved or missing."],
        [
          {
            code: "trace.board-yaml-missing",
            severity: "error",
            message:
              "board.yaml path could not be resolved or the file does not exist.",
          },
        ],
        createEmptyTraceData(
          resolved.generatedAt,
          flags.inspectPath,
          flags.target,
        ),
      );
    }

    const issues: CliIssue[] = [];
    const targets = resolveTargets(flags.target);
    const decisions: DebugGenerationTraceDecision[] = [];

    for (const target of targets) {
      const plan = createLoaderPlan(resolved.projectContext, target);
      decisions.push({
        key: `generation.target.${target}`,
        outcome: "planned",
        outputPath: plan.outputPath,
        detail: `Would run: ${plan.commandLine}`,
      });
    }

    const focusPath = flags.inspectPath;
    if (focusPath) {
      const inspect = createGenerationFocusDecision(focusPath);
      decisions.push(inspect);
    }

    const report = createGenerationTraceReport(
      resolved.generatedAt,
      "cli.trace",
      decisions,
    );

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines: formatTraceTextLines(report, flags),
      envelope: createEnvelope(
        "trace",
        {
          root: resolved.projectContext.workspaceRoot,
          boardYaml: resolved.projectContext.boardYamlPath,
        },
        {
          schemaVersion: "1",
          generatedAt: report.generatedAt,
          workflow: report.workflow,
          focusPath,
          target: targets.length === 1 ? targets[0] : null,
          decisions: report.decisions,
        },
        issues,
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected CLI trace failure.";
    return createFailureResult(
      "trace",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["trace: internal failure", message],
      [
        {
          code: "trace.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        workflow: "cli.trace",
        focusPath: flags.inspectPath,
        target: null,
        decisions: [],
      },
    );
  }
}

function resolveTargets(rawTarget: string | null): EmitMode[] {
  if (!rawTarget) {
    return [...ALL_EMIT_MODES];
  }

  if ((ALL_EMIT_MODES as readonly string[]).includes(rawTarget)) {
    return [rawTarget as EmitMode];
  }

  throw new Error(
    `Unsupported trace target '${rawTarget}'. Allowed values: ${ALL_EMIT_MODES.join(", ")}.`,
  );
}

function createGenerationFocusDecision(
  focusPath: string,
): DebugGenerationTraceDecision {
  return {
    key: `config.path.${focusPath}`,
    outcome: "planned",
    detail:
      "Path-level tracing is currently static and reports planning context only.",
  };
}

function formatTraceTextLines(
  report: { decisions: readonly DebugGenerationTraceDecision[] },
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines = [`trace: decisions=${report.decisions.length}`];

  if (!flags.quiet) {
    for (const decision of report.decisions) {
      lines.push(`[${decision.outcome}] ${decision.key}: ${decision.detail}`);
    }
  }

  return lines;
}

function createEmptyTraceData(
  generatedAt: string,
  focusPath: string | null,
  target: string | null,
): TraceCommandData {
  return {
    schemaVersion: "1",
    generatedAt,
    workflow: "cli.trace",
    focusPath,
    target: target as EmitMode | null,
    decisions: [],
  };
}
