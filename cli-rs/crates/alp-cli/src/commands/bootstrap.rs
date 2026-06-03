// SPDX-License-Identifier: Apache-2.0
//! `alp bootstrap` — set up the SDK's build environment.
//!
//! Orchestrates the SDK's own canonical `scripts/bootstrap.sh` (install west,
//! create the Zephyr workspace via `west init`/`west update`, install Zephyr's
//! Python requirements). The CLI does not reimplement the per-OS steps — the SDK
//! owns them. The compiler toolchains (Zephyr SDK, vendor SDKs) stay out of
//! scope; `doctor` detects + points to those.
//!
//! Text mode inherits stdio so the (long) install streams live in the caller's
//! terminal; JSON mode captures the run and emits a single envelope.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use super::CommandRun;
use crate::cli::{BootstrapArgs, GlobalArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

#[derive(Serialize)]
struct BootstrapData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "sdkRoot")]
    sdk_root: String,
    #[serde(rename = "scriptPath")]
    script_path: String,
    #[serde(rename = "noPip")]
    no_pip: bool,
    #[serde(rename = "noWest")]
    no_west: bool,
    #[serde(rename = "printEnv")]
    print_env: bool,
}

pub fn run(g: &GlobalArgs, args: &BootstrapArgs) -> CommandRun {
    // bootstrap.sh is POSIX-only; on native Windows point at WSL2 / the docs.
    if cfg!(windows) {
        return failure(
            g,
            ExitCode::RuntimeFailure,
            "windows-unsupported",
            "bootstrap.sh is POSIX-only. On Windows use WSL2 (Ubuntu) or follow the native steps in docs/cross-platform-setup.md §4.",
            empty_data(args),
            vec![
                "bootstrap: not supported on native Windows.".to_string(),
                "Use WSL2 (Ubuntu) or docs/cross-platform-setup.md §4.".to_string(),
            ],
        );
    }

    let context = resolve_cli_project_context(g);
    let Some(sdk_root) = context.sdk_root.clone() else {
        return failure(
            g,
            ExitCode::ValidationFailure,
            "sdk-root-unresolved",
            "alp-sdk root is unresolved. Use --sdk-root or run `alp sdk install <version>` first.",
            empty_data(args),
            vec!["bootstrap: alp-sdk root is unresolved.".to_string()],
        );
    };

    let script = Path::new(&sdk_root).join("scripts").join("bootstrap.sh");
    let script_str = script.to_string_lossy().to_string();
    if !script.exists() {
        return failure(
            g,
            ExitCode::RuntimeFailure,
            "script-missing",
            &format!("bootstrap.sh not found at {script_str}; is this a valid alp-sdk checkout?"),
            empty_data(args),
            vec![format!("bootstrap: {script_str} not found.")],
        );
    }

    let mut sh_args: Vec<String> = vec![script_str.clone()];
    if args.no_pip {
        sh_args.push("--no-pip".to_string());
    }
    if args.no_west {
        sh_args.push("--no-west".to_string());
    }
    if args.print_env {
        sh_args.push("--print-env".to_string());
    }

    let data = BootstrapData {
        schema_version: "1".to_string(),
        sdk_root: sdk_root.clone(),
        script_path: script_str.clone(),
        no_pip: args.no_pip,
        no_west: args.no_west,
        print_env: args.print_env,
    };
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    if g.is_json() {
        // Capture the run; emit exactly one envelope on stdout.
        let code = Command::new("bash")
            .args(&sh_args)
            .output()
            .ok()
            .and_then(|o| o.status.code());
        let (exit, issues) = match code {
            Some(0) => (ExitCode::Success, Vec::new()),
            _ => (
                ExitCode::RuntimeFailure,
                vec![Issue {
                    code: "bootstrap.failed".to_string(),
                    severity: "error".to_string(),
                    message: "bootstrap.sh reported a failure; re-run without --format json to see the log."
                        .to_string(),
                }],
            ),
        };
        let json = Envelope::new("bootstrap", project, data, issues, exit.code()).to_json();
        CommandRun {
            exit,
            text: Vec::new(),
            json: Some(json),
        }
    } else {
        // Text mode: stream the install live (inherited stdio).
        let status = Command::new("bash").args(&sh_args).status();
        let (exit, line) = match status {
            Ok(s) if s.success() => (ExitCode::Success, "bootstrap: complete.".to_string()),
            Ok(_) => (
                ExitCode::RuntimeFailure,
                "bootstrap: failed (see log above).".to_string(),
            ),
            Err(e) => (
                ExitCode::RuntimeFailure,
                format!("bootstrap: failed to launch bash: {e}"),
            ),
        };
        CommandRun {
            exit,
            text: vec![line],
            json: None,
        }
    }
}

fn empty_data(args: &BootstrapArgs) -> BootstrapData {
    BootstrapData {
        schema_version: "1".to_string(),
        sdk_root: String::new(),
        script_path: String::new(),
        no_pip: args.no_pip,
        no_west: args.no_west,
        print_env: args.print_env,
    }
}

fn failure(
    g: &GlobalArgs,
    exit: ExitCode,
    code: &str,
    message: &str,
    data: BootstrapData,
    text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("bootstrap.{code}"),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    // Failure paths report a null project (matches the other commands).
    let project = Project {
        root: None,
        board_yaml: None,
    };
    let text = if g.is_json() { Vec::new() } else { text_lines };
    let json = g
        .is_json()
        .then(|| Envelope::new("bootstrap", project, data, issues, exit.code()).to_json());
    CommandRun { exit, text, json }
}
