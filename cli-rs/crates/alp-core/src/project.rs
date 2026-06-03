// SPDX-License-Identifier: Apache-2.0
//! Workspace/project resolution — a port of the TypeScript
//! `resolveProjectContext`. Filesystem access is injected as a `path_exists`
//! predicate so the resolution logic stays pure and unit-testable; the CLI
//! supplies the real `Path::exists` probe.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Default)]
pub struct ProjectSettings {
    pub sdk_path: String,
    pub python_path: String,
    pub board_yaml_path: String,
    pub west_cwd: String,
}

#[derive(Debug, Clone)]
pub struct ProjectResolutionInput {
    pub workspace_folders: Vec<String>,
    pub settings: ProjectSettings,
    pub is_windows: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub workspace_root: Option<String>,
    pub sdk_root: Option<String>,
    pub board_yaml_path: Option<String>,
    pub west_cwd: Option<String>,
    pub python_binary: String,
}

/// `scripts/alp_project.py` is the canonical marker for an ALP SDK root.
fn contains_loader_script(root: &str, path_exists: &impl Fn(&str) -> bool) -> bool {
    let marker = Path::new(root).join("scripts").join("alp_project.py");
    path_exists(&marker.to_string_lossy())
}

fn resolve_workspace_root(workspace_folders: &[String]) -> Option<String> {
    workspace_folders.first().cloned()
}

fn collect_sdk_candidates(
    workspace_folders: &[String],
    path_exists: &impl Fn(&str) -> bool,
) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    let push_unique = |value: String, out: &mut Vec<String>| {
        if !out.contains(&value) {
            out.push(value);
        }
    };

    for folder in workspace_folders {
        // Check both the workspace root and the conventional sibling alp-sdk folder.
        if contains_loader_script(folder, path_exists) {
            push_unique(folder.clone(), &mut candidates);
        }

        if let Some(parent) = Path::new(folder).parent() {
            let sibling = parent.join("alp-sdk");
            let sibling = sibling.to_string_lossy().to_string();
            if contains_loader_script(&sibling, path_exists) {
                push_unique(sibling, &mut candidates);
            }
        }
    }

    candidates
}

fn resolve_sdk_root(
    workspace_folders: &[String],
    configured_sdk_path: &str,
    path_exists: &impl Fn(&str) -> bool,
) -> Option<String> {
    // Prefer the explicit SDK path, but only if it contains the loader entrypoint.
    let trimmed = configured_sdk_path.trim();
    if !trimmed.is_empty() {
        return if contains_loader_script(trimmed, path_exists) {
            Some(trimmed.to_string())
        } else {
            None
        };
    }

    // Auto-discovery is valid only when exactly one SDK root is detected.
    let candidates = collect_sdk_candidates(workspace_folders, path_exists);
    if candidates.len() == 1 {
        return candidates.into_iter().next();
    }

    None
}

fn resolve_board_yaml_path(
    workspace_root: Option<&str>,
    configured_board_yaml_path: &str,
) -> Option<String> {
    let root = workspace_root?;
    let configured = Path::new(configured_board_yaml_path);
    if configured.is_absolute() {
        return Some(configured_board_yaml_path.to_string());
    }
    Some(
        Path::new(root)
            .join(configured)
            .to_string_lossy()
            .to_string(),
    )
}

fn resolve_west_cwd(workspace_root: Option<&str>, configured_west_cwd: &str) -> Option<String> {
    let trimmed = configured_west_cwd.trim();
    if !trimmed.is_empty() {
        return Some(trimmed.to_string());
    }
    workspace_root.map(str::to_string)
}

fn resolve_python_binary(configured_python_path: &str, is_windows: bool) -> String {
    let trimmed = configured_python_path.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    if is_windows { "python" } else { "python3" }.to_string()
}

