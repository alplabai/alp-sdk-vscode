// SPDX-License-Identifier: Apache-2.0
//! Pure build pre-flight: given the CLI's resolved project/workspace state,
//! report ordered readiness checks so `alp build` (and `alp doctor`) can tell the
//! user what is missing and how to fix it *before* a build is attempted —
//! instead of surfacing a raw `west` / CMake error. Filesystem probing happens in
//! the adapter (the CLI); this module stays pure and unit-testable.

use crate::debug::{DoctorCheck, DoctorStatus, DoctorSummary};

/// Resolved, already-probed inputs for the build pre-flight. The CLI fills these
/// from `resolve_project_context` + filesystem checks; this module never touches
/// the filesystem.
#[derive(Debug, Clone, Default)]
pub struct PreflightInput {
    /// Resolved alp-sdk checkout, or `None` when unresolved.
    pub sdk_root: Option<String>,
    /// Whether the resolved `board.yaml` exists on disk.
    pub board_yaml_present: bool,
    /// Resolved west workspace topdir (holds `.west/`), or `None` when none was
    /// found (reused or bootstrapped).
    pub workspace_dir: Option<String>,
    /// Whether a usable `west` was resolved (a workspace venv west or one on PATH).
    pub west_available: bool,
}

/// Ordered build-readiness checks. A `Fail` blocks the build; a `Warn` is
/// advisory. Each non-`Pass` `detail` embeds the one-line fix so the guidance is
/// visible even without `--verbose`.
pub fn build_preflight_checks(input: &PreflightInput) -> Vec<DoctorCheck> {
    let mut checks = Vec::new();

    checks.push(match &input.sdk_root {
        Some(root) => pass("sdk", format!("alp-sdk at {root}")),
        None => fail(
            "sdk",
            "no SDK selected — run `alp sdk switch <path>` or `alp sdk install <ver>`",
            "alp sdk switch <path>",
        ),
    });

    checks.push(if input.board_yaml_present {
        pass("boardYaml", "board.yaml found".to_string())
    } else {
        fail(
            "boardYaml",
            "board.yaml not found — run `alp init` or pass `--board-yaml <path>`",
            "alp init",
        )
    });

    checks.push(match &input.workspace_dir {
        Some(dir) => pass("workspace", format!("Zephyr workspace at {dir}")),
        None => fail(
            "workspace",
            "no Zephyr workspace — run `alp bootstrap` (reuses a compatible Zephyr, else bootstraps one)",
            "alp bootstrap",
        ),
    });

    checks.push(if input.west_available {
        pass("westResolved", "west resolved".to_string())
    } else {
        warn(
            "westResolved",
            "west not found — run `alp bootstrap` to create the workspace venv",
            "alp bootstrap",
        )
    });

    checks
}

/// A build is blocked when any check failed.
pub fn preflight_blocked(checks: &[DoctorCheck]) -> bool {
    checks.iter().any(|c| c.status == DoctorStatus::Fail)
}

/// Tally checks into a pass/warn/fail summary.
pub fn preflight_summary(checks: &[DoctorCheck]) -> DoctorSummary {
    let mut summary = DoctorSummary {
        pass: 0,
        warn: 0,
        fail: 0,
    };
    for check in checks {
        match check.status {
            DoctorStatus::Pass => summary.pass += 1,
            DoctorStatus::Warn => summary.warn += 1,
            DoctorStatus::Fail => summary.fail += 1,
        }
    }
    summary
}

/// Deduplicated fix hints for the non-passing checks, in evaluation order.
pub fn preflight_next_steps(checks: &[DoctorCheck]) -> Vec<String> {
    let mut steps: Vec<String> = Vec::new();
    for check in checks {
        if check.status == DoctorStatus::Pass {
            continue;
        }
        if let Some(fix) = &check.fix {
            if !steps.contains(fix) {
                steps.push(fix.clone());
            }
        }
    }
    steps
}

fn pass(name: &str, detail: String) -> DoctorCheck {
    DoctorCheck {
        name: name.to_string(),
        status: DoctorStatus::Pass,
        detail,
        fix: None,
    }
}

fn fail(name: &str, detail: &str, fix: &str) -> DoctorCheck {
    DoctorCheck {
        name: name.to_string(),
        status: DoctorStatus::Fail,
        detail: detail.to_string(),
        fix: Some(fix.to_string()),
    }
}

fn warn(name: &str, detail: &str, fix: &str) -> DoctorCheck {
    DoctorCheck {
        name: name.to_string(),
        status: DoctorStatus::Warn,
        detail: detail.to_string(),
        fix: Some(fix.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> PreflightInput {
        PreflightInput {
            sdk_root: Some("/sdk".to_string()),
            board_yaml_present: true,
            workspace_dir: Some("/ws".to_string()),
            west_available: true,
        }
    }

    #[test]
    fn fully_ready_is_not_blocked_and_all_pass() {
        let checks = build_preflight_checks(&ready());
        assert!(!preflight_blocked(&checks));
        let summary = preflight_summary(&checks);
        assert_eq!((summary.pass, summary.warn, summary.fail), (4, 0, 0));
        assert!(preflight_next_steps(&checks).is_empty());
    }

    #[test]
    fn missing_sdk_blocks_with_a_switch_hint() {
        let input = PreflightInput {
            sdk_root: None,
            ..ready()
        };
        let checks = build_preflight_checks(&input);
        assert!(preflight_blocked(&checks));
        let sdk = checks.iter().find(|c| c.name == "sdk").unwrap();
        assert_eq!(sdk.status, DoctorStatus::Fail);
        assert!(sdk.detail.contains("alp sdk switch"));
        assert!(
            preflight_next_steps(&checks)
                .iter()
                .any(|s| s.contains("alp sdk switch"))
        );
    }

    #[test]
    fn missing_board_and_workspace_both_block() {
        let input = PreflightInput {
            board_yaml_present: false,
            workspace_dir: None,
            ..ready()
        };
        let checks = build_preflight_checks(&input);
        assert!(preflight_blocked(&checks));
        let summary = preflight_summary(&checks);
        assert_eq!(summary.fail, 2);
    }

    #[test]
    fn missing_west_warns_but_does_not_block() {
        let input = PreflightInput {
            west_available: false,
            ..ready()
        };
        let checks = build_preflight_checks(&input);
        assert!(!preflight_blocked(&checks));
        let west = checks.iter().find(|c| c.name == "westResolved").unwrap();
        assert_eq!(west.status, DoctorStatus::Warn);
    }
}
