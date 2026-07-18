// SPDX-License-Identifier: Apache-2.0
//! `alp run` — build the current project, then either execute it locally
//! (default: `native_sim`) or flash it to real hardware (`--flash` only).
//!
//! Mirrors the SDK's `alp run` (`scripts/alp_cli/run.py:31-38`) at the verb
//! level: it flashes ONLY on explicit `--flash`; `--board` alone builds and
//! returns 0. The SDK script's own build step is a legacy single-image `west
//! build -b <board>` shim (shared with its `alp build --board`); this CLI's
//! build model has already moved on to the orchestrated, board.yaml-driven
//! plan that `alp build`'s default path consumes (see `commands::build`).
//! `run` reuses THAT engine — the native build (`build::run_build`) and the
//! existing west-forward flash path (`build::run(.., "flash", ..)`) — rather
//! than re-deriving either. Because of that reuse, a bare `--board <hw>`
//! CANNOT steer this CLI's build differently (board.yaml/the system manifest
//! already names the target, not this flag's value) — so it is refused
//! outright unless paired with `--flash`, rather than silently arming a flash
//! (the old foot-gun: any real `--board` value used to flash whatever probe
//! was attached) or silently ignoring the flag to run `native_sim` anyway.
//! `--board native_sim` is treated the same as no `--board` at all.

use std::path::{Path, PathBuf};
use std::process::Command;

use alp_core::ProjectContext;
use serde_json::{Value, json};

use super::CommandRun;
use crate::cli::{BuildArgs, GlobalArgs, RunArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

use super::build;

/// The literal binary Zephyr's `native_sim` target produces — a fixed name on
/// every host OS (it's Zephyr's own native-target naming, not a Windows
/// suffix), matching the SDK script's `build / "zephyr" / "zephyr.exe"`.
const NATIVE_SIM_EXE: &str = "zephyr.exe";

/// Candidate build-dir names a `native_sim` core's output could land under,
/// checked in order: the SDK script's single-image layout, then the shape a
/// `native_sim` core would get from this CLI's per-slice build-plan naming
/// (`<core_id>-<backend>`).
const NATIVE_SIM_BUILD_DIRS: [&str; 2] = ["native_sim", "native_sim-zephyr"];

/// `alp run` entry point.
pub fn run(g: &GlobalArgs, args: &RunArgs) -> CommandRun {
    let is_real_board = args
        .board
        .as_deref()
        .map(str::trim)
        .is_some_and(|b| !b.is_empty() && b != "native_sim");

    // A real `--board` with no `--flash` can't be honored safely or usefully:
    // this CLI can't build differently for it (see the module doc), so
    // silently running native_sim would ignore the value the caller gave, and
    // silently flashing it (the pre-fix behavior) would arm `west alp-flash`
    // against whatever probe happens to be attached. Refuse outright instead.
    if is_real_board && !args.flash {
        return board_without_flash_guard(g);
    }

    // Build via the same engine `alp build` uses by default (native,
    // board.yaml-driven plan) — never duplicated here.
    let build_args = BuildArgs {
        plan: false,
        plan_from: None,
        materialise: false,
        native: true,
        manifest: false,
        manifest_from: None,
        west: false,
        args: Vec::new(),
    };
    let built = build::run_build(g, &build_args);
    if built.exit.code() != ExitCode::Success.code() {
        return retag(built, "run");
    }

    if args.flash {
        // Reuse the existing west-forward flash path verbatim; only the
        // caller's own trailing args are forwarded (`west alp-flash` has no
        // board selector — the system manifest already names the hardware).
        return retag(build::run(g, "flash", &args.args), "run");
    }

    exec_native_sim(g, built)
}

/// `run.board-without-flash` validation guard (exit 2): a real `--board` with
/// no `--flash` is refused before any build runs — see the module doc for
/// why. Never spawns anything; JSON mode gets the standard envelope, text
/// mode a single explanatory line.
fn board_without_flash_guard(g: &GlobalArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };
    let message = "`--board` programs hardware; pass `--flash` to confirm, or drop `--board` to \
                   run under native_sim."
        .to_string();
    let issues = vec![Issue {
        code: "run.board-without-flash".to_string(),
        severity: "error".to_string(),
        message: message.clone(),
    }];
    let text = if g.is_json() {
        Vec::new()
    } else {
        vec![format!("run: {message}")]
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "run",
            project,
            serde_json::Value::Null,
            issues,
            ExitCode::ValidationFailure.code(),
        )
        .to_json()
    });

    CommandRun {
        exit: ExitCode::ValidationFailure,
        text,
        json,
    }
}

