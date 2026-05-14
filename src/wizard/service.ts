// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "../configurator/models";
import { createBoardYaml } from "../configurator/service";
import {
    WizardFileChange,
    WizardGeneratedOutputPreview,
    WizardPlan,
    WizardPlanInput,
    WizardPlannedFile,
    WizardTemplateDefinition,
    WizardTemplateId,
  WizardValidationSummary,
} from "./models";

const TEMPLATE_DEFINITIONS: readonly WizardTemplateDefinition[] = [
  {
    id: "minimal-app",
    label: "Minimal app",
    description: "Smallest baseline project with a simple main loop.",
    defaultFeatures: { wifi: false, mqtt: false, ble: false, tls: false },
    defaultLibraries: [],
  },
  {
    id: "sensor-starter",
    label: "Sensor starter",
    description: "Sensor polling skeleton with diagnostics-friendly logging.",
    defaultFeatures: { wifi: false, mqtt: false, ble: false, tls: false },
    defaultLibraries: ["fmt"],
  },
  {
    id: "iot-starter",
    label: "IoT starter",
    description: "Connectivity-oriented starter with Wi-Fi and MQTT defaults.",
    defaultFeatures: { wifi: true, mqtt: true, ble: false, tls: true },
    defaultLibraries: ["mbedtls", "fmt"],
  },
  {
    id: "edge-ai-starter",
    label: "Edge AI starter",
    description: "Inference-first starter with arena sizing and backend hints.",
    defaultFeatures: { wifi: false, mqtt: false, ble: false, tls: false },
    defaultLibraries: ["cmsis_dsp", "etl"],
  },
  {
    id: "board-diagnostics",
    label: "Board diagnostics",
    description: "Bring-up oriented starter for board and peripheral checks.",
    defaultFeatures: { wifi: false, mqtt: false, ble: false, tls: false },
    defaultLibraries: ["fmt", "doctest"],
  },
];

export function listWizardTemplates(): WizardTemplateDefinition[] {
  return TEMPLATE_DEFINITIONS.map((template) => ({
    ...template,
    defaultFeatures: { ...template.defaultFeatures },
    defaultLibraries: [...template.defaultLibraries],
  }));
}

export function createWizardPlan(input: WizardPlanInput): WizardPlan {
  const template = resolveTemplate(input.templateId);
  const boardModel = createBoardModel(input);
  const files = createStarterFiles(template.id, boardModel);
  return {
    template,
    boardModel,
    files,
    scaffoldTreePreview: createScaffoldTreePreview(files),
  };
}

export function createWizardPreviewMarkdown(
  plan: WizardPlan,
  fileChanges: WizardFileChange[],
  generatedOutputs: WizardGeneratedOutputPreview[] = [],
  validationSummary: WizardValidationSummary =
    createWizardValidationSummary(plan.boardModel),
): string {
  const boardModel = plan.boardModel;
  const changedCount = fileChanges.filter(
    (file) => file.kind !== "unchanged",
  ).length;

  const lines: string[] = [];
  lines.push("# ALP Project Wizard Preview");
  lines.push("");
  lines.push("## Selection");
  lines.push("");
  lines.push(`- Template: ${plan.template.label}`);
  lines.push(`- SoM: ${boardModel.som.sku}`);
  lines.push(`- Carrier: ${boardModel.carrier?.name ?? "<unset>"}`);
  lines.push(`- OS: ${boardModel.os}`);
  lines.push(
    `- Libraries: ${(boardModel.libraries ?? []).join(", ") || "(none)"}`,
  );
  lines.push("");
  lines.push("## Planned Tree");
  lines.push("");
  lines.push("```text");
  lines.push(plan.scaffoldTreePreview);
  lines.push("```");
  lines.push("");
  lines.push("## File Changes");
  lines.push("");
  lines.push(`- Files that will be written: ${changedCount}`);
  for (const file of fileChanges) {
    lines.push(`- ${file.kind.toUpperCase()}: ${file.relativePath}`);
  }
  lines.push("");

  lines.push("## Validation Summary");
  lines.push("");
  lines.push(
    `- Errors: ${validationSummary.errors.length} | Warnings: ${validationSummary.warnings.length} | Suggestions: ${validationSummary.suggestions.length}`,
  );
  for (const error of validationSummary.errors) {
    lines.push(`- Error: ${error}`);
  }
  for (const warning of validationSummary.warnings) {
    lines.push(`- Warning: ${warning}`);
  }
  for (const suggestion of validationSummary.suggestions) {
    lines.push(`- Suggestion: ${suggestion}`);
  }
  if (
    validationSummary.errors.length === 0 &&
    validationSummary.warnings.length === 0 &&
    validationSummary.suggestions.length === 0
  ) {
    lines.push("- No validation findings.");
  }
  lines.push("");

  lines.push("## Generated Output Preview");
  lines.push("");
  if (generatedOutputs.length === 0) {
    lines.push("- No generated output targets available.");
    lines.push("");
  } else {
    for (const output of generatedOutputs) {
      lines.push(
        `### ${output.displayName} (${output.emit}) - ${output.state.toUpperCase()}`,
      );
      lines.push("");
      lines.push(`Path: ${output.outputRelativePath}`);
      lines.push("");
      lines.push("```text");
      lines.push(output.contentPreview);
      lines.push("```");
      lines.push("");
    }
  }

  for (const file of plan.files) {
    lines.push(`### ${file.relativePath}`);
    lines.push("");
    lines.push("```text");
    lines.push(file.content.trimEnd());
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

export function createWizardValidationSummary(
  boardModel: BoardModel,
): WizardValidationSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!boardModel.som?.sku) {
    errors.push("SoM SKU is required.");
  }
  if (!boardModel.carrier?.name) {
    errors.push("Carrier name is required.");
  }
  if (!boardModel.os) {
    errors.push("OS target is required.");
  }

  const arena = boardModel.inference?.default_arena_kib;
  if (arena !== undefined && arena < 16) {
    warnings.push("Inference arena should be at least 16 KiB.");
  }

  if (boardModel.iot?.mqtt && !boardModel.iot?.wifi) {
    suggestions.push(
      "MQTT is enabled while Wi-Fi is disabled. Confirm your transport path.",
    );
  }

  return { errors, warnings, suggestions };
}

