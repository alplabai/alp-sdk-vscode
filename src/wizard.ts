// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "@alp-sdk/core/configurator/models";
import {
  collectWizardFileChanges,
  writeWizardFiles,
} from "@alp-sdk/core/wizard/fileSystem";
import {
  ModuleScaffoldInput,
  ModuleTemplateDefinition,
  ModuleTemplateId,
} from "@alp-sdk/core/wizard/models";
import {
  createModuleScaffoldPlan,
  createModuleScaffoldPreviewMarkdown,
  listModuleTemplates,
} from "@alp-sdk/core/wizard/service";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { loadBoardModel } from "./configurator/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

const FIRST_RUN_PROMPT_KEY_PREFIX = "alp.firstRunWizardPromptShown";

// New Project is owned by NewProjectFlowPanel (the `alp.newProjectWizard`
// command, registered in extension.ts) which scaffolds real, v0.6-conformant
// projects via `alp init`. This module now only owns module scaffolding into an
// existing project (`alp.scaffoldModule`) — the legacy QuickPick project wizard
// was retired (it duplicated the command id and emitted pre-v0.6 board.yaml).
export function registerProjectWizardCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.scaffoldModule", () =>
    runModuleScaffoldWizard(),
  );
}

export async function maybeOfferFirstRunWizard(
  context: vscode.ExtensionContext,
): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot || !project.boardYamlPath) {
    return;
  }
  if (fs.existsSync(project.boardYamlPath)) {
    return;
  }

  const workspaceKey = workspacePromptKey(project.workspaceRoot);
  if (context.workspaceState.get<boolean>(workspaceKey, false)) {
    return;
  }

  await context.workspaceState.update(workspaceKey, true);
  const action = await vscode.window.showInformationMessage(
    "Alp: No board.yaml found. Create a new project?",
    "New Project",
  );
  if (action === "New Project") {
    await vscode.commands.executeCommand("alp.newProjectWizard");
  }
}

async function runModuleScaffoldWizard(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Alp: open a workspace folder before scaffolding a module.",
    );
    return;
  }

  const template = await pickModuleTemplate();
  if (!template) {
    return;
  }

  const defaultModuleName = suggestedModuleName(template.id);
  const moduleName = await vscode.window.showInputBox({
    title: "Alp: Module name",
    prompt: "Enter a module name (letters, numbers, separators are allowed).",
    placeHolder: defaultModuleName,
    value: defaultModuleName,
    ignoreFocusOut: true,
    validateInput: (value) => {
      return /[a-zA-Z0-9]/.test(value)
        ? null
        : "Module name must include at least one alphanumeric character.";
    },
  });
  if (!moduleName) {
    return;
  }

  const boardModel = readExistingBoardModel(project.boardYamlPath);
  const planInput: ModuleScaffoldInput = {
    templateId: template.id,
    moduleName,
    boardModel,
  };

  const plan = createModuleScaffoldPlan(planInput);
  const fileChanges = collectWizardFileChanges(
    project.workspaceRoot,
    plan.files,
  );

  const previewDocument = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: createModuleScaffoldPreviewMarkdown(plan, fileChanges),
  });
  await vscode.window.showTextDocument(previewDocument, { preview: false });

  const writeCount = fileChanges.filter(
    (file) => file.kind !== "unchanged",
  ).length;
  if (writeCount === 0) {
    await vscode.window.showInformationMessage(
      "Alp: module scaffold matches current files. Nothing to write.",
    );
    return;
  }

  const newCount = fileChanges.filter((f) => f.kind === "new").length;
  const updateCount = fileChanges.filter((f) => f.kind === "update").length;
  const changeSummary = [
    newCount > 0 ? `${newCount} new` : null,
    updateCount > 0 ? `${updateCount} updated` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const moduleAction = await vscode.window.showWarningMessage(
    `Alp: ${writeCount} module file change(s) — ${changeSummary}. Review the plan above, then apply?`,
    { modal: true },
    "Apply Changes",
  );
  if (moduleAction !== "Apply Changes") {
    return;
  }

  const result = writeWizardFiles(project.workspaceRoot, plan.files);
  const sourcePath = path.join(
    project.workspaceRoot,
    `src/modules/${plan.normalizedModuleName}/${plan.normalizedModuleName}.c`,
  );
  const sourceDoc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(sourcePath),
  );
  await vscode.window.showTextDocument(sourceDoc, { preview: false });

  vscode.window.setStatusBarMessage(
    `Alp: module scaffold wrote ${result.written.length} file(s), unchanged ${result.unchanged.length}.`,
    7000,
  );
}

function workspacePromptKey(workspaceRoot: string): string {
  return `${FIRST_RUN_PROMPT_KEY_PREFIX}:${workspaceRoot}`;
}

async function pickModuleTemplate(): Promise<ModuleTemplateDefinition | null> {
  const templates = listModuleTemplates();
  const pick = await vscode.window.showQuickPick(
    templates.map((template) => ({
      label: template.label,
      description: template.description,
      detail: `id: ${template.id}`,
      template,
    })),
    {
      title: "Alp: Scaffold module template",
      placeHolder:
        "Select the module template for existing project scaffolding",
      ignoreFocusOut: true,
    },
  );
  return pick?.template ?? null;
}

function readExistingBoardModel(
  boardYamlPath: string | null,
): BoardModel | null {
  if (!boardYamlPath || !fs.existsSync(boardYamlPath)) {
    return null;
  }

  try {
    return loadBoardModel(boardYamlPath);
  } catch {
    return null;
  }
}

function suggestedModuleName(templateId: ModuleTemplateId): string {
  switch (templateId) {
    case "sensor-driver":
      return "sensor_input";
    case "connectivity-service":
      return "connectivity_service";
    case "inference-stage":
      return "inference_stage";
    default:
      return "board_health";
  }
}
