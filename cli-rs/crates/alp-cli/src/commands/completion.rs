// SPDX-License-Identifier: Apache-2.0
//! `alp completion` — emit a shell completion script.
//!
//! Parity with TS `runCompletionCommand`: the scripts are byte-for-byte copies
//! of the TS output (captured from the reference CLI and embedded verbatim via
//! `include_str!`), so the contract envelope's `script` field matches exactly.

use super::CommandRun;
use crate::cli::{CompletionArgs, GlobalArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;

/// Verbatim bash completion script, captured from the reference TS CLI.
const BASH_SCRIPT: &str = include_str!("completion_scripts/bash.bash");
/// Verbatim zsh completion script, captured from the reference TS CLI.
const ZSH_SCRIPT: &str = include_str!("completion_scripts/zsh.zsh");
/// Verbatim fish completion script, captured from the reference TS CLI.
const FISH_SCRIPT: &str = include_str!("completion_scripts/fish.fish");

/// Envelope `data` payload for `completion`: the resolved shell and its script.
#[derive(serde::Serialize)]
struct CompletionData {
    /// Data schema version, serialized as `schemaVersion`; always `"1"`.
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Resolved shell name (`bash`/`zsh`/`fish`).
    shell: String,
    /// The emitted completion script body.
    script: String,
}

/// Build an empty `Project` (no root / `board.yaml`); `completion` is project-agnostic.
fn null_project() -> Project {
    Project {
        root: None,
        board_yaml: None,
    }
}

/// Mirror TS `resolveShell`: default `bash`; trim + lowercase; else unsupported.
fn resolve_shell(raw: Option<&str>) -> Option<&'static str> {
    match raw.unwrap_or("bash").trim().to_ascii_lowercase().as_str() {
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        _ => None,
    }
}

/// Select the embedded completion script for `shell`; unknown shells fall back to bash.
fn script_for(shell: &str) -> &'static str {
    match shell {
        "zsh" => ZSH_SCRIPT,
        "fish" => FISH_SCRIPT,
        _ => BASH_SCRIPT,
    }
}

/// Run `alp completion`: resolve `--shell` and emit its script, or fail with
/// `completion.shell-unsupported` (exit `RuntimeFailure`) for an unsupported shell.
pub fn run(g: &GlobalArgs, args: &CompletionArgs) -> CommandRun {
    let Some(shell) = resolve_shell(args.shell.as_deref()) else {
        let issues = vec![Issue {
            code: "completion.shell-unsupported".to_string(),
            severity: "error".to_string(),
            message: "Unsupported shell. Allowed values: bash, zsh, fish.".to_string(),
        }];
        let data = CompletionData {
            schema_version: "1".to_string(),
            shell: "bash".to_string(),
            script: String::new(),
        };
        let text = if g.is_json() {
            Vec::new()
        } else {
            vec!["completion: unsupported shell. Use --shell bash|zsh|fish.".to_string()]
        };
        let json = g.is_json().then(|| {
            Envelope::new(
                "completion",
                null_project(),
                data,
                issues,
                ExitCode::RuntimeFailure.code(),
            )
            .to_json()
        });
        return CommandRun {
            exit: ExitCode::RuntimeFailure,
            text,
            json,
        };
    };

    let script = script_for(shell).to_string();
    let text = if g.is_json() {
        Vec::new()
    } else {
        script.split('\n').map(str::to_string).collect()
    };
    let data = CompletionData {
        schema_version: "1".to_string(),
        shell: shell.to_string(),
        script,
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "completion",
            null_project(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_shell_defaults_and_normalizes() {
        assert_eq!(resolve_shell(None), Some("bash"));
        assert_eq!(resolve_shell(Some("  ZSH ")), Some("zsh"));
        assert_eq!(resolve_shell(Some("fish")), Some("fish"));
        assert_eq!(resolve_shell(Some("tcsh")), None);
    }

    #[test]
    fn scripts_are_nonempty_and_shell_specific() {
        assert!(BASH_SCRIPT.contains("_alp_complete"));
        assert!(ZSH_SCRIPT.contains("#compdef alp"));
        assert!(FISH_SCRIPT.contains("__fish_use_subcommand"));
        // The captured zsh script collapses the `_arguments -C` continuations.
        assert!(ZSH_SCRIPT.contains("_arguments -C     '1:command:->command'"));
    }
}
