// SPDX-License-Identifier: Apache-2.0
//! **PARSER layer** — the metadata structs (`board.yaml` + the SoM preset +
//! the resolved board definition + the SoC spec), deserialized from YAML/JSON.
//! Pure models: serde derives only, no domain logic. This is the deserialize
//! half of the parser/writer split — serde *is* the parser (RFC #235: facts are
//! data). Everything here is `pub(crate)` so the engine modules can read it.

use std::collections::BTreeMap;

use serde::Deserialize;

// --- board.yaml (the consumer's project file) ---

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BoardYaml {
    pub(crate) som: BoardSom,
    /// top-level board hw_rev (overrides the board def default)
    #[serde(default)]
    pub(crate) hw_rev: Option<String>,
    #[serde(default)]
    pub(crate) cores: BTreeMap<String, BoardCore>,
    #[serde(default)]
    pub(crate) diagnostics: Option<Diagnostics>,
    #[serde(default)]
    pub(crate) ipc: Vec<IpcChannel>,
    /// Storage partition declarations (typed) — the input to the bottom-up
    /// partition allocator (`partition.rs`), mirroring the SDK `storage:` block.
    #[serde(default)]
    pub(crate) storage: Vec<StorageEntry>,
    /// Secure-boot / MCUboot config (signing, slot sizes, swap algorithm).
    #[serde(default)]
    pub(crate) boot: Option<BootBlock>,
    /// PSA crypto / TF-M secure-world config.
    #[serde(default)]
    pub(crate) security: Option<SecurityBlock>,
    /// OTA update fabric (project-wide); drives the `# OTA` alp.conf section.
    #[serde(default)]
    pub(crate) ota: Option<OtaBlock>,
    /// The E1M pads this app actively uses (a subset of the board's `e1m_routes`)
    /// — the input to end-to-end pin-mux validation.
    #[serde(default)]
    pub(crate) pins: Vec<RouteEntry>,
}

/// One `storage:` entry, verbatim from board.yaml (mirrors the SDK `StorageEntry`).
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct StorageEntry {
    pub(crate) name: String,
    pub(crate) size_kib: u64,
    pub(crate) fs: String, // littlefs | fat | ext4 | raw
    #[serde(default)]
    pub(crate) mount: Option<String>,
    #[serde(default)]
    pub(crate) flash_device: Option<String>,
    /// Explicit offset override (page-aligned); the allocator honours it verbatim.
    #[serde(default)]
    pub(crate) offset_kib: Option<u64>,
}

