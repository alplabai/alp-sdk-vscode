// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { ModuleTemplateId } from "@alp-sdk/core/wizard/models";
import {
    createModuleScaffoldPlan,
    listModuleTemplates,
} from "@alp-sdk/core/wizard/service";
import {
    collectWizardFileChanges,
    writeWizardFiles,
} from "@alp-sdk/core/wizard/vscodeAdapter";
import {
    CLI_EXIT_CODE,
    CliExecutionInput,
    CliExecutionResult,
    CliGlobalFlags,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

interface ScaffoldCommandData {
  schemaVersion: "1";
  templateId: ModuleTemplateId;
  moduleName: string;
  normalizedModuleName: string;
  destination: string;
  preview: boolean;
  fileChanges: Array<{
    relativePath: string;
    kind: "new" | "update" | "unchanged";
  }>;
  written: string[];
  unchanged: string[];
}

export function runScaffoldCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<ScaffoldCommandData> {
  try {
    if (!flags.name || !flags.name.trim()) {
      return createFailureResult(
        "scaffold",
        flags.format,
        CLI_EXIT_CODE.runtimeFailure,
        ["scaffold: --name is required for module scaffolding."],
        [
          {
            code: "scaffold.name-required",
            severity: "error",
            message: "Module name is required. Provide --name <module-name>.",
          },
        ],
        {
          schemaVersion: "1",
          templateId: "sensor-driver",
          moduleName: "",
          normalizedModuleName: "",
          destination: path.resolve(input.cwd),
          preview: flags.preview,
          fileChanges: [],
          written: [],
          unchanged: [],
        },
      );
    }

    const templateId = resolveScaffoldTemplate(flags.template);
    const destination = path.resolve(
      input.cwd,
      flags.destination ?? flags.projectPath ?? ".",
    );
    const plan = createModuleScaffoldPlan({
      templateId,
      moduleName: flags.name,
      boardModel: null,
    });
    const fileChanges = collectWizardFileChanges(destination, plan.files);
    const blockingUpdates = fileChanges.filter(
      (file) => file.kind === "update",
    );

    if (blockingUpdates.length > 0 && !flags.force) {
      return createFailureResult(
        "scaffold",
        flags.format,
        CLI_EXIT_CODE.writeFailure,
        [
          `scaffold: ${blockingUpdates.length} existing files would be updated. Use --force to overwrite.`,
        ],
        [
          {
            code: "scaffold.overwrite-blocked",
            severity: "error",
            message:
              "Existing files would be overwritten. Re-run with --force to allow updates.",
          },
        ],
        {
          schemaVersion: "1",
          templateId,
          moduleName: plan.moduleName,
          normalizedModuleName: plan.normalizedModuleName,
          destination,
          preview: flags.preview,
          fileChanges,
          written: [],
          unchanged: [],
        },
      );
    }

    const writeResult = flags.preview
      ? { written: [], unchanged: [] }
      : writeWizardFiles(destination, plan.files);
    const textLines: string[] = [];

    if (flags.preview) {
      textLines.push(
        `scaffold: preview ${fileChanges.length} files in ${destination}`,
      );
    } else {
      textLines.push(
        `scaffold: wrote ${writeResult.written.length} files in ${destination}`,
      );
      if (writeResult.unchanged.length > 0) {
        textLines.push(
          `scaffold: unchanged ${writeResult.unchanged.length} files`,
        );
      }
    }

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines: flags.format === "json" ? [] : textLines,
      envelope: createEnvelope(
        "scaffold",
        {
          root: destination,
          boardYaml: path.join(destination, "board.yaml"),
        },
        {
          schemaVersion: "1",
          templateId,
          moduleName: plan.moduleName,
          normalizedModuleName: plan.normalizedModuleName,
          destination,
          preview: flags.preview,
          fileChanges,
          written: writeResult.written,
          unchanged: writeResult.unchanged,
        },
        [],
        CLI_EXIT_CODE.success,
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI scaffold failure.";
    return createFailureResult(
      "scaffold",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["scaffold: internal failure", message],
      [
        {
          code: "scaffold.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        templateId: "sensor-driver",
        moduleName: flags.name ?? "",
        normalizedModuleName: "",
        destination: path.resolve(input.cwd),
        preview: flags.preview,
        fileChanges: [],
        written: [],
        unchanged: [],
      },
    );
  }
}

function resolveScaffoldTemplate(rawTemplate: string | null): ModuleTemplateId {
  if (!rawTemplate) {
    return "sensor-driver";
  }

  const available = listModuleTemplates().map((template) => template.id);
  if ((available as readonly string[]).includes(rawTemplate)) {
    return rawTemplate as ModuleTemplateId;
  }

  throw new Error(
    `Unsupported --template '${rawTemplate}'. Allowed values: ${available.join(", ")}.`,
  );
}
