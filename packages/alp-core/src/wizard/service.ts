// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "../configurator/models";
import { createBoardYaml } from "../configurator/service";
import {
    ModuleScaffoldInput,
    ModuleScaffoldPlan,
    ModuleTemplateDefinition,
    ModuleTemplateId,
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
  {
    id: "host-tooling-starter",
    label: "Host tooling starter",
    // planned — file generation not yet implemented
    description:
      "Monorepo scaffold for a host-side ALP tool: shared core package, standalone CLI, and VS Code extension surface.",
    defaultFeatures: { wifi: false, mqtt: false, ble: false, tls: false },
    defaultLibraries: [],
  },
];

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

export function listWizardTemplates(): WizardTemplateDefinition[] {
  return TEMPLATE_DEFINITIONS.map((template) => ({
    ...template,
    defaultFeatures: { ...template.defaultFeatures },
    defaultLibraries: [...template.defaultLibraries],
  }));
}

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
  lines.push("# ALP Module Scaffold Preview");
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
  validationSummary: WizardValidationSummary = createWizardValidationSummary(
    plan.boardModel,
  ),
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

  lines.push("## Starter Code Explanation");
  lines.push("");
  for (const explanation of createTemplateExplanation(plan.template.id)) {
    lines.push(`- ${explanation}`);
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

export function suggestTemplateIdFromBoardModel(
  boardModel: BoardModel,
): WizardTemplateId {
  if (
    boardModel.diagnostics?.last_error &&
    boardModel.diagnostics?.log_level === "debug"
  ) {
    return "board-diagnostics";
  }

  if (boardModel.inference) {
    return "edge-ai-starter";
  }

  if (boardModel.iot?.wifi || boardModel.iot?.mqtt || boardModel.iot?.tls) {
    return "iot-starter";
  }

  if ((boardModel.libraries ?? []).includes("fmt")) {
    return "sensor-starter";
  }

  return "minimal-app";
}

export function createTemplateExplanation(
  templateId: WizardTemplateId,
): string[] {
  switch (templateId) {
    case "sensor-starter":
      return [
        "src/main.c includes a sensor-oriented TODO path for bus init and polling.",
        "Use this when your first milestone is sensor bring-up and deterministic sampling.",
      ];
    case "iot-starter":
      return [
        "Starter defaults include Wi-Fi, MQTT, and TLS-friendly settings in board.yaml.",
        "src/main.c highlights connectivity boot and MQTT session bring-up steps.",
      ];
    case "edge-ai-starter":
      return [
        "board.yaml includes an inference block with arena defaults for initial runs.",
        "src/main.c points to model-load and inference-loop integration work.",
      ];
    case "board-diagnostics":
      return [
        "Template enables diagnostics-friendly defaults for bring-up and fault tracking.",
        "src/main.c is oriented toward check-list style board validation routines.",
      ];
    case "host-tooling-starter":
      return [
        "Scaffolds a monorepo with packages/core (shared domain), packages/cli (standalone npm CLI), and root src/ (VS Code extension).",
        "Follows the one-core-many-surfaces principle: validation, generation, and scaffolding logic lives in the core package.",
        "File generation for this template is planned and not yet available.",
      ];
    default:
      return [
        "Minimal template keeps generated code intentionally small and neutral.",
        "Use this baseline when you want full control over feature bring-up order.",
      ];
  }
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
    "# ALP Module Scaffold",
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
    os: input.os ?? "zephyr",
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
  if (templateId === "host-tooling-starter") {
    return createHostToolingStarterFiles();
  }

  const templateSpecificFiles = createTemplateSpecificStarterFiles(templateId);

  return [
    { relativePath: "board.yaml", content: createBoardYaml(boardModel) },
    {
      relativePath: "README.md",
      content: createProjectReadme(templateId, boardModel),
    },
    {
      relativePath: "prj.conf",
      content: createPrjConf(templateId),
    },
    { relativePath: "CMakeLists.txt", content: createCmakeLists() },
    {
      relativePath: "src/CMakeLists.txt",
      content: createSrcCmakeLists(templateSpecificFiles),
    },
    {
      relativePath: "include/app/app.h",
      content: createAppHeader(),
    },
    { relativePath: "src/main.c", content: createMainSource(templateId) },
    ...templateSpecificFiles,
  ];
}

function createHostToolingStarterFiles(): WizardPlannedFile[] {
  return [
    {
      relativePath: "package.json",
      content: [
        "{",
        '  "name": "my-alp-tool",',
        '  "version": "0.1.0",',
        '  "private": true,',
        '  "scripts": {',
        '    "compile": "tsc --build && pnpm --filter ./packages/cli run compile",',
        '    "test": "node --test test/*.test.js",',
        '    "clean": "tsc --build --clean"',
        "  },",
        '  "devDependencies": {',
        '    "typescript": "^5.5.0"',
        "  },",
        '  "engines": {',
        '    "node": ">=18"',
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "pnpm-workspace.yaml",
      content: ["packages:", '  - "packages/*"', ""].join("\n"),
    },
    {
      relativePath: "tsconfig.json",
      content: [
        "{",
        '  "files": [],',
        '  "references": [',
        '    { "path": "./packages/core" },',
        '    { "path": "./packages/cli" }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: ".gitignore",
      content: ["node_modules/", "dist/", "out/", "*.js.map", ".env", ""].join(
        "\n",
      ),
    },
    {
      relativePath: "README.md",
      content: [
        "# my-alp-tool",
        "",
        "<!-- Generated by ALP SDK host-tooling-starter. -->",
        "<!-- Replace `my-alp-tool` / `@my-alp-tool` with your tool name. -->",
        "",
        "A host-side ALP tool following the one-core-many-surfaces pattern.",
        "",
        "## Structure",
        "",
        "```",
        "packages/core/   shared logic (no VS Code / Node built-ins)",
        "packages/cli/    standalone CLI surface",
        "src/             VS Code extension surface",
        "```",
        "",
        "## Quick start",
        "",
        "```bash",
        "pnpm install",
        "pnpm run compile",
        "```",
        "",
      ].join("\n"),
    },
    {
      relativePath: "packages/core/package.json",
      content: [
        "{",
        '  "name": "@my-alp-tool/core",',
        '  "version": "0.1.0",',
        '  "private": true,',
        '  "main": "dist/index.js",',
        '  "types": "dist/index.d.ts",',
        '  "scripts": {',
        '    "compile": "tsc --build"',
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "packages/core/tsconfig.json",
      content: [
        "{",
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        '    "module": "commonjs",',
        '    "lib": ["ES2022"],',
        '    "declaration": true,',
        '    "declarationMap": true,',
        '    "sourceMap": true,',
        '    "outDir": "dist",',
        '    "rootDir": "src",',
        '    "composite": true,',
        '    "strict": true,',
        '    "esModuleInterop": true',
        "  },",
        '  "include": ["src/**/*"]',
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "packages/core/src/index.ts",
      content: [
        "// SPDX-License-Identifier: Apache-2.0",
        "// TODO: export shared types and utilities for CLI and extension surfaces.",
        'export const version = "0.1.0";',
        "",
      ].join("\n"),
    },
    {
      relativePath: "packages/cli/package.json",
      content: [
        "{",
        '  "name": "@my-alp-tool/cli",',
        '  "version": "0.1.0",',
        '  "private": true,',
        '  "main": "dist/cli/main.js",',
        '  "scripts": {',
        '    "compile": "tsc --build"',
        "  },",
        '  "dependencies": {',
        '    "@my-alp-tool/core": "workspace:*"',
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "packages/cli/tsconfig.json",
      content: [
        "{",
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        '    "module": "commonjs",',
        '    "lib": ["ES2022"],',
        '    "declaration": true,',
        '    "declarationMap": true,',
        '    "sourceMap": true,',
        '    "outDir": "dist",',
        '    "rootDir": "src",',
        '    "composite": true,',
        '    "strict": true,',
        '    "esModuleInterop": true,',
        '    "paths": {',
        '      "@my-alp-tool/core": ["../core/src"]',
        "    }",
        "  },",
        '  "references": [{ "path": "../core" }],',
        '  "include": ["src/**/*"]',
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "packages/cli/src/cli/main.ts",
      content: [
        "// SPDX-License-Identifier: Apache-2.0",
        'import { version } from "@my-alp-tool/core";',
        "",
        "function main(): void {",
        "  const args = process.argv.slice(2);",
        '  if (args.includes("--version") || args.includes("-v")) {',
        "    process.stdout.write(`my-alp-tool v${version}\\n`);",
        "    return;",
        "  }",
        '  process.stdout.write("TODO: implement CLI commands.\\n");',
        "}",
        "",
        "main();",
        "",
      ].join("\n"),
    },
    {
      relativePath: "src/extension.ts",
      content: [
        "// SPDX-License-Identifier: Apache-2.0",
        'import * as vscode from "vscode";',
        "",
        "export function activate(context: vscode.ExtensionContext): void {",
        "  // TODO: register commands, providers, and views.",
        "  void context.subscriptions;",
        "}",
        "",
        "export function deactivate(): void {",
        "  // no-op",
        "}",
        "",
      ].join("\n"),
    },
  ];
}

function createTemplateSpecificStarterFiles(
  templateId: WizardTemplateId,
): WizardPlannedFile[] {
  switch (templateId) {
    case "sensor-starter":
      return [
        {
          relativePath: "src/features/sensor_pipeline.c",
          content: createFeatureSource(
            "sensor_pipeline",
            "TODO: initialize bus, read sensors, normalize values for app flow.",
          ),
        },
      ];
    case "iot-starter":
      return [
        {
          relativePath: "src/features/connectivity_pipeline.c",
          content: createFeatureSource(
            "connectivity_pipeline",
            "TODO: bring up Wi-Fi, establish MQTT session, and publish telemetry.",
          ),
        },
        {
          relativePath: "config/iot.env.example",
          content: [
            "# Copy to iot.env and provide real values.",
            "WIFI_SSID=<ssid>",
            "WIFI_PASSWORD=<password>",
            "MQTT_ENDPOINT=<host>",
            "MQTT_PORT=8883",
            "",
          ].join("\n"),
        },
      ];
    case "edge-ai-starter":
      return [
        {
          relativePath: "src/features/inference_pipeline.c",
          content: createFeatureSource(
            "inference_pipeline",
            "TODO: map input tensors, execute inference, and decode model output.",
          ),
        },
      ];
    case "board-diagnostics":
      return [
        {
          relativePath: "src/features/diagnostics_checks.c",
          content: createFeatureSource(
            "diagnostics_checks",
            "TODO: run board bring-up checks and report failing subsystems.",
          ),
        },
      ];
    case "host-tooling-starter":
      return [];
    default:
      return [
        {
          relativePath: "src/features/app_bootstrap.c",
          content: createFeatureSource(
            "app_bootstrap",
            "TODO: register app services and initialize runtime modules.",
          ),
        },
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

function createProjectReadme(
  templateId: WizardTemplateId,
  boardModel: BoardModel,
): string {
  const explanations = createTemplateExplanation(templateId);
  return [
    "# ALP Starter Project",
    "",
    `Template: ${templateId}`,
    `SoM: ${boardModel.som.sku}`,
    `Carrier: ${boardModel.carrier?.name ?? "<unset>"}`,
    `OS: ${boardModel.os}`,
    "",
    "## Generated Starter Notes",
    "",
    ...explanations.map((line) => `- ${line}`),
    "",
    "## Next Steps",
    "",
    "- Run Alp: Validate board.yaml.",
    "- Run Alp: Generate all to produce derived outputs under build/generated/.",
    "- Extend source files under src/features/ for your target behavior.",
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
    "add_subdirectory(src)",
    "",
  ].join("\n");
}

function createSrcCmakeLists(files: WizardPlannedFile[]): string {
  const featureSources = files
    .map((file) => file.relativePath)
    .filter(
      (relativePath) =>
        relativePath.startsWith("src/features/") && relativePath.endsWith(".c"),
    );

  return [
    "set(ALP_APP_SOURCES",
    "  main.c",
    ...featureSources.map(
      (sourcePath) => `  ${sourcePath.replace(/^src\//, "")}`,
    ),
    ")",
    "",
    "add_executable(alp_app ${ALP_APP_SOURCES})",
    "target_include_directories(alp_app PRIVATE ../include)",
    "",
  ].join("\n");
}

function createAppHeader(): string {
  return [
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    "#ifndef ALP_APP_APP_H",
    "#define ALP_APP_APP_H",
    "",
    "int alp_app_init(void);",
    "int alp_app_run(void);",
    "",
    "#endif /* ALP_APP_APP_H */",
    "",
  ].join("\n");
}

function createMainSource(templateId: WizardTemplateId): string {
  const body = mainBodyForTemplate(templateId);
  return [
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    '#include "app/app.h"',
    "#include <stdio.h>",
    "",
    "int alp_app_init(void) {",
    "  // TODO: initialize app-level services.",
    "  return 0;",
    "}",
    "",
    "int alp_app_run(void) {",
    "  // TODO: execute one app cycle.",
    "  return 0;",
    "}",
    "",
    "int main(void) {",
    "  if (alp_app_init() != 0) {",
    '    puts("alp_app_init failed");',
    "    return 1;",
    "  }",
    "",
    "  if (alp_app_run() != 0) {",
    '    puts("alp_app_run failed");',
    "    return 1;",
    "  }",
    "",
    ...body.map((line) => `  ${line}`),
    "  return 0;",
    "}",
    "",
  ].join("\n");
}

function createPrjConf(templateId: WizardTemplateId): string {
  const common = ["CONFIG_ASSERT=y", "CONFIG_NEWLIB_LIBC=y"];

  if (templateId === "iot-starter") {
    return [
      ...common,
      "CONFIG_NETWORKING=y",
      "CONFIG_NET_IPV4=y",
      "CONFIG_MQTT_LIB=y",
      "CONFIG_MBEDTLS=y",
      "",
    ].join("\n");
  }

  if (templateId === "edge-ai-starter") {
    return [
      ...common,
      "CONFIG_CMSIS_DSP=y",
      "CONFIG_CBPRINTF_FP_SUPPORT=y",
      "",
    ].join("\n");
  }

  if (templateId === "board-diagnostics") {
    return [
      ...common,
      "CONFIG_LOG=y",
      "CONFIG_LOG_MODE_DEFERRED=y",
      "CONFIG_LOG_DEFAULT_LEVEL=4",
      "",
    ].join("\n");
  }

  if (templateId === "sensor-starter") {
    return [...common, "CONFIG_SENSOR=y", "CONFIG_I2C=y", ""].join("\n");
  }

  return [...common, ""].join("\n");
}

function createFeatureSource(unitName: string, todoLine: string): string {
  return [
    "// SPDX-License-Identifier: Apache-2.0",
    "",
    "#include <stdio.h>",
    "",
    `int ${unitName}_step(void) {`,
    `  // ${todoLine}`,
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
