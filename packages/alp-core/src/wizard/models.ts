// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "../configurator/service";

export type WizardTemplateId =
  | "minimal-app"
  | "sensor-starter"
  | "iot-starter"
  | "edge-ai-starter"
  | "board-diagnostics"
  | "host-tooling-starter";

export interface WizardFeatureFlags {
  wifi: boolean;
  mqtt: boolean;
  ble: boolean;
  tls: boolean;
}

export interface WizardTemplateDefinition {
  id: WizardTemplateId;
  label: string;
  description: string;
  defaultFeatures: WizardFeatureFlags;
  defaultLibraries: string[];
}

export interface WizardPlanInput {
  templateId: WizardTemplateId;
  somSku: string;
  carrierName: string;
  os: string;
  features: WizardFeatureFlags;
  libraries: string[];
}

export interface WizardPlannedFile {
  relativePath: string;
  content: string;
}

export interface WizardPlan {
  template: WizardTemplateDefinition;
  boardModel: BoardModel;
  files: WizardPlannedFile[];
  scaffoldTreePreview: string;
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

export interface WizardValidationSummary {
  errors: string[];
  warnings: string[];
  suggestions: string[];
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
