// SPDX-License-Identifier: Apache-2.0
//! `alp init` — initialize a new ALP project from a template.

use std::path::PathBuf;

use alp_core::wizard::{
    WizardFileChangeKind, WizardPlanInput, WizardTemplateId, app_core_for_sku,
    collect_wizard_file_changes, create_scaffold_tree_preview, create_wizard_plan_with_cores,
    infer_runtime_for_core_id, list_wizard_templates, write_wizard_files,
};
use inquire::{InquireError, Select, Text};

use super::CommandRun;
use crate::cli::{GlobalArgs, InitArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;

// ---------------------------------------------------------------------------
// JSON envelope data
// ---------------------------------------------------------------------------

/// One planned file change in the JSON envelope: its workspace-relative path and
/// change kind (`create`/`update`/`unchanged`, from `WizardFileChangeKind`).
#[derive(serde::Serialize)]
struct FileChangeSer {
    #[serde(rename = "relativePath")]
    relative_path: String,
    kind: String,
}

/// `data` payload for the `init` envelope: the resolved template/destination,
/// whether this was a preview, the planned `file_changes`, and post-write
/// `written`/`unchanged` lists.
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

/// Execute `alp init`: resolve template/name/destination (prompting when
/// interactive), build the scaffold plan (heterogeneous when `--cores` is given),
/// then preview or write files — guarding overwrites behind `--force`.
pub fn run(g: &GlobalArgs, args: &InitArgs) -> CommandRun {
    let is_interactive = !g.non_interactive && !g.ci;

    // 1. Resolve template.
    let template_id = match resolve_template(args.template.as_deref(), is_interactive) {
        Ok(id) => id,
        Err(Cancelled) => {
            eprintln!("Cancelled.");
            return runtime_failure_run();
        }
        Err(BadArg(msg)) => {
            return error_run(g, ExitCode::ValidationFailure, "init.invalid-template", &msg);
        }
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

    // 5. Build plan (heterogeneous when --cores is given; else single-core).
    let cores = match parse_cores(args.cores.as_deref()) {
        Ok(cores) => cores,
        Err(msg) => return error_run(g, ExitCode::ValidationFailure, "init.invalid-cores", &msg),
    };
    // The app core's runtime is fixed (the scaffolded src/ + prj.conf are
    // Zephyr); reject a contradictory --cores request instead of silently
    // overriding it.
    let app_core = app_core_for_sku(args.som.as_deref().unwrap_or(alp_core::DEFAULT_SOM_SKU));
    if let Some((_, os)) = cores
        .iter()
        .find(|(id, os)| id.as_str() == app_core && os.as_str() != "zephyr")
    {
        return error_run(
            g,
            ExitCode::ValidationFailure,
            "init.invalid-cores",
            &format!(
                "Core '{app_core}' is this SoM's app core and runs zephyr; --cores requested '{os}'. Omit the entry or use {app_core}:zephyr."
            ),
        );
    }
    let mut plan = create_wizard_plan_with_cores(
        &WizardPlanInput {
            template_id,
            project_name: name.clone(),
            destination: destination.clone(),
            som_sku: args.som.clone(),
        },
        &cores,
    );

    // 5b. Honor --board-yaml: emit the caller's board.yaml verbatim instead of the
    // generated stub. This lets Alp Studio adopt `alp init` as its project render --
    // it passes a fully-resolved board.yaml and expects it copied through untouched
    // (alp-sdk-vscode#64). Templates that emit no board.yaml (host-tooling-starter)
    // have nothing to override, so pairing them with --board-yaml is a hard error
    // rather than a silent no-op that would drop the caller's file.
    if let Some(path) = g.board_yaml.as_deref() {
        match std::fs::read_to_string(path) {
            Ok(content) => {
                let mut applied = false;
                for file in plan.files.iter_mut() {
                    if file.relative_path == "board.yaml" {
                        file.content = content.clone();
                        applied = true;
                    }
                }
                if !applied {
                    return error_run(
                        g,
                        ExitCode::ValidationFailure,
                        "init.board-yaml-unsupported",
                        &format!(
                            "--board-yaml was given but template '{}' emits no board.yaml to override.",
                            template_id.as_str()
                        ),
                    );
                }
            }
            Err(err) => {
                return error_run(
                    g,
                    ExitCode::ValidationFailure,
                    "init.board-yaml-unreadable",
                    &format!("--board-yaml '{path}' could not be read: {err}"),
                );
            }
        }
    }

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
            ExitCode::WriteFailure,
            "init.write-failed",
            &format!("Failed to write files: {e}"),
        ),
    }
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/// Accepted per-core OS values for `--cores` entries (`id:os`).
const CORE_OS_CHOICES: [&str; 4] = ["zephyr", "yocto", "baremetal", "off"];

/// Parse + validate `--cores` (`id[:os],…`) into `(id, os)` pairs. OS is
/// inferred from the core-id silicon class when omitted. Errors (the
/// `init.invalid-cores` issue, exit 2 — validation) on an id outside the
/// schema's `^[a-z][a-z0-9_]+$` pattern, an unknown OS, or a duplicate id —
/// invalid values would otherwise flow verbatim into board.yaml.
/// None/empty → no cores (single-core default).
fn parse_cores(raw: Option<&str>) -> Result<Vec<(String, String)>, String> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let mut cores: Vec<(String, String)> = Vec::new();
    for entry in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let mut parts = entry.splitn(2, ':');
        let id = parts.next().unwrap_or("").trim().to_string();
        if id.is_empty() {
            continue;
        }
        let valid_id = id.len() >= 2
            && id.as_bytes()[0].is_ascii_lowercase()
            && id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
        if !valid_id {
            return Err(format!(
                "Invalid core id '{id}' in --cores (expected lowercase id matching ^[a-z][a-z0-9_]+$, e.g. m33_sm)."
            ));
        }
        let os = match parts.next().map(str::trim).filter(|s| !s.is_empty()) {
            Some(os) => {
                if !CORE_OS_CHOICES.contains(&os) {
                    return Err(format!(
                        "Invalid OS '{os}' for core '{id}' in --cores (expected one of: zephyr, yocto, baremetal, off)."
                    ));
                }
                os.to_string()
            }
            None => infer_runtime_for_core_id(&id).to_string(),
        };
        if cores.iter().any(|(existing, _)| existing == &id) {
            return Err(format!("Duplicate core id '{id}' in --cores."));
        }
        cores.push((id, os));
    }
    Ok(cores)
}

