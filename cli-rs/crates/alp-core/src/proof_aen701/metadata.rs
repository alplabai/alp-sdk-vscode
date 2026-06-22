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
    #[serde(default)]
    pub(crate) storage: Vec<serde_yaml::Value>,
    /// The E1M pads this app actively uses (a subset of the board's `e1m_routes`)
    /// — the input to end-to-end pin-mux validation.
    #[serde(default)]
    pub(crate) pins: Vec<RouteEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct IpcChannel {
    pub(crate) kind: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) endpoints: Vec<String>,
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
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct Mailbox {
    #[serde(default)]
    pub(crate) controller: Option<String>,
}

/// One SoM-specific pad dispatch entry: the E1M pad reaches the SoC via
/// `dispatch` (an on-module mediator chip, or `direct`), optionally at the
/// mediator's `dispatch_pin`.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PadRoute {
    pub(crate) e1m: String,
    pub(crate) dispatch: String,
    #[serde(default)]
    pub(crate) dispatch_pin: Option<u32>,
    #[serde(default)]
    pub(crate) doc: Option<String>,
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
    #[serde(default)]
    pub(crate) flash_args: Option<String>,
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
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SocCore {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) vector_extension: Option<String>,
}
