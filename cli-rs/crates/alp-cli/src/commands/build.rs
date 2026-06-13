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

use alp_core::ProjectContext;
use alp_core::build_plan::{BuildPlan, parse_build_plan, summarize_plan};
use alp_core::system_manifest::{parse_system_manifest, summarize_manifest};
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

/// `alp build` entry. `--native` runs the CLI-native build (consume plan →
/// materialise → execute); `--plan` / `--materialise` consume + show/write the
/// plan; otherwise delegate to `west alp-build` (the Wave A2 behavior).
pub fn run_build(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    if args.manifest || args.manifest_from.is_some() {
        manifest_command(g, args)
    } else if args.native {
        native_build(g, args)
    } else if args.plan || args.plan_from.is_some() || args.materialise {
        plan_command(g, args)
    } else {
        run(g, "build", &args.args)
    }
}

/// `alp build --manifest [--manifest-from FILE]` — the post-build IDE/tool
/// contract (`build/system-manifest.yaml`). With `--manifest-from` we read a
/// local manifest (e.g. one `west alp-build` already wrote); otherwise we ask
/// the SDK for the projection (`alp_orchestrate.py --emit system-manifest`,
/// status: pending). Either way we parse + version-guard it and emit the
/// manifest in the envelope (the IDE reads this instead of shelling python).
fn manifest_command(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let yaml = match &args.manifest_from {
        Some(path) => match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                return plan_error_run(
                    g,
                    project,
                    "build.manifest-unavailable",
                    format!("failed to read manifest file `{path}`: {e}"),
                    ExitCode::RuntimeFailure,
                );
            }
        },
        None => match invoke_sdk_emit(&context, "system-manifest", "build.manifest-unavailable") {
            Ok(s) => s,
            Err((code, message)) => {
                return plan_error_run(g, project, code, message, ExitCode::RuntimeFailure);
            }
        },
    };

    match parse_system_manifest(&yaml) {
        Ok(manifest) => {
            if g.is_json() {
                let json =
                    Envelope::new("build", project, &manifest, Vec::new(), ExitCode::Success.code())
                        .to_json();
                CommandRun {
                    exit: ExitCode::Success,
                    text: Vec::new(),
                    json: Some(json),
                }
            } else {
                CommandRun {
                    exit: ExitCode::Success,
                    text: summarize_manifest(&manifest),
                    json: None,
                }
            }
        }
        Err(e) => plan_error_run(
            g,
            project,
            "build.manifest-invalid",
            e.to_string(),
            ExitCode::RuntimeFailure,
        ),
    }
}

/// The project build tree base (where `build/<core>-<os>/` lives) — the same
/// place `west alp-build` would run.
fn base_dir(context: &ProjectContext) -> String {
    context
        .west_cwd
        .clone()
        .or_else(|| context.workspace_root.clone())
        .unwrap_or_else(|| ".".to_string())
}

/// Acquire + parse the build plan: from `--plan-from <FILE>` if given, else by
/// invoking the SDK's `--emit build-plan` (ADR 0014). Schema-version guarded.
fn acquire_plan(
    context: &ProjectContext,
    args: &BuildArgs,
) -> Result<BuildPlan, (&'static str, String)> {
    let json = match &args.plan_from {
        Some(path) => std::fs::read_to_string(path).map_err(|e| {
            (
                "build.plan-unavailable",
                format!("failed to read plan file `{path}`: {e}"),
            )
        })?,
        None => invoke_sdk_emit(context, "build-plan", "build.plan-unavailable")?,
    };
    parse_build_plan(&json).map_err(|e| ("build.plan-invalid", e.to_string()))
}

/// `alp build --plan [--plan-from FILE] [--materialise]` — consume the build
/// plan (the SDK's single source of truth; the CLI only deserializes it), then
/// either show it or materialise its files. No execution.
fn plan_command(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let plan = match acquire_plan(&context, args) {
        Ok(plan) => plan,
        Err((code, message)) => {
            return plan_error_run(g, project, code, message, ExitCode::RuntimeFailure);
        }
    };

    if !args.materialise {
        return show_plan_run(g, project, &plan);
    }

    let base = base_dir(&context);
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

/// `alp build --native` — consume the plan, materialise its files, then run each
/// slice's command sequentially. (Per ADR 0014 the conf→build wiring "C4" is
/// still settling on the SDK side; we run whatever command the emit gives, so a
/// build before C4 lands may not yet apply the per-slice config.)
fn native_build(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let plan = match acquire_plan(&context, args) {
        Ok(plan) => plan,
        Err((code, message)) => {
            return plan_error_run(g, project, code, message, ExitCode::RuntimeFailure);
        }
    };

    let base = base_dir(&context);
    if let Err(e) = materialise_plan(&plan, Path::new(&base)) {
        return plan_error_run(
            g,
            project,
            "build.materialise-failed",
            e.message(),
            ExitCode::WriteFailure,
        );
    }

    execute_slices(g, project, &plan, &base)
}

#[derive(Serialize)]
struct SliceResult {
    #[serde(rename = "coreId")]
    core_id: String,
    backend: String,
    status: String, // "ok" | "failed" | "skipped"
    #[serde(skip_serializing_if = "Option::is_none")]
    rc: Option<i32>,
}

#[derive(Serialize)]
struct BuildRunData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "baseDir")]
    base_dir: String,
    slices: Vec<SliceResult>,
}