/// After a successful build, look for the `native_sim` binary and execute it
/// — text mode streams it live (inherited stdio), since a `native_sim` image
/// runs indefinitely (it's a live device-simulator loop, not a batch job).
/// JSON mode never executes it: capturing output would mean waiting forever
/// on a process that never closes stdout, which would hang `alp --format json
/// run` and break the one-envelope-per-invocation contract. JSON mode instead
/// reports the skip via `data.exec.executed: false` — run in text mode to
/// actually execute. No binary found (the project declares no `native_sim`
/// core) is not a failure either way: the build already succeeded, so `run`
/// reports that result unchanged — mirrors the SDK note that `native_sim` is
/// a single-image target, not guaranteed by every board.yaml.
fn exec_native_sim(g: &GlobalArgs, built: CommandRun) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let base = PathBuf::from(base_dir(&context));
    let Some(exe) = find_native_sim_exe(&base) else {
        let mut run = retag(built, "run");
        if !g.is_json() {
            run.text.push(format!(
                "run: no native_sim binary found under {} — nothing to execute.",
                base.display()
            ));
        }
        return run;
    };

    if g.is_json() {
        return skip_exec_result(built, &exe);
    }

    eprintln!("run: executing {}", exe.display());
    let (ok, rc) = match Command::new(&exe).status() {
        Ok(s) => (s.success(), s.code()),
        Err(e) => {
            eprintln!("run: failed to launch {}: {e}", exe.display());
            (false, None)
        }
    };

    let exit = if ok {
        ExitCode::Success
    } else {
        ExitCode::RuntimeFailure
    };
    with_exec_result(built, exit, &exe, ok, rc)
}

/// The `data.exec` skip reason JSON mode reports when a `native_sim` binary
/// was found but not executed (see `exec_native_sim`).
const NATIVE_SIM_JSON_SKIP_REASON: &str =
    "native_sim exec skipped in --format json (run in text mode to execute)";

/// JSON-mode outcome when a `native_sim` binary WAS found: re-tag the build's
/// own (already-successful) envelope as `run` and nest
/// `{executed:false, reason, binary}` under `data.exec` — the exit code stays
/// the build's own `Success`, since this is a deliberate skip, not a failure.
fn skip_exec_result(built: CommandRun, exe: &Path) -> CommandRun {
    let mut run = retag(built, "run");
    run.json = run.json.map(|j| match serde_json::from_str::<Value>(&j) {
        Ok(mut v) => {
            if let Some(data) = v
                .as_object_mut()
                .and_then(|obj| obj.get_mut("data"))
                .and_then(Value::as_object_mut)
            {
                data.insert(
                    "exec".to_string(),
                    json!({
                        "executed": false,
                        "reason": NATIVE_SIM_JSON_SKIP_REASON,
                        "binary": exe.to_string_lossy(),
                    }),
                );
            }
            serde_json::to_string(&v).unwrap_or(j)
        }
        Err(_) => j,
    });
    run
}

/// Locate the produced `native_sim` executable under a build base dir,
/// checking `NATIVE_SIM_BUILD_DIRS` in order.
fn find_native_sim_exe(base: &Path) -> Option<PathBuf> {
    for dir in NATIVE_SIM_BUILD_DIRS {
        let exe = base.join(dir).join("zephyr").join(NATIVE_SIM_EXE);
        if exe.is_file() {
            return Some(exe);
        }
    }
    None
}

/// The project build-tree base (`build/<core>-<os>/` lives here) — mirrors
/// `commands::build`'s private helper of the same name; kept as its own tiny
/// copy here since that one isn't exported (path resolution only, not
/// build/flash logic, so this isn't the duplication the unit is meant to avoid).
fn base_dir(context: &ProjectContext) -> String {
    context
        .west_cwd
        .clone()
        .or_else(|| context.workspace_root.clone())
        .unwrap_or_else(|| ".".to_string())
}

