// SPDX-License-Identifier: Apache-2.0
//! `alp sdk <list|install|current|switch>` — manage local SDK installs.
//!
//! Mirrors TS `runSdkCommand`: `list` queries the GitHub releases API,
//! `install <version>` git-clones into the cache, `current` reports the active
//! SDK, and `switch <version|path>` repoints it. Network/filesystem effects
//! live here; parsing + readiness logic is in `alp-core::sdk`.

use std::path::{Path, PathBuf};
use std::process::Command;

use alp_core::{
    GITHUB_RELEASES_URL, SdkReadinessReport, SdkReadinessState, SdkRelease, check_sdk_readiness,
    parse_remote_sdk_releases, resolve_active_sdk,
};
use serde::Serialize;

use super::CommandRun;
use crate::cli::{GlobalArgs, SdkArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::generated_at_iso;

const SDK_GIT_URL: &str = "https://github.com/alplabai/alp-sdk.git";

#[derive(Serialize)]
struct ListData {
    subcommand: &'static str,
    releases: Vec<SdkRelease>,
}

#[derive(Serialize)]
struct InstallData {
    subcommand: &'static str,
    version: String,
    #[serde(rename = "sdkPath")]
    sdk_path: String,
    readiness: SdkReadinessReport,
}

#[derive(Serialize)]
struct CurrentData {
    subcommand: &'static str,
    #[serde(rename = "sdkPath")]
    sdk_path: Option<String>,
    readiness: Option<SdkReadinessReport>,
}

#[derive(Serialize)]
struct SwitchData {
    subcommand: &'static str,
    #[serde(rename = "sdkPath")]
    sdk_path: String,
    version: Option<String>,
}

pub fn run(g: &GlobalArgs, args: &SdkArgs) -> CommandRun {
    match args.subcommand.as_deref() {
        Some("list") => run_list(g),
        Some("install") => run_install(g, args),
        Some("current") => run_current(g),
        Some("switch") => run_switch(g, args),
        other => {
            let sub = other.unwrap_or("(none)");
            emit_failure(
                g,
                ListData {
                    subcommand: "list",
                    releases: Vec::new(),
                },
                ExitCode::RuntimeFailure,
                "unknown-subcommand",
                format!("Unknown sdk subcommand: {sub}"),
                vec![
                    format!("sdk: unknown subcommand '{sub}'."),
                    "Available subcommands: list, install <version>, current, switch <version>"
                        .to_string(),
                ],
            )
        }
    }
}

// ── alp sdk list ────────────────────────────────────────────────────────────

fn run_list(g: &GlobalArgs) -> CommandRun {
    let releases = match fetch_releases() {
        Ok(r) => r,
        Err(message) => {
            return emit_failure(
                g,
                ListData {
                    subcommand: "list",
                    releases: Vec::new(),
                },
                ExitCode::RuntimeFailure,
                "fetch-failed",
                message.clone(),
                vec!["sdk list: failed to fetch releases.".to_string(), message],
            );
        }
    };
    let text = format_release_table(&releases);
    emit_success(
        g,
        ListData {
            subcommand: "list",
            releases,
        },
        ExitCode::Success,
        text,
    )
}

fn fetch_releases() -> Result<Vec<SdkRelease>, String> {
    let response = ureq::get(GITHUB_RELEASES_URL)
        .set("User-Agent", "alp-cli/0")
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|e| e.to_string())?;
    let value: serde_json::Value = response.into_json().map_err(|e| e.to_string())?;
    parse_remote_sdk_releases(&value)
}

fn format_release_table(releases: &[SdkRelease]) -> Vec<String> {
    if releases.is_empty() {
        return vec!["No SDK releases found.".to_string()];
    }
    let mut lines = vec![format!("ALP SDK releases ({})", releases.len())];
    for rel in releases {
        let date: String = rel.published_at.chars().take(10).collect();
        let notes = if rel.release_notes_summary.is_empty() {
            String::new()
        } else {
            format!("   {}", truncate(&rel.release_notes_summary, 60))
        };
        lines.push(format!("  {:<12} {date}{notes}", rel.tag));
    }
    lines
}

// ── alp sdk install <version> ────────────────────────────────────────────────

