// SPDX-License-Identifier: Apache-2.0

import { EmitMode } from "../../../loader/models";
import { listGenerationTargetSupport } from "../../../loader/service";
import {
  createTemplateExplanation,
  listModuleTemplates,
  listWizardTemplates,
} from "../../../wizard/service";
import {
  CLI_EXIT_CODE,
  CliExecutionInput,
  CliExecutionResult,
  CliGlobalFlags,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

interface ExplainCommandData {
  schemaVersion: "1";
  selector: {
    kind:
      | "overview"
      | "project-template"
      | "module-template"
      | "generation-target";
    value: string;
  };
  summary: string;
  details: string[];
  available: {
    projectTemplates: string[];
    moduleTemplates: string[];
    generationTargets: EmitMode[];
  };
}

export function runExplainCommand(
  flags: CliGlobalFlags,
  _input: Omit<CliExecutionInput, "argv">,
): CliExecutionResult<ExplainCommandData> {
  try {
    const projectTemplates = listWizardTemplates();
    const moduleTemplates = listModuleTemplates();
    const generationTargets = listGenerationTargetSupport();
    const requestedTemplate = flags.template?.trim() || null;
    const requestedTarget = flags.target?.trim() || null;

    if (requestedTemplate && requestedTarget) {
      return createFailureResult(
        "explain",
        flags.format,
        CLI_EXIT_CODE.runtimeFailure,
        [
          "explain: use either --template or --target, but not both in the same command.",
        ],
        [
          {
            code: "explain.ambiguous-selector",
            severity: "error",
            message: "Use either --template or --target for explain, not both.",
          },
        ],
        {
          schemaVersion: "1",
          selector: { kind: "overview", value: "" },
          summary: "",
          details: [],
          available: {
            projectTemplates: projectTemplates.map((item) => item.id),
            moduleTemplates: moduleTemplates.map((item) => item.id),
            generationTargets: generationTargets.map((item) => item.emit),
          },
        },
      );
    }

    if (requestedTemplate) {
      const projectTemplate = projectTemplates.find(
        (item) => item.id === requestedTemplate,
      );
      if (projectTemplate) {
        const details = [
          projectTemplate.description,
          ...createTemplateExplanation(projectTemplate.id),
          `Default libraries: ${projectTemplate.defaultLibraries.join(", ") || "(none)"}`,
          `Default features: ${formatFeatureFlags(projectTemplate.defaultFeatures)}`,
        ];
        return createExplainSuccess(
          flags,
          {
            kind: "project-template",
            value: projectTemplate.id,
          },
          `${projectTemplate.label} (${projectTemplate.id})`,
          details,
          projectTemplates,
          moduleTemplates,
          generationTargets,
        );
      }

      const moduleTemplate = moduleTemplates.find(
        (item) => item.id === requestedTemplate,
      );
      if (moduleTemplate) {
        const details = [
          moduleTemplate.description,
          `Function prefix: ${moduleTemplate.functionPrefix}`,
          "Use this template with alp scaffold to generate a module source/header baseline.",
        ];
        return createExplainSuccess(
          flags,
          {
            kind: "module-template",
            value: moduleTemplate.id,
          },
          `${moduleTemplate.label} (${moduleTemplate.id})`,
          details,
          projectTemplates,
          moduleTemplates,
          generationTargets,
        );
      }

      return createFailureResult(
        "explain",
        flags.format,
        CLI_EXIT_CODE.runtimeFailure,
        [
          `explain: unknown template '${requestedTemplate}'. Run alp explain without selectors to list available topics.`,
        ],
        [
          {
            code: "explain.template-unknown",
            severity: "error",
            message: `Unknown template '${requestedTemplate}'.`,
          },
        ],
        {
          schemaVersion: "1",
          selector: { kind: "overview", value: requestedTemplate },
          summary: "",
          details: [],
          available: {
            projectTemplates: projectTemplates.map((item) => item.id),
            moduleTemplates: moduleTemplates.map((item) => item.id),
            generationTargets: generationTargets.map((item) => item.emit),
          },
        },
      );
    }

    if (requestedTarget) {
      const target = generationTargets.find(
        (item) => item.emit === requestedTarget,
      );
      if (!target) {
        return createFailureResult(
          "explain",
          flags.format,
          CLI_EXIT_CODE.runtimeFailure,
          [
            `explain: unknown generation target '${requestedTarget}'. Run alp explain without selectors to list available targets.`,
          ],
          [
            {
              code: "explain.target-unknown",
              severity: "error",
              message: `Unknown generation target '${requestedTarget}'.`,
            },
          ],
          {
            schemaVersion: "1",
            selector: { kind: "overview", value: requestedTarget },
            summary: "",
            details: [],
            available: {
              projectTemplates: projectTemplates.map((item) => item.id),
              moduleTemplates: moduleTemplates.map((item) => item.id),
              generationTargets: generationTargets.map((item) => item.emit),
            },
          },
        );
      }

      const details = [
        `Display name: ${target.displayName}`,
        `Output path: ${target.outputRelativePath}`,
        `Preview label: ${target.preview.label}`,
        `Preview language: ${target.preview.languageId}`,
      ];
      return createExplainSuccess(
        flags,
        {
          kind: "generation-target",
          value: target.emit,
        },
        `${target.displayName} (${target.emit})`,
        details,
        projectTemplates,
        moduleTemplates,
        generationTargets,
      );
    }

    const overviewDetails = [
      "Use --template to explain a project template (init) or module template (scaffold).",
      "Use --target to explain a generation output target.",
      `Project templates: ${projectTemplates.map((item) => item.id).join(", ")}`,
      `Module templates: ${moduleTemplates.map((item) => item.id).join(", ")}`,
      `Generation targets: ${generationTargets.map((item) => item.emit).join(", ")}`,
    ];

    return createExplainSuccess(
      flags,
      {
        kind: "overview",
        value: "all",
      },
      "ALP explain topics",
      overviewDetails,
      projectTemplates,
      moduleTemplates,
      generationTargets,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected CLI explain failure.";
    return createFailureResult(
      "explain",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["explain: internal failure", message],
      [
        {
          code: "explain.internal-failure",
          severity: "error",
          message,
        },
      ],
      {
        schemaVersion: "1",
        selector: { kind: "overview", value: "" },
        summary: "",
        details: [],
        available: {
          projectTemplates: [],
          moduleTemplates: [],
          generationTargets: [],
        },
      },
    );
  }
}

function createExplainSuccess(
  flags: CliGlobalFlags,
  selector: ExplainCommandData["selector"],
  summary: string,
  details: string[],
  projectTemplates: ReturnType<typeof listWizardTemplates>,
  moduleTemplates: ReturnType<typeof listModuleTemplates>,
  generationTargets: ReturnType<typeof listGenerationTargetSupport>,
): CliExecutionResult<ExplainCommandData> {
  const data: ExplainCommandData = {
    schemaVersion: "1",
    selector,
    summary,
    details,
    available: {
      projectTemplates: projectTemplates.map((item) => item.id),
      moduleTemplates: moduleTemplates.map((item) => item.id),
      generationTargets: generationTargets.map((item) => item.emit),
    },
  };

  const textLines: string[] = [];
  if (flags.format === "text") {
    textLines.push(`explain: ${summary}`);
    if (!flags.quiet) {
      for (const detail of details) {
        textLines.push(`- ${detail}`);
      }
    }
  }

  return {
    format: flags.format,
    exitCode: CLI_EXIT_CODE.success,
    textLines,
    envelope: createEnvelope(
      "explain",
      {
        root: null,
        boardYaml: null,
      },
      data,
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

function formatFeatureFlags(features: {
  wifi: boolean;
  mqtt: boolean;
  ble: boolean;
  tls: boolean;
}): string {
  return [
    `wifi=${features.wifi}`,
    `mqtt=${features.mqtt}`,
    `ble=${features.ble}`,
    `tls=${features.tls}`,
  ].join(" ");
}
