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

use serde::Serialize;

use super::CommandRun;
use crate::cli::GlobalArgs;
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