/// Outcome of resolving an interactive/CLI input that didn't succeed.
enum ResolveErr {
    /// User aborted the prompt (Ctrl-C / Esc) — maps to a runtime failure.
    Cancelled,
    /// A supplied argument was invalid; carries the user-facing message
    /// (rejected with `init.invalid-template`, exit 2 — validation).
    BadArg(String),
}
use ResolveErr::*;

/// Resolve the template id from `--template`, an interactive picker, or the
/// `MinimalApp` default in non-interactive mode.
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

/// Resolve the optional project name from `--name` or an interactive prompt;
/// empty means scaffold directly into the destination.
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

/// Resolve the destination directory, preferring `--destination`, then the
/// global `--project`, then an interactive prompt, defaulting to `.`.
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

/// Build the envelope `Project` block, recording `destination` as the root
/// (no `board.yaml` exists yet at init time).
fn make_project(destination: &str) -> Project {
    Project {
        root: Some(destination.to_string()),
        board_yaml: None,
    }
}

/// Build an `InitData` payload with empty `written`/`unchanged` lists, used for
/// preview and overwrite-guard responses where no files are actually written.
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

/// A bare `RuntimeFailure` result with no text/JSON, returned when the user
/// cancels an interactive prompt.
fn runtime_failure_run() -> CommandRun {
    CommandRun {
        exit: ExitCode::RuntimeFailure,
        text: vec![],
        json: None,
    }
}

/// Build an error `CommandRun` carrying a single error `Issue` (and a matching
/// text/JSON envelope) for the given `exit` code, issue `code`, and `message`.
/// Validation errors pass `ValidationFailure` (exit 2), write errors
/// `WriteFailure` (exit 3) — matching the CLI exit-code contract.
fn error_run(g: &GlobalArgs, exit: ExitCode, code: &str, message: &str) -> CommandRun {
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
            exit.code(),
        )
        .to_json()
    });
    CommandRun {
        exit,
        text,
        json,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_cores;

    #[test]
    fn parse_cores_accepts_valid_entries_and_infers_os() {
        let cores = parse_cores(Some("m33_sm:zephyr, a55_cluster")).unwrap();
        assert_eq!(
            cores,
            vec![
                ("m33_sm".to_string(), "zephyr".to_string()),
                ("a55_cluster".to_string(), "yocto".to_string()),
            ]
        );
        assert!(parse_cores(None).unwrap().is_empty());
        assert!(parse_cores(Some("  ,, ")).unwrap().is_empty());
    }

    #[test]
    fn parse_cores_rejects_bad_id_bad_os_and_duplicates() {
        // Schema pattern ^[a-z][a-z0-9_]+$ — invalid ids must not reach board.yaml.
        assert!(parse_cores(Some("Weird-ID!:yocto")).is_err());
        assert!(parse_cores(Some("m33_sm:freertos")).is_err());
        assert!(parse_cores(Some("m33_sm,m33_sm:zephyr")).is_err());
    }
}
