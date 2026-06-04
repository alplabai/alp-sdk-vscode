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

use std::path::{Component, Path};
use std::process::Command;

use alp_core::build_plan::{BuildPlan, parse_build_plan, summarize_plan};
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

/// `alp build` entry: `--plan` / `--materialise` consume the SDK's emitted build
/// plan; otherwise delegate to `west alp-build` (the Wave A2 behavior).
pub fn run_build(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    if args.plan || args.plan_from.is_some() || args.materialise {
        plan_command(g, args)
    } else {
        run(g, "build", &args.args)
    }
}

/// `alp build --plan [--plan-from FILE] [--materialise]` — consume the build
/// plan (the SDK's single source of truth; the CLI only deserializes it), then
/// either show it or materialise its files. No execution yet (Wave C0 / C1-prep).
fn plan_command(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
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
            "live build-plan emit is not wired yet — the SDK's \
             `alp_orchestrate.py --emit build-plan` exists (ADR 0014) but is not \
             yet in a tagged SDK release we pin to. Pass `--plan-from <FILE>` to \
             consume an emitted plan JSON (see docs/BUILD_ORCHESTRATION.md)."
                .to_string(),
        )),
    };

    let plan = match source
        .and_then(|json| parse_build_plan(&json).map_err(|e| ("build.plan-invalid", e.to_string())))
    {
        Ok(plan) => plan,
        Err((code, message)) => {
            return plan_error_run(g, project, code, message, ExitCode::RuntimeFailure);
        }
    };

    if !args.materialise {
        return show_plan_run(g, project, &plan);
    }

    // Materialise: byte-write the plan's files under the project's build tree
    // (the same place `west alp-build` would run).
    let base = context
        .west_cwd
        .clone()
        .or_else(|| context.workspace_root.clone())
        .unwrap_or_else(|| ".".to_string());
    match materialise_plan(&plan, Path::new(&base)) {
        Ok(written) => materialise_ok_run(g, project, &base, written),
        Err(e) => plan_error_run(
            g,
            project,
            "build.materialise-failed",
            e.message(),
            ExitCode::WriteFailure,
        ),
    }
}

fn show_plan_run(g: &GlobalArgs, project: Project, plan: &BuildPlan) -> CommandRun {
    if g.is_json() {
        let json =
            Envelope::new("build", project, plan, Vec::new(), ExitCode::Success.code()).to_json();
        CommandRun {
            exit: ExitCode::Success,
            text: Vec::new(),
            json: Some(json),
        }
    } else {
        CommandRun {
            exit: ExitCode::Success,
            text: summarize_plan(plan),
            json: None,
        }
    }
}

#[derive(Serialize)]
struct MaterialiseData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "baseDir")]
    base_dir: String,
    written: Vec<String>,
}

fn materialise_ok_run(
    g: &GlobalArgs,
    project: Project,
    base: &str,
    written: Vec<String>,
) -> CommandRun {
    if g.is_json() {
        let data = MaterialiseData {
            schema_version: "1".to_string(),
            base_dir: base.to_string(),
            written: written.clone(),
        };
        let json =
            Envelope::new("build", project, data, Vec::new(), ExitCode::Success.code()).to_json();
        CommandRun {
            exit: ExitCode::Success,
            text: Vec::new(),
            json: Some(json),
        }
    } else {
        let mut text = vec![format!(
            "materialised {} file(s) under {}:",
            written.len(),
            base
        )];
        text.extend(written.into_iter().map(|p| format!("  {p}")));
        CommandRun {
            exit: ExitCode::Success,
            text,
            json: None,
        }
    }
}

fn plan_error_run(
    g: &GlobalArgs,
    project: Project,
    code: &str,
    message: String,
    exit: ExitCode,
) -> CommandRun {
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

/// Write every artefact the plan carries under `base`. Idempotent byte-writes;
/// refuses absolute or `..`-escaping artefact paths (defensive — we only write
/// inside the project's build tree). The SDK guarantees these contents match
/// what `west alp-build` would write, so materialising cannot drift.
fn materialise_plan(plan: &BuildPlan, base: &Path) -> Result<Vec<String>, MaterialiseError> {
    let mut written = Vec::new();
    for f in plan.all_artefacts() {
        let rel = Path::new(&f.path);
        if rel.is_absolute() || rel.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(MaterialiseError::UnsafePath(f.path.clone()));
        }
        let dest = base.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| MaterialiseError::Io(f.path.clone(), e))?;
        }
        std::fs::write(&dest, &f.contents).map_err(|e| MaterialiseError::Io(f.path.clone(), e))?;
        written.push(f.path.clone());
    }
    Ok(written)
}

#[derive(Debug)]
enum MaterialiseError {
    UnsafePath(String),
    Io(String, std::io::Error),
}

impl MaterialiseError {
    fn message(&self) -> String {
        match self {
            MaterialiseError::UnsafePath(p) => {
                format!("refusing to write unsafe artefact path `{p}` (absolute or contains `..`)")
            }
            MaterialiseError::Io(p, e) => format!("failed to write `{p}`: {e}"),
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

    const SAMPLE_PLAN: &str = r#"{
      "schemaVersion": 1,
      "boardYaml": "/p/board.yaml",
      "sku": "E1M-AEN701",
      "buildRoot": "build",
      "slices": [
        { "coreId": "m55_hp", "backend": "zephyr", "buildDir": "build/m55_hp-zephyr",
          "configArtefacts": [{ "path": "build/m55_hp-zephyr/alp.conf", "contents": "CONFIG_GPIO=y\n" }],
          "command": { "tool": "west", "args": ["build"], "cwd": "build/m55_hp-zephyr" } }
      ],
      "sharedArtefacts": [{ "path": "build/generated/alp/system_ipc.h", "contents": "/* ipc */\n" }]
    }"#;

    fn unique_temp_dir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("{tag}-{}", std::process::id()))
    }

    #[test]
    fn materialise_writes_all_artefacts_and_creates_dirs() {
        let plan = parse_build_plan(SAMPLE_PLAN).unwrap();
        let base = unique_temp_dir("alp-mat-ok");
        let _ = std::fs::remove_dir_all(&base);

        let written = materialise_plan(&plan, &base).expect("materialise should succeed");
        assert_eq!(written.len(), plan.all_artefacts().len());

        // Nested parent dirs were created, and contents byte-match the plan.
        let shared = base.join("build/generated/alp/system_ipc.h");
        assert_eq!(std::fs::read_to_string(&shared).unwrap(), "/* ipc */\n");
        let conf = base.join("build/m55_hp-zephyr/alp.conf");
        assert_eq!(std::fs::read_to_string(&conf).unwrap(), "CONFIG_GPIO=y\n");

        // Idempotent: a second write succeeds (byte-overwrite).
        materialise_plan(&plan, &base).expect("re-materialise should succeed");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn materialise_refuses_path_traversal() {
        let json = r#"{
          "schemaVersion": 1, "boardYaml": "b", "sku": "S", "buildRoot": "build",
          "slices": [],
          "sharedArtefacts": [{ "path": "../escape.txt", "contents": "x" }]
        }"#;
        let plan = parse_build_plan(json).unwrap();
        let base = unique_temp_dir("alp-mat-unsafe");
        let _ = std::fs::remove_dir_all(&base);

        let err = materialise_plan(&plan, &base).expect_err("must refuse `..`");
        assert!(err.message().contains("unsafe"), "got: {}", err.message());
        // Nothing escaped above base.
        assert!(!base.join("../escape.txt").exists());

        std::fs::remove_dir_all(&base).ok();
    }
}
