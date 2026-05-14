// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import {
  createEmptyPresetCatalogue,
  parseBoardModel,
} from "../../../configurator/service";
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

interface PresetsCommandData {
  schemaVersion: "1";
  sdkRoot: string | null;
  skus: string[];
  carriers: Array<{
    name: string;
    populatedKeys: string[];
  }>;
  libraries: string[];
  inferenceBackends: string[];
  logLevels: string[];
  osChoices: string[];
}

export function runPresetsCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<PresetsCommandData> {
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

    const catalogue = loadPresetCatalogueForCli(context.sdkRoot);
    const issues: CliIssue[] = [];
    if (!context.sdkRoot) {
      issues.push({
        code: "presets.sdk-root-unresolved",
        severity: "warning",
        message:
          "alp-sdk root is unresolved. Returning built-in defaults and empty SDK preset lists.",
      });
    }

    const data: PresetsCommandData = {
      schemaVersion: "1",
      sdkRoot: context.sdkRoot,
      skus: [...catalogue.skus],
      carriers: catalogue.carriers.map((carrier) => ({
        name: carrier.name,
        populatedKeys: Object.keys(carrier.populated).sort(),
      })),
      libraries: [...catalogue.libraries],
      inferenceBackends: [...catalogue.inferenceBackends],
      logLevels: [...catalogue.logLevels],
      osChoices: [...catalogue.osChoices],
    };

    const textLines: string[] = [];
    if (flags.format === "text") {
      textLines.push(
        `presets: skus=${data.skus.length} carriers=${data.carriers.length} libraries=${data.libraries.length}`,
      );

      if (flags.verbose) {
        for (const sku of data.skus) {
          textLines.push(`sku: ${sku}`);
        }
        for (const carrier of data.carriers) {
          textLines.push(`carrier: ${carrier.name}`);
        }
      }
    }

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines,
      envelope: createEnvelope(
        "presets",
        {
          root: context.workspaceRoot,
          boardYaml: context.boardYamlPath,
        },
        data,
        issues,
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI presets failure.";
    return createFailureResult(
      "presets",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["presets: internal failure", message],
      [
        {
          code: "presets.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        sdkRoot: null,
        skus: [],
        carriers: [],
        libraries: [],
        inferenceBackends: [],
        logLevels: [],
        osChoices: [],
      },
    );
  }
}

function loadPresetCatalogueForCli(sdkRoot: string | null): {
  skus: string[];
  carriers: Array<{ name: string; populated: Record<string, boolean> }>;
  libraries: string[];
  inferenceBackends: string[];
  logLevels: string[];
  osChoices: string[];
} {
  const catalogue = createEmptyPresetCatalogue();
  if (!sdkRoot) {
    return catalogue;
  }

  const modulesDir = path.join(sdkRoot, "metadata", "e1m_modules");
  if (fs.existsSync(modulesDir)) {
    catalogue.skus = fs
      .readdirSync(modulesDir)
      .filter((name) => name.startsWith("E1M-"))
      .filter((name) => fs.existsSync(path.join(modulesDir, name, "som.yaml")))
      .sort((left, right) => left.localeCompare(right));
  }

  const carriersDir = path.join(sdkRoot, "metadata", "carriers");
  if (fs.existsSync(carriersDir)) {
    const carriers: Array<{
      name: string;
      populated: Record<string, boolean>;
    }> = [];
    for (const name of fs.readdirSync(carriersDir)) {
      const presetPath = path.join(carriersDir, name, "board.yaml");
      if (!fs.existsSync(presetPath)) {
        continue;
      }

      try {
        const parsed = parseBoardModel(fs.readFileSync(presetPath, "utf-8"));
        carriers.push({
          name,
          populated: parsed.carrier?.populated ?? {},
        });
      } catch {
        // Ignore malformed carrier presets in CLI listing mode.
      }
    }

    carriers.sort((left, right) => left.name.localeCompare(right.name));
    catalogue.carriers = carriers;
  }

  return catalogue;
}
