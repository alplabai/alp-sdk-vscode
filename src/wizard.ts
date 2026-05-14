// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { loadPresetCatalogue } from "./configurator/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import {
    WizardFeatureFlags,
    WizardPlanInput,
    WizardTemplateDefinition,
} from "./wizard/models";
import {
    createWizardPlan,
    createWizardPreviewMarkdown,
  createWizardValidationSummary,
    listWizardTemplates,
} from "./wizard/service";
import {
    collectGeneratedOutputPreviews,
    collectWizardFileChanges,
    writeWizardFiles,
} from "./wizard/vscodeAdapter";

const FIRST_RUN_PROMPT_KEY_PREFIX = "alp.firstRunWizardPromptShown";

export function registerProjectWizardCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.newProjectWizard", () =>
    runProjectWizard(),
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
    "Alp: No board.yaml found. Start with the new project wizard?",
    "Open Wizard",
  );
  if (action === "Open Wizard") {
    await runProjectWizard();
  }
}

async function runProjectWizard(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Alp: open a workspace folder before running the project wizard.",
    );
    return;
  }

  const catalogue = loadPresetCatalogue(project);
  const template = await pickTemplate();
  if (!template) {
    return;
  }

  const somSku = await pickValue(
    "Alp: Pick SoM SKU",
    "Select the target module SKU.",
    catalogue.skus,
    "E1M-AEN701",
  );
  if (!somSku) {
    return;
  }

  const carrierName = await pickValue(
    "Alp: Pick carrier",
    "Select the carrier preset.",
    catalogue.carriers.map((carrier) => carrier.name),
    "E1M-EVK",
  );
  if (!carrierName) {
    return;
  }

  const os = await pickValue(
    "Alp: Pick OS",
    "Select the OS target for board.yaml.",
    catalogue.osChoices,
    "zephyr",
  );
  if (!os) {
    return;
  }

  const features = await pickFeatures(template.defaultFeatures);
  if (!features) {
    return;
  }

  const libraries = await pickLibraries(
    catalogue.libraries,
    template.defaultLibraries,
  );
  if (!libraries) {
    return;
  }

  const planInput: WizardPlanInput = {
    templateId: template.id,
    somSku,
    carrierName,
    os,
    features,
    libraries,
  };
  const plan = createWizardPlan(planInput);
  const fileChanges = collectWizardFileChanges(
    project.workspaceRoot,
    plan.files,
  );
  const generatedOutputs = collectGeneratedOutputPreviews(
    project.workspaceRoot,
  );
  const validationSummary = createWizardValidationSummary(plan.boardModel);

  const previewDocument = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: createWizardPreviewMarkdown(
      plan,
      fileChanges,
      generatedOutputs,
      validationSummary,
    ),
  });
  await vscode.window.showTextDocument(previewDocument, { preview: false });

  if (validationSummary.errors.length > 0) {
    await vscode.window.showErrorMessage(
      `Alp: wizard validation found ${validationSummary.errors.length} error(s). Resolve selections before writing files.`,
    );
    return;
  }

  const writeCount = fileChanges.filter(
    (file) => file.kind !== "unchanged",
  ).length;
  if (writeCount === 0) {
    await vscode.window.showInformationMessage(
      "Alp: wizard plan matches current files. Nothing to write.",
    );
    return;
  }

  const overwriteCount = fileChanges.filter(
    (file) => file.kind === "update",
  ).length;
  const action = await vscode.window.showWarningMessage(
    `Alp: write ${writeCount} file(s)? Existing files to update: ${overwriteCount}.`,
    { modal: true },
    "Write Files",
  );
  if (action !== "Write Files") {
    return;
  }

  const result = writeWizardFiles(project.workspaceRoot, plan.files);
  const boardYamlPath = path.join(project.workspaceRoot, "board.yaml");
  const boardYamlUri = vscode.Uri.file(boardYamlPath);
  const boardDoc = await vscode.workspace.openTextDocument(boardYamlUri);
  await vscode.window.showTextDocument(boardDoc, { preview: false });

  vscode.window.setStatusBarMessage(
    `Alp: wizard wrote ${result.written.length} file(s), unchanged ${result.unchanged.length}.`,
    7000,
  );
}

function workspacePromptKey(workspaceRoot: string): string {
  return `${FIRST_RUN_PROMPT_KEY_PREFIX}:${workspaceRoot}`;
}

async function pickTemplate(): Promise<WizardTemplateDefinition | null> {
  const templates = listWizardTemplates();
  const pick = await vscode.window.showQuickPick(
    templates.map((template) => ({
      label: template.label,
      description: template.description,
      detail: `id: ${template.id}`,
      template,
    })),
    {
      title: "Alp: New project template",
      placeHolder: "Select the starter template",
      ignoreFocusOut: true,
    },
  );
  return pick?.template ?? null;
}

async function pickValue(
  title: string,
  placeHolder: string,
  values: readonly string[],
  fallback: string,
): Promise<string | null> {
  const candidates = values.length > 0 ? values : [fallback];
  const pick = await vscode.window.showQuickPick(
    candidates.map((value) => ({
      label: value,
      value,
    })),
    {
      title,
      placeHolder,
      ignoreFocusOut: true,
    },
  );
  return pick?.value ?? null;
}

async function pickFeatures(
  defaults: WizardFeatureFlags,
): Promise<WizardFeatureFlags | null> {
  const items = [
    {
      label: "wifi",
      description: "Enable Wi-Fi station path",
      picked: defaults.wifi,
    },
    {
      label: "mqtt",
      description: "Enable MQTT client",
      picked: defaults.mqtt,
    },
    {
      label: "ble",
      description: "Enable BLE host stack",
      picked: defaults.ble,
    },
    {
      label: "tls",
      description: "Enable TLS support",
      picked: defaults.tls,
    },
  ];

  const picks = await vscode.window.showQuickPick(items, {
    title: "Alp: Select feature flags",
    placeHolder: "Choose optional feature flags",
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picks) {
    return null;
  }

  const selected = new Set(picks.map((pick) => pick.label));
  return {
    wifi: selected.has("wifi"),
    mqtt: selected.has("mqtt"),
    ble: selected.has("ble"),
    tls: selected.has("tls"),
  };
}

async function pickLibraries(
  catalogueLibraries: readonly string[],
  defaults: readonly string[],
): Promise<string[] | null> {
  const libraries = catalogueLibraries.length > 0 ? catalogueLibraries : [];
  const items = libraries.map((library) => ({
    label: library,
    picked: defaults.includes(library),
  }));

  const picks = await vscode.window.showQuickPick(items, {
    title: "Alp: Select optional libraries",
    placeHolder: "Choose optional dependencies for board.yaml",
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picks) {
    return null;
  }

  return picks.map((pick) => pick.label).sort();
}
