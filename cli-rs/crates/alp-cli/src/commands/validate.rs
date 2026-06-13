// SPDX-License-Identifier: Apache-2.0
//! `alp validate` — validate schema + semantic rules for the active project.
//!
//! Default behavior spawns the Python SDK validator
//! (`<sdk>/scripts/validate_board_yaml.py --input <board>`), mirroring TS
//! `runValidateCommand`. `--offline` runs only the structural validator
//! (`validateBoardYamlLocally`) — no Python/SDK required.

use std::path::{Path, PathBuf};
use std::process::Command;

use alp_core::{
    Outcome, ProjectContext, ValidatorExecution, analyze_validation_result,
    validate_board_yaml_local,
};

use super::CommandRun;
use crate::cli::{GlobalArgs, ValidateArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

/// Envelope `data` payload for `validate` — serialized into the JSON output.
#[derive(serde::Serialize)]
struct ValidateData {
    /// Data-schema version of this payload (currently always `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Validation outcome string (e.g. `clean`, `schema-violation`, `failed`).
    outcome: String,
    /// Number of issues reported.
    #[serde(rename = "issueCount")]
    issue_count: usize,
    /// The validator command line that was run (empty on the offline/guard paths).
    #[serde(rename = "commandLine")]
    command_line: String,
    /// Resolved `board.yaml` path that was validated.
    #[serde(rename = "boardYamlPath")]
    board_yaml_path: String,
}

/// Entry point for `alp validate`: dispatch to the offline structural validator
/// (`--offline`) or the Python-SDK spawn path.
pub fn run(g: &GlobalArgs, args: &ValidateArgs) -> CommandRun {
    if args.offline {
        run_offline(g)
    } else {
        run_spawn(g)
    }
}

/// Map a validation `Outcome` to the stable CLI `ExitCode` (clean → success,
/// schema/preset/revision violations → validation failure, failed → runtime failure).
fn validation_outcome_exit_code(outcome: Outcome) -> ExitCode {
    match outcome {
        Outcome::Clean => ExitCode::Success,
        Outcome::MissingPreset | Outcome::SchemaViolation | Outcome::HardwareRevision => {
            ExitCode::ValidationFailure
        }
        Outcome::Failed => ExitCode::RuntimeFailure,
    }
}

/// Mirror of TS `toCliIssues`: rewrite each parsed issue's code to
/// `validate.<outcome>`; synthesize one issue for a non-clean, issue-less run.
fn to_cli_issues(outcome: Outcome, issues: &[alp_core::ValidationIssue]) -> Vec<Issue> {
    let mapped: Vec<Issue> = issues
        .iter()
        .map(|i| Issue {
            code: format!("validate.{}", outcome.as_str()),
            severity: i.severity.as_str().to_string(),
            message: i.message.clone(),
        })
        .collect();

    if !mapped.is_empty() {
        return mapped;
    }
    if outcome == Outcome::Clean {
        return Vec::new();
    }
    vec![Issue {
        code: format!("validate.{}", outcome.as_str()),
        severity: "error".to_string(),
        message: format!("Validation ended with outcome '{}'.", outcome.as_str()),
    }]
}

// ───────────────────────────── spawn path ─────────────────────────────

/// Default validation path: resolve the project, spawn the SDK's
/// `validate_board_yaml.py`, and turn its output into a `CommandRun`. Guards on
/// missing `board.yaml` / unresolved SDK root before spawning.
fn run_spawn(g: &GlobalArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);

    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    // Guard 1: board.yaml must resolve and exist.
    let board_path = match &context.board_yaml_path {
        Some(path) if Path::new(path).exists() => path.clone(),
        _ => {
            return validation_guard_failure(
                g,
                project,
                &context,
                "board-yaml-missing",
                "board.yaml path could not be resolved or the file does not exist.",
            );
        }
    };

    // Guard 2: SDK root must resolve.
    let Some(sdk_root) = context.sdk_root.clone() else {
        return validation_guard_failure(
            g,
            project,
            &context,
            "sdk-root-unresolved",
            "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
        );
    };

    // Plan: spawn `<sdk>/scripts/validate_board_yaml.py --input <board>`.
    let script_path = Path::new(&sdk_root)
        .join("scripts")
        .join("validate_board_yaml.py")
        .to_string_lossy()
        .to_string();
    let command_line = format!(
        "{} {} --input {}",
        context.python_binary, script_path, board_path
    );

    let execution = match Command::new(&context.python_binary)
        .arg(&script_path)
        .arg("--input")
        .arg(&board_path)
        .output()
    {
        Ok(out) => ValidatorExecution {
            status: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        },
        // A failed spawn mirrors TS spawnSync's null status → "failed" outcome.
        Err(_) => ValidatorExecution {
            status: None,
            stdout: String::new(),
            stderr: String::new(),
        },
    };

    let result = analyze_validation_result(&execution);
    let exit = validation_outcome_exit_code(result.outcome);
    let issues = to_cli_issues(result.outcome, &result.issues);

    let data = ValidateData {
        schema_version: "1".to_string(),
        outcome: result.outcome.as_str().to_string(),
        issue_count: issues.len(),
        command_line: command_line.clone(),
        board_yaml_path: board_path.clone(),
    };

    let text = if g.is_json() {
        Vec::new()
    } else {
        spawn_text(result.outcome, &issues, g, &board_path, &command_line)
    };
    let json = g
        .is_json()
        .then(|| Envelope::new("validate", project, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

/// Build a `validate`-failure `CommandRun` for a pre-spawn guard (missing
/// `board.yaml` or unresolved SDK root); emits one issue coded `validate.<code>`.
fn validation_guard_failure(
    g: &GlobalArgs,
    project: Project,
    context: &ProjectContext,
    code: &str,
    message: &str,
) -> CommandRun {
    let board_yaml_path = context.board_yaml_path.clone().unwrap_or_default();
    let issues = vec![Issue {
        code: format!("validate.{code}"),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    let data = ValidateData {
        schema_version: "1".to_string(),
        outcome: "failed".to_string(),
        issue_count: 1,
        command_line: String::new(),
        board_yaml_path,
    };
    let text = if g.is_json() {
        Vec::new()
    } else {
        vec![
            "validate: validation failure".to_string(),
            message.to_string(),
        ]
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "validate",
            project,
            data,
            issues,
            ExitCode::ValidationFailure.code(),
        )
        .to_json()
    });

    CommandRun {
        exit: ExitCode::ValidationFailure,
        text,
        json,
    }
}

/// Render the human-readable (non-JSON) output lines for a validation result;
/// suppresses per-issue/board detail under `--quiet`, appends the cmd under `--verbose`.
fn spawn_text(
    outcome: Outcome,
    issues: &[Issue],
    g: &GlobalArgs,
    board_path: &str,
    command_line: &str,
) -> Vec<String> {
    let mut lines = Vec::new();
    if outcome == Outcome::Clean {
        lines.push("validate: clean".to_string());
        if !g.quiet {
            lines.push(format!("board.yaml: {board_path}"));
        }
    } else {
        lines.push(format!("validate: {}", outcome.as_str()));
        if !g.quiet {
            for issue in issues {
                lines.push(format!("[{}] {}", issue.severity, issue.message));
            }
        }
    }
    if g.verbose {
        lines.push(format!("cmd: {command_line}"));
    }
    lines
}

// ──────────────────────────── offline path ────────────────────────────

/// Resolve the `board.yaml` path for the offline path: explicit `--board-yaml`
/// if given, else `<--project|.>/board.yaml`.
fn resolve_offline_board_path(g: &GlobalArgs) -> PathBuf {
    if let Some(b) = &g.board_yaml {
        return PathBuf::from(b);
    }
    let root = g.project.clone().unwrap_or_else(|| ".".to_string());
    Path::new(&root).join("board.yaml")
}

/// Offline validation path: read `board.yaml` and run only the structural
/// validator (`validate_board_yaml_local`) — no Python/SDK needed.
fn run_offline(g: &GlobalArgs) -> CommandRun {
    let board_path = resolve_offline_board_path(g);
    let board_str = board_path.to_string_lossy().to_string();
    let project = Project {
        root: g.project.clone().or_else(|| Some(".".to_string())),
        board_yaml: Some(board_str.clone()),
    };

    if !board_path.exists() {
        return offline_failure(
            g,
            project,
            ExitCode::ValidationFailure,
            "board-yaml-missing",
            "board.yaml path could not be resolved or the file does not exist.",
            &board_str,
        );
    }

    let text = match std::fs::read_to_string(&board_path) {
        Ok(t) => t,
        Err(e) => {
            return offline_failure(
                g,
                project,
                ExitCode::InternalFailure,
                "internal-failure",
                &format!("could not read board.yaml: {e}"),
                &board_str,
            );
        }
    };

    match validate_board_yaml_local(&text) {
        Ok(result) => {
            let exit = validation_outcome_exit_code(result.outcome);
            let issues = to_cli_issues(result.outcome, &result.issues);
            let data = ValidateData {
                schema_version: "1".to_string(),
                outcome: result.outcome.as_str().to_string(),
                issue_count: issues.len(),
                command_line: String::new(),
                board_yaml_path: board_str.clone(),
            };
            let text_lines = if g.is_json() {
                Vec::new()
            } else {
                spawn_text(result.outcome, &issues, g, &board_str, "")
            };
            let json = g
                .is_json()
                .then(|| Envelope::new("validate", project, data, issues, exit.code()).to_json());

            CommandRun {
                exit,
                text: text_lines,
                json,
            }
        }
        Err(e) => offline_failure(
            g,
            project,
            ExitCode::InternalFailure,
            "internal-failure",
            &e.to_string(),
            &board_str,
        ),
    }
}

/// Build a failure `CommandRun` for the offline path (missing/unreadable
/// `board.yaml` or validator error) with the given `exit` and one `validate.<code>` issue.
fn offline_failure(
    g: &GlobalArgs,
    project: Project,
    exit: ExitCode,
    code: &str,
    message: &str,
    board_path: &str,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("validate.{code}"),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    let data = ValidateData {
        schema_version: "1".to_string(),
        outcome: "failed".to_string(),
        issue_count: 1,
        command_line: String::new(),
        board_yaml_path: board_path.to_string(),
    };
    let text = if g.is_json() {
        Vec::new()
    } else {
        vec![
            "validate: validation failure".to_string(),
            message.to_string(),
        ]
    };
    let json = g
        .is_json()
        .then(|| Envelope::new("validate", project, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_code_mapping_matches_contract() {
        assert_eq!(
            validation_outcome_exit_code(Outcome::Clean),
            ExitCode::Success
        );
        assert_eq!(
            validation_outcome_exit_code(Outcome::SchemaViolation),
            ExitCode::ValidationFailure
        );
        assert_eq!(
            validation_outcome_exit_code(Outcome::MissingPreset),
            ExitCode::ValidationFailure
        );
        assert_eq!(
            validation_outcome_exit_code(Outcome::HardwareRevision),
            ExitCode::ValidationFailure
        );
        assert_eq!(
            validation_outcome_exit_code(Outcome::Failed),
            ExitCode::RuntimeFailure
        );
    }

    #[test]
    fn non_clean_without_issues_synthesizes_one() {
        let issues = to_cli_issues(Outcome::Failed, &[]);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "validate.failed");
        assert!(issues[0].message.contains("outcome 'failed'"));

        assert!(to_cli_issues(Outcome::Clean, &[]).is_empty());
    }
}