fn run_install(g: &GlobalArgs, args: &SdkArgs) -> CommandRun {
    let Some(version) = args.arg.clone() else {
        return emit_failure(
            g,
            InstallData {
                subcommand: "install",
                version: String::new(),
                sdk_path: String::new(),
                readiness: empty_readiness(""),
            },
            ExitCode::RuntimeFailure,
            "missing-version",
            "Version argument is required.".to_string(),
            vec![
                "sdk install: version argument is required.".to_string(),
                "Usage: alp sdk install <version>".to_string(),
            ],
        );
    };

    let cache_root = args.destination.clone().unwrap_or_else(default_cache_root);
    let dest_path = Path::new(&cache_root).join(&version);
    let dest_str = dest_path.to_string_lossy().to_string();

    let already_installed = dest_path.join("scripts").join("alp_project.py").exists();
    if !already_installed {
        if let Err(message) = git_clone(&version, &dest_path) {
            return emit_failure(
                g,
                InstallData {
                    subcommand: "install",
                    version: version.clone(),
                    sdk_path: dest_str.clone(),
                    readiness: empty_readiness(&dest_str),
                },
                ExitCode::RuntimeFailure,
                "install-failed",
                message.clone(),
                vec!["sdk install: installation failed.".to_string(), message],
            );
        }
    }

    let readiness = readiness_for(&dest_str);
    // Process exit reflects readiness; the envelope field stays success (TS parity).
    let exit = if readiness.state == SdkReadinessState::Missing {
        ExitCode::RuntimeFailure
    } else {
        ExitCode::Success
    };
    let text = format_readiness_block(&format!("SDK {version} installed"), &readiness);
    emit_success(
        g,
        InstallData {
            subcommand: "install",
            version,
            sdk_path: dest_str,
            readiness,
        },
        exit,
        text,
    )
}

fn git_clone(version: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let status = Command::new("git")
        .args(["clone", "--branch", version, "--depth", "1", SDK_GIT_URL])
        .arg(dest)
        .status()
        .map_err(|e| format!("Alp: git clone failed to start: {e}"))?;
    if !status.success() {
        return Err(format!(
            "Alp: git clone failed with exit code {}.",
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ));
    }
    Ok(())
}

// ── alp sdk current ──────────────────────────────────────────────────────────

fn run_current(g: &GlobalArgs) -> CommandRun {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let sdk_path = resolve_active_sdk(
        &cwd.to_string_lossy(),
        |p| Path::new(p).exists(),
        |p| std::fs::read_to_string(p).ok(),
    );
    let readiness = sdk_path.as_deref().map(readiness_for);

    let text = match (&sdk_path, &readiness) {
        (Some(_), Some(report)) => format_readiness_block("Active SDK", report),
        _ => vec![
            "No active SDK configured for this workspace.".to_string(),
            "Run 'alp sdk install <version>' to get started.".to_string(),
        ],
    };
    emit_success(
        g,
        CurrentData {
            subcommand: "current",
            sdk_path,
            readiness,
        },
        ExitCode::Success,
        text,
    )
}

// ── alp sdk switch <version|path> ────────────────────────────────────────────

fn run_switch(g: &GlobalArgs, args: &SdkArgs) -> CommandRun {
    let Some(version_or_path) = args.arg.clone() else {
        return emit_failure(
            g,
            SwitchData {
                subcommand: "switch",
                sdk_path: String::new(),
                version: None,
            },
            ExitCode::RuntimeFailure,
            "missing-version",
            "Version or path argument is required.".to_string(),
            vec![
                "sdk switch: version or path argument is required.".to_string(),
                "Usage: alp sdk switch <version|path>".to_string(),
            ],
        );
    };

    let sdk_path = if Path::new(&version_or_path).is_absolute() {
        version_or_path.clone()
    } else {
        g.sdk_root.clone().unwrap_or_else(|| {
            Path::new(&default_cache_root())
                .join(&version_or_path)
                .to_string_lossy()
                .to_string()
        })
    };

    if !Path::new(&sdk_path).exists() {
        return emit_failure(
            g,
            SwitchData {
                subcommand: "switch",
                sdk_path: sdk_path.clone(),
                version: None,
            },
            ExitCode::RuntimeFailure,
            "path-not-found",
            format!("SDK path not found: {sdk_path}"),
            vec![
                format!("sdk switch: SDK path does not exist: {sdk_path}"),
                "Run 'alp sdk install <version>' first.".to_string(),
            ],
        );
    }

    if let Err(message) = write_active_pointer(&sdk_path) {
        return emit_failure(
            g,
            SwitchData {
                subcommand: "switch",
                sdk_path: sdk_path.clone(),
                version: None,
            },
            ExitCode::RuntimeFailure,
            "switch-failed",
            message.clone(),
            vec![
                "sdk switch: failed to update active SDK pointer.".to_string(),
                message,
            ],
        );
    }

    let readiness = readiness_for(&sdk_path);
    let text = vec![
        format!(
            "Switched active SDK to {}.",
            readiness
                .version
                .clone()
                .unwrap_or_else(|| sdk_path.clone())
        ),
        format!("  path    {sdk_path}"),
        format!("  state   {}", state_label(readiness.state)),
    ];
    emit_success(
        g,
        SwitchData {
            subcommand: "switch",
            sdk_path,
            version: readiness.version,
        },
        ExitCode::Success,
        text,
    )
}

