// SPDX-License-Identifier: Apache-2.0
//! Spinners for captured, latency-bound commands (`sdk list` HTTP fetch,
//! `sdk install` git clone). Pure presentation, drawn to stderr — it never
//! touches the JSON envelope on stdout.
//!
//! A spinner is shown only in genuine interactive use: a TTY with none of
//! `--format json` / `--quiet` / `--ci` / `--non-interactive`. In every other
//! case (piped output, JSON, CI, the VS Code extension) it resolves to a hidden
//! bar that draws nothing — so logs and the byte-for-byte JSON output stay clean.

use std::io::IsTerminal;
use std::time::Duration;

use indicatif::{ProgressBar, ProgressStyle};

use crate::cli::GlobalArgs;

/// A steady-ticking spinner, or a hidden no-op bar when output isn't an
/// interactive terminal. Call `finish_and_clear()` when the work completes.
pub fn spinner(g: &GlobalArgs, message: &str) -> ProgressBar {
    let interactive =
        !g.is_json() && !g.quiet && !g.ci && !g.non_interactive && std::io::stderr().is_terminal();
    if !interactive {
        return ProgressBar::hidden();
    }

    let pb = ProgressBar::new_spinner();
    // A braille spinner + message; template is static so `with_template` can't fail.
    if let Ok(style) = ProgressStyle::with_template("{spinner:.cyan} {msg}") {
        pb.set_style(style.tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", ""]));
    }
    pb.enable_steady_tick(Duration::from_millis(80));
    pb.set_message(message.to_string());
    pb
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Format;

    fn args(format: Format, quiet: bool, ci: bool, non_interactive: bool) -> GlobalArgs {
        GlobalArgs {
            project: None,
            board_yaml: None,
            sdk_root: None,
            target: None,
            all: false,
            format,
            verbose: false,
            quiet,
            no_color: false,
            non_interactive,
            ci,
        }
    }

    #[test]
    fn hidden_in_json_quiet_ci_and_non_interactive() {
        // JSON, --quiet, --ci, and --non-interactive each force a hidden bar,
        // regardless of TTY. (Under `cargo test` stderr is non-TTY anyway, so
        // the interactive branch is never taken here either.)
        assert!(spinner(&args(Format::Json, false, false, false), "x").is_hidden());
        assert!(spinner(&args(Format::Text, true, false, false), "x").is_hidden());
        assert!(spinner(&args(Format::Text, false, true, false), "x").is_hidden());
        assert!(spinner(&args(Format::Text, false, false, true), "x").is_hidden());
    }
}
