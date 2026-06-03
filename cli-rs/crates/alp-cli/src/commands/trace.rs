// SPDX-License-Identifier: Apache-2.0
//! `alp trace` — report the generation decisions a build would make.
//!
//! Mirrors TS `runTraceCommand`: for each emit target, record the loader plan
//! it would run (planned, with output path + command line). Requires a resolved
//! SDK root and an existing board.yaml (else exit 2); an unknown `--target`
//! is exit 5.

use std::path::Path;

use alp_core::{
    ALL_EMIT_MODES, DebugGenerationTraceDecision, DebugTraceOutcome, create_loader_plan,
    generation_target_support,
};

use super::CommandRun;
use crate::cli::{GlobalArgs, TraceArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::{generated_at_iso, resolve_cli_project_context};

#[derive(serde::Serialize)]
struct TraceData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    workflow: String,
    #[serde(rename = "focusPath")]
    focus_path: Option<String>,
    target: Option<String>,
    decisions: Vec<DebugGenerationTraceDecision>,
}

pub fn run(g: &GlobalArgs, args: &TraceArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let generated_at = generated_at_iso();
    let focus = args.path.clone();

    let empty_data = |g_at: &str| TraceData {
        schema_version: "1".to_string(),
        generated_at: g_at.to_string(),
        workflow: "cli.trace".to_string(),
        focus_path: focus.clone(),
        target: g.target.clone(),
        decisions: Vec::new(),
    };

    if context.sdk_root.is_none() {
        return failure(
            g,
            ExitCode::ValidationFailure,
            "sdk-root-unresolved",
            "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
            empty_data(&generated_at),
            vec!["trace: alp-sdk root is unresolved.".to_string()],
        );
    }

    let board_resolved = context
        .board_yaml_path
        .as_deref()
        .is_some_and(|p| Path::new(p).exists());
    if !board_resolved {
        return failure(
            g,
            ExitCode::ValidationFailure,
            "board-yaml-missing",
            "board.yaml path could not be resolved or the file does not exist.",
            empty_data(&generated_at),
            vec!["trace: board.yaml path is unresolved or missing.".to_string()],
        );
    }

    let targets = match resolve_targets(g.target.as_deref()) {
        Ok(t) => t,
        Err(message) => {
            // TS routes an unknown target through the catch block, whose data
            // carries target: null (unlike the guard paths above).
            let mut data = empty_data(&generated_at);
            data.target = None;
            return failure(
                g,
                ExitCode::InternalFailure,
                "internal-failure",
                &message,
                data,
                vec!["trace: internal failure".to_string(), message.clone()],
            );
        }
    };

    // Guards above guarantee these are present.
    let workspace_root = context.workspace_root.as_deref().unwrap_or_default();
    let sdk_root = context.sdk_root.as_deref().unwrap_or_default();
    let board_path = context.board_yaml_path.as_deref().unwrap_or_default();

    let mut decisions: Vec<DebugGenerationTraceDecision> = Vec::new();
    for emit in &targets {
        let support = generation_target_support(emit).expect("target validated");
        let plan = create_loader_plan(
            workspace_root,
            sdk_root,
            board_path,
            &context.python_binary,
            support,
        );
        decisions.push(DebugGenerationTraceDecision {
            key: format!("generation.target.{emit}"),
            outcome: DebugTraceOutcome::Planned,
            output_path: Some(plan.output_path),
            detail: format!("Would run: {}", plan.command_line),
        });
    }
    if let Some(focus_path) = &focus {
        decisions.push(DebugGenerationTraceDecision {
            key: format!("config.path.{focus_path}"),
            outcome: DebugTraceOutcome::Planned,
            output_path: None,
            detail: "Path-level tracing is currently static and reports planning context only."
                .to_string(),
        });
    }

    let target = if targets.len() == 1 {
        Some(targets[0].to_string())
    } else {
        None
    };
    let text = if g.is_json() {
        Vec::new()
    } else {
        trace_text(&decisions, g)
    };
    let project_env = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };
    let data = TraceData {
        schema_version: "1".to_string(),
        generated_at,
        workflow: "cli.trace".to_string(),
        focus_path: focus,
        target,
        decisions,
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "trace",
            project_env,
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

fn resolve_targets(raw: Option<&str>) -> Result<Vec<&'static str>, String> {
    match raw {
        None => Ok(ALL_EMIT_MODES.to_vec()),
        Some(target) => match ALL_EMIT_MODES.iter().copied().find(|m| *m == target) {
            Some(m) => Ok(vec![m]),
            None => Err(format!(
                "Unsupported trace target '{target}'. Allowed values: {}.",
                ALL_EMIT_MODES.join(", ")
            )),
        },
    }
}

fn failure(
    g: &GlobalArgs,
    exit: ExitCode,
    code: &str,
    message: &str,
    data: TraceData,
    text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("trace.{code}"),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    // TS createFailureResult reports a null project on the failure paths.
    let project_env = Project {
        root: None,
        board_yaml: None,
    };
    let text = if g.is_json() { Vec::new() } else { text_lines };
    let json = g
        .is_json()
        .then(|| Envelope::new("trace", project_env, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

fn trace_text(decisions: &[DebugGenerationTraceDecision], g: &GlobalArgs) -> Vec<String> {
    let mut lines = vec![format!("trace: decisions={}", decisions.len())];
    if !g.quiet {
        for decision in decisions {
            lines.push(format!(
                "[{}] {}: {}",
                outcome_label(decision.outcome),
                decision.key,
                decision.detail
            ));
        }
    }
    lines
}

fn outcome_label(outcome: DebugTraceOutcome) -> &'static str {
    match outcome {
        DebugTraceOutcome::Planned => "planned",
        DebugTraceOutcome::Written => "written",
        DebugTraceOutcome::Failed => "failed",
    }
}
