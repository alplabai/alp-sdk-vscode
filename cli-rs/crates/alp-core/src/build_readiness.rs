// SPDX-License-Identifier: Apache-2.0
//! Build-readiness preflight — the toolchains a build (and the Yocto `.wic`
//! flash) needs, keyed off the OSes the active `board.yaml` declares. Used by
//! `alp doctor --build` (and, later, as `alp build`'s preflight).
//!
//! Scope boundary: `board.yaml` alone does not carry each core's *type*
//! (Cortex-M vs Cortex-A) — that resolves from the SoM topology in the SDK
//! metadata (owned by `alp_orchestrate.py`, deliberately not reimplemented here,
//! see EXTENSION_CLI_INTEGRATION.md §9). So we key off cores' explicit `os:`
//! fields; when none are declared we check all three backends. The authoritative
//! per-core resolution stays `west alp-build`'s job — this is advisory.

use std::collections::BTreeSet;

use serde::Serialize;

use crate::debug::{DoctorCheck, DoctorStatus, DoctorSummary};
use crate::model::BoardModel;

/// A build backend a `board.yaml` can target. Serializes lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildOs {
    /// Zephyr RTOS build (west + CMake + Ninja + Zephyr SDK).
    Zephyr,
    /// Yocto Linux image build (Linux-only; bitbake).
    Yocto,
    /// Baremetal build (CMake + a vendor toolchain).
    Baremetal,
}

impl BuildOs {
    fn parse(raw: &str) -> Option<BuildOs> {
        match raw {
            "zephyr" => Some(BuildOs::Zephyr),
            "yocto" => Some(BuildOs::Yocto),
            "baremetal" => Some(BuildOs::Baremetal),
            _ => None,
        }
    }
}

/// The set of build OSes a `board.yaml` declares (top-level `os:` plus each
/// core's explicit `os:`). When nothing is declared, returns all three — the
/// SoM-default OS lives in SDK metadata we don't resolve here.
pub fn board_os_set(board: &BoardModel) -> Vec<BuildOs> {
    let mut set: BTreeSet<BuildOs> = BTreeSet::new();
    if let Some(os) = board.os.as_deref().and_then(BuildOs::parse) {
        set.insert(os);
    }
    if let Some(cores) = &board.cores {
        for core in cores.values() {
            if let Some(os) = core.os.as_deref().and_then(BuildOs::parse) {
                set.insert(os);
            }
        }
    }
    if set.is_empty() {
        return vec![BuildOs::Zephyr, BuildOs::Yocto, BuildOs::Baremetal];
    }
    set.into_iter().collect()
}

/// Host build-tool presence (probed by the caller; kept IO-free here).
#[derive(Debug, Clone, Copy)]
pub struct BuildToolProbe {
    /// `west` is on PATH (Zephyr build driver).
    pub west: bool,
    /// `cmake` is on PATH (Zephyr/baremetal build generator).
    pub cmake: bool,
    /// `ninja` is on PATH (Zephyr build backend).
    pub ninja: bool,
    /// `bitbake` is on PATH (Yocto build driver).
    pub bitbake: bool,
    /// Zephyr SDK toolchain detected (via env / install dir, not PATH).
    pub zephyr_sdk: bool,
    /// `bmaptool` — the preferred Yocto `.wic` flasher (sparse-aware).
    pub bmaptool: bool,
    /// `dd` — the Yocto `.wic` flash fallback when `bmaptool` is absent.
    pub dd: bool,
    /// Host is Linux (gates Yocto builds, which are Linux-only).
    pub is_linux: bool,
}

/// The build-readiness preflight result: declared OS set, per-tool checks, a
/// pass/warn/fail summary, and deduped remediation steps. Serializes camelCase.
#[derive(Debug, Clone, Serialize)]
pub struct BuildReadinessReport {
    /// Report envelope schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    /// Timestamp the report was generated (supplied by the caller).
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    /// The build OSes this report's checks cover.
    #[serde(rename = "osSet")]
    pub os_set: Vec<BuildOs>,
    /// Aggregate pass/warn/fail counts over `checks`.
    pub summary: DoctorSummary,
    /// Per-tool readiness checks.
    pub checks: Vec<DoctorCheck>,
    /// Deduped fix hints for every non-passing check.
    #[serde(rename = "nextSteps")]
    pub next_steps: Vec<String>,
}

