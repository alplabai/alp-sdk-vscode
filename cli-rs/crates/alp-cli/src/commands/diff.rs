// SPDX-License-Identifier: Apache-2.0
//! `alp diff` — show how `normalize_board_model` changes the parsed board.yaml.
//!
//! Mirrors TS `runDiffCommand`: parse board.yaml, normalize it, and diff the
//! two as JSON trees (added/removed/changed by path). Null object entries are
//! pruned first so the diff matches the TS model's sparse (undefined-omitting)
//! shape.

use std::path::Path;

use alp_core::{
    DiffEntry, DiffKind, collect_diff_entries, normalize_board_model, parse_board_model,
    prune_nulls,
};
use serde_json::Value;

use super::CommandRun;
use crate::cli::GlobalArgs;
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

#[derive(serde::Serialize)]
struct DiffData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "boardYamlPath")]
    board_yaml_path: String,
    unchanged: bool,
    #[serde(rename = "changeCount")]
    change_count: usize,
    changes: Vec<DiffEntry>,
}

pub fn run(g: &GlobalArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let board_path = match &context.board_yaml_path {
        Some(path) if Path::new(path).exists() => path.clone(),
        _ => {
            return failure(
                g,
                project,
                ExitCode::ValidationFailure,
                "board-yaml-missing",
                "board.yaml path could not be resolved or the file does not exist.",
                context.board_yaml_path.clone().unwrap_or_default(),
                vec!["diff: board.yaml path is unresolved or missing.".to_string()],
            );
        }
    };

    let text = match std::fs::read_to_string(&board_path) {
        Ok(t) => t,
        Err(e) => {
            return failure(
                g,
                project,
                ExitCode::InternalFailure,
                "internal-failure",
                &format!("could not read board.yaml: {e}"),
                board_path.clone(),
                vec!["diff: internal failure".to_string(), e.to_string()],
            );
        }
    };

    let model = match parse_board_model(&text) {
        Ok(m) => m,
        Err(e) => {
            return failure(
                g,
                project,
                ExitCode::InternalFailure,
                "internal-failure",
                &e.to_string(),
                board_path.clone(),
                vec!["diff: internal failure".to_string(), e.to_string()],
            );
        }
    };

    let before = prune_nulls(serde_json::to_value(&model).expect("board model is serializable"));
    let normalized = normalize_board_model(model);
    let after =
        prune_nulls(serde_json::to_value(&normalized).expect("board model is serializable"));
    let changes = collect_diff_entries(&before, &after);

    let data = DiffData {
        schema_version: "1".to_string(),
        board_yaml_path: board_path.clone(),
        unchanged: changes.is_empty(),
        change_count: changes.len(),
        changes,
    };

    let text_lines = if g.is_json() {
        Vec::new()
    } else {
        format_diff_text(&data, g, &board_path)
    };
    let json = g.is_json().then(|| {
        Envelope::new("diff", project, data, Vec::new(), ExitCode::Success.code()).to_json()
    });

    CommandRun {
        exit: ExitCode::Success,
        text: text_lines,
        json,
    }
}

#[allow(clippy::too_many_arguments)]
fn failure(
    g: &GlobalArgs,
    project: Project,
    exit: ExitCode,
    code: &str,
    message: &str,
    board_yaml_path: String,
    text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("diff.{code}"),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    let data = DiffData {
        schema_version: "1".to_string(),
        board_yaml_path,
        unchanged: false,
        change_count: 0,
        changes: Vec::new(),
    };
    let text = if g.is_json() { Vec::new() } else { text_lines };
    let json = g
        .is_json()
        .then(|| Envelope::new("diff", project, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

fn format_diff_text(data: &DiffData, g: &GlobalArgs, board_path: &str) -> Vec<String> {
    if data.changes.is_empty() {
        return vec!["diff: no effective-config differences detected.".to_string()];
    }

    let mut lines = vec![format!(
        "diff: {} differences in {}",
        data.changes.len(),
        board_path
    )];
    if !g.quiet {
        for change in &data.changes {
            lines.push(format!(
                "{} {}: {} -> {}",
                kind_label(change.kind),
                change.path,
                format_value(&change.before),
                format_value(&change.after),
            ));
        }
    }
    lines
}

fn kind_label(kind: DiffKind) -> &'static str {
    match kind {
        DiffKind::Added => "ADDED",
        DiffKind::Removed => "REMOVED",
        DiffKind::Changed => "CHANGED",
    }
}

fn format_value(value: &Option<Value>) -> String {
    match value {
        None => "<undefined>".to_string(),
        Some(Value::String(s)) => serde_json::to_string(s).unwrap_or_else(|_| s.clone()),
        Some(val) => {
            let raw = serde_json::to_string(val).unwrap_or_else(|_| val.to_string());
            if raw.chars().count() > 120 {
                let truncated: String = raw.chars().take(117).collect();
                format!("{truncated}...")
            } else {
                raw
            }
        }
    }
}
