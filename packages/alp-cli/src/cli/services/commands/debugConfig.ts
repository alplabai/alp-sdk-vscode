// SPDX-License-Identifier: Apache-2.0

import { createLaunchJsonWritePlan } from "@alp-sdk/core/debug/launchJsonCore";
import { DebugServerKind, DebugTargetKind } from "@alp-sdk/core/debug/models";
import {
    createDebugProfile,
    createLaunchPreview,
    debugProfileToLaunchDraft,
} from "@alp-sdk/core/debug/service";
import * as path from "path";
import {
    CLI_EXIT_CODE,
    CliExecutionInput,
    CliExecutionResult,
    CliGlobalFlags,
    CliIssue,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";
import { parseServerKind, parseTargetKind } from "./debugShared";

interface DebugConfigCommandData {
  schemaVersion: "1";
  generatedAt: string;
  targetKind: DebugTargetKind;
  server: DebugServerKind;
  preview: boolean;
  launchJsonPath: string;
  replaced: boolean;
  notes: string[];
}

export function runDebugConfigCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<DebugConfigCommandData> {
  try {
    const targetKind = parseTargetKind(flags.targetKind);
    const server = parseServerKind(flags.server);
    const generatedAt = new Date().toISOString();

    const preview = createLaunchPreview(generatedAt, targetKind, server);
    const profile = createDebugProfile(targetKind, server);
    const draft = debugProfileToLaunchDraft(profile);

    const workspaceRoot = path.resolve(input.cwd, flags.projectPath ?? ".");
    const launchJsonPath = path.join(workspaceRoot, ".vscode", "launch.json");

    const issues: CliIssue[] = [];
    let replaced = false;

    if (flags.preview) {
      return buildSuccessResult(
        flags,
        generatedAt,
        targetKind,
        server,
        launchJsonPath,
        false,
        preview.notes,
        preview,
        issues,
      );
    }

    if (!input.readFile || !input.writeFile || !input.mkdirP) {
      return createFailureResult(
        "debug-config",
        flags.format,
        CLI_EXIT_CODE.runtimeFailure,
        [
          "debug-config: file system adapters are required.",
          "Use --preview to output the launch configuration without writing files.",
        ],
        [
          {
            code: "debug-config.adapters-required",
            severity: "error",
            message:
              "readFile, writeFile, and mkdirP adapters are required to write launch.json.",
          },
        ],
        createEmptyData(generatedAt, targetKind, server, launchJsonPath),
      );
    }

    const vscodDir = path.dirname(launchJsonPath);
    input.mkdirP(vscodDir);

    const existingContent = input.pathExists(launchJsonPath)
      ? input.readFile(launchJsonPath)
      : null;

    const writePlan = createLaunchJsonWritePlan(existingContent, draft);
    replaced = writePlan.replaced;

    try {
      input.writeFile(launchJsonPath, writePlan.content);
    } catch (writeError) {
      const message =
        writeError instanceof Error
          ? writeError.message
          : "Failed to write launch.json.";
      return createFailureResult(
        "debug-config",
        flags.format,
        CLI_EXIT_CODE.writeFailure,
        ["debug-config: failed to write launch.json.", message],
        [
          {
            code: "debug-config.write-failure",
            severity: "error",
            message,
          },
        ],
        createEmptyData(generatedAt, targetKind, server, launchJsonPath),
      );
    }

    return buildSuccessResult(
      flags,
      generatedAt,
      targetKind,
      server,
      launchJsonPath,
      replaced,
      preview.notes,
      preview,
      issues,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected debug-config failure.";
    return createFailureResult(
      "debug-config",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["debug-config: internal failure", message],
      [
        {
          code: "debug-config.internal-failure",
          severity: "error",
          message,
        },
      ],
      createEmptyData(
        new Date().toISOString(),
        "zephyr-mcu",
        "none",
        path.join(input.cwd, ".vscode", "launch.json"),
      ),
    );
  }
}

function buildSuccessResult(
  flags: CliGlobalFlags,
  generatedAt: string,
  targetKind: DebugTargetKind,
  server: DebugServerKind,
  launchJsonPath: string,
  replaced: boolean,
  notes: string[],
  preview: ReturnType<typeof createLaunchPreview>,
  issues: CliIssue[],
): CliExecutionResult<DebugConfigCommandData> {
  const data: DebugConfigCommandData = {
    schemaVersion: "1",
    generatedAt,
    targetKind,
    server,
    preview: flags.preview,
    launchJsonPath,
    replaced,
    notes,
  };

  return {
    format: flags.format,
    exitCode: CLI_EXIT_CODE.success,
    textLines: formatDebugConfigTextLines(
      targetKind,
      server,
      launchJsonPath,
      replaced,
      flags.preview,
      notes,
      preview,
      flags,
    ),
    envelope: createEnvelope(
      "debug-config",
      { root: path.dirname(path.dirname(launchJsonPath)), boardYaml: null },
      data,
      issues,
      CLI_EXIT_CODE.success,
    ),
  };
}

function formatDebugConfigTextLines(
  targetKind: DebugTargetKind,
  server: DebugServerKind,
  launchJsonPath: string,
  replaced: boolean,
  preview: boolean,
  notes: string[],
  launchPreview: ReturnType<typeof createLaunchPreview>,
  flags: CliGlobalFlags,
): string[] {
  if (flags.format === "json") {
    return [];
  }

  const lines: string[] = [];

  if (preview) {
    lines.push(
      `debug-config: preview target=${targetKind} server=${server}`,
      `launch.json path: ${launchJsonPath}`,
    );
    if (!flags.quiet) {
      lines.push(
        "",
        JSON.stringify(launchPreview.launch, null, 2),
        "",
        ...notes.map((n) => `note: ${n}`),
      );
    }
  } else {
    const action = replaced ? "updated" : "written";
    lines.push(
      `debug-config: ${action} target=${targetKind} server=${server}`,
      `launch.json: ${launchJsonPath}`,
    );
    if (!flags.quiet) {
      lines.push(...notes.map((n) => `note: ${n}`));
    }
  }

  return lines;
}

function createEmptyData(
  generatedAt: string,
  targetKind: DebugTargetKind,
  server: DebugServerKind,
  launchJsonPath: string,
): DebugConfigCommandData {
  return {
    schemaVersion: "1",
    generatedAt,
    targetKind,
    server,
    preview: false,
    launchJsonPath,
    replaced: false,
    notes: [],
  };
}
