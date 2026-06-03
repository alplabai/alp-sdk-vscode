// SPDX-License-Identifier: Apache-2.0
//! `alp init` — initialize a new ALP project from a template.

use std::path::PathBuf;

use alp_core::wizard::{
    WizardFileChangeKind, WizardPlanInput, WizardTemplateId, collect_wizard_file_changes,
    create_scaffold_tree_preview, create_wizard_plan, list_wizard_templates, write_wizard_files,
};
use inquire::{InquireError, Select, Text};

use super::CommandRun;
use crate::cli::{GlobalArgs, InitArgs};
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
struct InitData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "templateId")]
    template_id: String,
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

pub fn run(g: &GlobalArgs, args: &InitArgs) -> CommandRun {
    let is_interactive = !g.non_interactive && !g.ci;

    // 1. Resolve template.
    let template_id = match resolve_template(args.template.as_deref(), is_interactive) {
        Ok(id) => id,
        Err(Cancelled) => {
            eprintln!("Cancelled.");
            return runtime_failure_run();
        }
        Err(BadArg(msg)) => return error_run(g, "init.invalid-template", &msg),
    };

    // 2. Resolve name (optional).
    let name = match resolve_name(args.name.as_deref(), is_interactive) {
        Ok(n) => n,
        Err(_) => {
            eprintln!("Cancelled.");
            return runtime_failure_run();
        }
    };

    // 3. Resolve destination.
    let destination = match resolve_destination(
        args.destination.as_deref(),
        g.project.as_deref(),
        is_interactive,
    ) {
        Ok(d) => d,
        Err(_) => {
            eprintln!("Cancelled.");
            return runtime_failure_run();
        }
    };

    // 4. Compute project root.
    let dest_path = PathBuf::from(&destination);
    let project_root = if name.is_empty() {
        dest_path.clone()
    } else {
        dest_path.join(&name)
    };

    // 5. Build plan.
    let plan = create_wizard_plan(&WizardPlanInput {
        template_id,
        project_name: name.clone(),
        destination: destination.clone(),
        som_sku: args.som.clone(),
    });

    // 6. Collect file changes.
    let changes = collect_wizard_file_changes(&project_root, &plan.files);
    let file_changes_ser: Vec<FileChangeSer> = changes
        .iter()
        .map(|c| FileChangeSer {
            relative_path: c.relative_path.clone(),
            kind: c.kind.as_str().to_string(),
        })
        .collect();

    let has_updates = changes
        .iter()
        .any(|c| c.kind == WizardFileChangeKind::Update);

    // 7. Guard against unforced overwrites.
    if has_updates && !args.force {
        let project = make_project(&destination);
        let data = empty_data(template_id, &destination, args.preview, file_changes_ser);
        let issues = vec![Issue {
            code: "init.would-overwrite".to_string(),
            severity: "error".to_string(),
            message: "One or more files would be overwritten. Use --force to allow updates."
                .to_string(),
        }];
        let text = if g.is_json() {
            vec![]
        } else {
            vec!["init: would overwrite existing files; use --force to proceed.".to_string()]
        };
        let json = g.is_json().then(|| {
            Envelope::new("init", project, data, issues, ExitCode::WriteFailure.code()).to_json()
        });
        return CommandRun {
            exit: ExitCode::WriteFailure,
            text,
            json,
        };
    }

    // 8. Preview mode — show plan, no writes.
    if args.preview {
        let tree = create_scaffold_tree_preview(&plan.files);
        let project = make_project(&destination);
        let data = empty_data(template_id, &destination, true, file_changes_ser);
        let text = if g.is_json() {
            vec![]
        } else {
            vec![
                format!("init: preview for template '{}'", template_id.as_str()),
                tree,
            ]
        };
        let json = g.is_json().then(|| {
            Envelope::new("init", project, data, vec![], ExitCode::Success.code()).to_json()
        });
        return CommandRun {
            exit: ExitCode::Success,
            text,
            json,
        };
    }

    // 9. Write files.
    match write_wizard_files(&project_root, &plan.files) {
        Ok(result) => {
            let project = make_project(&destination);
            let data = InitData {
                schema_version: "1".to_string(),
                template_id: template_id.as_str().to_string(),
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
                        "init: created '{}' from template '{}'",
                        project_root.display(),
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
                Envelope::new("init", project, data, vec![], ExitCode::Success.code()).to_json()
            });
            CommandRun {
                exit: ExitCode::Success,
                text,
                json,
            }
        }
        Err(e) => error_run(
            g,
            "init.write-failed",
            &format!("Failed to write files: {e}"),
        ),
    }
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

