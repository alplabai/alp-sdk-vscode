// SPDX-License-Identifier: Apache-2.0
//! `alp generate` — generate board-derived output files.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::CommandRun;
use crate::cli::GlobalArgs;
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;

/// Every supported `--emit` mode, used as the default target set when neither
/// `--target` nor `--all` narrows the selection.
///
/// `carrier-netlist` is a board-level export — the deterministic carrier
/// netlist + BOM handoff Alp Studio consumes (alp-sdk#419) — not a per-core
/// build config like the other four. It is intentionally a `generate` target
/// only: it is NOT in `alp_core::ALL_EMIT_MODES` (the set `trace` /
/// `support-bundle` enumerate), because those model the *build* generation a
/// slice runs, and a netlist is not part of a build.
const ALL_EMIT_MODES: [&str; 5] = [
    "zephyr-conf",
    "dts-overlay",
    "cmake-args",
    "yocto-conf",
    "carrier-netlist",
];

/// JSON `data` payload for the `generate` envelope.
#[derive(serde::Serialize)]
struct GenerateData {
    /// Schema version of this payload (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Emit modes that were requested for this run.
    targets: Vec<String>,
    /// Workspace-relative paths of successfully written outputs.
    written: Vec<String>,
    /// Emit modes whose generation failed.
    failed: Vec<String>,
}

/// Run `alp generate`: resolve the board and SDK roots, invoke `alp_project.py`
/// once per emit target, and assemble the text/JSON `CommandRun` result.
pub fn run(g: &GlobalArgs) -> CommandRun {
    let workspace_root = resolve_workspace_root(g);
    let board_path = resolve_board_path(g, &workspace_root);

    // Keep as-given strings for JSON (reproducible in golden fixtures).
    let project_str = g.project.clone().unwrap_or_else(|| ".".to_string());
    let board_yaml_str = g
        .board_yaml
        .clone()
        .unwrap_or_else(|| "board.yaml".to_string());
    let project = Project {
        root: Some(project_str),
        board_yaml: Some(board_yaml_str),
    };

    if !board_path.exists() {
        return failure(
            g,
            project,
            ExitCode::ValidationFailure,
            "board-yaml-missing",
            "board.yaml path could not be resolved or the file does not exist.",
            empty_data(),
            vec!["generate: board.yaml path is unresolved or missing.".to_string()],
        );
    }

    let Some(sdk_root) = resolve_sdk_root(g, &workspace_root) else {
        return failure(
            g,
            project,
            ExitCode::ValidationFailure,
            "sdk-root-unresolved",
            "alp-sdk root is unresolved. Use --sdk-root or place project near alp-sdk checkout.",
            empty_data(),
            vec!["generate: alp-sdk root is unresolved.".to_string()],
        );
    };

    let targets = match resolve_generate_targets(g.target.as_deref(), g.all) {
        Ok(t) => t,
        Err(message) => {
            let copy = message.clone();
            return failure(
                g,
                project,
                ExitCode::InternalFailure,
                "internal-failure",
                &message,
                empty_data(),
                vec!["generate: internal failure".to_string(), copy],
            );
        }
    };

    let python = default_python_binary();
    let script_path = sdk_root.join("scripts").join("alp_project.py");
    let mut written = Vec::<String>::new();
    let mut failed = Vec::<String>::new();
    let mut issues = Vec::<Issue>::new();

    for emit in &targets {
        let output_path = output_path_for_emit(&workspace_root, emit);
        let output_str = output_path.to_string_lossy().to_string();
        let status = Command::new(python)
            .arg(&script_path)
            .arg("--input")
            .arg(&board_path)
            .arg("--emit")
            .arg(emit)
            .arg("--output")
            .arg(&output_str)
            .output();

        match status {
            Ok(out) if out.status.success() => {
                written.push(relative_or_full(&workspace_root, &output_path));
            }
            Ok(out) => {
                failed.push((*emit).to_string());
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                issues.push(Issue {
                    code: "generate.emit-failed".to_string(),
                    severity: "error".to_string(),
                    message: if stderr.is_empty() {
                        format!("Generation failed for target '{emit}'.")
                    } else {
                        stderr
                    },
                });
            }
            Err(err) => {
                failed.push((*emit).to_string());
                issues.push(Issue {
                    code: "generate.emit-failed".to_string(),
                    severity: "error".to_string(),
                    message: format!("Generation failed for target '{emit}': {err}"),
                });
            }
        }
    }

    let exit = if failed.is_empty() {
        ExitCode::Success
    } else {
        ExitCode::WriteFailure
    };
    let data = GenerateData {
        schema_version: "1".to_string(),
        targets: targets.iter().map(|s| (*s).to_string()).collect(),
        written,
        failed,
    };

    let text = if g.is_json() {
        Vec::new()
    } else {
        generate_text_lines(g, &data)
    };
    let json = g
        .is_json()
        .then(|| Envelope::new("generate", project, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

/// Resolve the workspace root: the current directory, joined with `--project` if given.
fn resolve_workspace_root(g: &GlobalArgs) -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match &g.project {
        Some(project) => cwd.join(project),
        None => cwd,
    }
}

/// Resolve the `board.yaml` path from `--board-yaml` (absolute or workspace-relative),
/// defaulting to `<workspace_root>/board.yaml`.
fn resolve_board_path(g: &GlobalArgs, workspace_root: &Path) -> PathBuf {
    if let Some(board) = &g.board_yaml {
        let board_path = PathBuf::from(board);
        if board_path.is_absolute() {
            return board_path;
        }
        return workspace_root.join(board_path);
    }

    workspace_root.join("board.yaml")
}

/// Resolve the alp-sdk root: honor `--sdk-root` if it has the loader script,
/// otherwise probe the workspace and sibling `alp-sdk` / `alp-sdk-upstream` dirs.
fn resolve_sdk_root(g: &GlobalArgs, workspace_root: &Path) -> Option<PathBuf> {
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

/// True if `root` contains `scripts/alp_project.py`, marking it as a valid SDK root.
fn has_loader_script(root: &Path) -> bool {
    root.join("scripts").join("alp_project.py").exists()
}

/// Resolve which emit modes to run: all modes when `all` is set or no `--target`
/// is given, otherwise the single matching mode, or an error for an unknown target.
fn resolve_generate_targets(target: Option<&str>, all: bool) -> Result<Vec<&'static str>, String> {
    if all || target.is_none() {
        return Ok(ALL_EMIT_MODES.to_vec());
    }

    let target = target.unwrap_or_default();
    if let Some(mode) = ALL_EMIT_MODES.iter().copied().find(|mode| *mode == target) {
        return Ok(vec![mode]);
    }

    Err(format!("Unsupported generate target '{target}'."))
}

/// Map an emit mode to its output file under `<workspace_root>/build/generated/`.
fn output_path_for_emit(workspace_root: &Path, emit: &str) -> PathBuf {
    let file_name = match emit {
        "zephyr-conf" => "alp.conf",
        "dts-overlay" => "alp.overlay",
        "cmake-args" => "alp-cmake-args.txt",
        "yocto-conf" => "alp-yocto.conf",
        "carrier-netlist" => "carrier-netlist.json",
        _ => "alp.out",
    };

    workspace_root
        .join("build")
        .join("generated")
        .join(file_name)
}

/// Render `output_path` relative to `workspace_root`, falling back to the full
/// path when it is not under the root.
fn relative_or_full(workspace_root: &Path, output_path: &Path) -> String {
    output_path
        .strip_prefix(workspace_root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| output_path.to_string_lossy().to_string())
}

/// The default Python interpreter name: `python` on Windows, `python3` elsewhere.
fn default_python_binary() -> &'static str {
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    }
}

