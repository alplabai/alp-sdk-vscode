// SPDX-License-Identifier: Apache-2.0
//! Domain types for the project wizard and module scaffold.

use std::fmt;

// ---------------------------------------------------------------------------
// Template IDs
// ---------------------------------------------------------------------------

/// Identifier of a project-wizard template, mapped 1:1 to its stable kebab-case slug.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WizardTemplateId {
    MinimalApp,
    ZephyrApp,
    SensorStarter,
    IotStarter,
    EdgeAiStarter,
    BoardDiagnostics,
    HostToolingStarter,
}

impl WizardTemplateId {
    /// Returns the stable kebab-case slug for this template id.
    pub fn as_str(self) -> &'static str {
        match self {
            WizardTemplateId::MinimalApp => "minimal-app",
            WizardTemplateId::ZephyrApp => "zephyr-app",
            WizardTemplateId::SensorStarter => "sensor-starter",
            WizardTemplateId::IotStarter => "iot-starter",
            WizardTemplateId::EdgeAiStarter => "edge-ai-starter",
            WizardTemplateId::BoardDiagnostics => "board-diagnostics",
            WizardTemplateId::HostToolingStarter => "host-tooling-starter",
        }
    }

    /// Parses a template slug back into a `WizardTemplateId`; `None` if unrecognized.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "minimal-app" => Some(WizardTemplateId::MinimalApp),
            "zephyr-app" => Some(WizardTemplateId::ZephyrApp),
            "sensor-starter" => Some(WizardTemplateId::SensorStarter),
            "iot-starter" => Some(WizardTemplateId::IotStarter),
            "edge-ai-starter" => Some(WizardTemplateId::EdgeAiStarter),
            "board-diagnostics" => Some(WizardTemplateId::BoardDiagnostics),
            "host-tooling-starter" => Some(WizardTemplateId::HostToolingStarter),
            _ => None,
        }
    }
}

impl fmt::Display for WizardTemplateId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Identifier of a module-scaffold template, mapped 1:1 to its stable kebab-case slug.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleTemplateId {
    SensorDriver,
    ConnectivityService,
    InferenceStage,
    DiagnosticsCheck,
}

impl ModuleTemplateId {
    /// Returns the stable kebab-case slug for this module template id.
    pub fn as_str(self) -> &'static str {
        match self {
            ModuleTemplateId::SensorDriver => "sensor-driver",
            ModuleTemplateId::ConnectivityService => "connectivity-service",
            ModuleTemplateId::InferenceStage => "inference-stage",
            ModuleTemplateId::DiagnosticsCheck => "diagnostics-check",
        }
    }

    /// Parses a module-template slug back into a `ModuleTemplateId`; `None` if unrecognized.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "sensor-driver" => Some(ModuleTemplateId::SensorDriver),
            "connectivity-service" => Some(ModuleTemplateId::ConnectivityService),
            "inference-stage" => Some(ModuleTemplateId::InferenceStage),
            "diagnostics-check" => Some(ModuleTemplateId::DiagnosticsCheck),
            _ => None,
        }
    }
}

impl fmt::Display for ModuleTemplateId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ---------------------------------------------------------------------------
// Template definition building blocks
// ---------------------------------------------------------------------------

/// Connectivity/security feature toggles a template requests in its generated config.
#[derive(Debug, Clone, Copy)]
pub struct WizardFeatureFlags {
    /// Enable Wi-Fi support.
    pub wifi: bool,
    /// Enable MQTT support.
    pub mqtt: bool,
    /// Enable Bluetooth Low Energy support.
    pub ble: bool,
    /// Enable TLS support.
    pub tls: bool,
}

/// A single feature C file that a project template generates.
pub struct FeatureFileSpec {
    /// Path relative to project root, e.g. "src/features/sensor_pipeline.c".
    pub path: &'static str,
    /// C identifier stem used in the generated function name, e.g. "sensor_pipeline".
    pub unit_name: &'static str,
    /// TODO comment inserted into the function body.
    pub todo_line: &'static str,
}

