// SPDX-License-Identifier: Apache-2.0
//
// TS mirror of the ALP **system manifest** (`build/system-manifest.yaml`) — the
// IDE/tool contract emitted by `west alp-emit system-manifest`
// (`python -m alp_orchestrate --emit system-manifest`). Mirrors, field-for-field,
// the Rust model in cli-rs/crates/alp-core/src/system_manifest.rs and the
// vendored schema schemas/system-manifest-v1.schema.json (alp-sdk v0.13.0).
// Kept in sync MANUALLY — change all three together.
//
// TOLERANT READER (the stability policy from alp-sdk#106): `schema_version` 1 is
// additive-only; a breaking change ships as v2 via a deprecation cycle. So
// every block is read leniently — optional fields stay optional, unknown
// additive fields are ignored, and fields the schema marks "required" but the
// emitter omits for off/pending slices (flash_method/flash_args) are optional.

export const SYSTEM_MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestHwInfo {
  sku: string;
  som_hw_rev?: string | null;
  board_name?: string | null;
  board_hw_rev?: string | null;
  silicon?: string | null;
  /** Resolved features.hw_info.eeprom manifest location (present when declared in board.yaml). */
  eeprom?: {
    bus: string;
    bus_id: number;
    addr_7bit: number;
    offset: number;
  };
}

export type SliceStatus = "pending" | "ok" | "failed" | "skipped";

/** One per-core image: runtime + the build/flash wiring the IDE consumes. */
export interface ManifestSlice {
  core_id: string;
  /** zephyr | yocto | baremetal | off (value-set owned by board.schema.json). */
  os: string;
  app?: string;
  image?: string;
  /** Yocto bitbake recipe packaging an app-only Yocto slice's `app:` source dir. */
  recipe?: string;
  machine?: string;
  board?: string;
  toolchain?: string;
  build_dir?: string;
  output_artefact?: string;
  status: SliceStatus | string;
  log_path?: string;
  reason?: string;
  /** Schema-required, but omitted by the emitter for off/pending slices. */
  flash_method?: string;
  /** Method-specific (shape varies by flash_method); kept opaque. */
  flash_args?: Record<string, unknown>;
}

export interface ManifestIpcLink {
  name: string;
  kind: string;
  endpoints: string[];
  status?: string;
  reason?: string;
  // additionalProperties: true upstream — extra carve-out fields tolerated.
  [key: string]: unknown;
}

export interface ManifestHelperMcu {
  name: string;
  chip: string;
  firmware_path?: string;
  flash_method?: string;
  /** An object, or the string "TBD" when the recipe isn't finalized. */
  flash_args?: Record<string, unknown> | string;
  [key: string]: unknown;
}

export interface SystemManifest {
  schema_version: number;
  generated_by: string;
  hw_info: ManifestHwInfo;
  slices: ManifestSlice[];
  ipc: ManifestIpcLink[];
  helper_mcus: ManifestHelperMcu[];
  /** Inter-image boot sequencing — opaque until a SoM declares boot_order. */
  boot_order: unknown[];
  /** Resolved storage partitions — present only when the project declares storage. */
  storage?: unknown[];
}

/** True for a slice whose core participates in build/flash (its os isn't off). */
export function isActiveSlice(slice: ManifestSlice): boolean {
  return slice.os !== "off";
}
