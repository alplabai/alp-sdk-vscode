// SPDX-License-Identifier: Apache-2.0
//! Small shared helpers for command implementations.

use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use alp_core::{
    ProjectContext, ProjectResolutionInput, ProjectSettings, format_iso8601_utc,
    resolve_active_sdk, resolve_project_context,
};

use crate::cli::GlobalArgs;

/// Current UTC instant as an ISO-8601 string. Honors `SOURCE_DATE_EPOCH` for
/// reproducible output (tests, CI snapshots). Shared by doctor/inspect/trace.
pub fn generated_at_iso() -> String {
    if let Ok(raw) = std::env::var("SOURCE_DATE_EPOCH") {
        if let Ok(secs) = raw.trim().parse::<i64>() {
            return format_iso8601_utc(secs, 0);
        }
    }
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => format_iso8601_utc(d.as_secs() as i64, d.subsec_millis()),
        Err(_) => format_iso8601_utc(0, 0),
    }
}

/// Whether `command` resolves on PATH, via `which`/`where` (mirrors the TS
/// CLI's `commandExistsOnPath`). Shared by doctor + support-bundle.
pub fn command_on_path(command: &str) -> bool {
    let resolver = if cfg!(windows) { "where" } else { "which" };
    Command::new(resolver)
        .arg(command)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Whether a build tool resolves on this host: an absolute path (e.g. a venv
/// `west`) must exist on disk; a bare name must be on PATH. The single gate
/// predicate shared by the build pre-flight probe and the slice executor —
/// keep them answering the same question so preflight verdicts match what
/// actually runs.
pub fn tool_available(tool: &str) -> bool {
    let path = Path::new(tool);
    if path.is_absolute() {
        path.exists()
    } else {
        command_on_path(tool)
    }
}

/// Lexically normalize a path (collapse `.` and `..`) without touching the
/// filesystem, mirroring Node's `path.resolve` behavior on the joined result.
pub fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Resolve the workspace root from `--project` (joined to CWD) or CWD itself.
/// Unnormalized join, matching the resolution `generate`/`init`/`examples` use
/// before probing for the SDK checkout.
pub fn cli_workspace_root(g: &GlobalArgs) -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match &g.project {
        Some(project) => cwd.join(project),
        None => cwd,
    }
}

/// True if `root` contains `scripts/alp_project.py`, marking it a valid SDK root.
pub fn has_loader_script(root: &Path) -> bool {
    root.join("scripts").join("alp_project.py").exists()
}

/// The explicit SDK path to honor before auto-discovery, in precedence order:
/// `--sdk-root` (terminal — returned as-is so the caller's loader check fails
/// loudly on a bad path), then the workspace active-SDK pointer
/// (`.alp/sdk-path`, written by `alp sdk switch`). The pointer is best-effort:
/// it is only returned when it still points at a real checkout (`has_loader`),
/// so a stale pointer silently falls through to auto-discovery instead of
/// locking the user out. Returns `""` when neither applies. Pure — filesystem
/// access is injected for unit testing.
fn effective_sdk_path_with(
    sdk_root_arg: Option<&str>,
    workspace_root: &str,
    has_loader: &impl Fn(&str) -> bool,
    path_exists: &impl Fn(&str) -> bool,
    read_file: &impl Fn(&str) -> Option<String>,
) -> String {
    if let Some(root) = sdk_root_arg {
        if !root.trim().is_empty() {
            return root.to_string();
        }
    }
    match resolve_active_sdk(workspace_root, path_exists, read_file) {
        Some(pointer) if has_loader(&pointer) => pointer,
        _ => String::new(),
    }
}

/// Filesystem-backed [`effective_sdk_path_with`]: `--sdk-root` > `.alp/sdk-path`
/// pointer (best-effort) > `""` (auto-discovery).
fn effective_sdk_path(g: &GlobalArgs, workspace_root: &Path) -> String {
    effective_sdk_path_with(
        g.sdk_root.as_deref(),
        &workspace_root.to_string_lossy(),
        &|p| has_loader_script(Path::new(p)),
        &|p| Path::new(p).exists(),
        &|p| std::fs::read_to_string(p).ok(),
    )
}

/// Resolve the alp-sdk root: honor `--sdk-root` when it has the loader script,
/// then the workspace active-SDK pointer (`.alp/sdk-path`), otherwise probe the
/// workspace and sibling `alp-sdk` / `alp-sdk-upstream` dirs. Shared by
/// `generate` (codegen), `init --from-example`, and `examples`.
pub fn resolve_sdk_root(g: &GlobalArgs, workspace_root: &Path) -> Option<PathBuf> {
    if let Some(root) = &g.sdk_root {
        let candidate = PathBuf::from(root);
        if has_loader_script(&candidate) {
            return Some(candidate);
        }
        return None;
    }

    // Workspace active-SDK pointer (`alp sdk switch`); best-effort — only when it
    // still points at a real checkout, else fall through to auto-discovery.
    if let Some(pointer) = resolve_active_sdk(
        &workspace_root.to_string_lossy(),
        |p| Path::new(p).exists(),
        |p| std::fs::read_to_string(p).ok(),
    ) {
        let candidate = PathBuf::from(&pointer);
        if has_loader_script(&candidate) {
            return Some(candidate);
        }
    }

    let parent = workspace_root.parent().map(Path::to_path_buf);
    let candidates = [
        workspace_root.to_path_buf(),
        parent
            .as_ref()
            .map(|p| p.join("alp-sdk"))
            .unwrap_or_else(|| PathBuf::from("alp-sdk")),
        parent
            .as_ref()
            .map(|p| p.join("alp-sdk-upstream"))
            .unwrap_or_else(|| PathBuf::from("alp-sdk-upstream")),
    ];

    candidates.into_iter().find(|c| has_loader_script(c))
}

/// Discover the project root for a board.yaml-consuming command. An explicit
/// `--project` wins. An explicit `--board-yaml` keeps `cwd` as the root, so the
/// board file and `.alp/sdk-path` resolve relative to where the user invoked
/// (unchanged behavior). With NEITHER flag, walk UP from `cwd` to the nearest
/// ancestor that holds a `board.yaml` — so a bare `alp build` works from any
/// subdirectory of a project, the way git finds `.git`. Falls back to `cwd`
/// when no marker is found, preserving the "no board.yaml — run `alp init`"
/// error. `has_board_yaml` is injected for tests.
fn discover_workspace_root(
    cwd: &Path,
    project_arg: Option<&str>,
    board_yaml_arg: Option<&str>,
    has_board_yaml: &impl Fn(&Path) -> bool,
) -> PathBuf {
    if let Some(project) = project_arg {
        return normalize_path(&cwd.join(project));
    }
    if board_yaml_arg.is_some() {
        return normalize_path(cwd);
    }
    let start = normalize_path(cwd);
    let mut dir = Some(start.as_path());
    while let Some(current) = dir {
        if has_board_yaml(current) {
            return current.to_path_buf();
        }
        dir = current.parent();
    }
    start
}

/// Resolve the project context from the global args, mirroring the TS commands'
/// `path.resolve(cwd, project) + resolveProjectContext` boilerplate. Shared by
/// `validate`, `diff`, `presets`, and `doctor`.
pub fn resolve_cli_project_context(g: &GlobalArgs) -> ProjectContext {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let workspace_root = discover_workspace_root(
        &cwd,
        g.project.as_deref(),
        g.board_yaml.as_deref(),
        &|dir| dir.join("board.yaml").exists(),
    )
    .to_string_lossy()
    .to_string();

    let settings = ProjectSettings {
        // `--sdk-root` > `.alp/sdk-path` pointer > `""` (core auto-discovery).
        sdk_path: effective_sdk_path(g, Path::new(&workspace_root)),
        python_path: String::new(),
        board_yaml_path: g
            .board_yaml
            .clone()
            .unwrap_or_else(|| "board.yaml".to_string()),
        west_cwd: String::new(),
    };
    resolve_project_context(
        &ProjectResolutionInput {
            workspace_folders: vec![workspace_root],
            settings,
            is_windows: cfg!(windows),
        },
        |p| Path::new(p).exists(),
    )
}

// ── ~/.alp home + SDK install roots (issue #121 stage 1) ──────────────────────

/// Resolve the user's home directory: `HOME` on Unix, `USERPROFILE` on Windows.
///
/// Errors instead of silently falling back to `"."`: a `"."` fallback lands
/// `~/.alp/...` writes in the current project directory — for a global-pointer
/// write that means overwriting the project's own `.alp/sdk-path` pin (issue #121
/// footgun #4). Callers surface the error as a command failure.
pub fn alp_home() -> Result<PathBuf, String> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    home_from_env(std::env::var_os(var), var)
}

