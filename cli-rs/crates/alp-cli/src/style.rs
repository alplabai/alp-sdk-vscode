// SPDX-License-Identifier: Apache-2.0
//! Terminal styling for human-readable (text-mode) output. This is pure
//! presentation — the JSON envelope is never styled and stays byte-for-byte
//! stable. Color is emitted only when text output (stderr) is a TTY, `NO_COLOR`
//! is unset, and neither `--no-color` nor `--ci` was passed.

use std::io::IsTerminal;

use alp_core::{DoctorCheck, DoctorStatus, DoctorSummary};
use owo_colors::OwoColorize;

use crate::cli::GlobalArgs;

/// Resolved styling decision for one invocation.
#[derive(Debug, Clone, Copy)]
pub struct Theme {
    /// Whether ANSI styling is emitted; `false` yields plain ASCII output.
    color: bool,
}

impl Theme {
    /// Decide whether to emit ANSI styling. Human-readable text goes to stderr,
    /// so the TTY probe is against stderr.
    pub fn from_args(g: &GlobalArgs) -> Self {
        let color = !g.no_color
            && !g.ci
            && std::env::var_os("NO_COLOR").is_none()
            && std::io::stderr().is_terminal();
        Theme { color }
    }

    /// `s` rendered bold when color is on, else returned unchanged.
    fn bold(&self, s: &str) -> String {
        if self.color {
            s.bold().to_string()
        } else {
            s.to_string()
        }
    }

    /// `s` rendered dimmed when color is on, else returned unchanged.
    fn dim(&self, s: &str) -> String {
        if self.color {
            s.dimmed().to_string()
        } else {
            s.to_string()
        }
    }

    /// `s` rendered cyan when color is on, else returned unchanged.
    fn cyan(&self, s: &str) -> String {
        if self.color {
            s.cyan().to_string()
        } else {
            s.to_string()
        }
    }

    /// A colored, bold status glyph for the given check status.
    fn glyph(&self, status: DoctorStatus) -> String {
        if !self.color {
            // Equal-width ASCII markers so the name column stays aligned when
            // color (and the single-glyph form) is off.
            return match status {
                DoctorStatus::Pass => "[+]".to_string(),
                DoctorStatus::Warn => "[!]".to_string(),
                DoctorStatus::Fail => "[x]".to_string(),
            };
        }
        match status {
            DoctorStatus::Pass => "✓".green().bold().to_string(),
            DoctorStatus::Warn => "!".yellow().bold().to_string(),
            DoctorStatus::Fail => "✗".red().bold().to_string(),
        }
    }

    /// `N passed · N warnings · N failed`, with each count colored only when
    /// non-zero (a `0 failed` reads as muted, not alarming red).
    fn summary_line(&self, summary: &DoctorSummary) -> String {
        let passed = format!("{} passed", summary.pass);
        let passed = if self.color && summary.pass > 0 {
            passed.green().to_string()
        } else {
            self.dim(&passed)
        };

        let warnings = format!("{} {}", summary.warn, plural(summary.warn, "warning"));
        let warnings = if self.color && summary.warn > 0 {
            warnings.yellow().to_string()
        } else {
            self.dim(&warnings)
        };

        let failed = format!("{} failed", summary.fail);
        let failed = if self.color && summary.fail > 0 {
            failed.red().to_string()
        } else {
            self.dim(&failed)
        };

        let sep = self.dim("·");
        format!("{passed} {sep} {warnings} {sep} {failed}")
    }

    /// A leading-blank-padded, red error line (used by the doctor error paths).
    pub fn error_lines(&self, message: &str) -> Vec<String> {
        let glyph = self.glyph(DoctorStatus::Fail);
        vec![
            String::new(),
            format!("  {glyph}  {}", self.bold(message)),
            String::new(),
        ]
    }

    /// A colored "building" header for a live per-slice build step: an accent
    /// arrow, the bold `core [backend]` label, and the dimmed command. Bracketing
    /// the tool's own streamed output with `slice_result` gives a colorful,
    /// live-progress feel without a spinner (builds run sequentially).
    pub fn slice_start(&self, core: &str, backend: &str, command: &str) -> String {
        let arrow = if self.color {
            "▶".cyan().bold().to_string()
        } else {
            "→".to_string()
        };
        let head = self.bold(&format!("{core} [{backend}]"));
        format!("  {arrow} building {head}  {}", self.dim(command))
    }

    /// A colored result line for a finished (or skipped) slice: the status glyph
    /// followed by the note (`ok (rc=0)`, `no command — skipped`, …). Indented to
    /// sit under its `slice_start` header.
    pub fn slice_result(&self, status: DoctorStatus, note: &str) -> String {
        format!("    {} {note}", self.glyph(status))
    }
}

