// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { createDefaultBoardModel } from "../../../configurator/service";
import { WizardTemplateId } from "../../../wizard/models";
import { createWizardPlan, listWizardTemplates } from "../../../wizard/service";
import {
  collectWizardFileChanges,
  writeWizardFiles,
} from "../../../wizard/vscodeAdapter";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliGlobalFlags,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

interface InitCommandData {
  schemaVersion: "1";
  templateId: WizardTemplateId;
  destination: string;
  preview: boolean;
  fileChanges: Array<{
    relativePath: string;
    kind: "new" | "update" | "unchanged";
  }>;
  written: string[];
  unchanged: string[];
}

export function runInitCommand(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<InitCommandData> {
  try {
    const templateId = resolveInitTemplate(flags.template);
    const defaultBoard = createDefaultBoardModel();

    const baseDestination = path.resolve(
      input.cwd,
      flags.destination ?? flags.projectPath ?? ".",
    );
    const projectRoot = flags.name
      ? path.join(baseDestination, flags.name)
      : baseDestination;

    const template = listWizardTemplates().find(
      (item) => item.id === templateId,
    );
    if (!template) {
      throw new Error(`Unsupported init template '${templateId}'.`);
    }

    const plan = createWizardPlan({
      templateId,
      somSku: defaultBoard.som.sku,
      carrierName: defaultBoard.carrier?.name ?? "E1M-EVK",
      os: defaultBoard.os,
      features: { ...template.defaultFeatures },
      libraries: [...template.defaultLibraries],
    });

    const fileChanges = collectWizardFileChanges(projectRoot, plan.files);
    const blockingUpdates = fileChanges.filter(
      (file) => file.kind === "update",
    );

    if (blockingUpdates.length > 0 && !flags.force) {
      return createFailureResult(
        "init",
        flags.format,
        CLI_EXIT_CODE.writeFailure,
        [
          `init: ${blockingUpdates.length} existing files would be updated. Use --force to overwrite.`,
        ],
        [
          {
            code: "init.overwrite-blocked",
            severity: "error",
            message:
              "Existing files would be overwritten. Re-run with --force to allow updates.",
          },
        ],
        {
          schemaVersion: "1",
          templateId,
          destination: projectRoot,
          preview: flags.preview,
          fileChanges,
          written: [],
          unchanged: [],
        },
      );
    }

    const writeResult = flags.preview
      ? { written: [], unchanged: [] }
      : writeWizardFiles(projectRoot, plan.files);

    const textLines: string[] = [];
    if (flags.preview) {
      textLines.push(
        `init: preview ${fileChanges.length} files in ${projectRoot}`,
      );
    } else {
      textLines.push(
        `init: wrote ${writeResult.written.length} files in ${projectRoot}`,
      );
      if (writeResult.unchanged.length > 0) {
        textLines.push(`init: unchanged ${writeResult.unchanged.length} files`);
      }
    }

    return {
      format: flags.format,
      exitCode: CLI_EXIT_CODE.success,
      textLines: flags.format === "json" ? [] : textLines,
      envelope: createEnvelope(
        "init",
        {
          root: projectRoot,
          boardYaml: path.join(projectRoot, "board.yaml"),
        },
        {
          schemaVersion: "1",
          templateId,
          destination: projectRoot,
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
      error instanceof Error ? error.message : "Unexpected CLI init failure.";
    return createFailureResult(
      "init",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["init: internal failure", message],
      [
        {
          code: "init.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        templateId: "minimal-app",
        destination: path.resolve(input.cwd),
        preview: flags.preview,
        fileChanges: [],
        written: [],
        unchanged: [],
      },
    );
  }
}

function resolveInitTemplate(rawTemplate: string | null): WizardTemplateId {
  if (!rawTemplate) {
    return "minimal-app";
  }

  const available = listWizardTemplates().map((template) => template.id);
  if ((available as readonly string[]).includes(rawTemplate)) {
    return rawTemplate as WizardTemplateId;
  }

  throw new Error(
    `Unsupported --template '${rawTemplate}'. Allowed values: ${available.join(", ")}.`,
  );
}
