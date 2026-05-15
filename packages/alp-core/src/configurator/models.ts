// SPDX-License-Identifier: Apache-2.0

export interface BoardModel {
  schema_version: number;
  som: { sku: string };
  carrier?: { name: string; populated?: Record<string, boolean> };
  os: string;
  inference?: { backend?: string; default_arena_kib?: number };
  libraries?: string[];
  iot?: { wifi?: boolean; mqtt?: boolean; ble?: boolean; tls?: boolean };
  diagnostics?: { last_error?: boolean; log_level?: string };
}

export interface CarrierPreset {
  name: string;
  populated: Record<string, boolean>;
}

export interface PresetCatalogue {
  skus: string[];
  carriers: CarrierPreset[];
  libraries: string[];
  inferenceBackends: string[];
  logLevels: string[];
  osChoices: string[];
}

export interface ConfiguratorInitPayload {
  type: "init";
  model: BoardModel;
  catalogue: PresetCatalogue;
  boardPath: string;
}

export interface ConfiguratorSavedPayload {
  type: "saved";
  boardPath: string;
}

export type ConfiguratorOutboundMessage =
  | ConfiguratorInitPayload
  | ConfiguratorSavedPayload;

export interface ConfiguratorInboundMessage {
  type: string;
  payload?: BoardModel;
}