/// Assemble the build-readiness report for an OS set + probed host tools.
pub fn build_readiness_report(
    generated_at: String,
    os_set: Vec<BuildOs>,
    probe: &BuildToolProbe,
) -> BuildReadinessReport {
    let mut checks: Vec<DoctorCheck> = Vec::new();
    let mut seen: BTreeSet<&'static str> = BTreeSet::new();

    if os_set.contains(&BuildOs::Zephyr) {
        push_tool(
            &mut checks,
            &mut seen,
            "west",
            probe.west,
            "Zephyr",
            "Install west via `alp bootstrap`.",
        );
        push_tool(
            &mut checks,
            &mut seen,
            "cmake",
            probe.cmake,
            "Zephyr/baremetal",
            "Install CMake (>=3.20).",
        );
        push_tool(
            &mut checks,
            &mut seen,
            "ninja",
            probe.ninja,
            "Zephyr",
            "Install Ninja.",
        );
        // Zephyr SDK is detected (env / install dir), not a PATH binary.
        checks.push(DoctorCheck {
            name: "zephyrSdk".to_string(),
            status: if probe.zephyr_sdk {
                DoctorStatus::Pass
            } else {
                DoctorStatus::Warn
            },
            detail: if probe.zephyr_sdk {
                "Zephyr SDK toolchain detected.".to_string()
            } else {
                "Zephyr SDK toolchain not detected (ZEPHYR_SDK_INSTALL_DIR unset).".to_string()
            },
            fix: if probe.zephyr_sdk {
                None
            } else {
                Some(
                    "Install the Zephyr SDK: https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html"
                        .to_string(),
                )
            },
        });
    }

    if os_set.contains(&BuildOs::Yocto) {
        if probe.is_linux {
            push_tool(
                &mut checks,
                &mut seen,
                "bitbake",
                probe.bitbake,
                "Yocto",
                "Install the Yocto host packages (see docs/getting-started.md).",
            );
            // Flash prerequisite: `alp flash` writes the Yocto `.wic` to SD/eMMC
            // via `bmaptool` (sparse-aware, preferred) and falls back to `dd`.
            // Warn early so the gap shows at doctor time, not mid-flash.
            let (status, detail, fix) = if probe.bmaptool {
                (
                    DoctorStatus::Pass,
                    "bmaptool is available — fast sparse Yocto .wic flashing.".to_string(),
                    None,
                )
            } else if probe.dd {
                (
                    DoctorStatus::Warn,
                    "bmaptool not found; Yocto .wic flash falls back to dd (slower)."
                        .to_string(),
                    Some(
                        "Install bmaptool for sparse .wic flashing (e.g. `apt install bmap-tools`)."
                            .to_string(),
                    ),
                )
            } else {
                (
                    DoctorStatus::Warn,
                    "neither bmaptool nor dd on PATH — Yocto .wic flash (`alp flash`) will fail."
                        .to_string(),
                    Some(
                        "Install bmaptool (`apt install bmap-tools`) or dd (coreutils)."
                            .to_string(),
                    ),
                )
            };
            checks.push(DoctorCheck {
                name: "bmaptool".to_string(),
                status,
                detail,
                fix,
            });
        } else {
            checks.push(DoctorCheck {
                name: "yoctoHost".to_string(),
                status: DoctorStatus::Warn,
                detail: "Yocto builds are Linux-only; use WSL2 or a Linux host/container."
                    .to_string(),
                fix: Some("Run Yocto builds on Linux (WSL2 / Docker).".to_string()),
            });
        }
    }

    if os_set.contains(&BuildOs::Baremetal) {
        push_tool(
            &mut checks,
            &mut seen,
            "cmake",
            probe.cmake,
            "baremetal",
            "Install CMake (>=3.20).",
        );
        checks.push(DoctorCheck {
            name: "vendorToolchain".to_string(),
            status: DoctorStatus::Warn,
            detail: "Baremetal needs a vendor toolchain (Alif/Renesas/NXP), per SoC family."
                .to_string(),
            fix: Some(
                "Install the vendor toolchain for your SoC (see docs/getting-started.md §8)."
                    .to_string(),
            ),
        });
    }

    let summary = DoctorSummary {
        pass: count(&checks, DoctorStatus::Pass),
        warn: count(&checks, DoctorStatus::Warn),
        fail: count(&checks, DoctorStatus::Fail),
    };
    let next_steps = unique_next_steps(&checks);

    BuildReadinessReport {
        schema_version: "1".to_string(),
        generated_at,
        os_set,
        summary,
        checks,
        next_steps,
    }
}