/// Resolve every runtime input once so each surface reads the same context.
pub fn resolve_project_context(
    input: &ProjectResolutionInput,
    path_exists: impl Fn(&str) -> bool,
) -> ProjectContext {
    let workspace_root = resolve_workspace_root(&input.workspace_folders);

    ProjectContext {
        sdk_root: resolve_sdk_root(
            &input.workspace_folders,
            &input.settings.sdk_path,
            &path_exists,
        ),
        board_yaml_path: resolve_board_yaml_path(
            workspace_root.as_deref(),
            &input.settings.board_yaml_path,
        ),
        west_cwd: resolve_west_cwd(workspace_root.as_deref(), &input.settings.west_cwd),
        python_binary: resolve_python_binary(&input.settings.python_path, input.is_windows),
        workspace_root,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(folders: &[&str], settings: ProjectSettings) -> ProjectResolutionInput {
        ProjectResolutionInput {
            workspace_folders: folders.iter().map(|s| s.to_string()).collect(),
            settings,
            is_windows: false,
        }
    }

    #[test]
    fn python_binary_defaults_per_platform() {
        assert_eq!(resolve_python_binary("", false), "python3");
        assert_eq!(resolve_python_binary("", true), "python");
        assert_eq!(
            resolve_python_binary("  /usr/bin/py  ", false),
            "/usr/bin/py"
        );
    }

    #[test]
    fn board_yaml_path_joins_relative_under_workspace() {
        let ctx = resolve_project_context(
            &input(
                &["/work/proj"],
                ProjectSettings {
                    board_yaml_path: "board.yaml".to_string(),
                    ..Default::default()
                },
            ),
            |_| false,
        );
        assert_eq!(
            ctx.board_yaml_path.as_deref(),
            Some("/work/proj/board.yaml")
        );
        assert_eq!(ctx.west_cwd.as_deref(), Some("/work/proj"));
    }

    #[test]
    fn board_yaml_absolute_is_preserved() {
        let ctx = resolve_project_context(
            &input(
                &["/work/proj"],
                ProjectSettings {
                    board_yaml_path: "/etc/board.yaml".to_string(),
                    ..Default::default()
                },
            ),
            |_| false,
        );
        assert_eq!(ctx.board_yaml_path.as_deref(), Some("/etc/board.yaml"));
    }

    #[test]
    fn explicit_sdk_path_requires_loader_script() {
        let with_loader = resolve_sdk_root(&[], "/sdk", &|p| p == "/sdk/scripts/alp_project.py");
        assert_eq!(with_loader.as_deref(), Some("/sdk"));

        let without_loader = resolve_sdk_root(&[], "/sdk", &|_| false);
        assert_eq!(without_loader, None);
    }

    #[test]
    fn auto_discovers_workspace_root_as_sdk() {
        let ctx = resolve_project_context(
            &input(&["/work/sdkroot"], ProjectSettings::default()),
            |p| p == "/work/sdkroot/scripts/alp_project.py",
        );
        assert_eq!(ctx.sdk_root.as_deref(), Some("/work/sdkroot"));
    }

    #[test]
    fn auto_discovers_sibling_alp_sdk() {
        let ctx =
            resolve_project_context(&input(&["/work/proj"], ProjectSettings::default()), |p| {
                p == "/work/alp-sdk/scripts/alp_project.py"
            });
        assert_eq!(ctx.sdk_root.as_deref(), Some("/work/alp-sdk"));
    }

    #[test]
    fn ambiguous_sdk_candidates_resolve_to_none() {
        // Both the workspace root and its sibling qualify -> ambiguous -> None.
        let ctx =
            resolve_project_context(&input(&["/work/proj"], ProjectSettings::default()), |p| {
                p == "/work/proj/scripts/alp_project.py"
                    || p == "/work/alp-sdk/scripts/alp_project.py"
            });
        assert_eq!(ctx.sdk_root, None);
    }

    #[test]
    fn no_workspace_folder_yields_null_root_and_paths() {
        let ctx = resolve_project_context(&input(&[], ProjectSettings::default()), |_| false);
        assert_eq!(ctx.workspace_root, None);
        assert_eq!(ctx.board_yaml_path, None);
        assert_eq!(ctx.west_cwd, None);
    }
}
