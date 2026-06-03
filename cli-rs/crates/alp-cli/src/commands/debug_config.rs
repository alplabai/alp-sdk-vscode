// SPDX-License-Identifier: Apache-2.0
//! `alp debug-config` — generate (or preview) a VS Code launch.json entry.
//!
//! Mirrors TS `runDebugConfigCommand`: build a launch draft for the target/
//! server, then either preview it (`--preview`) or merge it into
//! `<workspace>/.vscode/launch.json`. Invalid kind / unsupported backend →
//! exit 5; a failed write → exit 3.

use std::path::{Path, PathBuf};

use alp_core::{
    DebugServerKind, DebugTargetKind, create_launch_draft, create_launch_json_write_plan,
    launch_preview_document, launch_preview_notes, parse_server_kind, parse_target_kind,
};
use serde_json::Value;

use super::CommandRun;
use crate::cli::{DebugConfigArgs, GlobalArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::{generated_at_iso, normalize_path};

#[derive(serde::Serialize)]
struct DebugConfigData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    #[serde(rename = "targetKind")]
    target_kind: DebugTargetKind,
    server: DebugServerKind,
    preview: bool,
    #[serde(rename = "launchJsonPath")]
    launch_json_path: String,
    replaced: bool,
    notes: Vec<String>,
}

pub fn run(g: &GlobalArgs, args: &DebugConfigArgs) -> CommandRun {
    let generated_at = generated_at_iso();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // Errors before workspace resolution report a cwd-based launch.json path
    // and a zephyr-mcu/none placeholder (matches the TS catch block).
    let cwd_launch_path = || {
        cwd.join(".vscode")
            .join("launch.json")
            .to_string_lossy()
            .to_string()
    };

    let target = match parse_target_kind(args.target_kind.as_deref()) {
        Ok(t) => t,
        Err(message) => return internal_failure(g, &generated_at, message, cwd_launch_path()),
    };
    let server = match parse_server_kind(args.server.as_deref()) {
        Ok(s) => s,
        Err(message) => return internal_failure(g, &generated_at, message, cwd_launch_path()),
    };
    let draft = match create_launch_draft(target, server) {
        Ok(d) => d,
        Err(message) => return internal_failure(g, &generated_at, message, cwd_launch_path()),
    };

    let project_arg = g.project.clone().unwrap_or_else(|| ".".to_string());
    let workspace_root = normalize_path(&cwd.join(&project_arg));
    let launch_json_path = workspace_root
        .join(".vscode")
        .join("launch.json")
        .to_string_lossy()
        .to_string();
    let notes = launch_preview_notes();

    if args.preview {
        return success(
            g,
            &generated_at,
            target,
            server,
            &launch_json_path,
            true,
            false,
            &notes,
            &draft,
            &workspace_root,
        );
    }

    // Write mode: merge into .vscode/launch.json.
    let vscode_dir = Path::new(&launch_json_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| workspace_root.join(".vscode"));
    if let Err(e) = std::fs::create_dir_all(&vscode_dir) {
        return write_failure(
            g,
            &generated_at,
            target,
            server,
            &launch_json_path,
            e.to_string(),
        );
    }

    let existing = if Path::new(&launch_json_path).exists() {
        std::fs::read_to_string(&launch_json_path).ok()
    } else {
        None
    };

    let plan = match create_launch_json_write_plan(existing.as_deref(), &draft) {
        Ok(p) => p,
        // A malformed existing launch.json surfaces as an internal failure in TS.
        Err(message) => return internal_failure(g, &generated_at, message, cwd_launch_path()),
    };

    if let Err(e) = std::fs::write(&launch_json_path, &plan.content) {
        return write_failure(
            g,
            &generated_at,
            target,
            server,
            &launch_json_path,
            e.to_string(),
        );
    }

    success(
        g,
        &generated_at,
        target,
        server,
        &launch_json_path,
        false,
        plan.replaced,
        &notes,
        &draft,
        &workspace_root,
    )
}