/// Run each slice's `ToolStep` sequentially under `base`. Text mode streams each
/// build live (inherited stdio) with per-slice headers; JSON mode captures and
/// folds per-slice results into the envelope. Commandless slices are skipped.
/// Runs all slices (does not abort early) and exits non-zero if any failed.
fn execute_slices(g: &GlobalArgs, project: Project, plan: &BuildPlan, base: &str) -> CommandRun {
    let base_path = Path::new(base);
    let text_mode = !g.is_json();
    let mut results: Vec<SliceResult> = Vec::new();
    let mut any_failed = false;

    for slice in &plan.slices {
        let backend = slice.backend.as_str().to_string();
        let Some(cmd) = &slice.command else {
            if text_mode {
                eprintln!("→ {} [{}]: (no command — skipped)", slice.core_id, backend);
            }
            results.push(SliceResult {
                core_id: slice.core_id.clone(),
                backend,
                status: "skipped".to_string(),
                rc: None,
            });
            continue;
        };

        if text_mode {
            eprintln!("→ {} [{}]: {}", slice.core_id, backend, cmd.display());
        }
        let cwd = base_path.join(&cmd.cwd);
        // The build dir must exist before the tool runs (west/cmake build there).
        if let Err(e) = std::fs::create_dir_all(&cwd) {
            if text_mode {
                eprintln!("   [failed] cannot create build dir {}: {e}", cwd.display());
            }
            any_failed = true;
            results.push(SliceResult {
                core_id: slice.core_id.clone(),
                backend,
                status: "failed".to_string(),
                rc: None,
            });
            continue;
        }
        let tool = if cmd.tool == "west" {
            west_program(base)
        } else {
            cmd.tool.clone()
        };
        let mut command = Command::new(&tool);
        command.args(&cmd.args).current_dir(&cwd).envs(&slice.env);

        let (status, rc) = if text_mode {
            match command.status() {
                Ok(s) if s.success() => ("ok", s.code()),
                Ok(s) => ("failed", s.code()),
                Err(e) => {
                    eprintln!("   launch error: {e}");
                    ("failed", None)
                }
            }
        } else {
            match command.output() {
                Ok(o) if o.status.success() => ("ok", o.status.code()),
                Ok(o) => ("failed", o.status.code()),
                Err(_) => ("failed", None),
            }
        };
        if status == "failed" {
            any_failed = true;
        }
        if text_mode {
            let rc_note = rc.map(|c| format!(" (rc={c})")).unwrap_or_default();
            eprintln!("   [{status}]{rc_note}");
        }
        results.push(SliceResult {
            core_id: slice.core_id.clone(),
            backend,
            status: status.to_string(),
            rc,
        });
    }

    let exit = if any_failed {
        ExitCode::RuntimeFailure
    } else {
        ExitCode::Success
    };

    if g.is_json() {
        let issues = if any_failed {
            vec![Issue {
                code: "build.slice-failed".to_string(),
                severity: "error".to_string(),
                message: "one or more slices failed to build".to_string(),
            }]
        } else {
            Vec::new()
        };
        let data = BuildRunData {
            schema_version: "1".to_string(),
            base_dir: base.to_string(),
            slices: results,
        };
        let json = Envelope::new("build", project, data, issues, exit.code()).to_json();
        CommandRun {
            exit,
            text: Vec::new(),
            json: Some(json),
        }
    } else {
        let ok = results.iter().filter(|r| r.status == "ok").count();
        let failed = results.iter().filter(|r| r.status == "failed").count();
        let skipped = results.iter().filter(|r| r.status == "skipped").count();
        CommandRun {
            exit,
            text: vec![format!(
                "build: {ok} ok, {failed} failed, {skipped} skipped"
            )],
            json: None,
        }
    }
}

