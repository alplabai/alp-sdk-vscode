// SPDX-License-Identifier: Apache-2.0
//! `alp-core` — shared, IO-free board logic for the ALP toolchain.
//!
//! This crate is the Rust home of the board model, parsing, and
//! validation. It contains no terminal, filesystem-walking, or process
//! logic so it can be reused by the CLI today and (later) bridged to the
//! TypeScript extension/LSP via napi-rs or WASM.

pub mod build_readiness;
pub mod clock;
pub mod debug;
pub mod debug_launch;
pub mod diff;
pub mod loader;
pub mod model;
pub mod presets;
pub mod preview;
pub mod project;
pub mod sdk;
pub mod sdk_catalogue;
pub mod validate;
pub mod wizard;

pub use build_readiness::{
    BuildOs, BuildReadinessReport, BuildToolProbe, board_os_set, build_readiness_report,
};
pub use clock::format_iso8601_utc;
pub use debug::{
    DebugGenerationTraceDecision, DebugResolvedValue, DebugRuntimeCapabilities, DebugServerKind,
    DebugTargetKind, DebugTraceOutcome, DebugValueSource, DebugWorkspaceContext,
    DebuggerExtensionsState, DoctorCheck, DoctorReport, DoctorStatus, DoctorSummary,
    build_doctor_report, collect_resolved_values, collect_runtime_capabilities_from_commands,
    create_debug_workspace_context, is_server_supported_for_target, parse_server_kind,
    parse_target_kind, server_choices_for_target,
};
pub use debug_launch::{
    LaunchJsonWritePlan, create_launch_draft, create_launch_json_write_plan,
    launch_preview_document, launch_preview_notes,
};
pub use diff::{DiffEntry, DiffKind, collect_diff_entries, prune_nulls};
pub use loader::{
    ALL_EMIT_MODES, GenerationTargetSupport, LoaderPlan, create_loader_plan,
    generation_target_support, list_generation_target_support,
};
pub use model::{BoardModel, normalize_board_model};
pub use presets::{PresetCatalogueDefaults, empty_preset_catalogue};
pub use preview::{EffectiveConfigPreviewPayload, create_effective_config_preview_payload};
pub use project::{
    ProjectContext, ProjectResolutionInput, ProjectSettings, resolve_project_context,
};
pub use sdk::{
    GITHUB_RELEASES_URL, SdkReadinessReport, SdkReadinessState, SdkRelease, check_sdk_readiness,
    parse_remote_sdk_releases, resolve_active_sdk,
};
pub use sdk_catalogue::{
    AcceleratorAvail, BoardPreset, ChipChoice, ChipDef, ChipKconfig, I2cDevice, MemorySpec,
    PadRoute, SdkCatalogue, SocCore, SocSpec, SomPreset, TopologyCore, accelerator_availability,
    boards_for_som, chip_defaults, chip_family_for_sku, chips_for_som, core_ids_for_som,
    effective_chip_choices, effective_populated, parse_board_preset, parse_chip_def,
    parse_soc_spec, parse_som_preset,
};
pub use validate::{
    Outcome, ParseError, Severity, ValidationIssue, ValidationResult, ValidatorExecution,
    analyze_validation_result, classify_validation_outcome, parse_board_model,
    validate_board_yaml_local,
};
