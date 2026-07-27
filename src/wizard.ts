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
import { planConfirm, planPrecondition, planSuccess } from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
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
  // Audit verdict `keep`: the text and the single action are already right, so
  // the plan is spelled out rather than built by `planPrecondition("noBoardYaml")`
  // — that builder retitles the offer and adds a second button. `newProject`
  // carries a `run` (alp.newProjectWizard), so the presenter executes it and the
  // old branch-on-title disappears with no change in what the user sees.
  await notify({
    severity: "info",
    channel: "toast",
    message: "Alp: No board.yaml found. Create a new project?",
    actions: [{ id: "newProject" }],
  });
}

async function runModuleScaffoldWizard(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    // A precondition, not a failure: warning severity + the Open Folder action
    // (alp.switchWorkspace) instead of a red toast whose only option is dismissal.
    await notify(
      planPrecondition("noWorkspace", { operation: "scaffold a module" }),
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
    // Same channel as this function's success path below (the status bar): a
    // transient no-op verdict is not worth a notification the user must dismiss.
    await notify(
      planSuccess(
        "Alp: module scaffold matches current files. Nothing to write.",
      ),
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
  // Stays MODAL: this gates a multi-file write, and a corner toast is easy to
  // miss or auto-dismiss — the blocking dialog is what guarantees the user saw
  // the question. The "read the plan first" affordance rides in `modalDetail`,
  // which is rendered ON the dialog; the markdown preview opened above survives
  // a Cancel, so reading it costs one re-run and never a stray write. The pick
  // still gates the write: `applyChanges` has no `run` in the presenter's
  // table, so `notify` hands the id back instead of swallowing it.
  const moduleAction = await notify(
    planConfirm({
      message: `Alp: apply ${writeCount} module file change(s) — ${changeSummary}?`,
      modalDetail:
        "The markdown preview listing every file is open behind this dialog. " +
        'Cancel to read it, then re-run "Alp: Scaffold module" to apply.',
      confirm: { id: "applyChanges" },
    }),
  );
  if (moduleAction !== "applyChanges") {
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