/// Append a PATH-binary readiness check, deduped by `name` (a tool needed by
/// more than one declared OS is reported once).
fn push_tool(
    checks: &mut Vec<DoctorCheck>,
    seen: &mut BTreeSet<&'static str>,
    name: &'static str,
    present: bool,
    need: &str,
    fix: &str,
) {
    if !seen.insert(name) {
        return;
    }
    checks.push(DoctorCheck {
        name: name.to_string(),
        status: if present {
            DoctorStatus::Pass
        } else {
            DoctorStatus::Warn
        },
        detail: if present {
            format!("{name} is available.")
        } else {
            format!("{name} not found on PATH — needed for {need} builds.")
        },
        fix: if present { None } else { Some(fix.to_string()) },
    });
}

fn count(checks: &[DoctorCheck], status: DoctorStatus) -> u32 {
    checks.iter().filter(|c| c.status == status).count() as u32
}

fn unique_next_steps(checks: &[DoctorCheck]) -> Vec<String> {
    let mut steps = Vec::new();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::parse_board_model;

    fn probe_all_present() -> BuildToolProbe {
        BuildToolProbe {
            west: true,
            cmake: true,
            ninja: true,
            bitbake: true,
            zephyr_sdk: true,
            bmaptool: true,
            dd: true,
            is_linux: true,
        }
    }

    #[test]
    fn os_set_from_explicit_core_os() {
        let board = parse_board_model(
            "schema_version: 2\ncores:\n  m55_hp:\n    os: zephyr\n    app: ./src\n  a32:\n    os: yocto\n    app: ./a\n",
        )
        .unwrap();
        assert_eq!(board_os_set(&board), vec![BuildOs::Zephyr, BuildOs::Yocto]);
    }

    #[test]
    fn os_set_falls_back_to_all_when_undeclared() {
        let board =
            parse_board_model("schema_version: 2\ncores:\n  m55_hp:\n    app: ./src\n").unwrap();
        assert_eq!(
            board_os_set(&board),
            vec![BuildOs::Zephyr, BuildOs::Yocto, BuildOs::Baremetal]
        );
    }

    #[test]
    fn zephyr_checks_present_pass_clean() {
        let report =
            build_readiness_report("t".to_string(), vec![BuildOs::Zephyr], &probe_all_present());
        assert_eq!(report.summary.fail, 0);
        assert!(report.summary.warn == 0);
        assert!(
            report
                .checks
                .iter()
                .any(|c| c.name == "west" && c.status == DoctorStatus::Pass)
        );
        assert!(report.checks.iter().any(|c| c.name == "zephyrSdk"));
    }

    #[test]
    fn missing_tools_warn_with_next_steps() {
        let probe = BuildToolProbe {
            west: false,
            cmake: false,
            ninja: false,
            bitbake: false,
            zephyr_sdk: false,
            bmaptool: false,
            dd: false,
            is_linux: true,
        };
        let report = build_readiness_report("t".to_string(), vec![BuildOs::Zephyr], &probe);
        assert!(report.summary.warn >= 4); // west, cmake, ninja, zephyrSdk
        assert_eq!(report.summary.fail, 0);
        assert!(!report.next_steps.is_empty());
    }

    #[test]
    fn cmake_not_duplicated_across_zephyr_and_baremetal() {
        let report = build_readiness_report(
            "t".to_string(),
            vec![BuildOs::Zephyr, BuildOs::Baremetal],
            &probe_all_present(),
        );
        assert_eq!(
            report.checks.iter().filter(|c| c.name == "cmake").count(),
            1
        );
    }

    #[test]
    fn yocto_on_non_linux_warns() {
        let probe = BuildToolProbe {
            is_linux: false,
            ..probe_all_present()
        };
        let report = build_readiness_report("t".to_string(), vec![BuildOs::Yocto], &probe);
        assert!(report.checks.iter().any(|c| c.name == "yoctoHost"));
    }

    #[test]
    fn yocto_flash_checks_bmaptool() {
        // bmaptool present → a passing flash-prereq check.
        let pass =
            build_readiness_report("t".to_string(), vec![BuildOs::Yocto], &probe_all_present());
        assert!(
            pass.checks
                .iter()
                .any(|c| c.name == "bmaptool" && c.status == DoctorStatus::Pass)
        );

        // Neither bmaptool nor dd → warn + a next step (and no bmaptool check for
        // a Zephyr-only project).
        let probe = BuildToolProbe {
            bmaptool: false,
            dd: false,
            ..probe_all_present()
        };
        let warn = build_readiness_report("t".to_string(), vec![BuildOs::Yocto], &probe);
        assert!(
            warn.checks
                .iter()
                .any(|c| c.name == "bmaptool" && c.status == DoctorStatus::Warn)
        );
        let zephyr_only =
            build_readiness_report("t".to_string(), vec![BuildOs::Zephyr], &probe_all_present());
        assert!(!zephyr_only.checks.iter().any(|c| c.name == "bmaptool"));
    }
}
