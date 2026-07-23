// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "../configurator/models";
import {
  ModuleScaffoldInput,
  ModuleScaffoldPlan,
  ModuleTemplateDefinition,
  ModuleTemplateId,
  WizardFileChange,
  WizardPlannedFile,
} from "./models";

const MODULE_TEMPLATE_DEFINITIONS: readonly ModuleTemplateDefinition[] = [
  {
    id: "sensor-driver",
    label: "Sensor driver module",
    description: "Adds a source/header pair for sensor acquisition logic.",
    functionPrefix: "alp_sensor",
  },
  {
    id: "connectivity-service",
    label: "Connectivity service module",
    description: "Adds module skeleton for network/session orchestration.",
    functionPrefix: "alp_conn",
  },
  {
    id: "inference-stage",
    label: "Inference stage module",
    description: "Adds module skeleton for model pre/post processing path.",
    functionPrefix: "alp_infer",
  },
  {
    id: "diagnostics-check",
    label: "Diagnostics check module",
    description: "Adds bring-up and runtime health-check module scaffold.",
    functionPrefix: "alp_diag",
  },
];

export function listModuleTemplates(): ModuleTemplateDefinition[] {
  return MODULE_TEMPLATE_DEFINITIONS.map((template) => ({ ...template }));
}

export function createModuleScaffoldPlan(
  input: ModuleScaffoldInput,
): ModuleScaffoldPlan {
  const template = resolveModuleTemplate(input.templateId);
  const normalizedModuleName = normalizeModuleName(input.moduleName);
  const files = createModuleScaffoldFiles(
    template,
    normalizedModuleName,
    input.boardModel,
  );
  return {
    template,
    moduleName: input.moduleName,
    normalizedModuleName,
    files,
    scaffoldTreePreview: createScaffoldTreePreview(files),
    explanations: createModuleScaffoldExplanations(
      template.id,
      normalizedModuleName,
    ),
  };
}

export function createModuleScaffoldPreviewMarkdown(
  plan: ModuleScaffoldPlan,
  fileChanges: WizardFileChange[],
): string {
  const changedCount = fileChanges.filter(
    (file) => file.kind !== "unchanged",
  ).length;

  const lines: string[] = [];
  lines.push("# Alp Module Scaffold Preview");
  lines.push("");
  lines.push("## Selection");
  lines.push("");
  lines.push(`- Template: ${plan.template.label}`);
  lines.push(`- Requested name: ${plan.moduleName}`);
  lines.push(`- Normalized name: ${plan.normalizedModuleName}`);
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
  lines.push("## Module Notes");
  lines.push("");
  for (const explanation of plan.explanations) {
    lines.push(`- ${explanation}`);
  }
  lines.push("");

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

function resolveModuleTemplate(
  templateId: ModuleTemplateId,
): ModuleTemplateDefinition {
  const template = MODULE_TEMPLATE_DEFINITIONS.find(
    (item) => item.id === templateId,
  );
  if (!template) {
    throw new Error(`Alp: unsupported module template '${templateId}'.`);
  }
  return { ...template };
}

function normalizeModuleName(moduleName: string): string {
  const trimmed = moduleName.trim().toLowerCase();
  const normalized = trimmed
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    throw new Error(
      "Alp: module name must contain at least one alphanumeric character.",
    );
  }

  return normalized;
}

function createModuleScaffoldFiles(
  template: ModuleTemplateDefinition,
  normalizedModuleName: string,
  boardModel: BoardModel | null,
): WizardPlannedFile[] {
  const headerPath = `include/modules/${normalizedModuleName}.h`;
  const sourcePath = `src/modules/${normalizedModuleName}/${normalizedModuleName}.c`;
  const notesPath = `src/modules/${normalizedModuleName}/README.md`;

  return [
    {
      relativePath: headerPath,
      content: createModuleHeader(template, normalizedModuleName),
    },
    {
      relativePath: sourcePath,
      content: createModuleSource(template, normalizedModuleName, boardModel),
    },
    {
      relativePath: notesPath,
      content: createModuleNotes(template, normalizedModuleName),
    },
  ];
}

function createModuleHeader(
  template: ModuleTemplateDefinition,
  normalizedModuleName: string,
): string {
  const symbol = normalizedModuleName.toUpperCase();
  const guard = `ALP_MODULES_${symbol}_H`;
  const base = `${template.functionPrefix}_${normalizedModuleName}`;

  return [
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    `#ifndef ${guard}`,
    `#define ${guard}`,
    "",
    "int " + base + "_init(void);",
    "int " + base + "_run(void);",
    "",
    `#endif /* ${guard} */`,
    "",
  ].join("\n");
}

function createModuleSource(
  template: ModuleTemplateDefinition,
  normalizedModuleName: string,
  boardModel: BoardModel | null,
): string {
  const base = `${template.functionPrefix}_${normalizedModuleName}`;
  const headerPath = `modules/${normalizedModuleName}.h`;
  const boardHint = boardModel
    ? `// Board context: ${boardModel.som?.sku ?? "<unset>"} / ${boardModel.os ?? "<unset>"}`
    : "// Board context: unavailable";

  return [
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    `#include \"${headerPath}\"`,
    "",
    boardHint,
    "",
    "int " + base + "_init(void) {",
    "  // TODO: initialize module dependencies.",
    "  return 0;",
    "}",
    "",
    "int " + base + "_run(void) {",
    "  // TODO: implement module main behavior.",
    "  return 0;",
    "}",
    "",
  ].join("\n");
}

function createModuleNotes(
  template: ModuleTemplateDefinition,
  normalizedModuleName: string,
): string {
  const explanations = createModuleScaffoldExplanations(
    template.id,
    normalizedModuleName,
  );
  return [
    "# Alp Module Scaffold",
    "",
    `Template: ${template.label}`,
    `Module: ${normalizedModuleName}`,
    "",
    "## Notes",
    "",
    ...explanations.map((line) => `- ${line}`),
    "",
    "Generated by Alp: Scaffold module.",
    "",
  ].join("\n");
}

function createModuleScaffoldExplanations(
  templateId: ModuleTemplateId,
  normalizedModuleName: string,
): string[] {
  switch (templateId) {
    case "sensor-driver":
      return [
        `Use ${normalizedModuleName}_run to place sensor polling and conversion logic.`,
        "Keep hardware-specific register access isolated from upper-level app flow.",
      ];
    case "connectivity-service":
      return [
        `Use ${normalizedModuleName}_init for stack/session initialization.`,
        "Keep retry/backoff and transport health checks localized in this module.",
      ];
    case "inference-stage":
      return [
        `Use ${normalizedModuleName}_run to host pre-process, infer, and post-process calls.`,
        "Keep model IO shaping and feature extraction close to this module boundary.",
      ];
    default:
      return [
        `Use ${normalizedModuleName}_run for periodic health checks and error probes.`,
        "Keep board bring-up assertions and diagnostics output in this module.",
      ];
  }
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