function resolveTemplate(
  templateId: WizardTemplateId,
): WizardTemplateDefinition {
  const template = TEMPLATE_DEFINITIONS.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Alp: unsupported project template '${templateId}'.`);
  }
  return {
    ...template,
    defaultFeatures: { ...template.defaultFeatures },
    defaultLibraries: [...template.defaultLibraries],
  };
}

function createBoardModel(input: WizardPlanInput): BoardModel {
  const boardModel: BoardModel = {
    schema_version: 1,
    som: { sku: input.somSku },
    carrier: { name: input.carrierName },
    os: input.os,
  };

  const libraries = [...new Set(input.libraries)].sort();
  if (libraries.length > 0) {
    boardModel.libraries = libraries;
  }

  if (
    input.features.wifi ||
    input.features.mqtt ||
    input.features.ble ||
    input.features.tls
  ) {
    boardModel.iot = {
      wifi: input.features.wifi,
      mqtt: input.features.mqtt,
      ble: input.features.ble,
      tls: input.features.tls,
    };
  }

  if (input.templateId === "edge-ai-starter") {
    boardModel.inference = {
      backend: "auto",
      default_arena_kib: 256,
    };
  }

  if (input.templateId === "board-diagnostics") {
    boardModel.diagnostics = {
      last_error: true,
      log_level: "debug",
    };
  }

  return boardModel;
}

function createStarterFiles(
  templateId: WizardTemplateId,
  boardModel: BoardModel,
): WizardPlannedFile[] {
  return [
    { relativePath: "board.yaml", content: createBoardYaml(boardModel) },
    {
      relativePath: "README.md",
      content: createProjectReadme(templateId, boardModel),
    },
    { relativePath: "CMakeLists.txt", content: createCmakeLists() },
    { relativePath: "src/main.c", content: createMainSource(templateId) },
  ];
}

function createScaffoldTreePreview(files: WizardPlannedFile[]): string {
  const paths = files.map((file) => file.relativePath).sort();
  const treeLines: string[] = ["."];
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const isLast = index === paths.length - 1;
    treeLines.push(`${isLast ? "`--" : "|--"} ${path}`);
  }
  return treeLines.join("\n");
}

function createProjectReadme(
  templateId: WizardTemplateId,
  boardModel: BoardModel,
): string {
  return [
    "# ALP Starter Project",
    "",
    `Template: ${templateId}`,
    `SoM: ${boardModel.som.sku}`,
    `Carrier: ${boardModel.carrier?.name ?? "<unset>"}`,
    `OS: ${boardModel.os}`,
    "",
    "This workspace was generated by Alp: New Project Wizard.",
    "Use Alp commands to validate, generate, and build outputs.",
    "",
  ].join("\n");
}

function createCmakeLists(): string {
  return [
    "cmake_minimum_required(VERSION 3.20)",
    "project(alp_starter C)",
    "",
    "add_executable(alp_app src/main.c)",
    "",
  ].join("\n");
}

function createMainSource(templateId: WizardTemplateId): string {
  const body = mainBodyForTemplate(templateId);
  return [
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    "#include <stdio.h>",
    "",
    "int main(void) {",
    ...body.map((line) => `  ${line}`),
    "  return 0;",
    "}",
    "",
  ].join("\n");
}

function mainBodyForTemplate(templateId: WizardTemplateId): string[] {
  switch (templateId) {
    case "sensor-starter":
      return [
        'puts("ALP sensor starter boot");',
        'puts("TODO: initialize sensor bus and polling loop");',
      ];
    case "iot-starter":
      return [
        'puts("ALP IoT starter boot");',
        'puts("TODO: connect Wi-Fi and start MQTT session");',
      ];
    case "edge-ai-starter":
      return [
        'puts("ALP edge AI starter boot");',
        'puts("TODO: load model and run inference loop");',
      ];
    case "board-diagnostics":
      return [
        'puts("ALP board diagnostics starter boot");',
        'puts("TODO: run bring-up checks and report failures");',
      ];
    default:
      return [
        'puts("ALP minimal starter boot");',
        'puts("TODO: add your application logic");',
      ];
  }
}
