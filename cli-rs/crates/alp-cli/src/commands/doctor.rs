// SPDX-License-Identifier: Apache-2.0
//! `alp doctor` — diagnose debug readiness for a target/server combination.
//!
//! Mirrors the TypeScript `runDoctorCommand`: resolve the project context,
//! probe runtime capabilities (binaries on PATH), and build a doctor report.
//! Exit code is `doctorFailure` (4) when any check fails, `internalFailure`
//! (5) on an invalid `--target-kind`/`--server`, and `success` (0) otherwise.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use alp_core::{
    BuildOs, BuildToolProbe, DebugServerKind, DebugTargetKind, DebuggerExtensionsState,
    DoctorCheck, DoctorReport, DoctorStatus, DoctorSummary, ProjectContext, board_os_set,
    build_doctor_report, build_readiness_report, collect_runtime_capabilities_from_commands,
    create_debug_workspace_context, is_server_supported_for_target, parse_board_model,
    parse_server_kind, parse_target_kind,
};

use super::CommandRun;
use crate::cli::{BootstrapArgs, DoctorArgs, GlobalArgs};
use crate::commands::build::probe_build_preflight;
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::style::{self, Theme};
use crate::util::{command_on_path, generated_at_iso, resolve_cli_project_context};

/// Entry point for `alp doctor`: dispatches to `--build` readiness, else resolves
/// the debug context, validates `--target-kind`/`--server`, probes runtime
/// capabilities, and emits the doctor report (text or JSON envelope).
pub fn run(g: &GlobalArgs, args: &DoctorArgs) -> CommandRun {
    let generated_at = generated_at_iso();
    if args.build {
        return run_build_readiness(g, &generated_at, args.fix);
    }
    let context = resolve_context(g, &generated_at);

    // Resolved project paths are reported on the success path only (mirrors TS).
    let resolved_project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let target = match parse_target_kind(args.target_kind.as_deref()) {
        Ok(value) => value,
        Err(message) => return internal_failure(g, &generated_at, message),
    };
    let server = match parse_server_kind(args.server.as_deref()) {
        Ok(value) => value,
        Err(message) => return internal_failure(g, &generated_at, message),
    };

    if !is_server_supported_for_target(target, server) {
        return unsupported_server(g, &generated_at, target, server);
    }

    let runtime =
        collect_runtime_capabilities_from_commands(&project_context(&context), command_on_path);
    let mut report = build_doctor_report(&context, target, server, &runtime);
    append_sdk_provenance(
        &mut report.checks,
        &mut report.summary,
        context.sdk_root.as_deref(),
    );
    append_path_shadow_check(&mut report.checks, &mut report.summary);

    let exit = if report.summary.fail > 0 {
        ExitCode::DoctorFailure
    } else {
        ExitCode::Success
    };
    let issues = checks_to_issues(&report.checks);
    let text = if g.is_json() {
        Vec::new()
    } else {
        format_doctor_text(g, &report)
    };
    let json = g
        .is_json()
        .then(|| Envelope::new("doctor", resolved_project, report, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

/// `alp doctor --build` — build-readiness preflight. Resolves the OS set from
/// the active `board.yaml` (explicit core `os:` fields; all three when none are
/// declared), probes host build tools, and reports per-OS toolchain readiness.
/// Advisory only — the authoritative per-core resolution stays `west alp-build`.
fn run_build_readiness(g: &GlobalArgs, generated_at: &str, fix: bool) -> CommandRun {
    let mut context = resolve_cli_project_context(g);

    // `--fix`: when no Zephyr workspace is resolved, bootstrap one on demand
    // (reuses a compatible Zephyr, else bootstraps), then re-resolve the context.
    if fix
        && probe_build_preflight(g, &context)
            .iter()
            .any(|c| c.name == "workspace" && c.status == DoctorStatus::Fail)
    {
        let _ = crate::commands::bootstrap::run(
            g,
            &BootstrapArgs {
                no_pip: false,
                no_west: false,
                print_env: false,
            },
        );
        context = resolve_cli_project_context(g);
    }

    let resolved_project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };

    let os_set = read_board_model(&context)
        .map(|board| board_os_set(&board))
        .unwrap_or_else(|| vec![BuildOs::Zephyr, BuildOs::Yocto, BuildOs::Baremetal]);

    let probe = BuildToolProbe {
        west: command_on_path("west"),
        cmake: command_on_path("cmake"),
        ninja: command_on_path("ninja"),
        bitbake: command_on_path("bitbake"),
        zephyr_sdk: zephyr_sdk_detected(),
        bmaptool: command_on_path("bmaptool"),
        dd: command_on_path("dd"),
        is_linux: cfg!(target_os = "linux"),
    };

    let mut report = build_readiness_report(generated_at.to_string(), os_set, &probe);
    append_sdk_provenance(
        &mut report.checks,
        &mut report.summary,
        context.sdk_root.as_deref(),
    );
    append_path_shadow_check(&mut report.checks, &mut report.summary);

    // Real gate: prepend the project/workspace readiness (can a build even
    // start?) ahead of the host-tool probes, sharing `alp build`'s pre-flight
    // checks so `doctor` and `build` agree on what "ready" means.
    for check in probe_build_preflight(g, &context).into_iter().rev() {
        match check.status {
            DoctorStatus::Pass => report.summary.pass += 1,
            DoctorStatus::Warn => report.summary.warn += 1,
            DoctorStatus::Fail => report.summary.fail += 1,
        }
        report.checks.insert(0, check);
    }

    let exit = if report.summary.fail > 0 {
        ExitCode::DoctorFailure
    } else {
        ExitCode::Success
    };
    let issues = checks_to_issues(&report.checks);
    let text = if g.is_json() {
        Vec::new()
    } else {
        format_build_text(g, &report)
    };
    let json = g
        .is_json()
        .then(|| Envelope::new("doctor", resolved_project, report, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

/// Append an SDK-provenance check (conformance Issue 4 + 6): records the SDK
/// checkout's git short-commit and `metadata/sdk_version.yaml`, so a build plan
/// can be traced to the planner that produced it, and warns when the checkout
/// is behind its upstream tracking ref.
fn append_sdk_provenance(
    checks: &mut Vec<DoctorCheck>,
    summary: &mut DoctorSummary,
    sdk_root: Option<&str>,
) {
    let Some(root) = sdk_root else {
        return;
    };

    let commit = git_short_commit(root);
    let version = read_sdk_version(root);

    let mut detail = match (&version, &commit) {
        (Some(v), Some(c)) => format!("alp-sdk {v} @ {c}"),
        (None, Some(c)) => format!("alp-sdk @ {c}"),
        (Some(v), None) => format!("alp-sdk {v}"),
        (None, None) => {
            format!("alp-sdk at {root} (no git checkout / metadata/sdk_version.yaml)")
        }
    };

    // Advisory: reads the local remote-tracking ref, performs no network fetch,
    // so it only reflects the checkout's state as of the last `git fetch`.
    let (status, fix) = match git_behind_upstream(root) {
        Some(n) if n > 0 => {
            detail = format!("{detail} — {n} commit(s) behind upstream");
            (
                DoctorStatus::Warn,
                Some(format!("Update the SDK checkout: git -C {root} pull")),
            )
        }
        _ => (DoctorStatus::Pass, None),
    };

    match status {
        DoctorStatus::Pass => summary.pass += 1,
        DoctorStatus::Warn => summary.warn += 1,
        DoctorStatus::Fail => summary.fail += 1,
    }
    checks.push(DoctorCheck {
        name: "sdkProvenance".to_string(),
        status,
        detail,
        fix,
    });
}

/// `git -C <root> rev-parse --short HEAD`, or `None` when `root` is not a git
/// checkout (e.g. an extracted SDK release archive).
fn git_short_commit(root: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", root, "rev-parse", "--short", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let commit = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!commit.is_empty()).then_some(commit)
}

/// Count of commits `HEAD` is behind its upstream tracking ref, without
/// fetching. `None` when there is no upstream or `root` is not a git checkout.
fn git_behind_upstream(root: &str) -> Option<u32> {
    let output = std::process::Command::new("git")
        .args(["-C", root, "rev-list", "--count", "HEAD..@{upstream}"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()?.trim().parse().ok()
}

/// Read a version from `<root>/metadata/sdk_version.yaml`: a `version: X` line
/// if present, else the first bare scalar. `None` when the file is absent.
fn read_sdk_version(root: &str) -> Option<String> {
    let path = Path::new(root).join("metadata").join("sdk_version.yaml");
    let text = std::fs::read_to_string(path).ok()?;
    let mut bare: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("version:") {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        } else if bare.is_none() && !line.contains(':') {
            bare = Some(line.trim_matches('"').trim_matches('\'').to_string());
        }
    }
    bare
}

/// Append a `pathShadow` check (advisory only — never fails doctor, mirrors
/// `sdkProvenance`'s Warn-only shape): warns when a *different* `alp` resolves
/// ahead of this running binary on `PATH`, but ONLY when that shadow looks
/// like the SDK's Python/venv CLI — see `path_shadow_warning` for why this
/// check's scope stops there. Adds nothing to the report when PATH resolves
/// to this same binary, to nothing at all, or to a shadow that isn't the
/// Python CLI — all healthy, unremarkable cases.
fn append_path_shadow_check(checks: &mut Vec<DoctorCheck>, summary: &mut DoctorSummary) {
    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    let Some(path_var) = std::env::var_os("PATH") else {
        return;
    };
    let Some(shadow) = find_shadowing_alp(&path_var, &current_exe) else {
        return;
    };
    let Some(check) = path_shadow_warning(&shadow, &read_file_head, &current_exe) else {
        return;
    };

    summary.warn += 1;
    checks.push(check);
}

/// Build the `pathShadow` Warn check for a detected shadow, or `None` when
/// the shadow shouldn't be warned about at all. This check's ONLY target is
/// the Python/venv `alp` collision: after `alp bootstrap`, its underlying
/// `scripts/bootstrap.sh` tells the user to `source .venv/bin/activate`, and
/// an activated venv's `bin`/`Scripts` dir then wins PATH resolution over
/// wherever this native CLI is installed, so the *next* `alp` invocation
/// silently runs the SDK's Python CLI instead — that's worth a warning +
/// `deactivate`/reorder-PATH fix. A node launcher (the npm shim's
/// `#!/usr/bin/env node` script that itself spawns
/// `node_modules/@alplabai/alp-cli/binary/alp`) or a sibling copy of the
/// native binary elsewhere on PATH is a normal, healthy resolver arrangement,
/// NOT this footgun — warning there would be a permanent false positive that
/// wrongly tells the user to `deactivate`/reorder PATH, which would bypass
/// the managed install instead of fixing anything. `looks_like_python_cli`
/// (venv-shim path shape or a `python` shebang) is the sole gate.
fn path_shadow_warning(
    shadow: &Path,
    read_head: &impl Fn(&Path) -> Option<Vec<u8>>,
    current_exe: &Path,
) -> Option<DoctorCheck> {
    if !looks_like_python_cli(shadow, read_head) {
        return None;
    }

    let shadow_str = shadow.to_string_lossy();
    let detail = format!(
        "Another `alp` shadows this native CLI on PATH: {shadow_str} (looks like the SDK's \
         Python CLI). A venv-activated shell may run the wrong `alp`."
    );
    let fix = Some(format!(
        "Run `deactivate` (or reorder PATH) so {} resolves first.",
        current_exe.display()
    ));

    Some(DoctorCheck {
        name: "pathShadow".to_string(),
        status: DoctorStatus::Warn,
        detail,
        fix,
    })
}

/// Find the first `alp`/`alp.exe` that PATH resolution would hit, scanning
/// `path_var` left to right. Returns `None` when the first hit is this same
/// running binary (the healthy case — nothing shadows it) or when no `alp`
/// is found on PATH at all.
fn find_shadowing_alp(path_var: &OsStr, current_exe: &Path) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "alp.exe" } else { "alp" };
    let dirs: Vec<PathBuf> = std::env::split_paths(path_var).collect();
    find_shadowing_alp_with(&dirs, exe_name, &|p| p.is_file(), &|p| {
        same_binary(p, current_exe)
    })
}

/// Pure PATH-scan core of [`find_shadowing_alp`]: `exists`/`is_current` are
/// injected so this is unit-testable without touching the real filesystem.
fn find_shadowing_alp_with(
    dirs: &[PathBuf],
    exe_name: &str,
    exists: &impl Fn(&Path) -> bool,
    is_current: &impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    for dir in dirs {
        let candidate = dir.join(exe_name);
        if !exists(&candidate) {
            continue;
        }
        if is_current(&candidate) {
            // PATH resolution stops here, and it's us — no shadow.
            return None;
        }
        return Some(candidate);
    }
    None
}

/// Whether `a` and `b` name the same file on disk, resolving symlinks when
/// possible (a `alp` copied or symlinked onto PATH still counts as "us"); a
/// path that can't be canonicalized (doesn't exist, permissions) falls back
/// to plain path equality.
fn same_binary(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

/// Heuristic: does `path` look like the SDK's Python `alp` shim rather than
/// another copy of the native binary? True when the path runs through a
/// `.venv`/`venv` virtualenv's `bin` (POSIX) or `Scripts` (Windows) directory,
/// or when the file's first line is a `#!` shebang naming a `python`
/// interpreter. `read_head` is injected for unit testing.
fn looks_like_python_cli(path: &Path, read_head: &impl Fn(&Path) -> Option<Vec<u8>>) -> bool {
    looks_like_venv_shim(path) || read_head(path).is_some_and(|head| shebang_names_python(&head))
}

/// True when `path` has a `.venv`/`venv` component immediately followed by a
/// `bin`/`Scripts` component (e.g. `project/.venv/bin/alp`,
/// `project\venv\Scripts\alp.exe`) — the shape of a virtualenv's shim dir.
/// Splits on `/` and `\` directly (rather than `Path::components()`) so the
/// check is host-OS independent: `Path` only treats `\` as a separator on
/// Windows, but a Windows-style shadow path can be reported while running on
/// any host (and is worth recognizing in tests on any host too).
fn looks_like_venv_shim(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    let comps: Vec<&str> = path_str.split(['/', '\\']).collect();
    comps.iter().enumerate().any(|(i, c)| {
        (*c == ".venv" || *c == "venv")
            && comps
                .get(i + 1)
                .is_some_and(|next| *next == "bin" || *next == "Scripts")
    })
}

/// True when `head` (a file's leading bytes) starts with a `#!` shebang line
/// that names a `python` interpreter (e.g. `#!/usr/bin/env python3`).
fn shebang_names_python(head: &[u8]) -> bool {
    if !head.starts_with(b"#!") {
        return false;
    }
    let line_end = head.iter().position(|&b| b == b'\n').unwrap_or(head.len());
    String::from_utf8_lossy(&head[..line_end]).contains("python")
}

/// Read up to the first 256 bytes of `path`, for shebang sniffing. `None` on
/// any I/O error (missing file, permissions, …).
fn read_file_head(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 256];
    let n = file.read(&mut buf).ok()?;
    buf.truncate(n);
    Some(buf)
}

/// Read + parse the active `board.yaml`, returning `None` when it is absent or
/// unparseable (the preflight then falls back to checking all three backends).
fn read_board_model(context: &ProjectContext) -> Option<alp_core::BoardModel> {
    let path = context.board_yaml_path.as_deref()?;
    let source = std::fs::read_to_string(path).ok()?;
    parse_board_model(&source).ok()
}

/// Detect a Zephyr SDK install without spawning anything: honor
/// `ZEPHYR_SDK_INSTALL_DIR`, else look for a `zephyr-sdk-*` directory in the
/// usual install roots (home + `/opt`).
fn zephyr_sdk_detected() -> bool {
    if std::env::var_os("ZEPHYR_SDK_INSTALL_DIR").is_some() {
        return true;
    }
    let mut roots: Vec<PathBuf> = vec![PathBuf::from("/opt")];
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        roots.push(PathBuf::from(home));
    }
    roots.iter().any(|root| {
        std::fs::read_dir(root)
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("zephyr-sdk")
                })
            })
            .unwrap_or(false)
    })
}

