// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import {
    normalizeBoardModel,
    parseBoardModel,
} from "../../../configurator/service";
import { ProjectSettings } from "../../../project/models";
import { resolveProjectContext } from "../../../project/service";
import {
    CLI_EXIT_CODE,
    CliExecutionInput,
    CliExecutionResult,
    CliGlobalFlags,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

type DiffKind = "added" | "removed" | "changed";

interface DiffEntry {
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

interface DiffCommandData {
  schemaVersion: "1";
  boardYamlPath: string;
  unchanged: boolean;
  changeCount: number;
  changes: DiffEntry[];
}

export function runDiffCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<DiffCommandData> {
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
        "diff",
        flags.format,
        CLI_EXIT_CODE.validationFailure,
        ["diff: board.yaml path is unresolved or missing."],
        [
          {
            code: "diff.board-yaml-missing",
            severity: "error",
            message:
              "board.yaml path could not be resolved or the file does not exist.",
          },
        ],
        {
          schemaVersion: "1",
          boardYamlPath: context.boardYamlPath ?? "",
          unchanged: false,
          changeCount: 0,
          changes: [],
        },
      );
    }

    const boardText = fs.readFileSync(context.boardYamlPath, "utf8");
    const boardModel = parseBoardModel(boardText);
    const normalized = normalizeBoardModel(boardModel);

    const changes = collectDiffEntries(boardModel, normalized);
    const textLines =
      flags.format === "json"
        ? []
        : formatDiffTextLines(changes, context.boardYamlPath, flags.quiet);

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines,
      envelope: createEnvelope(
        "diff",
        {
          root: context.workspaceRoot,
          boardYaml: context.boardYamlPath,
        },
        {
          schemaVersion: "1",
          boardYamlPath: context.boardYamlPath,
          unchanged: changes.length === 0,
          changeCount: changes.length,
          changes,
        },
        [],
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected CLI diff failure.";
    return createFailureResult(
      "diff",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["diff: internal failure", message],
      [
        {
          code: "diff.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        boardYamlPath: "",
        unchanged: false,
        changeCount: 0,
        changes: [],
      },
    );
  }
}

function collectDiffEntries(before: unknown, after: unknown): DiffEntry[] {
  const output: DiffEntry[] = [];
  collectRecursiveDiff(before, after, "", output);
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function collectRecursiveDiff(
  before: unknown,
  after: unknown,
  currentPath: string,
  output: DiffEntry[],
): void {
  if (deepEqual(before, after)) {
    return;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = new Set<string>([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);

    for (const key of [...keys].sort()) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);

      if (!hasBefore) {
        output.push({
          path: nextPath,
          kind: "added",
          before: undefined,
          after: after[key],
        });
        continue;
      }

      if (!hasAfter) {
        output.push({
          path: nextPath,
          kind: "removed",
          before: before[key],
          after: undefined,
        });
        continue;
      }

      collectRecursiveDiff(before[key], after[key], nextPath, output);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      const nextPath = `${currentPath}[${index}]`;

      if (index >= before.length) {
        output.push({
          path: nextPath,
          kind: "added",
          before: undefined,
          after: after[index],
        });
        continue;
      }

      if (index >= after.length) {
        output.push({
          path: nextPath,
          kind: "removed",
          before: before[index],
          after: undefined,
        });
        continue;
      }

      collectRecursiveDiff(before[index], after[index], nextPath, output);
    }
    return;
  }

  output.push({
    path: currentPath || "<root>",
    kind: "changed",
    before,
    after,
  });
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    if (!deepEqual(leftKeys, rightKeys)) {
      return false;
    }

    for (const key of leftKeys) {
      if (!deepEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDiffTextLines(
  changes: readonly DiffEntry[],
  boardYamlPath: string,
  quiet: boolean,
): string[] {
  if (changes.length === 0) {
    return ["diff: no effective-config differences detected."];
  }

  const lines = [`diff: ${changes.length} differences in ${boardYamlPath}`];

  if (!quiet) {
    for (const change of changes) {
      lines.push(
        `${change.kind.toUpperCase()} ${change.path}: ${formatValue(change.before)} -> ${formatValue(change.after)}`,
      );
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
  if (!raw) {
    return String(value);
  }

  if (raw.length > 120) {
    return `${raw.slice(0, 117)}...`;
  }

  return raw;
}