fn write_active_pointer(sdk_path: &str) -> Result<(), String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let dir = cwd.join(".alp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let pointer = serde_json::json!({ "sdkPath": sdk_path, "updatedAt": generated_at_iso() });
    let content = format!(
        "{}\n",
        serde_json::to_string_pretty(&pointer).expect("pointer is serializable")
    );
    std::fs::write(dir.join("sdk-path"), content).map_err(|e| e.to_string())
}

// ── helpers ───────────────────────────────────────────────────────────────

fn readiness_for(sdk_path: &str) -> SdkReadinessReport {
    check_sdk_readiness(
        sdk_path,
        |p| Path::new(p).exists(),
        |p| std::fs::read_to_string(p).ok(),
    )
}

fn empty_readiness(sdk_path: &str) -> SdkReadinessReport {
    SdkReadinessReport {
        sdk_path: sdk_path.to_string(),
        version: None,
        loader_script_present: false,
        metadata_present: false,
        state: SdkReadinessState::Missing,
        issues: Vec::new(),
    }
}

fn default_cache_root() -> String {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".alp")
        .join("sdk-cache")
        .to_string_lossy()
        .to_string()
}

fn state_label(state: SdkReadinessState) -> &'static str {
    match state {
        SdkReadinessState::Ready => "ready",
        SdkReadinessState::Partial => "partial",
        SdkReadinessState::Missing => "missing",
    }
}

fn format_readiness_block(header: &str, report: &SdkReadinessReport) -> Vec<String> {
    let mut lines = vec![
        header.to_string(),
        format!("  path    {}", report.sdk_path),
        format!(
            "  version {}",
            report
                .version
                .clone()
                .unwrap_or_else(|| "(unknown)".to_string())
        ),
        format!("  state   {}", state_label(report.state)),
    ];
    if !report.issues.is_empty() {
        lines.push("  issues:".to_string());
        for issue in &report.issues {
            lines.push(format!("    - {issue}"));
        }
    }
    lines
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect()
    }
}

fn null_project() -> Project {
    Project {
        root: None,
        board_yaml: None,
    }
}

fn emit_success<T: Serialize>(
    g: &GlobalArgs,
    data: T,
    exit: ExitCode,
    text_lines: Vec<String>,
) -> CommandRun {
    let text = if g.is_json() { Vec::new() } else { text_lines };
    // The success-path envelope always carries exitCode 0 (mirrors TS
    // createEnvelope); the process exit may still differ (install → missing).
    let json = g.is_json().then(|| {
        Envelope::new(
            "sdk",
            null_project(),
            data,
            Vec::new(),
            ExitCode::Success.code(),
        )
        .to_json()
    });
    CommandRun { exit, text, json }
}

fn emit_failure<T: Serialize>(
    g: &GlobalArgs,
    data: T,
    exit: ExitCode,
    code: &str,
    message: String,
    text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("sdk.{code}"),
        severity: "error".to_string(),
        message,
    }];
    let text = if g.is_json() { Vec::new() } else { text_lines };
    let json = g
        .is_json()
        .then(|| Envelope::new("sdk", null_project(), data, issues, exit.code()).to_json());
    CommandRun { exit, text, json }
}