/// `boot:` — secure-boot / MCUboot driver (drives the sysbuild SB_CONFIG lines).
#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct BootBlock {
    #[serde(default)]
    pub(crate) method: Option<String>, // mcuboot | none
    #[serde(default)]
    pub(crate) signing: Option<SigningBlock>,
    #[serde(default)]
    pub(crate) slots: Option<BootSlots>,
    #[serde(default)]
    pub(crate) swap_algorithm: Option<String>, // scratch | move | overwrite
    #[serde(default)]
    pub(crate) scratch_size_kib: Option<u64>,
    #[serde(default)]
    pub(crate) anti_rollback: Option<bool>,
    /// Shared with TF-M (P2): the CMake build flavour.
    #[serde(default)]
    pub(crate) build_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SigningBlock {
    #[serde(default)]
    pub(crate) algorithm: Option<String>,
    #[serde(default)]
    pub(crate) key_file: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BootSlots {
    #[serde(default)]
    pub(crate) primary: Option<SlotSize>,
    #[serde(default)]
    pub(crate) secondary: Option<SlotSize>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SlotSize {
    #[serde(default)]
    pub(crate) size_kib: Option<u64>,
}

/// `security:` — PSA crypto + TF-M secure partition.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SecurityBlock {
    #[serde(default)]
    pub(crate) psa: Option<PsaBlock>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PsaBlock {
    #[serde(default)]
    pub(crate) tfm: Option<bool>,
    #[serde(default)]
    pub(crate) persistent_slots: Option<u32>,
    #[serde(default)]
    pub(crate) its_storage: Option<String>,
    #[serde(default)]
    pub(crate) ps_storage: Option<String>,
    #[serde(default)]
    pub(crate) attestation_root: Option<String>, // none | optiga_trust_m | tfm_internal
}

/// `ota:` — kept as an opaque presence/field bag for the comment-only alp.conf
/// section (live Mender wiring is a v0.7+ upstream gap; we reproduce the comments).
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct OtaBlock {
    #[serde(default)]
    pub(crate) provider: Option<String>,
    #[serde(default)]
    pub(crate) artifact_name: Option<String>,
    #[serde(default)]
    pub(crate) poll_interval_s: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct IpcChannel {
    pub(crate) kind: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) endpoints: Vec<String>,
    #[serde(default)]
    pub(crate) carve_out_kb: Option<u32>,
    #[serde(default)]
    pub(crate) cacheable: Option<bool>,
    /// Explicit carve-out base (page-aligned); overrides the allocator.
    #[serde(default)]
    pub(crate) address: Option<u64>,
}

/// One memory region (a SoM `memory_map:` entry or a SoC `memory_regions[]`):
/// where the carve-out allocator places IPC buffers.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct MemRegion {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) base: Option<u64>,
    #[serde(default)]
    pub(crate) size_kib: Option<u64>,
    #[serde(default)]
    pub(crate) size_mib: Option<u64>,
    #[serde(default)]
    pub(crate) accessible_from: Vec<String>,
    #[serde(default)]
    pub(crate) cacheable: Option<bool>,
    /// The Zephyr DT label the storage overlay decorates (`&<dt_label>`); falls
    /// back to `name` when unset. Derived regions carry no explicit label.
    #[serde(default)]
    pub(crate) dt_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct MailboxChannel {
    pub(crate) id: u32,
    #[serde(default)]
    pub(crate) reserved_for: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BoardSom {
    pub(crate) sku: String,
    #[serde(default)]
    pub(crate) hw_rev: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct BoardCore {
    #[serde(default)]
    pub(crate) app: Option<String>,
    #[serde(default)]
    pub(crate) image: Option<String>,
    #[serde(default)]
    pub(crate) libraries: Vec<String>,
    #[serde(default)]
    pub(crate) peripherals: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Diagnostics {
    #[serde(default)]
    pub(crate) log_level: Option<String>,
}

// --- the SoM preset (topology + on-module facts + inference) ---

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SomPreset {
    pub(crate) silicon: String,
    /// The SoC variant order-code (e.g. `AE722F80F55D5LS`) — selects the SoC
    /// `variants[]` entry whose MRAM/SRAM banks seed the derived memory map.
    #[serde(default)]
    pub(crate) silicon_variant: Option<String>,
    #[serde(default)]
    pub(crate) sku: Option<String>,
    /// SoM family (e.g. `alif-ensemble`) — matched against a board's
    /// `hosts_som_families` for the ALP-B011 carrier-support check.
    #[serde(default)]
    pub(crate) family: Option<String>,
    /// SoM-specific pad dispatch: which E1M pads reach the host SoC via an
    /// on-module mediator (e.g. the CC3501E) instead of directly. Composed with
    /// the board's `e1m_routes` (board-agnostic roles) at codegen time.
    #[serde(default)]
    pub(crate) pad_routes: Vec<PadRoute>,
    #[serde(default)]
    pub(crate) topology: BTreeMap<String, TopoCore>,
    #[serde(default)]
    pub(crate) on_module: BTreeMap<String, serde_yaml::Value>,
    #[serde(default)]
    pub(crate) helper_firmware: Vec<HelperFw>,
    #[serde(default)]
    pub(crate) inference: Inference,
    #[serde(default)]
    pub(crate) mailbox: Mailbox,
    /// Explicit per-SoM memory regions (non-stock partitioning); when absent the
    /// allocator falls back to the SoC's `memory_regions`.
    #[serde(default)]
    pub(crate) memory_map: Vec<MemRegion>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct Mailbox {
    #[serde(default)]
    pub(crate) controller: Option<String>,
    #[serde(default)]
    pub(crate) channels: Vec<MailboxChannel>,
}

/// One SoM-specific pad dispatch entry: the E1M pad reaches the SoC via
/// `dispatch` (an on-module mediator chip, or `direct`), optionally at the
/// mediator's `dispatch_pin`.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PadRoute {
    pub(crate) e1m: String,
    pub(crate) dispatch: String,
    /// The mediator pin — a NUMBER on the Alif CC3501E (`14`) or a NAME on the
    /// Renesas GD32 bridge (`PA11`). Kept as a raw value so the schema is
    /// vendor-neutral; stringified at render time.
    #[serde(default)]
    pub(crate) dispatch_pin: Option<serde_yaml::Value>,
    #[serde(default)]
    pub(crate) doc: Option<String>,
}

/// Stringify a `dispatch_pin` raw value (number → `"14"`, name → `"PA11"`).
pub(crate) fn pin_to_string(v: &serde_yaml::Value) -> Option<String> {
    v.as_u64()
        .map(|n| n.to_string())
        .or_else(|| v.as_str().map(String::from))
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct TopoCore {
    #[serde(default)]
    pub(crate) app: Option<String>,
    #[serde(default)]
    pub(crate) machine: Option<String>,
    #[serde(default)]
    pub(crate) board: Option<String>,
    #[serde(default)]
    pub(crate) toolchain: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct HelperFw {
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) chip: Option<String>,
    #[serde(default)]
    pub(crate) firmware_path: Option<String>,
    #[serde(default)]
    pub(crate) flash_method: Option<String>,
    /// Flash arguments — a bare string on Alif (`TBD`) or a structured map on the
    /// Renesas GD32 bridge (`{interface, target, base}`). Vendor-neutral raw value,
    /// passed through to the manifest verbatim.
    #[serde(default)]
    pub(crate) flash_args: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct Inference {
    #[serde(default)]
    pub(crate) npu_population: Vec<NpuEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct NpuEntry {
    #[serde(default)]
    pub(crate) variant: Option<String>,
}

// --- the resolved board definition + the SoC spec ---

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BoardDef {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) default_hw_rev: Option<String>,
    #[serde(default)]
    pub(crate) populated: BTreeMap<String, bool>,
    /// SoM families this carrier can host (e.g. `[alif-ensemble, nxp-imx9]`) —
    /// the ALP-B011 check rejects a SoM whose family is absent.
    #[serde(default)]
    pub(crate) hosts_som_families: Vec<String>,
    /// Board-agnostic E1M-pad routing, by section (`gpio`, `buses`, `pwm`, …).
    /// Each entry binds an E1M pad to a board-side macro; composed with the SoM's
    /// `pad_routes` to produce the per-pad dispatch, and checked for pad
    /// double-claims (ALP-B013).
    #[serde(default)]
    pub(crate) e1m_routes: BTreeMap<String, Vec<RouteEntry>>,
}

/// One board-side pad binding: an E1M pad → a board macro (with optional
/// Doxygen `doc`, `active_low`, and a portable `board_alias`).
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RouteEntry {
    pub(crate) e1m: String,
    #[serde(rename = "macro")]
    pub(crate) macro_name: String,
    #[serde(default)]
    pub(crate) doc: Option<String>,
    #[serde(default)]
    pub(crate) active_low: Option<bool>,
    #[serde(default)]
    pub(crate) board_alias: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SocSpec {
    /// The silicon ref this spec describes (e.g. `alif:ensemble:e7`) — the
    /// known-silicon membership token for the ALP-B012 allowlist check.
    #[serde(default, rename = "ref")]
    pub(crate) soc_ref: String,
    #[serde(default)]
    pub(crate) cores: Vec<SocCore>,
    /// The silicon's peripheral inventory: instance-kind → count (e.g.
    /// `i2c: 4`, `can_fd: 1`). Drives the ALP-B010 coverage check. Empty for a
    /// SoC whose datasheet ingestion is still pending.
    #[serde(default)]
    pub(crate) peripherals: BTreeMap<String, u32>,
    /// The on-die AI accelerators (Ethos-U on Alif, DRP-AI on Renesas, …). Its
    /// presence (not its vendor) gates the inference backend — the engine stays
    /// accelerator-agnostic; the backend symbol is policy data keyed by silicon.
    #[serde(default)]
    pub(crate) npus: Vec<SocNpu>,
    /// SoC-level memory regions with authoritative bases (e.g. RZ/V2N OCRAM at
    /// `0x00010000`) — the carve-out allocator's region table when the SoM
    /// declares no explicit `memory_map:`.
    #[serde(default)]
    pub(crate) memory_regions: Vec<MemRegion>,
    /// SoC order-code variants (mram_mb + per-bank SRAM). When the SoM declares
    /// no `memory_map:` and the SoC no `memory_regions`, the selected variant's
    /// MRAM + SRAM banks seed the derived memory map (the Alif/AEN path).
    #[serde(default)]
    pub(crate) variants: Vec<SocVariant>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SocVariant {
    #[serde(default)]
    pub(crate) order_code: String,
    #[serde(default)]
    pub(crate) mram_mb: Option<f64>,
    /// Per-bank SRAM sizes in KiB; bank names with a `_<CORE>_(ITCM|DTCM)` suffix
    /// become per-core non-cacheable regions, the rest shared + cacheable.
    #[serde(default)]
    pub(crate) sram_banks_kb: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SocNpu {
    #[serde(default, rename = "type")]
    pub(crate) kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SocCore {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) vector_extension: Option<String>,
}