/// Invoke the SDK's `alp_orchestrate.py --emit build-plan` and return its stdout
/// (deterministic, write-free JSON). The plan is the SDK's single source of
/// truth — we only run + parse it. Works against whatever SDK checkout is
/// resolved (`--sdk-root` / settings / bootstrap); the schema-version guard in
/// `parse_build_plan` rejects an incompatible emit.
/// Invoke the SDK's `alp_orchestrate.py --emit <emit>` for the project's
/// board.yaml and return its stdout. `emit` is the emit kind (`build-plan` /
/// `system-manifest`); `err_code` is the envelope issue code used for every
/// failure on this path so each caller keeps its own stable code.
fn invoke_sdk_emit(
    context: &ProjectContext,
    emit: &str,
    err_code: &'static str,
) -> Result<String, (&'static str, String)> {
    let sdk_root = context.sdk_root.as_deref().ok_or((
        err_code,
        format!(
            "no alp-sdk checkout found — pass `--sdk-root <PATH>`, set it in settings, or run \
             `alp bootstrap`. The {emit} comes from the SDK's `alp_orchestrate.py --emit {emit}`."
        ),
    ))?;
    let board_yaml = context.board_yaml_path.as_deref().ok_or((
        err_code,
        "no board.yaml found — pass `--board-yaml <PATH>` or run from a project.".to_string(),
    ))?;
    let script = Path::new(sdk_root)
        .join("scripts")
        .join("alp_orchestrate.py");
    if !script.is_file() {
        return Err((
            err_code,
            format!(
                "the SDK at `{sdk_root}` has no `scripts/alp_orchestrate.py` — pin to an SDK \
                 release that ships `--emit {emit}`."
            ),
        ));
    }
    let output = Command::new(&context.python_binary)
        .arg(&script)
        .args(["--input", board_yaml, "--emit", emit])
        .output()
        .map_err(|e| {
            (
                err_code,
                format!(
                    "failed to run `{} {}`: {e}",
                    context.python_binary,
                    script.display()
                ),
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr = stderr.trim();
        return Err((
            err_code,
            format!(
                "the SDK {emit} emit failed (rc {}){}",
                output.status.code().unwrap_or(-1),
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                }
            ),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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

/// Resolve the `west` program to launch. Prefer a workspace Python venv created
/// by `alp bootstrap` (`<dir>/.venv/bin/west`, searched from `start` upward) so
/// builds use the hermetic west rather than a (possibly broken) global one.
/// Falls back to `"west"` on PATH when no venv is found — so environments with
/// no venv (CI, the contract harness) behave exactly as before.
fn west_program(start: &str) -> String {
    let (sub, exe) = if cfg!(windows) {
        ("Scripts", "west.exe")
    } else {
        ("bin", "west")
    };
    let mut dir = Some(Path::new(start));
    while let Some(d) = dir {
        let candidate = d.join(".venv").join(sub).join(exe);
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
        dir = d.parent();
    }
    "west".to_string()
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
    let west_bin = west_program(&west_cwd);
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
        let result = Command::new(&west_bin)
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
        let status = Command::new(&west_bin)
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

    #[test]
    fn native_execute_runs_commands_skips_commandless_and_reports() {
        use clap::Parser;
        // A real GlobalArgs in JSON mode (captures output, no stderr noise).
        let g = crate::cli::Cli::parse_from(["alp", "--format", "json", "validate"]).global;

        // A portable success command on every CI platform.
        let (tool, args) = if cfg!(windows) {
            ("cmd", r#"["/C", "exit", "0"]"#)
        } else {
            ("true", "[]")
        };
        let json = format!(
            r#"{{
              "schemaVersion": 1, "boardYaml": "b", "sku": "S", "buildRoot": "build",
              "slices": [
                {{ "coreId": "c1", "backend": "zephyr", "buildDir": "build/c1",
                   "command": {{ "tool": "{tool}", "args": {args}, "cwd": "build/c1" }} }},
                {{ "coreId": "c2", "backend": "zephyr", "buildDir": "build/c2", "command": null }}
              ],
              "sharedArtefacts": []
            }}"#
        );
        let plan = parse_build_plan(&json).unwrap();
        let base = unique_temp_dir("alp-exec");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let project = Project {
            root: None,
            board_yaml: None,
        };
        let run = execute_slices(&g, project, &plan, base.to_str().unwrap());
        assert_eq!(run.exit.code(), 0);

        let env: serde_json::Value = serde_json::from_str(run.json.as_deref().unwrap()).unwrap();
        assert_eq!(env["ok"], true);
        let slices = env["data"]["slices"].as_array().unwrap();
        assert_eq!(slices.len(), 2);
        assert_eq!(slices[0]["status"], "ok");
        assert_eq!(slices[1]["status"], "skipped");
        // The build dir for the runnable slice was created.
        assert!(base.join("build/c1").is_dir());

        std::fs::remove_dir_all(&base).ok();
    }
}
