// SPDX-License-Identifier: Apache-2.0
//! Small shared helpers for command implementations.

use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use alp_core::{
    ProjectContext, ProjectResolutionInput, ProjectSettings, format_iso8601_utc,
    resolve_project_context,
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

/// Resolve the alp-sdk root: honor `--sdk-root` when it has the loader script,
/// otherwise probe the workspace and sibling `alp-sdk` / `alp-sdk-upstream` dirs.
/// Shared by `generate` (codegen), `init --from-example`, and `examples`.
pub fn resolve_sdk_root(g: &GlobalArgs, workspace_root: &Path) -> Option<PathBuf> {
    if let Some(root) = &g.sdk_root {
        let candidate = PathBuf::from(root);
        if has_loader_script(&candidate) {
            return Some(candidate);
        }
        return None;
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

/// Resolve the project context from the global args, mirroring the TS commands'
/// `path.resolve(cwd, project) + resolveProjectContext` boilerplate. Shared by
/// `validate`, `diff`, `presets`, and `doctor`.
pub fn resolve_cli_project_context(g: &GlobalArgs) -> ProjectContext {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let project_arg = g.project.clone().unwrap_or_else(|| ".".to_string());
    let workspace_root = normalize_path(&cwd.join(&project_arg))
        .to_string_lossy()
        .to_string();

    let settings = ProjectSettings {
        sdk_path: g.sdk_root.clone().unwrap_or_default(),
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
}