/// Static, fully-baked definition of a project-wizard template (catalog entry).
pub struct WizardTemplateDefinition {
    /// Template identifier this definition describes.
    pub id: WizardTemplateId,
    /// Human-readable display name.
    pub label: &'static str,
    /// One-line summary of what the template scaffolds.
    pub description: &'static str,
    /// SDK libraries the template depends on.
    pub libs: &'static [&'static str],
    /// Feature flags to emit, or `None` when the template needs none.
    pub features: Option<WizardFeatureFlags>,
    /// Extra `prj.conf` lines appended verbatim.
    pub prj_conf_extras: &'static [&'static str],
    /// Feature C files generated alongside `main`.
    pub feature_files: &'static [FeatureFileSpec],
    /// First line emitted in the generated `main` body.
    pub body_line1: &'static str,
    /// Second line emitted in the generated `main` body.
    pub body_line2: &'static str,
    /// Explanation lines surfaced to the user after scaffolding.
    pub explanation: &'static [&'static str],
}

/// Static, fully-baked definition of a module-scaffold template (catalog entry).
pub struct ModuleTemplateDefinition {
    /// Module template identifier this definition describes.
    pub id: ModuleTemplateId,
    /// Human-readable display name.
    pub label: &'static str,
    /// One-line summary of what the module scaffolds.
    pub description: &'static str,
    /// Prefix applied to generated function names.
    pub function_prefix: &'static str,
    /// Lines may contain `{nm}` which is substituted with the normalized module name.
    pub explanation: &'static [&'static str],
}

// ---------------------------------------------------------------------------
// Plan I/O types
// ---------------------------------------------------------------------------

/// Inputs needed to plan a project scaffold from a wizard template.
pub struct WizardPlanInput {
    /// Template to scaffold from.
    pub template_id: WizardTemplateId,
    /// Project name used in generated identifiers and paths.
    pub project_name: String,
    /// Target directory the plan is rooted at.
    pub destination: String,
    /// Optional SoM SKU to write into board.yaml; defaults when None.
    pub som_sku: Option<String>,
}

/// A single file a plan will emit: its path relative to the destination and its full content.
pub struct WizardPlannedFile {
    /// Path relative to the plan destination root.
    pub relative_path: String,
    /// Full file content to write.
    pub content: String,
}

/// The full set of files a wizard template expands into, before any disk I/O.
pub struct WizardPlan {
    /// Template the plan was produced from.
    pub template_id: WizardTemplateId,
    /// Files to write, in emit order.
    pub files: Vec<WizardPlannedFile>,
}

// ---------------------------------------------------------------------------
// File-change tracking
// ---------------------------------------------------------------------------

/// Outcome of comparing a planned file against what is already on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WizardFileChangeKind {
    /// File does not yet exist and will be created.
    New,
    /// File exists with different content and will be overwritten.
    Update,
    /// File exists with identical content; no write needed.
    Unchanged,
}

impl WizardFileChangeKind {
    /// Returns the stable lowercase label for this change kind.
    pub fn as_str(self) -> &'static str {
        match self {
            WizardFileChangeKind::New => "new",
            WizardFileChangeKind::Update => "update",
            WizardFileChangeKind::Unchanged => "unchanged",
        }
    }
}

impl fmt::Display for WizardFileChangeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A planned file paired with how it differs from the current on-disk state.
pub struct WizardFileChange {
    /// Path relative to the plan destination root.
    pub relative_path: String,
    /// Classification of the change against disk.
    pub kind: WizardFileChangeKind,
}

/// Summary of a plan applied to disk: which files were written vs. left untouched.
pub struct WizardWriteResult {
    /// Relative paths that were created or overwritten.
    pub written: Vec<String>,
    /// Relative paths skipped because their content already matched.
    pub unchanged: Vec<String>,
}

// ---------------------------------------------------------------------------
// Module scaffold types
// ---------------------------------------------------------------------------

/// Inputs needed to plan a module scaffold from a module template.
pub struct ModuleScaffoldInput {
    /// Module template to scaffold from.
    pub template_id: ModuleTemplateId,
    /// Raw module name as provided by the caller (normalized during planning).
    pub module_name: String,
    /// Target directory the plan is rooted at.
    pub destination: String,
}

/// The set of files a module template expands into, with the normalized name resolved.
pub struct ModuleScaffoldPlan {
    /// Template the plan was produced from.
    pub template_id: ModuleTemplateId,
    /// Module name after normalization, substituted into generated content.
    pub normalized_name: String,
    /// Files to write, in emit order.
    pub files: Vec<WizardPlannedFile>,
}
