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

/**
 * WHO may invoke a helper's `flash_method`, and WHEN — projected verbatim from
 * the SoM preset, and REQUIRED on every `helper_mcus[]` entry since alp-sdk
 * v0.16.0.
 *
 * `customer`: a plain flash target. `factory`: Alp Lab programs it in
 * production; never a customer flash target. `recovery_only`: Alp Lab programs
 * it in production and the customer may flash it ONLY to recover a bricked
 * device, using Alp Lab-supplied binaries.
 *
 * The schema states there is no absent-means-`customer` default, so a reader
 * must distinguish "no policy declared" from every declared value — see
 * `ManifestHelperMcu.flash_policy`. v0.16.0 ships 11 SoM presets; the 10 that
 * declare a helper all declare `recovery_only` (E1M-NX9101 declares
 * `helper_firmware: []`). Enforcement is tan's
 * (`flash_plan.py::helper_flash_gate`, tan-cli#611) and its ABSENT-policy
 * branch only skips when a method AND a channel are both declared -- which is
 * why this extension discloses the policy and never filters on it.
 */
export type HelperFlashPolicy = "customer" | "factory" | "recovery_only";

export interface ManifestHelperMcu {
  name: string;
  chip: string;
  firmware_path?: string;
  flash_method?: string;
  /** An object, or the string "TBD" when the recipe isn't finalized. */
  flash_args?: Record<string, unknown> | string;
  /**
   * REQUIRED upstream since v0.16.0, optional HERE on purpose: a manifest
   * emitted by an older SDK carries no such key, and the tolerant reader must
   * surface that as unknown authority rather than inventing one. Absent is NOT
   * `customer` — consumers compare against `"customer"` explicitly, so an
   * absent, misspelled, or upstream-added value all fail closed.
   *
   * The union is OPEN (`| (string & {})`) because `parseSystemManifest` casts
   * `helper_mcus` without validating it: a closed union would be a runtime lie
   * the moment upstream adds a fourth member, and would defeat any exhaustive
   * `switch` a later renderer writes over it. The three known members keep
   * their autocomplete; an unknown one stays readable rather than impossible.
   */
  flash_policy?: HelperFlashPolicy | (string & {});
  /**
   * How this helper's firmware is updated in the FIELD (`alp_ota_spi_otp`,
   * `alp_ota_spi_bridge`, ...). Deliberately unenumerated: the SoM-preset
   * schema owns the vocabulary and this manifest is additive-only. INDEPENDENT
   * of `flash_policy` and of `flash_method` — the schema is explicit that a
   * consumer "must not read one key's presence as excluding another's".
   */
  update_channel?: string;
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

// ---------------------------------------------------------------------------
// `alp-size/1` — the `tan size` envelope payload
// ---------------------------------------------------------------------------
//
// NOT part of system-manifest-v1, despite living next to it: `tan size` READS
// `build/system-manifest.yaml`, measures each slice's ELF, and resolves the SoM
// memory budget from SoC metadata, emitting its own `alp-size/1` payload in the
// envelope `data`. Modelled here because it is keyed by the same `core_id` and
// is only meaningful alongside a manifest.
//
// Mirrors tan-core's `SliceSize::to_json_entry` / `region_json` /
// `build_size_report` (crates/tan-core/src/size.rs, tan v0.3.1). Same tolerant
// reader doctrine as above: every measurement is optional, because tan reports
// `null` rather than guessing when a slice is not built, has no resolvable
// budget, or no size tool could read it.

/** One memory region's measurement against its budget. Any field may be null:
 *  `used` when nothing could measure it, `total` when no budget resolved, and
 *  `pct` whenever either is missing or the total is zero. */
export interface SizeRegion {
  used: number | null;
  total: number | null;
  pct: number | null;
}

/**
 * `ok` / `warn` / `over` are budget verdicts; the rest mean "no verdict":
 * `not-built` (no artefact yet), `no-budget` (neither region resolved), `n/a`
 * (the slice is not measurable at all, e.g. a Yocto image).
 */
export type SliceSizeStatus =
  | "ok"
  | "warn"
  | "over"
  | "not-built"
  | "no-budget"
  | "n/a";

/** One slice's measured footprint vs its resolved budget. */
export interface SliceSize {
  core_id: string;
  os: string;
  status: SliceSizeStatus;
  flash: SizeRegion;
  ram: SizeRegion;
  /** Where the measurement came from: `size-tool` / `pyelftools` / `rom/ram.json`. */
  source?: string | null;
  /** Why a budget is missing or the slice is `n/a`. */
  budget_note?: string;
  notes?: string[];
}

export interface SizeReport {
  schema: string;
  slices: SliceSize[];
  summary: {
    /** core_ids over budget. */
    over_budget: string[];
    /** Measured Zephyr core_ids whose budget could not be fully resolved. */
    unknown_budget: string[];
  };
}