/// Build the human-readable (non-JSON) output lines summarizing written/failed
/// targets, listing each target when `--verbose` is set.
fn generate_text_lines(g: &GlobalArgs, data: &GenerateData) -> Vec<String> {
    let mut lines = Vec::<String>::new();
    if data.failed.is_empty() {
        lines.push(format!(
            "generate: wrote {}/{} targets",
            data.written.len(),
            data.targets.len()
        ));
    } else {
        lines.push(format!(
            "generate: wrote {}/{}; failed: {}",
            data.written.len(),
            data.targets.len(),
            data.failed.join(", ")
        ));
    }

    if g.verbose {
        for target in &data.targets {
            lines.push(format!("target: {target}"));
        }
    }
    lines
}

/// A `GenerateData` with no targets/written/failed, used for early-failure envelopes.
fn empty_data() -> GenerateData {
    GenerateData {
        schema_version: "1".to_string(),
        targets: Vec::new(),
        written: Vec::new(),
        failed: Vec::new(),
    }
}

/// Build a failing `CommandRun` carrying a single `generate.{code}` error issue,
/// emitting either the JSON envelope or the provided text lines.
fn failure(
    g: &GlobalArgs,
    project: Project,
    exit: ExitCode,
    code: &str,
    message: &str,
    data: GenerateData,
    text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("generate.{code}"),
        severity: "error".to_string(),
        message: message.to_string(),
    }];
    let text = if g.is_json() { Vec::new() } else { text_lines };
    let json = g
        .is_json()
        .then(|| Envelope::new("generate", project, data, issues, exit.code()).to_json());

    CommandRun { exit, text, json }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_resolution_defaults_to_all() {
        let resolved = resolve_generate_targets(None, false).unwrap();
        assert_eq!(resolved, ALL_EMIT_MODES.to_vec());
    }

    #[test]
    fn target_resolution_accepts_single_target() {
        let resolved = resolve_generate_targets(Some("cmake-args"), false).unwrap();
        assert_eq!(resolved, vec!["cmake-args"]);
    }

    #[test]
    fn target_resolution_rejects_unknown_target() {
        let err = resolve_generate_targets(Some("unknown"), false).unwrap_err();
        assert!(err.contains("Unsupported generate target"));
    }

    #[test]
    fn target_resolution_accepts_carrier_netlist() {
        // The Studio netlist handoff (alp-sdk#419) must reach the SDK spawn,
        // not be rejected at the allowlist. See ALL_EMIT_MODES.
        let resolved = resolve_generate_targets(Some("carrier-netlist"), false).unwrap();
        assert_eq!(resolved, vec!["carrier-netlist"]);
    }

    #[test]
    fn carrier_netlist_writes_a_json_artefact() {
        let path = output_path_for_emit(Path::new("/ws"), "carrier-netlist");
        assert!(path.ends_with("build/generated/carrier-netlist.json"));
    }
}