/// Render the `--build` readiness report as human-readable lines, with the
/// resolved OS set (e.g. `zephyr · yocto`) as the subtitle.
fn format_build_text(g: &GlobalArgs, report: &alp_core::BuildReadinessReport) -> Vec<String> {
    let subtitle = report
        .os_set
        .iter()
        .map(|os| {
            serde_json::to_value(os)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" · ");
    style::render_report(
        g,
        "alp doctor --build",
        &subtitle,
        &report.checks,
        &report.summary,
        &report.next_steps,
    )
}

/// Resolve the debug workspace context, mirroring TS `resolveCliDebugContext`.
fn resolve_context(g: &GlobalArgs, generated_at: &str) -> alp_core::DebugWorkspaceContext {
    let project = resolve_cli_project_context(g);

    // The CLI assumes the marquee debugger extensions are present (it cannot
    // probe VS Code), matching the TS CLI's resolveCliDebugContext.
    let extensions = DebuggerExtensionsState {
        cortex_debug: true,
        peripheral_viewer: true,
        memory_view: true,
        cpp_tools: true,
        code_lldb: true,
    };
    create_debug_workspace_context(
        &project,
        generated_at.to_string(),
        |path| Path::new(path).exists(),
        extensions,
    )
}

/// Rebuild a `ProjectContext` view from the resolved debug context so the
/// runtime-capability probe can read the python binary.
fn project_context(context: &alp_core::DebugWorkspaceContext) -> ProjectContext {
    ProjectContext {
        workspace_root: context.workspace_root.clone(),
        sdk_root: context.sdk_root.clone(),
        board_yaml_path: context.board_yaml_path.clone(),
        west_cwd: None,
        python_binary: context.python_binary.clone(),
    }
}

/// Map non-passing `DoctorCheck`s to envelope `Issue`s, prefixing the check name
/// with `doctor.` and mapping `Fail`/`Warn` status to `error`/`warning` severity.
fn checks_to_issues(checks: &[DoctorCheck]) -> Vec<Issue> {
    checks
        .iter()
        .filter(|c| c.status != DoctorStatus::Pass)
        .map(|c| Issue {
            code: format!("doctor.{}", c.name),
            severity: if c.status == DoctorStatus::Fail {
                "error".to_string()
            } else {
                "warning".to_string()
            },
            message: c.detail.clone(),
        })
        .collect()
}

/// Render the doctor report as human-readable lines, with `<target> · <server>`
/// as the subtitle.
fn format_doctor_text(g: &GlobalArgs, report: &DoctorReport) -> Vec<String> {
    let subtitle = format!(
        "{} · {}",
        report.target_kind.as_str(),
        report.server.as_str()
    );
    style::render_report(
        g,
        "alp doctor",
        &subtitle,
        &report.checks,
        &report.summary,
        &report.next_steps,
    )
}

/// Build a checkless `DoctorReport` (summary `fail: 1`) for error paths, carrying
/// the given `target`/`server` and `next_steps` hints.
fn empty_report(
    generated_at: &str,
    target: DebugTargetKind,
    server: DebugServerKind,
    next_steps: Vec<String>,
) -> DoctorReport {
    DoctorReport {
        generated_at: generated_at.to_string(),
        target_kind: target,
        server,
        summary: DoctorSummary {
            pass: 0,
            warn: 0,
            fail: 1,
        },
        checks: Vec::new(),
        next_steps,
    }
}

/// Build the `DoctorFailure` (exit 4) result when `server` is not supported for
/// `target`: a `doctor.server-compatibility` issue plus an empty report.
fn unsupported_server(
    g: &GlobalArgs,
    generated_at: &str,
    target: DebugTargetKind,
    server: DebugServerKind,
) -> CommandRun {
    let issues = vec![Issue {
        code: "doctor.server-compatibility".to_string(),
        severity: "error".to_string(),
        message: format!(
            "Server '{}' is not supported for '{}'.",
            server.as_str(),
            target.as_str()
        ),
    }];
    let data = empty_report(
        generated_at,
        target,
        server,
        vec!["Choose a supported server for the selected target-kind.".to_string()],
    );
    let text = if g.is_json() {
        Vec::new()
    } else {
        Theme::from_args(g).error_lines(&format!(
            "Server '{}' is not supported for target '{}'.",
            server.as_str(),
            target.as_str()
        ))
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "doctor",
            null_project(),
            data,
            issues,
            ExitCode::DoctorFailure.code(),
        )
        .to_json()
    });

    CommandRun {
        exit: ExitCode::DoctorFailure,
        text,
        json,
    }
}

