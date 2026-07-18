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

/// `data` payload for the `bootstrap` envelope: the resolved SDK root, the
/// `bootstrap.sh` path, and the pass-through flags forwarded to the script.
#[derive(Serialize)]
struct BootstrapData {
    /// Payload schema version (`"1"`); serialized as `schemaVersion`.
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Resolved alp-sdk root; empty on failure paths.
    #[serde(rename = "sdkRoot")]
    sdk_root: String,
    /// Absolute path to the host's `<sdkRoot>/scripts/bootstrap.{sh,ps1}`; empty
    /// on failure paths.
    #[serde(rename = "scriptPath")]
    script_path: String,
    /// `--no-pip` flag forwarded to `bootstrap.sh` (skip Python requirements).
    #[serde(rename = "noPip")]
    no_pip: bool,
    /// `--no-west` flag forwarded to `bootstrap.sh` (skip west init/update).
    #[serde(rename = "noWest")]
    no_west: bool,
    /// `--print-env` flag forwarded to `bootstrap.sh` (print env, no install).
    #[serde(rename = "printEnv")]
    print_env: bool,
}

/// Runs `alp bootstrap`: resolves the SDK root, then invokes the SDK's own
/// native bootstrap script for this host — `scripts/bootstrap.sh` via `bash` on
/// POSIX, `scripts/bootstrap.ps1` via `pwsh -File` on Windows (flags mapped to
/// `-NoPip`/`-NoWest`/`-PrintEnv`). JSON mode captures the run into one
/// envelope; text mode streams the install live with inherited stdio. Returns
/// early on an unresolved SDK root or a missing script (on Windows, a missing
/// `bootstrap.ps1` means the SDK predates native-Windows bootstrap).
pub fn run(g: &GlobalArgs, args: &BootstrapArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let Some(sdk_root) = context.sdk_root.clone() else {
        return failure(
            g,
            ExitCode::ValidationFailure,
            "sdk-root-unresolved",
            "alp-sdk root is unresolved. Use --sdk-root, pin one with `alp sdk switch \
             <version|path>`, or run `alp sdk install <version>` first.",
            empty_data(args),
            vec!["bootstrap: alp-sdk root is unresolved.".to_string()],
        );
    };

    let windows = cfg!(windows);
    let script_name = if windows {
        "bootstrap.ps1"
    } else {
        "bootstrap.sh"
    };
    let script = Path::new(&sdk_root).join("scripts").join(script_name);
    let script_str = script.to_string_lossy().to_string();
    if !script.exists() {
        if windows {
            // The SDK is too old to ship the native-Windows twin — not a Windows
            // refusal, a stale checkout.
            return failure(
                g,
                ExitCode::RuntimeFailure,
                "windows-unsupported",
                &format!("scripts/bootstrap.ps1 not found at {script_str}; this alp-sdk predates native-Windows bootstrap. Update to an SDK that ships scripts/bootstrap.ps1, or use WSL2 (Ubuntu) — see docs/cross-platform-setup.md §4."),
                empty_data(args),
                vec![
                    "bootstrap: this alp-sdk predates native-Windows bootstrap (no scripts/bootstrap.ps1)."
                        .to_string(),
                    "Update the SDK, or use WSL2 (Ubuntu) — docs/cross-platform-setup.md §4."
                        .to_string(),
                ],
            );
        }
        return failure(
            g,
            ExitCode::RuntimeFailure,
            "script-missing",
            &format!("{script_name} not found at {script_str}; is this a valid alp-sdk checkout?"),
            empty_data(args),
            vec![format!("bootstrap: {script_str} not found.")],
        );
    }

    let (program, cmd_args) = bootstrap_command(
        windows,
        &script_str,
        args.no_pip,
        args.no_west,
        args.print_env,
    );

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
        let code = Command::new(&program)
            .args(&cmd_args)
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
                    message: "the bootstrap script reported a failure; re-run without --format json to see the log."
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
        let status = Command::new(&program).args(&cmd_args).status();
        let (exit, mut lines) = match status {
            Ok(s) if s.success() => (ExitCode::Success, vec!["bootstrap: complete.".to_string()]),
            Ok(_) => (
                ExitCode::RuntimeFailure,
                vec!["bootstrap: failed (see log above).".to_string()],
            ),
            Err(e) => (
                ExitCode::RuntimeFailure,
                vec![format!("bootstrap: failed to launch {program}: {e}")],
            ),
        };
        // Counter bootstrap.sh's own "Next steps" banner (it tells the user to
        // `source .venv/bin/activate`): an activated venv puts the SDK's
        // Python `alp` ahead of this native CLI on PATH (see `doctor`'s
        // `pathShadow` check), so the very next command the banner sets the
        // user up for would silently run the wrong binary.
        if exit == ExitCode::Success {
            lines.extend(venv_activation_note());
        }
        CommandRun {
            exit,
            text: lines,
            json: None,
        }
    }
}