/// Re-tag a delegated `CommandRun`'s envelope `command` field (e.g. `build` /
/// `flash`) as `run`'s own, so every `alp run` envelope self-identifies like
/// its sibling commands. Falls back to the untouched JSON on a parse failure
/// (should not happen — the JSON always comes from `Envelope::to_json`).
fn retag(run: CommandRun, command: &str) -> CommandRun {
    let json = run.json.map(|j| retag_json(&j, command));
    CommandRun {
        exit: run.exit,
        text: run.text,
        json,
    }
}

fn retag_json(json: &str, command: &str) -> String {
    match serde_json::from_str::<Value>(json) {
        Ok(mut v) => {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("command".to_string(), json!(command));
            }
            serde_json::to_string(&v).unwrap_or_else(|_| json.to_string())
        }
        Err(_) => json.to_string(),
    }
}

/// The human-readable exec-failure fact, shared by the text line and the
/// `run.exec-failed` JSON issue (F5.1: every other failing envelope in this
/// CLI carries at least one `Issue` — exec failure used to be the exception).
fn exec_failure_message(exe: &Path, rc: Option<i32>) -> String {
    match rc {
        Some(code) => format!("{} exited with code {code}", exe.display()),
        None => format!("{} did not run to completion", exe.display()),
    }
}