/// Pure core of [`alp_home`]: maps a raw env value to a home path, rejecting a
/// missing or empty value. Split out so the erroring behavior is testable without
/// mutating the process environment (which races under the parallel test runner).
fn home_from_env(raw: Option<std::ffi::OsString>, var: &str) -> Result<PathBuf, String> {
    raw.map(PathBuf::from)
        .filter(|home| !home.as_os_str().is_empty())
        .ok_or_else(|| format!("cannot resolve the home directory ({var} is unset)"))
}

/// The unified SDK install root, `~/.alp/sdk`. `alp sdk install <version>` writes
/// each release here and `alp sdk switch <version>` resolves versions here — this
/// converges with the VS Code extension's install location (issue #121 stage 1).
pub fn alp_sdk_root() -> Result<PathBuf, String> {
    Ok(alp_home()?.join(".alp").join("sdk"))
}

/// The legacy pre-unification install root, `~/.alp/sdk-cache`. Kept as a
/// READ-ONLY probe so SDKs installed by the previous CLI stay resolvable; nothing
/// writes here any more.
pub fn alp_sdk_legacy_root() -> Result<PathBuf, String> {
    Ok(alp_home()?.join(".alp").join("sdk-cache"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_current_and_parent_dirs() {
        assert_eq!(
            normalize_path(Path::new("/a/b/./c")),
            PathBuf::from("/a/b/c")
        );
        assert_eq!(
            normalize_path(Path::new("/a/b/../c")),
            PathBuf::from("/a/c")
        );
    }

    /// A `.alp/sdk-path` pointer that resolves to `sdk_path`, present + readable.
    fn pointer_fs(
        sdk_path: &'static str,
    ) -> (impl Fn(&str) -> bool, impl Fn(&str) -> Option<String>) {
        let json = format!("{{\"sdkPath\":\"{sdk_path}\"}}");
        (
            |p: &str| p.ends_with("sdk-path"),
            move |p: &str| p.ends_with("sdk-path").then(|| json.clone()),
        )
    }

    #[test]
    fn sdk_root_arg_wins_over_pointer() {
        let (exists, read) = pointer_fs("/from/pointer");
        // Explicit --sdk-root is terminal and returned verbatim, even ahead of a
        // valid pointer; the caller's own loader check validates it.
        let got = effective_sdk_path_with(Some("/explicit"), "/work", &|_| true, &exists, &read);
        assert_eq!(got, "/explicit");
    }

    #[test]
    fn blank_sdk_root_arg_falls_through_to_pointer() {
        let (exists, read) = pointer_fs("/from/pointer");
        let got = effective_sdk_path_with(
            Some("   "),
            "/work",
            &|p| p == "/from/pointer",
            &exists,
            &read,
        );
        assert_eq!(got, "/from/pointer");
    }

    #[test]
    fn valid_pointer_is_used_when_no_sdk_root_arg() {
        let (exists, read) = pointer_fs("/from/pointer");
        let got = effective_sdk_path_with(None, "/work", &|p| p == "/from/pointer", &exists, &read);
        assert_eq!(got, "/from/pointer");
    }

    #[test]
    fn stale_pointer_falls_through_to_auto_discovery() {
        let (exists, read) = pointer_fs("/gone");
        // Pointer resolves but its target has no loader script -> best-effort skip.
        let got = effective_sdk_path_with(None, "/work", &|_| false, &exists, &read);
        assert_eq!(got, "");
    }

    #[test]
    fn no_arg_and_no_pointer_yields_empty() {
        let got = effective_sdk_path_with(None, "/work", &|_| true, &|_| false, &|_| None);
        assert_eq!(got, "");
    }

    #[test]
    fn home_from_env_rejects_missing_or_empty() {
        // #121 footgun #4: an unresolvable home must NOT fall back to "." (which
        // would land ~/.alp writes in the current project dir).
        assert!(home_from_env(None, "HOME").is_err());
        assert!(home_from_env(Some(std::ffi::OsString::new()), "HOME").is_err());
    }

    #[test]
    fn home_from_env_accepts_a_set_value() {
        assert_eq!(
            home_from_env(Some(std::ffi::OsString::from("/home/x")), "HOME").unwrap(),
            PathBuf::from("/home/x")
        );
    }

    #[test]
    fn sdk_root_and_legacy_root_are_distinct_under_dot_alp() {
        // The unified install root and the legacy read-probe must never collide.
        let home = PathBuf::from("/home/x");
        assert_eq!(
            home.join(".alp").join("sdk"),
            PathBuf::from("/home/x/.alp/sdk")
        );
        assert_eq!(
            home.join(".alp").join("sdk-cache"),
            PathBuf::from("/home/x/.alp/sdk-cache")
        );
        assert_ne!(
            PathBuf::from("/home/x/.alp/sdk"),
            PathBuf::from("/home/x/.alp/sdk-cache")
        );
    }

    #[test]
    fn workspace_root_honors_explicit_project_arg() {
        // --project wins; no walk-up, no board.yaml probe.
        let got = discover_workspace_root(Path::new("/w/sub"), Some("proj"), None, &|_| false);
        assert_eq!(got, PathBuf::from("/w/sub/proj"));
    }

    #[test]
    fn workspace_root_keeps_cwd_when_board_yaml_arg_given() {
        // Explicit --board-yaml preserves cwd-relative resolution; never walks up.
        let got = discover_workspace_root(Path::new("/w/sub"), None, Some("board.yaml"), &|_| true);
        assert_eq!(got, PathBuf::from("/w/sub"));
    }

    #[test]
    fn workspace_root_walks_up_to_nearest_board_yaml() {
        // cwd is two levels below the project root at /w.
        let got = discover_workspace_root(Path::new("/w/a/b"), None, None, &|dir| {
            dir == Path::new("/w")
        });
        assert_eq!(got, PathBuf::from("/w"));
    }

    #[test]
    fn workspace_root_prefers_the_innermost_project() {
        // board.yaml at both /w and /w/a -> nearest (/w/a) wins.
        let got = discover_workspace_root(Path::new("/w/a/b"), None, None, &|dir| {
            dir == Path::new("/w/a") || dir == Path::new("/w")
        });
        assert_eq!(got, PathBuf::from("/w/a"));
    }

    #[test]
    fn workspace_root_falls_back_to_cwd_when_no_marker() {
        // Not inside any project -> cwd, so the caller still emits the not-found error.
        let got = discover_workspace_root(Path::new("/w/a/b"), None, None, &|_| false);
        assert_eq!(got, PathBuf::from("/w/a/b"));
    }
}
