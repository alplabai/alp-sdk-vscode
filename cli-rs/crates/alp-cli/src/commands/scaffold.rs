// SPDX-License-Identifier: Apache-2.0
//! `alp scaffold` — scaffold a module into an existing ALP project.

use alp_core::wizard::{
    ModuleScaffoldInput, ModuleTemplateId, WizardFileChangeKind, collect_wizard_file_changes,
    create_scaffold_tree_preview, create_module_scaffold_plan, list_module_templates,
    write_wizard_files,
};
use inquire::{InquireError, Select, Text};
use std::path::PathBuf;

use super::CommandRun;
use crate::cli::{GlobalArgs, ScaffoldArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;

// ---------------------------------------------------------------------------
// JSON envelope data
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct FileChangeSer {
    #[serde(rename = "relativePath")]
    relative_path: String,
    kind: String,
}

#[derive(serde::Serialize)]
struct ScaffoldData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "templateId")]
    template_id: String,
    #[serde(rename = "moduleName")]
    module_name: String,
    #[serde(rename = "normalizedModuleName")]
    normalized_module_name: String,
    destination: String,
    preview: bool,
    #[serde(rename = "fileChanges")]
    file_changes: Vec<FileChangeSer>,
    written: Vec<String>,
    unchanged: Vec<String>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn run(g: &GlobalArgs, args: &ScaffoldArgs) -> CommandRun {
    let is_interactive = !g.non_interactive && !g.ci;

    // 1. Resolve module name (required).
    let module_name = match resolve_module_name(args.name.as_deref(), is_interactive) {
        Ok(n) => n,
        Err(NeedName) => {
            return error_run(
                g,
                "scaffold.name-required",
                "Module name is required. Use --name <name> or run interactively.",
            );
        }
        Err(Cancelled) | Err(BadArg(_)) => {
            eprintln!("Cancelled.");
            return runtime_failure_run();
        }
    };

    // 2. Resolve template.
    let template_id = match resolve_template(args.template.as_deref(), is_interactive) {
        Ok(id) => id,
        Err(Cancelled) => {
            eprintln!("Cancelled.");
            return runtime_failure_run();
        }
        Err(BadArg(msg)) => return error_run(g, "scaffold.invalid-template", &msg),
        Err(NeedName) => unreachable!(),
    };

    // 3. Resolve destination.
    let destination = args
        .destination
        .as_deref()
        .or(g.project.as_deref())
        .unwrap_or(".")
        .to_string();

    let project_root = PathBuf::from(&destination);

    // 4. Build plan.
    let plan = match create_module_scaffold_plan(&ModuleScaffoldInput {
        template_id,
        module_name: module_name.clone(),
        destination: destination.clone(),
    }) {
        Ok(p) => p,
        Err(e) => return error_run(g, "scaffold.invalid-name", &e),
    };

    // 5. Collect file changes.
    let changes = collect_wizard_file_changes(&project_root, &plan.files);
    let file_changes_ser: Vec<FileChangeSer> = changes
        .iter()
        .map(|c| FileChangeSer {
            relative_path: c.relative_path.clone(),
            kind: c.kind.as_str().to_string(),
        })
        .collect();

    let has_updates = changes.iter().any(|c| c.kind == WizardFileChangeKind::Update);

    // 6. Guard against unforced overwrites.
    if has_updates && !args.force {
        let project = make_project(&destination);
        let data = empty_data(
            template_id,
            &module_name,
            &plan.normalized_name,
            &destination,
            args.preview,
            file_changes_ser,
        );
        let issues = vec![Issue {
            code: "scaffold.would-overwrite".to_string(),
            severity: "error".to_string(),
            message: "One or more files would be overwritten. Use --force to allow updates."
                .to_string(),
        }];
        let text = if g.is_json() {
            vec![]
        } else {
            vec!["scaffold: would overwrite existing files; use --force to proceed.".to_string()]
        };
        let json = g.is_json().then(|| {
            Envelope::new("scaffold", project, data, issues, ExitCode::WriteFailure.code())
                .to_json()
        });
        return CommandRun { exit: ExitCode::WriteFailure, text, json };
    }

    // 7. Preview mode.
    if args.preview {
        let tree = create_scaffold_tree_preview(&plan.files);
        let project = make_project(&destination);
        let data = empty_data(
            template_id,
            &module_name,
            &plan.normalized_name,
            &destination,
            true,
            file_changes_ser,
        );
        let text = if g.is_json() {
            vec![]
        } else {
            vec![
                format!(
                    "scaffold: preview for module '{}' (template '{}')",
                    plan.normalized_name,
                    template_id.as_str()
                ),
                tree,
            ]
        };
        let json = g.is_json().then(|| {
            Envelope::new("scaffold", project, data, vec![], ExitCode::Success.code()).to_json()
        });
        return CommandRun { exit: ExitCode::Success, text, json };
    }

    // 8. Write files.
    match write_wizard_files(&project_root, &plan.files) {
        Ok(result) => {
            let project = make_project(&destination);
            let data = ScaffoldData {
                schema_version: "1".to_string(),
                template_id: template_id.as_str().to_string(),
                module_name: module_name.clone(),
                normalized_module_name: plan.normalized_name.clone(),
                destination: destination.clone(),
                preview: false,
                file_changes: file_changes_ser,
                written: result.written.clone(),
                unchanged: result.unchanged.clone(),
            };
            let text = if g.is_json() {
                vec![]
            } else {
                vec![
                    format!(
                        "scaffold: created module '{}' (template '{}')",
                        plan.normalized_name,
                        template_id.as_str()
                    ),
                    format!(
                        "  written: {}, unchanged: {}",
                        result.written.len(),
                        result.unchanged.len()
                    ),
                ]
            };
            let json = g.is_json().then(|| {
                Envelope::new("scaffold", project, data, vec![], ExitCode::Success.code()).to_json()
            });
            CommandRun { exit: ExitCode::Success, text, json }
        }
        Err(e) => error_run(g, "scaffold.write-failed", &format!("Failed to write files: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

enum ResolveErr {
    Cancelled,
    NeedName,
    BadArg(String),
}
use ResolveErr::*;

fn resolve_module_name(arg: Option<&str>, interactive: bool) -> Result<String, ResolveErr> {
    if let Some(s) = arg {
        return Ok(s.to_string());
    }
    if interactive {
        return match Text::new("Module name:").prompt() {
            Ok(s) if s.trim().is_empty() => Err(NeedName),
            Ok(s) => Ok(s.trim().to_string()),
            Err(InquireError::OperationCanceled)
            | Err(InquireError::OperationInterrupted) => Err(Cancelled),
            Err(_) => Err(Cancelled),
        };
    }
    Err(NeedName)
}

fn resolve_template(
    arg: Option<&str>,
    interactive: bool,
) -> Result<ModuleTemplateId, ResolveErr> {
    if let Some(s) = arg {
        return ModuleTemplateId::from_str(s)
            .ok_or_else(|| BadArg(format!("Unknown module template '{s}'.")));
    }
    if interactive {
        let templates = list_module_templates();
        let options: Vec<String> = templates
            .iter()
            .map(|d| format!("{} — {}", d.id.as_str(), d.label))
            .collect();
        return match Select::new("Select a module template:", options.clone()).prompt() {
            Ok(choice) => {
                let idx = options.iter().position(|o| *o == choice).unwrap_or(0);
                Ok(templates[idx].id)
            }
            Err(InquireError::OperationCanceled)
            | Err(InquireError::OperationInterrupted) => Err(Cancelled),
            Err(_) => Err(Cancelled),
        };
    }
    Ok(ModuleTemplateId::SensorDriver)
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

fn make_project(destination: &str) -> Project {
    Project { root: Some(destination.to_string()), board_yaml: None }
}

fn empty_data(
    template_id: ModuleTemplateId,
    module_name: &str,
    normalized: &str,
    destination: &str,
    preview: bool,
    file_changes: Vec<FileChangeSer>,
) -> ScaffoldData {
    ScaffoldData {
        schema_version: "1".to_string(),
        template_id: template_id.as_str().to_string(),
        module_name: module_name.to_string(),
        normalized_module_name: normalized.to_string(),
        destination: destination.to_string(),
        preview,
        file_changes,
        written: vec![],
        unchanged: vec![],
    }
}

fn runtime_failure_run() -> CommandRun {
    CommandRun { exit: ExitCode::RuntimeFailure, text: vec![], json: None }
}

fn error_run(g: &GlobalArgs, code: &str, message: &str) -> CommandRun {
    let project = Project { root: None, board_yaml: None };
    let issues = vec![Issue {
        code: code.to_string(),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    let data = ScaffoldData {
        schema_version: "1".to_string(),
        template_id: String::new(),
        module_name: String::new(),
        normalized_module_name: String::new(),
        destination: String::new(),
        preview: false,
        file_changes: vec![],
        written: vec![],
        unchanged: vec![],
    };
    let text = if g.is_json() { vec![] } else { vec![format!("scaffold: {message}")] };
    let json = g.is_json().then(|| {
        Envelope::new("scaffold", project, data, issues, ExitCode::RuntimeFailure.code()).to_json()
    });
    CommandRun { exit: ExitCode::RuntimeFailure, text, json }
}
