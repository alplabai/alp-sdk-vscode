// SPDX-License-Identifier: Apache-2.0
//! `alp inspect` — show resolved project/debug context values.
//!
//! Mirrors TS `runInspectCommand`: build the debug context, list resolved
//! values (optionally filtered by `--path`), and warn when board.yaml is
//! missing or a `--path` filter matches nothing.

use std::path::Path;

use alp_core::{
    DebugResolvedValue, DebugValueSource, DebuggerExtensionsState, collect_resolved_values,
    create_debug_workspace_context,
};
use serde_json::Value;

use super::CommandRun;
use crate::cli::{GlobalArgs, InspectArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::{generated_at_iso, resolve_cli_project_context};

#[derive(serde::Serialize)]
struct InspectData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    #[serde(rename = "focusPath")]
    focus_path: Option<String>,
    #[serde(rename = "showOrigin")]
    show_origin: bool,
    #[serde(rename = "resolvedValues")]
    resolved_values: Vec<DebugResolvedValue>,
}

pub fn run(g: &GlobalArgs, args: &InspectArgs) -> CommandRun {
    let project = resolve_cli_project_context(g);
    let generated_at = generated_at_iso();
    let context = create_debug_workspace_context(
        &project,
        generated_at.clone(),
        |path| Path::new(path).exists(),
        DebuggerExtensionsState {
            cortex_debug: true,
            cpp_tools: true,
            code_lldb: true,
        },
    );

    let mut issues = Vec::new();
    if !context.board_yaml_exists {
        issues.push(Issue {
            code: "inspect.board-yaml-missing".to_string(),
            severity: "warning".to_string(),
            message: "board.yaml path could not be resolved or the file does not exist."
                .to_string(),
        });
    }

    let focus = args.path.clone();
    let resolved_values =
        filter_resolved_values(collect_resolved_values(&context), focus.as_deref());

    if let Some(focus_path) = &focus {
        if resolved_values.is_empty() {
            issues.push(Issue {
                code: "inspect.path-not-found".to_string(),
                severity: "warning".to_string(),
                message: format!("No resolved values match --path '{focus_path}'."),
            });
        }
    }

    let project_env = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };
    let text = if g.is_json() {
        Vec::new()
    } else {
        inspect_text(&resolved_values, focus.as_deref(), args.show_origin, g)
    };
    let data = InspectData {
        schema_version: "1".to_string(),
        generated_at: context.generated_at.clone(),
        focus_path: focus,
        show_origin: args.show_origin,
        resolved_values,
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "inspect",
            project_env,
            data,
            issues,
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

fn filter_resolved_values(
    values: Vec<DebugResolvedValue>,
    focus: Option<&str>,
) -> Vec<DebugResolvedValue> {
    match focus {
        None => values,
        Some(f) => {
            let dot = format!("{f}.");
            let bracket = format!("{f}[");
            values
                .into_iter()
                .filter(|v| v.key == f || v.key.starts_with(&dot) || v.key.starts_with(&bracket))
                .collect()
        }
    }
}

fn inspect_text(
    values: &[DebugResolvedValue],
    focus: Option<&str>,
    show_origin: bool,
    g: &GlobalArgs,
) -> Vec<String> {
    let mut lines = vec![format!("inspect: resolved values={}", values.len())];
    if let Some(focus_path) = focus {
        lines.push(format!("path={focus_path}"));
    }
    if !g.quiet {
        for value in values {
            let rendered = format_value(&value.value);
            if show_origin {
                lines.push(format!(
                    "{}={} source={} detail={}",
                    value.key,
                    rendered,
                    source_label(value.source),
                    serde_json::to_string(&value.detail).unwrap_or_else(|_| value.detail.clone())
                ));
            } else {
                lines.push(format!("{}={}", value.key, rendered));
            }
        }
    }
    lines
}

fn format_value(value: &Value) -> String {
    match value {
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| s.clone()),
        other => other.to_string(),
    }
}

fn source_label(source: DebugValueSource) -> &'static str {
    match source {
        DebugValueSource::Workspace => "workspace",
        DebugValueSource::Setting => "setting",
        DebugValueSource::Default => "default",
        DebugValueSource::Runtime => "runtime",
        DebugValueSource::Derived => "derived",
        DebugValueSource::Unresolved => "unresolved",
    }
}
