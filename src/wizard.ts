// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "@alp-sdk/core/configurator/models";
import {
    collectGeneratedOutputPreviews,
    collectWizardFileChanges,
    writeWizardFiles,
} from "@alp-sdk/core/wizard/fileSystem";
import {
    ModuleScaffoldInput,
    ModuleTemplateDefinition,
    ModuleTemplateId,
    WizardFeatureFlags,
    WizardPlanInput,
    WizardTemplateDefinition,
    WizardTemplateId,
} from "@alp-sdk/core/wizard/models";
import {
    createModuleScaffoldPlan,
    createModuleScaffoldPreviewMarkdown,
    createTemplateExplanation,
    createWizardPlan,
    createWizardPreviewMarkdown,
    createWizardValidationSummary,
    listModuleTemplates,
    listWizardTemplates,
    suggestTemplateIdFromBoardModel,
} from "@alp-sdk/core/wizard/service";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    loadBoardModel,
    loadPresetCatalogue,
} from "./configurator/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

const FIRST_RUN_PROMPT_KEY_PREFIX = "alp.firstRunWizardPromptShown";

export function registerProjectWizardCommand(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand("alp.newProjectWizard", () =>
      runProjectWizard(),
    ),
    vscode.commands.registerCommand("alp.scaffoldModule", () =>
      runModuleScaffoldWizard(),
    ),
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

  const existingBoardModel = readExistingBoardModel(project.boardYamlPath);
  const catalogue = loadPresetCatalogue(project);
  const suggestedTemplateId = existingBoardModel
    ? suggestTemplateIdFromBoardModel(existingBoardModel)
    : undefined;

  const template = await pickTemplate(suggestedTemplateId);
  if (!template) {
    return;
  }

  const existingSomSku = existingBoardModel?.som?.sku;
  const somSku = await pickValue(
    "Alp: Pick SoM SKU",
    "Select the target module SKU.",
    catalogue.skus,
    existingSomSku || "E1M-AEN701",
  );
  if (!somSku) {
    return;
  }

  const existingCarrier = existingBoardModel?.carrier?.name;
  const carrierName = await pickValue(
    "Alp: Pick carrier",
    "Select the carrier preset.",
    catalogue.carriers.map((carrier) => carrier.name),
    existingCarrier || "E1M-EVK",
  );
  if (!carrierName) {
    return;
  }

  const existingOs = existingBoardModel?.os;
  const os = await pickValue(
    "Alp: Pick OS",
    "Select the OS target for board.yaml.",
    catalogue.osChoices,
    existingOs || "zephyr",
  );
  if (!os) {
    return;
  }

  const features = await pickFeatures(
    existingBoardModel
      ? {
          wifi: !!existingBoardModel.iot?.wifi,
          mqtt: !!existingBoardModel.iot?.mqtt,
          ble: !!existingBoardModel.iot?.ble,
          tls: !!existingBoardModel.iot?.tls,
        }
      : template.defaultFeatures,
  );
  if (!features) {
    return;
  }

  const libraries = await pickLibraries(
    catalogue.libraries,
    existingBoardModel?.libraries ?? template.defaultLibraries,
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
  const overwritePreview = fileChanges
    .filter((file) => file.kind === "update")
    .slice(0, 3)
    .map((file) => file.relativePath)
    .join(", ");
  const overwriteSuffix =
    overwritePreview.length > 0
      ? ` Files to update: ${overwritePreview}${overwriteCount > 3 ? ", ..." : ""}.`
      : "";
  const action = await vscode.window.showWarningMessage(
    `Alp: write ${writeCount} file(s)? Existing files to update: ${overwriteCount}.${overwriteSuffix}`,
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

  const explanation = createTemplateExplanation(template.id);
  const openAction = await vscode.window.showInformationMessage(
    `Alp: ${template.label} scaffold ready. ${explanation[0]}`,
    "Open in New Window",
    "Stay Here",
  );
  if (openAction === "Open in New Window") {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(project.workspaceRoot),
      { forceNewWindow: true },
    );
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

  const overwriteCount = fileChanges.filter(
    (file) => file.kind === "update",
  ).length;
  const action = await vscode.window.showWarningMessage(
    `Alp: write ${writeCount} module file(s)? Existing files to update: ${overwriteCount}.`,
    { modal: true },
    "Write Files",
  );
  if (action !== "Write Files") {
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

async function pickTemplate(
  preferredTemplateId?: WizardTemplateId,
): Promise<WizardTemplateDefinition | null> {
  const templates = listWizardTemplates();
  const orderedTemplates = preferredTemplateId
    ? [
        ...templates.filter((template) => template.id === preferredTemplateId),
        ...templates.filter((template) => template.id !== preferredTemplateId),
      ]
    : templates;
  const pick = await vscode.window.showQuickPick(
    orderedTemplates.map((template, index) => ({
      label:
        index === 0 && template.id === preferredTemplateId
          ? `${template.label} (recommended)`
          : template.label,
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
