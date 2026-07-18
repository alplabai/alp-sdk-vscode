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
    /// Zephyr `MAJOR.MINOR` present in the reused workspace (e.g. `"4.4"`), read
    /// from `<workspace>/zephyr/VERSION`. `None` when there is no workspace or the
    /// file is unreadable/unparseable.
    pub workspace_zephyr_version: Option<String>,
    /// Zephyr `MAJOR.MINOR` the active SDK's `west.yml` pins (e.g. `"4.4"`).
    /// `None` when unresolved or the pin is a branch/SHA (no `MAJOR.MINOR` to
    /// compare).
    pub sdk_zephyr_pin: Option<String>,
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

    // Reused-workspace Zephyr compatibility. A workspace bootstrapped once and
    // reused across sessions can sit on a stale Zephyr after the SDK bumps its
    // west.yml pin — which surfaces as build failures that look like regressions
    // (the v3.7.0-vs-v4.4.0 incident). The MAJOR.MINOR reuse check used to run
    // only at bootstrap time; do it here too so `alp build`/`alp doctor` stop
    // reporting a clean Pass on a stale workspace. Only emitted when there is a
    // workspace to check AND both versions are known — Warn (advisory), so a
    // mismatch guides re-bootstrap without hard-blocking a workspace that may
    // still build.
    if input.workspace_dir.is_some() {
        if let (Some(ws), Some(pin)) = (&input.workspace_zephyr_version, &input.sdk_zephyr_pin) {
            checks.push(if ws == pin {
                pass("zephyrVersion", format!("Zephyr v{ws} matches the SDK pin"))
            } else {
                warn(
                    "zephyrVersion",
                    &format!(
                        "reused Zephyr v{ws} != SDK pin v{pin} — run `alp bootstrap` to refresh the workspace"
                    ),
                    "alp bootstrap",
                )
            });
        }
    }

    checks
}

/// Extract `MAJOR.MINOR` from a Zephyr `VERSION` file body (the `VERSION_MAJOR`
/// / `VERSION_MINOR` assignment lines). `None` when either field is absent or
/// non-numeric. Pure — the caller reads the file.
pub fn parse_zephyr_version_file(body: &str) -> Option<String> {
    let mut major: Option<u32> = None;
    let mut minor: Option<u32> = None;
    for line in body.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "VERSION_MAJOR" => major = value.trim().parse().ok(),
            "VERSION_MINOR" => minor = value.trim().parse().ok(),
            _ => {}
        }
    }
    Some(format!("{}.{}", major?, minor?))
}

/// Extract the Zephyr pin as `MAJOR.MINOR` from a `west.yml` body: the
/// `manifest.projects[]` entry named `zephyr`, whose `revision` is a `vX.Y.Z`
/// tag. `None` when absent or the revision is a branch/SHA (nothing to compare).
/// Pure — the caller reads the file.
pub fn parse_west_zephyr_pin(body: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct WestFile {
        manifest: WestManifest,
    }
    #[derive(serde::Deserialize)]
    struct WestManifest {
        #[serde(default)]
        projects: Vec<WestProject>,
    }
    #[derive(serde::Deserialize)]
    struct WestProject {
        name: Option<String>,
        revision: Option<String>,
    }

    let parsed: WestFile = serde_yaml::from_str(body).ok()?;
    let revision = parsed
        .manifest
        .projects
        .into_iter()
        .find(|p| p.name.as_deref() == Some("zephyr"))?
        .revision?;
    parse_major_minor_tag(&revision)
}

/// `"v4.4.0"` / `"4.4.0"` -> `"4.4"`; `None` for a branch/SHA revision that has
/// no leading `MAJOR.MINOR`.
fn parse_major_minor_tag(revision: &str) -> Option<String> {
    let trimmed = revision.trim();
    let stripped = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let mut parts = stripped.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    Some(format!("{major}.{minor}"))
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
            workspace_zephyr_version: Some("4.4".to_string()),
            sdk_zephyr_pin: Some("4.4".to_string()),
        }
    }

    #[test]
    fn fully_ready_is_not_blocked_and_all_pass() {
        let checks = build_preflight_checks(&ready());
        assert!(!preflight_blocked(&checks));
        let summary = preflight_summary(&checks);
        // sdk + boardYaml + workspace + westResolved + zephyrVersion (matched).
        assert_eq!((summary.pass, summary.warn, summary.fail), (5, 0, 0));
        assert!(preflight_next_steps(&checks).is_empty());
    }

    #[test]
    fn stale_reused_zephyr_warns_but_does_not_block() {
        let input = PreflightInput {
            workspace_zephyr_version: Some("3.7".to_string()),
            sdk_zephyr_pin: Some("4.4".to_string()),
            ..ready()
        };
        let checks = build_preflight_checks(&input);
        // A mismatch is advisory, not blocking — the workspace may still build.
        assert!(!preflight_blocked(&checks));
        let zv = checks.iter().find(|c| c.name == "zephyrVersion").unwrap();
        assert_eq!(zv.status, DoctorStatus::Warn);
        assert!(zv.detail.contains("3.7"));
        assert!(zv.detail.contains("4.4"));
        assert!(
            preflight_next_steps(&checks)
                .iter()
                .any(|s| s == "alp bootstrap")
        );
    }

    #[test]
    fn zephyr_version_check_is_skipped_when_unknown() {
        // No workspace VERSION / no comparable pin -> no zephyrVersion check
        // (don't nag when we can't actually verify).
        let input = PreflightInput {
            workspace_zephyr_version: None,
            sdk_zephyr_pin: Some("4.4".to_string()),
            ..ready()
        };
        let checks = build_preflight_checks(&input);
        assert!(checks.iter().all(|c| c.name != "zephyrVersion"));
    }

    #[test]
    fn parses_zephyr_version_file() {
        let body = "VERSION_MAJOR = 4\nVERSION_MINOR = 4\nPATCHLEVEL = 0\nEXTRAVERSION =\n";
        assert_eq!(parse_zephyr_version_file(body).as_deref(), Some("4.4"));
        assert_eq!(parse_zephyr_version_file("VERSION_MAJOR = 4\n"), None);
        assert_eq!(parse_zephyr_version_file(""), None);
    }

    #[test]
    fn parses_west_zephyr_pin() {
        let body = "manifest:\n  projects:\n    - name: hal_alif\n      revision: v2.2.0\n    - name: zephyr\n      revision: v4.4.0\n";
        assert_eq!(parse_west_zephyr_pin(body).as_deref(), Some("4.4"));
        // A branch/SHA revision has no MAJOR.MINOR to compare -> None.
        let sha = "manifest:\n  projects:\n    - name: zephyr\n      revision: abcdef1234\n";
        assert_eq!(parse_west_zephyr_pin(sha), None);
        // No zephyr project -> None.
        let none = "manifest:\n  projects:\n    - name: hal_alif\n      revision: v2.2.0\n";
        assert_eq!(parse_west_zephyr_pin(none), None);
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