/// Selects the interpreter and argv for the SDK's bootstrap script. On Windows
/// the SDK ships `scripts/bootstrap.ps1` (run via `pwsh -File`, flags mapped to
/// `-NoPip`/`-NoWest`/`-PrintEnv`); elsewhere `scripts/bootstrap.sh` (run via
/// `bash` with the POSIX `--no-pip`/`--no-west`/`--print-env` flags). `script`
/// is the already-resolved absolute script path. `windows` is `cfg!(windows)`,
/// passed explicitly so both mappings stay unit-testable on any host.
fn bootstrap_command(
    windows: bool,
    script: &str,
    no_pip: bool,
    no_west: bool,
    print_env: bool,
) -> (String, Vec<String>) {
    if windows {
        let mut args = vec!["-File".to_string(), script.to_string()];
        if no_pip {
            args.push("-NoPip".to_string());
        }
        if no_west {
            args.push("-NoWest".to_string());
        }
        if print_env {
            args.push("-PrintEnv".to_string());
        }
        ("pwsh".to_string(), args)
    } else {
        let mut args = vec![script.to_string()];
        if no_pip {
            args.push("--no-pip".to_string());
        }
        if no_west {
            args.push("--no-west".to_string());
        }
        if print_env {
            args.push("--print-env".to_string());
        }
        ("bash".to_string(), args)
    }
}

/// Lines counter-acting `bootstrap.sh`'s own "Next steps" banner: this native
/// CLI needs no venv activation, and activating it is actively counterproductive
/// (it puts the SDK's Python `alp` ahead of this one on PATH). Pure + unit
/// tested — no I/O, so it's safe to call unconditionally after a successful run.
fn venv_activation_note() -> Vec<String> {
    vec![
        String::new(),
        "Note: this native CLI works without activating the venv bootstrap.sh just set up."
            .to_string(),
        "Activating it (e.g. `source .venv/bin/activate`) puts the SDK's Python `alp` ahead \
         of this one on PATH — run `alp` commands from a plain shell instead."
            .to_string(),
    ]
}

/// Builds a `BootstrapData` for failure paths: empty `sdk_root`/`script_path`,
/// but carries through the user's flag selections.
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

/// Assembles a `CommandRun` for an early-return failure: one `bootstrap.<code>`
/// issue, a null project, and either the JSON envelope or the given text lines
/// depending on `g.is_json()`.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_uses_pwsh_and_maps_flags_to_switches() {
        let (program, args) = bootstrap_command(true, "s.ps1", true, false, true);
        assert_eq!(program, "pwsh");
        assert_eq!(args, ["-File", "s.ps1", "-NoPip", "-PrintEnv"]);
    }

    #[test]
    fn posix_uses_bash_and_maps_flags_to_long_options() {
        let (program, args) = bootstrap_command(false, "s.sh", false, true, false);
        assert_eq!(program, "bash");
        assert_eq!(args, ["s.sh", "--no-west"]);
    }

    #[test]
    fn no_flags_forwards_only_the_script() {
        let (_program, args) = bootstrap_command(false, "s.sh", false, false, false);
        assert_eq!(args, ["s.sh"]);
    }

    #[test]
    fn venv_activation_note_counters_activate_and_names_this_cli() {
        let lines = venv_activation_note();
        let joined = lines.join("\n");
        assert!(
            joined.contains("without activating the venv"),
            "should state this CLI needs no activation: {joined}"
        );
        assert!(
            joined.contains("source .venv/bin/activate"),
            "should name the exact instruction it is countering: {joined}"
        );
        assert!(
            joined.contains("ahead of this one on PATH"),
            "should explain *why* activation is counterproductive: {joined}"
        );
    }
}
