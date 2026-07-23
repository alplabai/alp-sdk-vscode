// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "../configurator/models";

export interface WizardPlannedFile {
  relativePath: string;
  content: string;
}

export type WizardFileChangeKind = "new" | "update" | "unchanged";

export interface WizardFileChange {
  relativePath: string;
  kind: WizardFileChangeKind;
}

export type WizardGeneratedOutputState = "existing" | "missing";

export interface WizardGeneratedOutputPreview {
  emit: string;
  displayName: string;
  outputRelativePath: string;
  languageId: string;
  state: WizardGeneratedOutputState;
  contentPreview: string;
}

export interface WizardWriteResult {
  written: string[];
  unchanged: string[];
}

export type ModuleTemplateId =
  | "sensor-driver"
  | "connectivity-service"
  | "inference-stage"
  | "diagnostics-check";

export interface ModuleTemplateDefinition {
  id: ModuleTemplateId;
  label: string;
  description: string;
  functionPrefix: string;
}

export interface ModuleScaffoldInput {
  templateId: ModuleTemplateId;
  moduleName: string;
  boardModel: BoardModel | null;
}

export interface ModuleScaffoldPlan {
  template: ModuleTemplateDefinition;
  moduleName: string;
  normalizedModuleName: string;
  files: WizardPlannedFile[];
  scaffoldTreePreview: string;
  explanations: string[];
}
