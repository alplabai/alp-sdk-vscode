// SPDX-License-Identifier: Apache-2.0

import { BoardModel } from "../configurator/models";

export type WizardTemplateId =
  | "minimal-app"
  | "sensor-starter"
  | "iot-starter"
  | "edge-ai-starter"
  | "board-diagnostics";

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

export interface WizardWriteResult {
  written: string[];
  unchanged: string[];
}
