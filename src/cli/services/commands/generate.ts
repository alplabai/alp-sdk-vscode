// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { executeLoaderPlanWithSpawn } from "../../../loader/adapterCore";
import { EmitMode } from "../../../loader/models";
import { ALL_EMIT_MODES, createLoaderPlan } from "../../../loader/service";
import { ProjectSettings } from "../../../project/models";
import { resolveProjectContext } from "../../../project/service";
import {
    CLI_EXIT_CODE,
    CliExecutionInput,
    CliExecutionResult,
    CliGlobalFlags,
    CliIssue,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

interface GenerateCommandData {
  schemaVersion: "1";
  targets: EmitMode[];
  written: string[];
  failed: EmitMode[];
}

export function runGenerateCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<GenerateCommandData> {
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
      return createFailureResult(
        "generate",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["generate: board.yaml path is unresolved or missing."],
        [
          {
            code: "generate.board-yaml-missing",
            severity: "error",
            message:
              "board.yaml path could not be resolved or the file does not exist.",
          },
        ],
        {
          schemaVersion: "1",
          targets: [],
          written: [],
          failed: [],
        },
      );
    }

    if (!context.sdkRoot) {
      return createFailureResult(
        "generate",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["generate: alp-sdk root is unresolved."],
        [
          {
            code: "generate.sdk-root-unresolved",
            severity: "error",
            message:
              "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
          },
        ],
        {
          schemaVersion: "1",
          targets: [],
          written: [],
          failed: [],
        },
      );
    }

    const targets = resolveGenerateTargets(flags.target, flags.all);
    const written: string[] = [];
    const failed: EmitMode[] = [];
    const issues: CliIssue[] = [];

    for (const emit of targets) {
      const plan = createLoaderPlan(context, emit);
      const execution = executeLoaderPlanWithSpawn(
        context.pythonBinary,
        plan,
        input.spawnSync,
      );
      if (execution.status === 0) {
        written.push(path.relative(workspaceRoot, plan.outputPath));
      } else {
        failed.push(emit);
        issues.push({
          code: "generate.emit-failed",
          severity: "error",
          message:
            execution.stderr.trim() ||
            `Generation failed for target '${emit}'.`,
        });
      }
    }

    const exitCode =
      failed.length === 0 ? CLI_EXIT_CODE.success : CLI_EXIT_CODE.writeFailure;

    const textLines: string[] = [];
    if (flags.format === "text") {
      if (failed.length === 0) {
        textLines.push(
          `generate: wrote ${written.length}/${targets.length} targets`,
        );
      } else {
        textLines.push(
          `generate: wrote ${written.length}/${targets.length}; failed: ${failed.join(", ")}`,
        );
      }

      if (flags.verbose) {
        for (const target of targets) {
          textLines.push(`target: ${target}`);
        }
      }
    }

    return {
      format: flags.format,
      exitCode,
      textLines,
      envelope: createEnvelope(
        "generate",
        {
          root: context.workspaceRoot,
          boardYaml: context.boardYamlPath,
        },
        {
          schemaVersion: "1",
          targets,
          written,
          failed,
        },
        issues,
        exitCode,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI generation failure.";
    return createFailureResult(
      "generate",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["generate: internal failure", message],
      [
        {
          code: "generate.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        targets: [],
        written: [],
        failed: [],
      },
    );
  }
}

function resolveGenerateTargets(
  target: string | null,
  all: boolean,
): EmitMode[] {
  if (all || !target) {
    return [...ALL_EMIT_MODES];
  }

  if ((ALL_EMIT_MODES as readonly string[]).includes(target)) {
    return [target as EmitMode];
  }

  throw new Error(`Unsupported generate target '${target}'.`);
}
