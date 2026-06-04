// SPDX-License-Identifier: Apache-2.0
//! `alp build` / `image` / `flash` / `clean` / `renode` — the build workflow.
//!
//! Each is the single user-facing entry that **hides `west`**: `alp build` runs
//! `west alp-build`, `alp flash` runs `west alp-flash`, etc. The per-core /
//! per-platform routing (Zephyr→`west build`, Yocto→`bitbake`, baremetal→CMake +
//! vendor toolchain) stays in the SDK's orchestrator (`alp_orchestrate.py`); the
//! CLI never re-decides the backend. Args after the subcommand are forwarded
//! verbatim to the `west alp-*` command.
//!
//! Text mode inherits stdio so the build streams live in the caller's terminal;
//! JSON mode captures + emits a single envelope.

use std::process::Command;

use alp_core::build_plan::{parse_build_plan, summarize_plan};
use serde::Serialize;

use super::CommandRun;
use crate::cli::{BuildArgs, GlobalArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

#[derive(Serialize)]
struct BuildData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "westCommand")]
    west_command: String,
    #[serde(rename = "westCwd")]
    west_cwd: String,
    args: Vec<String>,
}

/// `alp build` entry: `--plan` consumes the SDK's emitted build plan; otherwise
/// delegate to `west alp-build` (the Wave A2 behavior).
pub fn run_build(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    if args.plan || args.plan_from.is_some() {
        plan(g, args)
    } else {
        run(g, "build", &args.args)
    }
}

/// `alp build --plan [--plan-from FILE]` — consume + render the build plan
/// without building. The plan is the SDK's single source of truth; the CLI only
/// deserializes + presents it (Wave C0). Live `--emit build-plan` is pending on
/// the SDK side, so today the plan comes from `--plan-from <FILE>`.
fn plan(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let source: Result<String, (&str, String)> = match &args.plan_from {
        Some(path) => std::fs::read_to_string(path).map_err(|e| {
            (
                "build.plan-unavailable",
                format!("failed to read plan file `{path}`: {e}"),
            )
        }),
        None => Err((
            "build.plan-unavailable",
            "live build-plan emit is not available yet — the SDK's \
             `alp_orchestrate.py --emit build-plan` is pending (see \
             docs/BUILD_ORCHESTRATION.md). Pass `--plan-from <FILE>` to consume \
             an emitted plan JSON."
                .to_string(),
        )),
    };

    let parsed = source.and_then(|json| {
        parse_build_plan(&json).map_err(|e| ("build.plan-invalid", e.to_string()))
    });

    match parsed {
        Ok(plan) => {
            if g.is_json() {
                let json = Envelope::new(
                    "build",
                    project,
                    &plan,
                    Vec::new(),
                    ExitCode::Success.code(),
                )
                .to_json();
                CommandRun {
                    exit: ExitCode::Success,
                    text: Vec::new(),
                    json: Some(json),
                }
            } else {
                CommandRun {
                    exit: ExitCode::Success,
                    text: summarize_plan(&plan),
                    json: None,
                }
            }
        }
        Err((code, message)) => {
            let exit = ExitCode::RuntimeFailure;
            let issues = vec![Issue {
                code: code.to_string(),
                severity: "error".to_string(),
                message: message.clone(),
            }];
            if g.is_json() {
                let json = Envelope::new(
                    "build",
                    project,
                    serde_json::Value::Null,
                    issues,
                    exit.code(),
                )
                .to_json();
                CommandRun {
                    exit,
                    text: Vec::new(),
                    json: Some(json),
                }
            } else {
                CommandRun {
                    exit,
                    text: vec![format!("build: {message}")],
                    json: None,
                }
            }
        }
    }
}

/// Build the `west` argv: `alp-<subcommand>` followed by the forwarded args.
fn west_argv(subcommand: &str, passthrough: &[String]) -> Vec<String> {
    let mut argv = vec![format!("alp-{subcommand}")];
    argv.extend(passthrough.iter().cloned());
    argv
}

/// `subcommand` is the bare alp verb (`build`/`image`/`flash`/`clean`/`renode`).
pub fn run(g: &GlobalArgs, subcommand: &str, passthrough: &[String]) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let west_cwd = context
        .west_cwd
        .clone()
        .or_else(|| context.workspace_root.clone())
        .unwrap_or_else(|| ".".to_string());

    let argv = west_argv(subcommand, passthrough);
    let west_command = argv[0].clone();
    let data = BuildData {
        schema_version: "1".to_string(),
        west_command: west_command.clone(),
        west_cwd: west_cwd.clone(),
        args: passthrough.to_vec(),
    };
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    if g.is_json() {
        let result = Command::new("west")
            .args(&argv)
            .current_dir(&west_cwd)
            .output();
        let (exit, issues) = match result {
            Ok(out) if out.status.success() => (ExitCode::Success, Vec::new()),
            Ok(_) => (
                ExitCode::RuntimeFailure,
                vec![issue(
                    subcommand,
                    format!(
                        "`west {west_command}` failed; re-run without --format json to see the log."
                    ),
                )],
            ),
            Err(e) => (
                ExitCode::RuntimeFailure,
                vec![issue(subcommand, west_launch_error(&e))],
            ),
        };
        let json = Envelope::new(subcommand, project, data, issues, exit.code()).to_json();
        CommandRun {
            exit,
            text: Vec::new(),
            json: Some(json),
        }
    } else {
        // Text mode: stream the build live (inherited stdio).
        let status = Command::new("west")
            .args(&argv)
            .current_dir(&west_cwd)
            .status();
        let (exit, line) = match status {
            Ok(s) if s.success() => (ExitCode::Success, format!("{subcommand}: complete.")),
            Ok(_) => (
                ExitCode::RuntimeFailure,
                format!("{subcommand}: `west {west_command}` failed (see log above)."),
            ),
            Err(e) => (
                ExitCode::RuntimeFailure,
                format!("{subcommand}: {}", west_launch_error(&e)),
            ),
        };
        CommandRun {
            exit,
            text: vec![line],
            json: None,
        }
    }
}

fn issue(subcommand: &str, message: String) -> Issue {
    Issue {
        code: format!("{subcommand}.failed"),
        severity: "error".to_string(),
        message,
    }
}

fn west_launch_error(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "west not found on PATH — run `alp bootstrap` and ensure west is on PATH.".to_string()
    } else {
        format!("failed to launch west: {e}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_args_after_the_west_command() {
        assert_eq!(
            west_argv(
                "build",
                &[
                    "examples/uart-echo".to_string(),
                    "--core".to_string(),
                    "m55_hp".to_string()
                ]
            ),
            vec!["alp-build", "examples/uart-echo", "--core", "m55_hp"]
        );
        assert_eq!(west_argv("image", &[]), vec!["alp-image"]);
        assert_eq!(
            west_argv("flash", &["--sequential".to_string()]),
            vec!["alp-flash", "--sequential"]
        );
    }
}
