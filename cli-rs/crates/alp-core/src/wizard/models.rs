// SPDX-License-Identifier: Apache-2.0
//! Domain types for the project wizard and module scaffold.

use std::fmt;

// ---------------------------------------------------------------------------
// Template IDs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WizardTemplateId {
    MinimalApp,
    SensorStarter,
    IotStarter,
    EdgeAiStarter,
    BoardDiagnostics,
    HostToolingStarter,
}

impl WizardTemplateId {
    pub fn as_str(self) -> &'static str {
        match self {
            WizardTemplateId::MinimalApp => "minimal-app",
            WizardTemplateId::SensorStarter => "sensor-starter",
            WizardTemplateId::IotStarter => "iot-starter",
            WizardTemplateId::EdgeAiStarter => "edge-ai-starter",
            WizardTemplateId::BoardDiagnostics => "board-diagnostics",
            WizardTemplateId::HostToolingStarter => "host-tooling-starter",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "minimal-app" => Some(WizardTemplateId::MinimalApp),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleTemplateId {
    SensorDriver,
    ConnectivityService,
    InferenceStage,
    DiagnosticsCheck,
}

impl ModuleTemplateId {
    pub fn as_str(self) -> &'static str {
        match self {
            ModuleTemplateId::SensorDriver => "sensor-driver",
            ModuleTemplateId::ConnectivityService => "connectivity-service",
            ModuleTemplateId::InferenceStage => "inference-stage",
            ModuleTemplateId::DiagnosticsCheck => "diagnostics-check",
        }
    }

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

#[derive(Debug, Clone, Copy)]
pub struct WizardFeatureFlags {
    pub wifi: bool,
    pub mqtt: bool,
    pub ble: bool,
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

pub struct WizardTemplateDefinition {
    pub id: WizardTemplateId,
    pub label: &'static str,
    pub description: &'static str,
    pub libs: &'static [&'static str],
    pub features: Option<WizardFeatureFlags>,
    pub prj_conf_extras: &'static [&'static str],
    pub feature_files: &'static [FeatureFileSpec],
    pub body_line1: &'static str,
    pub body_line2: &'static str,
    pub explanation: &'static [&'static str],
}

pub struct ModuleTemplateDefinition {
    pub id: ModuleTemplateId,
    pub label: &'static str,
    pub description: &'static str,
    pub function_prefix: &'static str,
    /// Lines may contain `{nm}` which is substituted with the normalized module name.
    pub explanation: &'static [&'static str],
}

// ---------------------------------------------------------------------------
// Plan I/O types
// ---------------------------------------------------------------------------

pub struct WizardPlanInput {
    pub template_id: WizardTemplateId,
    pub project_name: String,
    pub destination: String,
}

pub struct WizardPlannedFile {
    pub relative_path: String,
    pub content: String,
}

pub struct WizardPlan {
    pub template_id: WizardTemplateId,
    pub files: Vec<WizardPlannedFile>,
}

// ---------------------------------------------------------------------------
// File-change tracking
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WizardFileChangeKind {
    New,
    Update,
    Unchanged,
}

impl WizardFileChangeKind {
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

pub struct WizardFileChange {
    pub relative_path: String,
    pub kind: WizardFileChangeKind,
}

pub struct WizardWriteResult {
    pub written: Vec<String>,
    pub unchanged: Vec<String>,
}

// ---------------------------------------------------------------------------
// Module scaffold types
// ---------------------------------------------------------------------------

pub struct ModuleScaffoldInput {
    pub template_id: ModuleTemplateId,
    pub module_name: String,
    pub destination: String,
}

pub struct ModuleScaffoldPlan {
    pub template_id: ModuleTemplateId,
    pub normalized_name: String,
    pub files: Vec<WizardPlannedFile>,
}
