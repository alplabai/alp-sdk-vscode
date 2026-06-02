// SPDX-License-Identifier: Apache-2.0
//! `alp validate` — offline structural validation (Phase 0).
//!
//! Parity target: TS `validateBoardYamlLocally`. Full SDK-spawn semantics
//! land in a later phase; this proves the envelope + exit-code contract.

use std::path::{Path, PathBuf};

use alp_core::{Outcome, validate_board_yaml_local};

use crate::cli::GlobalArgs;
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;

/// One command run: what to print and which code to exit with.
pub struct CommandRun {
    pub exit: ExitCode,
    /// Human text (stderr-bound); empty in JSON mode.
    pub text: Vec<String>,
    /// JSON document (stdout-bound) in JSON mode.
    pub json: Option<String>,
}

#[derive(serde::Serialize)]
struct ValidateData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    outcome: String,
    #[serde(rename = "issueCount")]
    issue_count: usize,
    #[serde(rename = "commandLine")]
    command_line: String,
    #[serde(rename = "boardYamlPath")]
    board_yaml_path: String,
}

fn resolve_board_path(g: &GlobalArgs) -> PathBuf {
    if let Some(b) = &g.board_yaml {
        return PathBuf::from(b);
    }
    let root = g.project.clone().unwrap_or_else(|| ".".to_string());
    Path::new(&root).join("board.yaml")
}

pub fn run(g: &GlobalArgs) -> CommandRun {
    let board_path = resolve_board_path(g);
    let board_str = board_path.to_string_lossy().to_string();
    let project = Project {
        root: g.project.clone().or_else(|| Some(".".to_string())),
        board_yaml: Some(board_str.clone()),
    };

    // 1. board.yaml must exist → validation failure (exit 2).
    if !board_path.exists() {
        return failure(
            g,
            project,
            ExitCode::ValidationFailure,
            "board-yaml-missing",
            "board.yaml path could not be resolved or the file does not exist.",
            &board_str,
        );
    }

    // 2. Read file.
    let text = match std::fs::read_to_string(&board_path) {
        Ok(t) => t,
        Err(e) => {
            return failure(
                g,
                project,
                ExitCode::InternalFailure,
                "internal-failure",
                &format!("could not read board.yaml: {e}"),
                &board_str,
            );
        }
    };

    // 3. Parse + validate.
    match validate_board_yaml_local(&text) {
        Ok(result) => {
            let exit = match result.outcome {
                Outcome::Clean => ExitCode::Success,
                Outcome::SchemaViolation => ExitCode::ValidationFailure,
            };
            let issues: Vec<Issue> = result
                .issues
                .iter()
                .map(|i| Issue {
                    code: format!("validate.{}", result.outcome.as_str()),
                    severity: i.severity.as_str().to_string(),
                    message: i.message.clone(),
                })
                .collect();

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
                validate_text(result.outcome, &issues, g, &board_str)
            };

            let json = g.is_json().then(|| {
                Envelope::new("validate", project, data, issues, exit.code()).to_json()
            });

            CommandRun { exit, text: text_lines, json }
        }
        Err(e) => failure(
            g,
            project,
            ExitCode::InternalFailure,
            "internal-failure",
            &e.to_string(),
            &board_str,
        ),
    }
}

fn validate_text(
    outcome: Outcome,
    issues: &[Issue],
    g: &GlobalArgs,
    board_path: &str,
) -> Vec<String> {
    let mut lines = Vec::new();
    match outcome {
        Outcome::Clean => {
            lines.push("validate: clean".to_string());
            if !g.quiet {
                lines.push(format!("board.yaml: {board_path}"));
            }
        }
        Outcome::SchemaViolation => {
            lines.push(format!("validate: {}", outcome.as_str()));
            if !g.quiet {
                for i in issues {
                    lines.push(format!("[{}] {}", i.severity, i.message));
                }
            }
        }
    }
    lines
}

fn failure(
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
        vec!["validate: validation failure".to_string(), message.to_string()]
    };
    let json = g
        .is_json()
        .then(|| Envelope::new("validate", project, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}
