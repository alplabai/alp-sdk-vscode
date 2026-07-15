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

use std::path::{Component, Path, PathBuf};
use std::process::Command;

use alp_core::ProjectContext;
use alp_core::build_plan::{BuildPlan, parse_build_plan, summarize_plan};
use alp_core::debug::{DoctorCheck, DoctorStatus};
use alp_core::preflight::{
    PreflightInput, build_preflight_checks, preflight_blocked, preflight_next_steps,
    preflight_summary,
};
use alp_core::system_manifest::{parse_system_manifest, summarize_manifest};
use serde::Serialize;

use super::CommandRun;
use crate::cli::{BuildArgs, GlobalArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

/// Envelope `data` for the `west`-delegating path: the `alp-*` command run, its
/// cwd, and the forwarded args.
#[derive(Serialize)]
struct BuildData {
    /// Envelope `data` schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// The `west alp-*` command invoked (e.g. `alp-build`).
    #[serde(rename = "westCommand")]
    west_command: String,
    /// Working directory the `west` command ran in.
    #[serde(rename = "westCwd")]
    west_cwd: String,
    /// Passthrough args forwarded verbatim after the subcommand.
    args: Vec<String>,
}

/// `alp build` entry. `--native` runs the CLI-native build (consume plan →
/// materialise → execute); `--plan` / `--materialise` consume + show/write the
/// plan; otherwise delegate to `west alp-build` (the Wave A2 behavior).
pub fn run_build(g: &GlobalArgs, args: &BuildArgs) -> CommandRun {
    if args.manifest || args.manifest_from.is_some() {
        manifest_command(g, args)
    } else if args.west {
        // Legacy escape hatch: delegate to `west alp-build` (needs alp-sdk as the
        // west manifest topdir). The default build no longer requires that.
        run(g, "build", &args.args)
    } else if args.plan || args.plan_from.is_some() || args.materialise {
        plan_command(g, args)
    } else {
        // Default (and `--native`): consume the SDK build-plan and run each slice's
        // command directly, so no `west alp-build` extension command is needed.
        native_build(g, args)
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

    // Order-independent pre-flight: in text mode, if a prerequisite is missing
    // (no SDK / board.yaml / workspace), show a colorful, actionable readiness
    // report and stop — instead of proceeding to a raw west/CMake error. JSON
    // mode keeps its stable envelope; the same errors surface from acquire_plan.
    if !g.is_json() {
        if let Some(blocked) = preflight_gate(g, &context) {
            return blocked;
        }
    }

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

/// Probe the build prerequisites (SDK / board.yaml / workspace / west) into the
/// pure `alp_core::preflight` checks. Shared by `alp build`'s pre-flight gate and
/// `alp doctor --build` so both speak the same readiness language.
pub(crate) fn probe_build_preflight(g: &GlobalArgs, context: &ProjectContext) -> Vec<DoctorCheck> {
    let base = base_dir(context);
    let sdk_root = crate::util::resolve_sdk_root(g, &crate::util::cli_workspace_root(g));
    let workspace = west_workspace_dir(&base, sdk_root.as_deref());
    let west = west_program(&base, sdk_root.as_deref());
    let west_available = if Path::new(&west).is_absolute() {
        Path::new(&west).exists()
    } else {
        crate::util::command_on_path(&west)
    };

    let input = PreflightInput {
        sdk_root: sdk_root
            .as_deref()
            .map(|p| p.to_string_lossy().into_owned()),
        board_yaml_present: context
            .board_yaml_path
            .as_deref()
            .is_some_and(|p| Path::new(p).exists()),
        workspace_dir: workspace
            .as_deref()
            .map(|p| p.to_string_lossy().into_owned()),
        west_available,
    };
    build_preflight_checks(&input)
}

/// Text-mode build pre-flight: run the shared checks and, if any block the build,
/// return a colorful readiness report to short-circuit with; `None` means all
/// clear — proceed.
fn preflight_gate(g: &GlobalArgs, context: &ProjectContext) -> Option<CommandRun> {
    let checks = probe_build_preflight(g, context);
    if !preflight_blocked(&checks) {
        return None;
    }
    let summary = preflight_summary(&checks);
    let steps = preflight_next_steps(&checks);
    let text = crate::style::render_report(g, "Build readiness", "", &checks, &summary, &steps);
    Some(CommandRun {
        exit: ExitCode::ValidationFailure,
        text,
        json: None,
    })
}

/// Per-slice outcome of a `--native` run, folded into the envelope.
#[derive(Serialize)]
struct SliceResult {
    /// The core this slice builds (e.g. `m55_hp`).
    #[serde(rename = "coreId")]
    core_id: String,
    /// Build backend for the slice (`zephyr` / `yocto` / `baremetal`).
    backend: String,
    /// Outcome: `"ok"`, `"failed"`, or `"skipped"` (no command).
    status: String, // "ok" | "failed" | "skipped"
    /// Process exit code, when the tool actually launched.
    #[serde(skip_serializing_if = "Option::is_none")]
    rc: Option<i32>,
}

/// Envelope `data` for a `--native` build: the base dir plus each slice result.
#[derive(Serialize)]
struct BuildRunData {
    /// Envelope `data` schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Project build-tree base the slices ran under.
    #[serde(rename = "baseDir")]
    base_dir: String,
    /// Outcome of each slice, in plan order.
    slices: Vec<SliceResult>,
}

/// Environment overrides that let `alp build` run a plan slice with no manual
/// setup: `ZEPHYR_BASE` (the resolved workspace's zephyr) and
/// `EXTRA_ZEPHYR_MODULES` (the alp-sdk checkout, so `west build -b <alp-board>`
/// finds the SDK's boards). Never overrides a key the plan's slice env pins.
fn zephyr_env_overrides(
    zephyr_base: Option<&Path>,
    sdk_root: Option<&Path>,
    slice_env: &std::collections::BTreeMap<String, String>,
) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    if !slice_env.contains_key("ZEPHYR_BASE") {
        if let Some(base) = zephyr_base {
            out.push(("ZEPHYR_BASE", base.to_string_lossy().into_owned()));
        }
    }
    if !slice_env.contains_key("EXTRA_ZEPHYR_MODULES") {
        if let Some(sdk) = sdk_root {
            out.push(("EXTRA_ZEPHYR_MODULES", sdk.to_string_lossy().into_owned()));
        }
    }
    out
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
    let sdk_root = crate::util::resolve_sdk_root(g, &crate::util::cli_workspace_root(g));
    // Auto-manage the build env so `alp build` needs no manual
    // `source .venv/activate` / `export ZEPHYR_BASE`: derive ZEPHYR_BASE from the
    // resolved workspace and pass the alp-sdk checkout as an extra Zephyr module,
    // so `west build -b <alp-board>` finds the SDK's boards without the user
    // wiring `-DEXTRA_ZEPHYR_MODULES`. The plan's per-slice env still wins.
    let zephyr_base = west_workspace_dir(base, sdk_root.as_deref())
        .map(|ws| ws.join("zephyr"))
        .filter(|z| z.is_dir());

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
            west_program(base, sdk_root.as_deref())
        } else {
            cmd.tool.clone()
        };
        let mut command = Command::new(&tool);
        command.args(&cmd.args).current_dir(&cwd).envs(&slice.env);
        for (key, value) in
            zephyr_env_overrides(zephyr_base.as_deref(), sdk_root.as_deref(), &slice.env)
        {
            command.env(key, value);
        }
        with_venv_on_path(&mut command, &tool);

        let (status, rc) = if text_mode {
            match command.status() {
                Ok(s) if s.success() => ("ok", s.code()),
                Ok(s) => ("failed", s.code()),
                Err(e) => {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        eprintln!(
                            "   {tool} not found on PATH — install it to build this {backend} slice"
                        );
                    } else {
                        eprintln!("   launch error: {e}");
                    }
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
        // Colorful per-slice recap: each slice as a check (ok / skipped / failed),
        // a colored summary line, and next-step hints when something failed.
        let checks: Vec<DoctorCheck> = results
            .iter()
            .map(|r| {
                let (status, detail) = match r.status.as_str() {
                    "ok" => (DoctorStatus::Pass, r.backend.clone()),
                    "skipped" => (DoctorStatus::Warn, format!("{} (no command)", r.backend)),
                    _ => (
                        DoctorStatus::Fail,
                        match r.rc {
                            Some(code) => format!("{} (rc={code})", r.backend),
                            None => format!("{} (did not run)", r.backend),
                        },
                    ),
                };
                DoctorCheck {
                    name: r.core_id.clone(),
                    status,
                    detail,
                    fix: None,
                }
            })
            .collect();
        let summary = preflight_summary(&checks);
        let next_steps = if summary.fail > 0 {
            vec![
                "see the streamed logs above for each failed slice".to_string(),
                "install any missing tool (west / bitbake) or fix the app's Zephyr CMakeLists"
                    .to_string(),
            ]
        } else {
            Vec::new()
        };
        let text = crate::style::render_report(g, "Build", "", &checks, &summary, &next_steps);
        CommandRun {
            exit,
            text,
            json: None,
        }
    }
}

/// Invoke the SDK's `alp_orchestrate.py --emit build-plan` and return its stdout
/// (deterministic, write-free JSON). The plan is the SDK's single source of
/// truth — we only run + parse it. Works against whatever SDK checkout is
/// resolved (`--sdk-root` / settings / bootstrap); the schema-version guard in
/// `parse_build_plan` rejects an incompatible emit.
/// Invoke the SDK's `alp_orchestrate --emit <emit>` (module form, scripts/ on
/// PYTHONPATH) for the project's board.yaml and return its stdout. `emit` is the
/// emit kind (`build-plan` /
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
            "no alp-sdk checkout found — pass `--sdk-root <PATH>`, pin one with \
             `alp sdk switch <version|path>`, set it in settings, or run `alp bootstrap`. The \
             {emit} comes from the SDK's `alp_orchestrate --emit {emit}`."
        ),
    ))?;
    let board_yaml = context.board_yaml_path.as_deref().ok_or((
        err_code,
        "no board.yaml found — pass `--board-yaml <PATH>` or run from a project.".to_string(),
    ))?;
    let scripts_dir = Path::new(sdk_root).join("scripts");
    // Invoke the planner as a module (`python -m alp_orchestrate`) with scripts/
    // on PYTHONPATH — the same way the SDK's own west_commands do. That resolves
    // both the modern package layout (scripts/alp_orchestrate/) and the legacy
    // flat module (scripts/alp_orchestrate.py), so the CLI works against any SDK
    // release. Gate on either being present so the error is clear.
    let has_planner = scripts_dir.join("alp_orchestrate.py").is_file()
        || scripts_dir
            .join("alp_orchestrate")
            .join("__init__.py")
            .is_file();
    if !has_planner {
        return Err((
            err_code,
            format!(
                "the SDK at `{sdk_root}` has no `alp_orchestrate` planner under scripts/ — pin \
                 to an SDK release that ships `--emit {emit}`."
            ),
        ));
    }
    // Prepend scripts/ to PYTHONPATH, preserving any value the caller set.
    let mut path_entries = vec![scripts_dir.clone()];
    if let Some(existing) = std::env::var_os("PYTHONPATH") {
        path_entries.extend(std::env::split_paths(&existing));
    }
    let pythonpath = std::env::join_paths(path_entries).map_err(|e| {
        (
            err_code,
            format!("failed to build PYTHONPATH for the SDK planner: {e}"),
        )
    })?;
    let output = Command::new(&context.python_binary)
        .args(["-m", "alp_orchestrate", "--input", board_yaml, "--emit", emit])
        .env("PYTHONPATH", &pythonpath)
        .output()
        .map_err(|e| {
            (
                err_code,
                format!(
                    "failed to run `{} -m alp_orchestrate --emit {emit}`: {e}",
                    context.python_binary
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

/// Render the acquired build plan without executing: JSON emits the plan in an
/// envelope; text emits `summarize_plan`.
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

/// Envelope `data` for a `--materialise` run: where files were written and which.
#[derive(Serialize)]
struct MaterialiseData {
    /// Envelope `data` schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Base dir the artefacts were written under.
    #[serde(rename = "baseDir")]
    base_dir: String,
    /// Relative paths of every artefact written.
    written: Vec<String>,
}

/// Build the success `CommandRun` after materialising: JSON envelope or a text
/// listing of the written files.
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

/// Build a failure `CommandRun` carrying a single `Issue` (`code`/`message`) at
/// the given `exit`: JSON emits a null-data envelope; text emits `build: <msg>`.
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

/// Failure modes of `materialise_plan`.
#[derive(Debug)]
enum MaterialiseError {
    /// Artefact path was absolute or contained `..` (rejected before writing).
    UnsafePath(String),
    /// I/O error while creating dirs or writing the artefact at this path.
    Io(String, std::io::Error),
}

impl MaterialiseError {
    /// Human-readable, single-line description of the failure for the envelope.
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

/// Resolve the `west` program to launch. Prefer a Python venv created by
/// `alp bootstrap` so builds use the hermetic west rather than a (possibly broken
/// or absent) global one, in this order:
///   1. a `.venv` in the project tree, searched from `start` upward;
///   2. the workspace venv derived from `$ZEPHYR_BASE` (`<ZEPHYR_BASE>/../.venv`),
///      so an activated-but-not-on-PATH workspace still resolves;
///   3. the SDK's canonical `<sdk-parent>/zephyrproject/.venv` — bootstrap.sh's
///      default `WORKSPACE_DIR` — so `alp --sdk-root <X> build` finds the
///      bootstrapped west WITHOUT the user activating the venv first.
/// Falls back to `"west"` on PATH when none resolve (CI, an activated venv, the
/// contract harness) — behaving exactly as before in those environments.
fn west_program(start: &str, sdk_root: Option<&Path>) -> String {
    let (sub, exe) = if cfg!(windows) {
        ("Scripts", "west.exe")
    } else {
        ("bin", "west")
    };
    let venv_west = |dir: &Path| dir.join(".venv").join(sub).join(exe);

    // 1. A `.venv` in the project tree.
    let mut dir = Some(Path::new(start));
    while let Some(d) = dir {
        let candidate = venv_west(d);
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
        dir = d.parent();
    }

    // 2. The workspace venv from $ZEPHYR_BASE (workspace = ZEPHYR_BASE/..).
    if let Ok(zephyr_base) = std::env::var("ZEPHYR_BASE") {
        if let Some(workspace) = Path::new(&zephyr_base).parent() {
            let candidate = venv_west(workspace);
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    // 3. The SDK workspace venv derived from `--sdk-root`. Post-alp-sdk#782 the
    //    workspace topdir is the SDK's parent (`west init -l <alp-sdk>`), so the
    //    venv is `<sdk-parent>/.venv`; older bootstraps used
    //    `<sdk-parent>/zephyrproject/.venv`. Check both.
    if let Some(parent) = sdk_root.and_then(|s| s.parent()) {
        for workspace in [parent.to_path_buf(), parent.join("zephyrproject")] {
            let candidate = venv_west(&workspace);
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    // 4. Fall back to `west` on PATH.
    "west".to_string()
}

/// Resolve the west workspace topdir — the directory holding `.west/`. `west alp-*`
/// are extension commands discovered *only* from a workspace manifest, so they must
/// be launched from inside the workspace, not the app dir. Checks: the project tree
/// upward (app inside a workspace), then `$ZEPHYR_BASE/..`, then the SDK-derived
/// layouts — `<sdk-parent>` (alp-sdk-manifest topdir, post-alp-sdk#782) and the
/// legacy `<sdk-parent>/zephyrproject`. `None` when no workspace is found (the
/// caller then keeps the pre-existing behavior of running in the app dir).
fn west_workspace_dir(start: &str, sdk_root: Option<&Path>) -> Option<PathBuf> {
    let is_workspace = |dir: &Path| dir.join(".west").is_dir();

    // 1. The project tree (if the app lives inside a workspace).
    let mut dir = Some(Path::new(start));
    while let Some(d) = dir {
        if is_workspace(d) {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    // 2. `$ZEPHYR_BASE/..` (the workspace topdir).
    if let Ok(zephyr_base) = std::env::var("ZEPHYR_BASE") {
        if let Some(workspace) = Path::new(&zephyr_base).parent() {
            if is_workspace(workspace) {
                return Some(workspace.to_path_buf());
            }
        }
    }
    // 3. SDK-derived layouts.
    if let Some(parent) = sdk_root.and_then(|s| s.parent()) {
        for workspace in [parent.to_path_buf(), parent.join("zephyrproject")] {
            if is_workspace(&workspace) {
                return Some(workspace);
            }
        }
    }
    None
}

/// When `tool` is a resolved venv `west` (an absolute path), prepend its
/// directory to `command`'s `PATH`. `west alp-*` spawns `alp_orchestrate`, which
/// spawns nested `west build`/`bitbake` that resolve `west` via PATH — without
/// this, they fail with "west not found in PATH" and silently skip the slice
/// unless the user activated the venv. A bare `"west"` (PATH fallback) is left as-is.
fn with_venv_on_path(command: &mut Command, tool: &str) {
    let bin = Path::new(tool);
    if !bin.is_absolute() {
        return;
    }
    let Some(dir) = bin.parent() else {
        return;
    };
    let existing = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![dir.to_path_buf()];
    paths.extend(std::env::split_paths(&existing));
    if let Ok(joined) = std::env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

/// `subcommand` is the bare alp verb (`build`/`image`/`flash`/`clean`/`renode`).
pub fn run(g: &GlobalArgs, subcommand: &str, passthrough: &[String]) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let west_cwd = context
        .west_cwd
        .clone()
        .or_else(|| context.workspace_root.clone())
        .unwrap_or_else(|| ".".to_string());

    let sdk_root = crate::util::resolve_sdk_root(g, &crate::util::cli_workspace_root(g));
    let west_bin = west_program(&west_cwd, sdk_root.as_deref());
    // `west alp-*` are extension commands discovered only from a workspace
    // manifest, so run them from the workspace topdir (holding `.west/`), not the
    // app dir. When a workspace resolves, pass the project dir as the `app_path`
    // positional the alp-* commands require — unless the caller already gave a
    // positional (e.g. `alp build <app>`). No workspace → keep the old app-dir cwd.
    let workspace = west_workspace_dir(&west_cwd, sdk_root.as_deref());
    let run_cwd = workspace
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| west_cwd.clone());
    let mut argv = west_argv(subcommand, passthrough);
    if workspace.is_some() && !passthrough.iter().any(|a| !a.starts_with('-')) {
        let app = std::fs::canonicalize(&west_cwd)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| west_cwd.clone());
        argv.insert(1, app);
    }
    let west_command = argv[0].clone();
    let data = BuildData {
        schema_version: "1".to_string(),
        west_command: west_command.clone(),
        west_cwd: run_cwd.clone(),
        args: passthrough.to_vec(),
    };
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    if g.is_json() {
        let mut cmd = Command::new(&west_bin);
        cmd.args(&argv).current_dir(&run_cwd);
        with_venv_on_path(&mut cmd, &west_bin);
        let result = cmd.output();
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
        let mut cmd = Command::new(&west_bin);
        cmd.args(&argv).current_dir(&run_cwd);
        with_venv_on_path(&mut cmd, &west_bin);
        let status = cmd.status();
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

/// Build an `error`-severity envelope `Issue` with code `<subcommand>.failed`.
fn issue(subcommand: &str, message: String) -> Issue {
    Issue {
        code: format!("{subcommand}.failed"),
        severity: "error".to_string(),
        message,
    }
}

/// Map a `west` launch I/O error to a user-facing message — special-casing
/// `NotFound` with a bootstrap/PATH hint.
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

    fn slice_env(pairs: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn env_overrides_set_base_and_modules_when_absent() {
        let got = zephyr_env_overrides(
            Some(Path::new("/ws/zephyr")),
            Some(Path::new("/sdk")),
            &slice_env(&[("ALP_SDK_ROOT", "/sdk")]),
        );
        assert_eq!(
            got,
            vec![
                ("ZEPHYR_BASE", "/ws/zephyr".to_string()),
                ("EXTRA_ZEPHYR_MODULES", "/sdk".to_string()),
            ]
        );
    }

    #[test]
    fn env_overrides_respect_plan_pinned_keys() {
        // The plan already pins both -> nothing is overridden.
        let got = zephyr_env_overrides(
            Some(Path::new("/ws/zephyr")),
            Some(Path::new("/sdk")),
            &slice_env(&[
                ("ZEPHYR_BASE", "/pinned"),
                ("EXTRA_ZEPHYR_MODULES", "/pinned-mod"),
            ]),
        );
        assert!(got.is_empty());
    }

    #[test]
    fn env_overrides_empty_when_nothing_resolved() {
        assert!(zephyr_env_overrides(None, None, &slice_env(&[])).is_empty());
    }

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

#[cfg(test)]
mod west_program_tests {
    use super::{west_program, west_workspace_dir};

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("alp-westp-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn venv_parts() -> (&'static str, &'static str) {
        if cfg!(windows) {
            ("Scripts", "west.exe")
        } else {
            ("bin", "west")
        }
    }

    #[test]
    fn finds_project_tree_venv_searching_upward() {
        let root = tmp("proj");
        let (sub, exe) = venv_parts();
        let venv_bin = root.join(".venv").join(sub);
        std::fs::create_dir_all(&venv_bin).unwrap();
        let west = venv_bin.join(exe);
        std::fs::write(&west, "").unwrap();
        let cwd = root.join("a").join("b");
        std::fs::create_dir_all(&cwd).unwrap();

        // No sdk_root needed — the project-tree venv is found by the upward walk.
        assert_eq!(
            west_program(&cwd.to_string_lossy(), None),
            west.to_string_lossy()
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolves_bootstrap_workspace_from_sdk_root() {
        // Step 2 ($ZEPHYR_BASE) is checked before the sdk-root default; skip when
        // an activated env would take precedence so the assertion stays deterministic.
        if std::env::var_os("ZEPHYR_BASE").is_some() {
            return;
        }
        let root = tmp("sdk");
        let (sub, exe) = venv_parts();
        let sdk = root.join("sdk-root");
        std::fs::create_dir_all(&sdk).unwrap();
        // Canonical bootstrap layout: <sdk-parent>/zephyrproject/.venv/<sub>/west.
        let venv_bin = root.join("zephyrproject").join(".venv").join(sub);
        std::fs::create_dir_all(&venv_bin).unwrap();
        let west = venv_bin.join(exe);
        std::fs::write(&west, "").unwrap();
        // A cwd with no project-tree venv above it.
        let cwd = root.join("elsewhere");
        std::fs::create_dir_all(&cwd).unwrap();

        assert_eq!(
            west_program(&cwd.to_string_lossy(), Some(sdk.as_path())),
            west.to_string_lossy()
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn falls_back_to_path_west_when_nothing_resolves() {
        let root = tmp("none");
        std::fs::create_dir_all(&root).unwrap();
        // Only assert the no-signal default when no ambient $ZEPHYR_BASE could win.
        if std::env::var_os("ZEPHYR_BASE").is_none() {
            assert_eq!(west_program(&root.to_string_lossy(), None), "west");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn workspace_dir_resolves_topdir_from_sdk_root() {
        // Step 2 ($ZEPHYR_BASE) precedes the sdk-root layouts; skip when set.
        if std::env::var_os("ZEPHYR_BASE").is_some() {
            return;
        }
        let root = tmp("ws");
        // alp-sdk#782 layout: workspace topdir = the SDK checkout's parent.
        let workspace = root.join("workspace");
        let sdk = workspace.join("alp-sdk");
        std::fs::create_dir_all(&sdk).unwrap();
        std::fs::create_dir_all(workspace.join(".west")).unwrap();
        let cwd = root.join("external-app"); // not inside any workspace
        std::fs::create_dir_all(&cwd).unwrap();

        assert_eq!(
            west_workspace_dir(&cwd.to_string_lossy(), Some(sdk.as_path())),
            Some(workspace)
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
}
