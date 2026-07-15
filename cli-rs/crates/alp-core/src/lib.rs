// SPDX-License-Identifier: Apache-2.0
#![doc = include_str!("../README.md")]

/// Default SoM SKU written into a scaffolded `board.yaml` when none is supplied
/// (`alp init` without `--som`). Single source of truth for the literal, shared
/// by the wizard (`wizard::service`) and the CLI's app-core guard.
pub const DEFAULT_SOM_SKU: &str = "E1M-AEN701";

pub mod build_plan;
pub mod build_readiness;
pub mod clock;
pub mod debug;
pub mod debug_launch;
pub mod diff;
pub mod loader;
pub mod model;
pub mod pinmux;
pub mod preflight;
pub mod presets;
pub mod preview;
pub mod project;
pub mod sdk;
pub mod sdk_catalogue;
pub mod system_manifest;
pub mod validate;
pub mod wizard;

pub use build_plan::{
    BUILD_PLAN_SCHEMA_VERSION, Backend, BuildPlan, BuildPlanError, BuildSlice, GeneratedFile,
    PlanWarning, ToolStep, parse_build_plan, summarize_plan,
};
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
pub use pinmux::{PinmuxPad, PinmuxTable, parse_pinmux_table, pinmux_family_for_sku};
pub use preflight::{
    PreflightInput, build_preflight_checks, preflight_blocked, preflight_next_steps,
    preflight_summary,
};
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
