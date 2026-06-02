// SPDX-License-Identifier: Apache-2.0
//! `alp-core` — shared, IO-free board logic for the ALP toolchain.
//!
//! This crate is the Rust home of the board model, parsing, and
//! validation. It contains no terminal, filesystem-walking, or process
//! logic so it can be reused by the CLI today and (later) bridged to the
//! TypeScript extension/LSP via napi-rs or WASM.

pub mod model;
pub mod preview;
pub mod sdk_catalogue;
pub mod validate;
pub mod wizard;

pub use model::{BoardModel, normalize_board_model};
pub use preview::{
    EffectiveConfigPreviewPayload, ProjectContext, create_effective_config_preview_payload,
};
pub use sdk_catalogue::{
    AcceleratorAvail, BoardPreset, ChipChoice, ChipDef, ChipKconfig, I2cDevice, MemorySpec,
    PadRoute, SdkCatalogue, SocCore, SocSpec, SomPreset, TopologyCore,
    accelerator_availability, boards_for_som, chip_defaults, chip_family_for_sku, chips_for_som,
    core_ids_for_som, effective_chip_choices, effective_populated, parse_board_preset,
    parse_chip_def, parse_soc_spec, parse_som_preset,
};
pub use validate::{
    Outcome, ParseError, Severity, ValidationIssue, ValidationResult,
    parse_board_model, validate_board_yaml_local,
};