/// Fold the `native_sim` execution outcome into the build's own envelope:
/// re-tag as `run`, override `ok`/`exitCode` with the execution's outcome, and
/// nest `{binary, ok, rc}` under `data.exec`. On failure also appends a
/// `run.exec-failed` error `Issue` to the envelope's `issues` array (see
/// `exec_failure_message`). Text mode gets the same fact as an appended line.
/// JSON is `None` in text mode (unchanged).
fn with_exec_result(
    built: CommandRun,
    exit: ExitCode,
    exe: &Path,
    ok: bool,
    rc: Option<i32>,
) -> CommandRun {
    let mut text = built.text;
    if !ok {
        text.push(format!("run: {}", exec_failure_message(exe, rc)));
    }

    let json = built.json.map(|j| match serde_json::from_str::<Value>(&j) {
        Ok(mut v) => {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("command".to_string(), json!("run"));
                obj.insert("ok".to_string(), json!(ok));
                obj.insert("exitCode".to_string(), json!(exit.code()));
                if let Some(data) = obj.get_mut("data").and_then(Value::as_object_mut) {
                    data.insert(
                        "exec".to_string(),
                        json!({
                            "binary": exe.to_string_lossy(),
                            "ok": ok,
                            "rc": rc,
                        }),
                    );
                }
                if !ok {
                    if let Some(issues) = obj.get_mut("issues").and_then(Value::as_array_mut) {
                        issues.push(json!({
                            "code": "run.exec-failed",
                            "severity": "error",
                            "message": exec_failure_message(exe, rc),
                        }));
                    }
                }
            }
            serde_json::to_string(&v).unwrap_or(j)
        }
        Err(_) => j,
    });

    CommandRun { exit, text, json }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retag_json_overrides_only_the_command_key() {
        let src = r#"{"command":"build","ok":true,"exitCode":0,"project":{"root":null,"boardYaml":null},"data":{"schemaVersion":"1"},"issues":[]}"#;
        let got = retag_json(src, "run");
        let v: Value = serde_json::from_str(&got).unwrap();
        assert_eq!(v["command"], "run");
        assert_eq!(v["ok"], true);
        assert_eq!(v["data"]["schemaVersion"], "1");
    }

    #[test]
    fn find_native_sim_exe_checks_both_layouts() {
        let base = std::env::temp_dir().join(format!("alp-run-nsim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("native_sim-zephyr").join("zephyr");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join(NATIVE_SIM_EXE);
        std::fs::write(&exe, "").unwrap();

        assert_eq!(find_native_sim_exe(&base), Some(exe));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn find_native_sim_exe_none_when_absent() {
        let base = std::env::temp_dir().join(format!("alp-run-nsim-none-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        assert_eq!(find_native_sim_exe(&base), None);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn with_exec_result_nests_exec_under_data_and_overrides_ok() {
        let built = CommandRun {
            exit: ExitCode::Success,
            text: vec!["build: complete.".to_string()],
            json: Some(
                r#"{"command":"build","ok":true,"exitCode":0,"project":{"root":null,"boardYaml":null},"data":{"schemaVersion":"1","baseDir":"build","slices":[]},"issues":[]}"#
                    .to_string(),
            ),
        };
        let run = with_exec_result(
            built,
            ExitCode::RuntimeFailure,
            Path::new("/tmp/zephyr.exe"),
            false,
            Some(1),
        );
        assert_eq!(run.exit.code(), 1);
        let v: Value = serde_json::from_str(run.json.as_deref().unwrap()).unwrap();
        assert_eq!(v["command"], "run");
        assert_eq!(v["ok"], false);
        assert_eq!(v["exitCode"], 1);
        assert_eq!(v["data"]["exec"]["ok"], false);
        assert_eq!(v["data"]["exec"]["rc"], 1);
        assert!(run.text.iter().any(|l| l.contains("exited with code 1")));
        // F5.1: a failing exec envelope is no longer the one failure shape
        // with an empty `issues` array.
        let issues = v["issues"].as_array().unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0]["code"], "run.exec-failed");
        assert_eq!(issues[0]["severity"], "error");
        assert!(issues[0]["message"].as_str().unwrap().contains("code 1"));
    }

    #[test]
    fn with_exec_result_leaves_issues_empty_on_success() {
        let built = CommandRun {
            exit: ExitCode::Success,
            text: vec!["build: complete.".to_string()],
            json: Some(
                r#"{"command":"build","ok":true,"exitCode":0,"project":{"root":null,"boardYaml":null},"data":{"schemaVersion":"1","baseDir":"build","slices":[]},"issues":[]}"#
                    .to_string(),
            ),
        };
        let run = with_exec_result(
            built,
            ExitCode::Success,
            Path::new("/tmp/zephyr.exe"),
            true,
            Some(0),
        );
        let v: Value = serde_json::from_str(run.json.as_deref().unwrap()).unwrap();
        assert!(v["issues"].as_array().unwrap().is_empty());
    }

    #[test]
    fn skip_exec_result_reports_not_executed_and_keeps_success() {
        let built = CommandRun {
            exit: ExitCode::Success,
            text: Vec::new(),
            json: Some(
                r#"{"command":"build","ok":true,"exitCode":0,"project":{"root":null,"boardYaml":null},"data":{"schemaVersion":"1","baseDir":"build","slices":[]},"issues":[]}"#
                    .to_string(),
            ),
        };
        let run = skip_exec_result(built, Path::new("/tmp/zephyr.exe"));
        assert_eq!(run.exit.code(), 0);
        let v: Value = serde_json::from_str(run.json.as_deref().unwrap()).unwrap();
        assert_eq!(v["command"], "run");
        assert_eq!(v["ok"], true);
        assert_eq!(v["data"]["exec"]["executed"], false);
        assert_eq!(v["data"]["exec"]["binary"], "/tmp/zephyr.exe");
        assert_eq!(v["data"]["exec"]["reason"], NATIVE_SIM_JSON_SKIP_REASON);
    }

    #[test]
    fn board_without_flash_is_refused_before_any_build() {
        use clap::Parser;
        let g = crate::cli::Cli::parse_from(["alp", "--format", "json", "run"]).global;
        let args = RunArgs {
            board: Some("e1m-aen801".to_string()),
            flash: false,
            args: Vec::new(),
        };
        let result = run(&g, &args);
        assert_eq!(result.exit.code(), ExitCode::ValidationFailure.code());
        let v: Value = serde_json::from_str(result.json.as_deref().unwrap()).unwrap();
        assert_eq!(v["command"], "run");
        assert_eq!(v["ok"], false);
        assert_eq!(v["exitCode"], 2);
        let issues = v["issues"].as_array().unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0]["code"], "run.board-without-flash");
        assert!(issues[0]["message"].as_str().unwrap().contains("--flash"));
    }
}
