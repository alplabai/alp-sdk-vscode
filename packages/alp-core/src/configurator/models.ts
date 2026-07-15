// SPDX-License-Identifier: Apache-2.0

export interface CoreEntry {
  os: "zephyr" | "yocto" | "baremetal" | "off";
  app?: string;
  image?: string;
  peripherals?: string[];
  libraries?: string[];
  inference?: { backend?: string; default_arena_kib?: number };
  iot?: { wifi?: boolean; mqtt?: boolean; ble?: boolean; tls?: boolean };
}

export interface IpcCarveOut {
  name: string;
  kind?: string;
  endpoints: string[];
  /** Shared-memory size in KiB (board.schema.json v0.6 field `carve_out_kb`). */
  carve_out_kb: number;
  cacheable?: boolean;
}

export interface BoardModel {
  schema_version: number;
  som: { sku: string };
  /** Retired: the configurator still edits `carrier`, but it is mapped onto the
   *  SDK-schema `preset` / `populated` on serialize (see normalizeBoardModel). */
  carrier?: { name: string; populated?: Record<string, boolean> };
  /** SDK board.schema.json top-level carrier preset (lowercase slug). Emitted in
   *  place of the retired `carrier:` key; mutually exclusive with `populated`. */
  preset?: string;
  /** SDK board.schema.json inline pin population (mutually exclusive with preset). */
  populated?: Record<string, boolean>;
  /** v1 only. Absent in schema_version >= 2 (use `cores` instead). */
  os?: string;
  /** v2 only. Per-core runtime + app mapping. */
  cores?: Record<string, CoreEntry>;
  /** v2 only. Cross-core IPC shared-memory carve-outs. */
  ipc?: IpcCarveOut[];
  inference?: { backend?: string; default_arena_kib?: number };
  libraries?: string[];
  iot?: { wifi?: boolean; mqtt?: boolean; ble?: boolean; tls?: boolean };
  diagnostics?: { last_error?: boolean; log_level?: string };
  [key: string]: unknown;
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