#[allow(clippy::too_many_arguments)]
fn success(
    g: &GlobalArgs,
    generated_at: &str,
    target: DebugTargetKind,
    server: DebugServerKind,
    launch_json_path: &str,
    preview: bool,
    replaced: bool,
    notes: &[String],
    draft: &Value,
    workspace_root: &Path,
) -> CommandRun {
    let data = DebugConfigData {
        schema_version: "1".to_string(),
        generated_at: generated_at.to_string(),
        target_kind: target,
        server,
        preview,
        launch_json_path: launch_json_path.to_string(),
        replaced,
        notes: notes.to_vec(),
    };
    let text = if g.is_json() {
        Vec::new()
    } else {
        debug_config_text(
            target,
            server,
            launch_json_path,
            replaced,
            preview,
            notes,
            draft,
            g,
        )
    };
    let project = Project {
        root: Some(workspace_root.to_string_lossy().to_string()),
        board_yaml: None,
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "debug-config",
            project,
            data,
            Vec::new(),
            ExitCode::Success.code(),
        )
        .to_json()
    });
    CommandRun {
        exit: ExitCode::Success,
        text,
        json,
    }
}

fn internal_failure(
    g: &GlobalArgs,
    generated_at: &str,
    message: String,
    launch_json_path: String,
) -> CommandRun {
    failure_envelope(
        g,
        generated_at,
        DebugTargetKind::ZephyrMcu,
        DebugServerKind::None,
        launch_json_path,
        ExitCode::InternalFailure,
        "internal-failure",
        message,
        vec!["debug-config: internal failure".to_string()],
    )
}

fn write_failure(
    g: &GlobalArgs,
    generated_at: &str,
    target: DebugTargetKind,
    server: DebugServerKind,
    launch_json_path: &str,
    message: String,
) -> CommandRun {
    failure_envelope(
        g,
        generated_at,
        target,
        server,
        launch_json_path.to_string(),
        ExitCode::WriteFailure,
        "write-failure",
        message,
        vec!["debug-config: failed to write launch.json.".to_string()],
    )
}

#[allow(clippy::too_many_arguments)]
fn failure_envelope(
    g: &GlobalArgs,
    generated_at: &str,
    target: DebugTargetKind,
    server: DebugServerKind,
    launch_json_path: String,
    exit: ExitCode,
    code: &str,
    message: String,
    mut text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("debug-config.{code}"),
        severity: "error".to_string(),
        message: message.clone(),
    }];
    let data = DebugConfigData {
        schema_version: "1".to_string(),
        generated_at: generated_at.to_string(),
        target_kind: target,
        server,
        preview: false,
        launch_json_path,
        replaced: false,
        notes: Vec::new(),
    };
    let text = if g.is_json() {
        Vec::new()
    } else {
        text_lines.push(message);
        text_lines
    };
    // TS createFailureResult reports a null project.
    let json = g.is_json().then(|| {
        Envelope::new(
            "debug-config",
            Project {
                root: None,
                board_yaml: None,
            },
            data,
            issues,
            exit.code(),
        )
        .to_json()
    });
    CommandRun { exit, text, json }
}

#[allow(clippy::too_many_arguments)]
fn debug_config_text(
    target: DebugTargetKind,
    server: DebugServerKind,
    launch_json_path: &str,
    replaced: bool,
    preview: bool,
    notes: &[String],
    draft: &Value,
    g: &GlobalArgs,
) -> Vec<String> {
    let mut lines = Vec::new();
    if preview {
        lines.push(format!(
            "debug-config: preview target={} server={}",
            target.as_str(),
            server.as_str()
        ));
        lines.push(format!("launch.json path: {launch_json_path}"));
        if !g.quiet {
            lines.push(String::new());
            let document = launch_preview_document(draft.clone());
            lines.push(serde_json::to_string_pretty(&document).unwrap_or_default());
            lines.push(String::new());
            lines.extend(notes.iter().map(|n| format!("note: {n}")));
        }
    } else {
        let action = if replaced { "updated" } else { "written" };
        lines.push(format!(
            "debug-config: {action} target={} server={}",
            target.as_str(),
            server.as_str()
        ));
        lines.push(format!("launch.json: {launch_json_path}"));
        if !g.quiet {
            lines.extend(notes.iter().map(|n| format!("note: {n}")));
        }
    }
    lines
}