/// Build the `InternalFailure` (exit 5) result for an invalid `--target-kind`
/// or `--server`: a `doctor.internal-failure` issue plus an empty report.
fn internal_failure(g: &GlobalArgs, generated_at: &str, message: String) -> CommandRun {
    let issues = vec![Issue {
        code: "doctor.internal-failure".to_string(),
        severity: "error".to_string(),
        message: message.clone(),
    }];
    let data = empty_report(
        generated_at,
        DebugTargetKind::NativeHost,
        DebugServerKind::None,
        Vec::new(),
    );
    let text = if g.is_json() {
        Vec::new()
    } else {
        Theme::from_args(g).error_lines(&message)
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "doctor",
            null_project(),
            data,
            issues,
            ExitCode::InternalFailure.code(),
        )
        .to_json()
    });

    CommandRun {
        exit: ExitCode::InternalFailure,
        text,
        json,
    }
}

/// A `Project` with no resolved paths, used on error envelopes where the
/// workspace was never resolved.
fn null_project() -> Project {
    Project {
        root: None,
        board_yaml: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shadow_scan_finds_nothing_when_no_dirs_have_alp() {
        let dirs = vec![PathBuf::from("/usr/bin"), PathBuf::from("/usr/local/bin")];
        let got = find_shadowing_alp_with(&dirs, "alp", &|_| false, &|_| false);
        assert_eq!(got, None);
    }

    #[test]
    fn shadow_scan_stops_at_the_current_binary() {
        // The first hit on PATH is us — no shadow, even though a later dir
        // also has an `alp` (PATH resolution never reaches it).
        let dirs = vec![PathBuf::from("/usr/local/bin"), PathBuf::from("/opt/alp")];
        let got = find_shadowing_alp_with(&dirs, "alp", &|_| true, &|p| {
            p == Path::new("/usr/local/bin/alp")
        });
        assert_eq!(got, None);
    }

    #[test]
    fn shadow_scan_reports_the_first_different_hit() {
        let dirs = vec![
            PathBuf::from("/home/dev/project/.venv/bin"),
            PathBuf::from("/usr/local/bin"),
        ];
        let got = find_shadowing_alp_with(&dirs, "alp", &|_| true, &|_| false);
        assert_eq!(got, Some(PathBuf::from("/home/dev/project/.venv/bin/alp")));
    }

    #[test]
    fn venv_shim_matches_posix_and_windows_shapes() {
        assert!(looks_like_venv_shim(Path::new(
            "/home/dev/project/.venv/bin/alp"
        )));
        assert!(looks_like_venv_shim(Path::new(
            r"C:\project\venv\Scripts\alp.exe"
        )));
        assert!(!looks_like_venv_shim(Path::new("/usr/local/bin/alp")));
        // A folder that merely contains "venv" as a substring, but isn't the
        // exact component, must not false-positive.
        assert!(!looks_like_venv_shim(Path::new("/opt/my-venv-tools/alp")));
    }

    #[test]
    fn shebang_detection_matches_only_python_interpreters() {
        assert!(shebang_names_python(b"#!/usr/bin/env python3\nprint(1)\n"));
        assert!(shebang_names_python(b"#!/usr/bin/python\nimport sys\n"));
        assert!(!shebang_names_python(b"#!/bin/bash\necho hi\n"));
        assert!(!shebang_names_python(b"not a shebang at all"));
    }

    #[test]
    fn looks_like_python_cli_falls_back_to_shebang_when_not_in_a_venv_dir() {
        let path = Path::new("/usr/local/bin/alp");
        assert!(looks_like_python_cli(path, &|_| Some(
            b"#!/usr/bin/env python3\n".to_vec()
        )));
        assert!(!looks_like_python_cli(path, &|_| Some(
            b"#!/bin/sh\n".to_vec()
        )));
        assert!(!looks_like_python_cli(path, &|_| None));
    }

    #[test]
    fn path_shadow_warning_fires_for_a_python_venv_shadow() {
        let shadow = Path::new("/project/.venv/bin/alp");
        let current = Path::new("/usr/local/bin/alp");
        let check = path_shadow_warning(shadow, &|_| None, current).expect("venv shadow must warn");
        assert_eq!(check.name, "pathShadow");
        assert_eq!(check.status, DoctorStatus::Warn);
        assert!(check.detail.contains("Python CLI"));
        assert!(check.fix.unwrap().contains("deactivate"));
    }

    #[test]
    fn path_shadow_warning_fires_for_a_bare_python_shebang_shadow() {
        let shadow = Path::new("/usr/local/bin/alp");
        let current = Path::new("/opt/alp/bin/alp");
        let check = path_shadow_warning(
            shadow,
            &|_| Some(b"#!/usr/bin/env python3\n".to_vec()),
            current,
        )
        .expect("python shebang shadow must warn");
        assert_eq!(check.status, DoctorStatus::Warn);
    }

    #[test]
    fn path_shadow_warning_is_silent_for_a_node_launcher() {
        // F4: the npm shim's `#!/usr/bin/env node` launcher (which itself
        // spawns node_modules/@alplabai/alp-cli/binary/alp) is a normal,
        // healthy resolver arrangement -- not the Python/venv collision this
        // check exists for. Must not warn, and must not advise deactivate.
        let shadow = Path::new("/usr/local/lib/node_modules/@alplabai/alp-cli/bin/alp");
        let current = Path::new("/opt/alp/bin/alp");
        let check = path_shadow_warning(
            shadow,
            &|_| Some(b"#!/usr/bin/env node\n".to_vec()),
            current,
        );
        assert!(check.is_none());
    }

    #[test]
    fn path_shadow_warning_is_silent_for_a_sibling_native_binary() {
        // A second native `alp` copy elsewhere on PATH (e.g. a Homebrew
        // install alongside the managed cache) is not a venv shim and has no
        // shebang at all -- also not this check's target.
        let shadow = Path::new("/opt/homebrew/bin/alp");
        let current = Path::new("/opt/alp/bin/alp");
        let check = path_shadow_warning(shadow, &|_| None, current);
        assert!(check.is_none());
    }

    #[test]
    fn append_path_shadow_check_is_noop_absent_env_signal() {
        // No PATH shadow expected on the actual test host in the overwhelming
        // common case; this exercises the real `std::env` lookups end-to-end
        // and just asserts the function never panics and never turns doctor
        // red (only ever appends a Warn, never a Fail).
        let mut checks = Vec::new();
        let mut summary = DoctorSummary {
            pass: 0,
            warn: 0,
            fail: 0,
        };
        append_path_shadow_check(&mut checks, &mut summary);
        assert_eq!(summary.fail, 0);
        if let Some(check) = checks.first() {
            assert_eq!(check.name, "pathShadow");
            assert_eq!(check.status, DoctorStatus::Warn);
        }
    }

    #[test]
    fn issues_skip_passing_checks() {
        let checks = vec![
            DoctorCheck {
                name: "ok".to_string(),
                status: DoctorStatus::Pass,
                detail: "fine".to_string(),
                fix: None,
            },
            DoctorCheck {
                name: "warned".to_string(),
                status: DoctorStatus::Warn,
                detail: "careful".to_string(),
                fix: Some("do x".to_string()),
            },
            DoctorCheck {
                name: "broken".to_string(),
                status: DoctorStatus::Fail,
                detail: "nope".to_string(),
                fix: Some("do y".to_string()),
            },
        ];
        let issues = checks_to_issues(&checks);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].code, "doctor.warned");
        assert_eq!(issues[0].severity, "warning");
        assert_eq!(issues[1].code, "doctor.broken");
        assert_eq!(issues[1].severity, "error");
    }

    #[test]
    fn unsupported_server_emits_doctor_failure_envelope() {
        let g = GlobalArgs {
            project: None,
            board_yaml: None,
            sdk_root: None,
            target: None,
            all: false,
            format: crate::cli::Format::Json,
            verbose: false,
            quiet: false,
            no_color: false,
            non_interactive: false,
            ci: false,
        };
        let run = unsupported_server(
            &g,
            "1970-01-01T00:00:00.000Z",
            DebugTargetKind::NativeHost,
            DebugServerKind::Jlink,
        );
        assert_eq!(run.exit, ExitCode::DoctorFailure);
        let json = run.json.expect("json envelope");
        assert!(json.contains("\"command\":\"doctor\""));
        assert!(json.contains("\"exitCode\":4"));
        assert!(json.contains("\"ok\":false"));
        assert!(json.contains("\"root\":null"));
        assert!(json.contains("doctor.server-compatibility"));
        assert!(json.contains("\"checks\":[]"));
        assert!(json.contains("Server 'jlink' is not supported for 'native-host'."));
        assert!(json.contains("Choose a supported server for the selected target-kind."));
    }
}