enum ResolveErr {
    Cancelled,
    BadArg(String),
}
use ResolveErr::*;

fn resolve_template(arg: Option<&str>, interactive: bool) -> Result<WizardTemplateId, ResolveErr> {
    if let Some(s) = arg {
        return WizardTemplateId::from_str(s)
            .ok_or_else(|| BadArg(format!("Unknown template '{s}'.")));
    }
    if interactive {
        let templates = list_wizard_templates();
        let options: Vec<String> = templates
            .iter()
            .map(|d| format!("{} — {}", d.id.as_str(), d.description))
            .collect();
        return match Select::new("Select a project template:", options.clone()).prompt() {
            Ok(choice) => {
                let idx = options.iter().position(|o| *o == choice).unwrap_or(0);
                Ok(templates[idx].id)
            }
            Err(InquireError::OperationCanceled) | Err(InquireError::OperationInterrupted) => {
                Err(Cancelled)
            }
            Err(_) => Err(Cancelled),
        };
    }
    Ok(WizardTemplateId::MinimalApp)
}

fn resolve_name(arg: Option<&str>, interactive: bool) -> Result<String, ResolveErr> {
    if let Some(s) = arg {
        return Ok(s.to_string());
    }
    if interactive {
        return match Text::new("Project name (optional, leave blank to init in destination):")
            .with_default("")
            .prompt()
        {
            Ok(s) => Ok(s.trim().to_string()),
            Err(InquireError::OperationCanceled) | Err(InquireError::OperationInterrupted) => {
                Err(Cancelled)
            }
            Err(_) => Err(Cancelled),
        };
    }
    Ok(String::new())
}

fn resolve_destination(
    arg: Option<&str>,
    project: Option<&str>,
    interactive: bool,
) -> Result<String, ResolveErr> {
    if let Some(s) = arg {
        return Ok(s.to_string());
    }
    if let Some(p) = project {
        return Ok(p.to_string());
    }
    if interactive {
        return match Text::new("Destination directory:")
            .with_default(".")
            .prompt()
        {
            Ok(s) => Ok(if s.trim().is_empty() {
                ".".to_string()
            } else {
                s
            }),
            Err(InquireError::OperationCanceled) | Err(InquireError::OperationInterrupted) => {
                Err(Cancelled)
            }
            Err(_) => Err(Cancelled),
        };
    }
    Ok(".".to_string())
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

fn make_project(destination: &str) -> Project {
    Project {
        root: Some(destination.to_string()),
        board_yaml: None,
    }
}

fn empty_data(
    template_id: WizardTemplateId,
    destination: &str,
    preview: bool,
    file_changes: Vec<FileChangeSer>,
) -> InitData {
    InitData {
        schema_version: "1".to_string(),
        template_id: template_id.as_str().to_string(),
        destination: destination.to_string(),
        preview,
        file_changes,
        written: vec![],
        unchanged: vec![],
    }
}

fn runtime_failure_run() -> CommandRun {
    CommandRun {
        exit: ExitCode::RuntimeFailure,
        text: vec![],
        json: None,
    }
}

fn error_run(g: &GlobalArgs, code: &str, message: &str) -> CommandRun {
    let project = Project {
        root: None,
        board_yaml: None,
    };
    let issues = vec![Issue {
        code: code.to_string(),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    let data = InitData {
        schema_version: "1".to_string(),
        template_id: String::new(),
        destination: String::new(),
        preview: false,
        file_changes: vec![],
        written: vec![],
        unchanged: vec![],
    };
    let text = if g.is_json() {
        vec![]
    } else {
        vec![format!("init: {message}")]
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "init",
            project,
            data,
            issues,
            ExitCode::RuntimeFailure.code(),
        )
        .to_json()
    });
    CommandRun {
        exit: ExitCode::RuntimeFailure,
        text,
        json,
    }
}