/// Render a doctor-style report (heading + aligned checks + colored summary +
/// optional next-steps) into stderr lines. Shared by `doctor` and
/// `doctor --build`.
pub fn render_report(
    g: &GlobalArgs,
    title: &str,
    subtitle: &str,
    checks: &[DoctorCheck],
    summary: &DoctorSummary,
    next_steps: &[String],
) -> Vec<String> {
    let theme = Theme::from_args(g);
    let (quiet, verbose) = (g.quiet, g.verbose);
    let mut lines = vec![String::new()];

    let heading = if subtitle.is_empty() {
        theme.bold(title)
    } else {
        format!("{}  {}", theme.bold(title), theme.dim(subtitle))
    };
    lines.push(format!("  {heading}"));
    lines.push(String::new());

    if !quiet && !checks.is_empty() {
        let width = checks
            .iter()
            .map(|c| c.name.chars().count())
            .max()
            .unwrap_or(0);
        for check in checks {
            // Pad the plain name, then style — padding after styling would
            // count the ANSI escapes and misalign the column.
            let name = format!("{:<width$}", check.name, width = width);
            let name = theme.bold(&name);
            let detail = if check.status == DoctorStatus::Pass {
                theme.dim(&check.detail)
            } else {
                check.detail.clone()
            };
            lines.push(format!(
                "  {}  {name}   {detail}",
                theme.glyph(check.status)
            ));
        }
        lines.push(String::new());
    }

    lines.push(format!("  {}", theme.summary_line(summary)));

    if verbose && !next_steps.is_empty() {
        lines.push(String::new());
        lines.push(format!("  {}", theme.bold("Next steps")));
        for step in next_steps {
            lines.push(format!("    {} {step}", theme.cyan("→")));
        }
    }

    lines
}

/// `word` for `n == 1`, else `word` with an `s` appended.
fn plural(n: u32, word: &str) -> String {
    if n == 1 {
        word.to_string()
    } else {
        format!("{word}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Format;

    // Under `cargo test` stderr is not a TTY, so `Theme::from_args` resolves to
    // color=false regardless of these fields — output is deterministic.
    fn args(quiet: bool, verbose: bool) -> GlobalArgs {
        GlobalArgs {
            project: None,
            board_yaml: None,
            sdk_root: None,
            target: None,
            all: false,
            format: Format::Text,
            verbose,
            quiet,
            no_color: true,
            non_interactive: false,
            ci: false,
        }
    }

    fn check(name: &str, status: DoctorStatus, detail: &str) -> DoctorCheck {
        DoctorCheck {
            name: name.to_string(),
            status,
            detail: detail.to_string(),
            fix: None,
        }
    }

    #[test]
    fn plain_markers_are_equal_width_and_aligned() {
        let checks = vec![
            check("west", DoctorStatus::Pass, "ok"),
            check("vendorToolchain", DoctorStatus::Warn, "needs toolchain"),
        ];
        let summary = DoctorSummary {
            pass: 1,
            warn: 1,
            fail: 0,
        };
        let lines = render_report(&args(false, false), "t", "sub", &checks, &summary, &[]);
        let pass_line = lines.iter().find(|l| l.contains("west")).unwrap();
        let warn_line = lines
            .iter()
            .find(|l| l.contains("vendorToolchain"))
            .unwrap();
        assert!(pass_line.contains("[+]"));
        assert!(warn_line.contains("[!]"));
        // Both names start at the same column (3-wide markers + padding).
        assert_eq!(
            pass_line.find("west").unwrap(),
            warn_line.find("vendorToolchain").unwrap()
        );
        assert!(lines.iter().all(|l| !l.contains('\u{1b}')), "no ANSI");
    }

    #[test]
    fn summary_pluralizes_and_never_styles_when_plain() {
        let theme = Theme { color: false };
        assert_eq!(
            theme.summary_line(&DoctorSummary {
                pass: 1,
                warn: 1,
                fail: 1,
            }),
            "1 passed · 1 warning · 1 failed"
        );
        assert_eq!(
            theme.summary_line(&DoctorSummary {
                pass: 4,
                warn: 0,
                fail: 2,
            }),
            "4 passed · 0 warnings · 2 failed"
        );
    }

    #[test]
    fn error_lines_are_blank_padded_and_plain() {
        let lines = Theme { color: false }.error_lines("boom");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "");
        assert!(lines[1].contains("[x]") && lines[1].contains("boom"));
        assert_eq!(lines[2], "");
    }

    #[test]
    fn quiet_hides_checks_but_keeps_summary() {
        let checks = vec![check("west", DoctorStatus::Pass, "ok")];
        let summary = DoctorSummary {
            pass: 1,
            warn: 0,
            fail: 0,
        };
        let lines = render_report(&args(true, false), "t", "sub", &checks, &summary, &[]);
        assert!(lines.iter().all(|l| !l.contains("west")));
        assert!(lines.iter().any(|l| l.contains("1 passed")));
    }

    #[test]
    fn slice_start_and_result_are_plain_when_color_off() {
        let theme = Theme { color: false };
        let start = theme.slice_start("m55_hp", "zephyr", "west build -b alp_e1m app");
        assert!(start.contains("building m55_hp [zephyr]"));
        assert!(start.contains("west build -b alp_e1m app"));
        assert!(start.contains('→') && !start.contains('▶'));

        let ok = theme.slice_result(DoctorStatus::Pass, "ok (rc=0)");
        assert!(ok.contains("[+]") && ok.contains("ok (rc=0)"));
        let bad = theme.slice_result(DoctorStatus::Fail, "failed (rc=1)");
        assert!(bad.contains("[x]") && bad.contains("failed (rc=1)"));

        for line in [&start, &ok, &bad] {
            assert!(!line.contains('\u{1b}'), "no ANSI when color off: {line}");
        }
    }

    #[test]
    fn next_steps_only_when_verbose() {
        let summary = DoctorSummary {
            pass: 0,
            warn: 1,
            fail: 0,
        };
        let steps = vec!["install west".to_string()];
        let quiet = render_report(&args(false, false), "t", "sub", &[], &summary, &steps);
        assert!(quiet.iter().all(|l| !l.contains("install west")));
        let loud = render_report(&args(false, true), "t", "sub", &[], &summary, &steps);
        assert!(loud.iter().any(|l| l.contains("install west")));
    }
}
