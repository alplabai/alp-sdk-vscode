// SPDX-License-Identifier: Apache-2.0
//! Filesystem I/O for the wizard — diff detection and writing.

use std::path::Path;

use super::models::{WizardFileChange, WizardFileChangeKind, WizardPlannedFile, WizardWriteResult};

/// Classify each planned file as New / Update / Unchanged relative to `project_root`.
pub fn collect_wizard_file_changes(
    project_root: &Path,
    files: &[WizardPlannedFile],
) -> Vec<WizardFileChange> {
    files
        .iter()
        .map(|f| {
            let path = project_root.join(&f.relative_path);
            let kind = if !path.exists() {
                WizardFileChangeKind::New
            } else {
                match std::fs::read_to_string(&path) {
                    Ok(existing) if existing == f.content => WizardFileChangeKind::Unchanged,
                    _ => WizardFileChangeKind::Update,
                }
            };
            WizardFileChange {
                relative_path: f.relative_path.clone(),
                kind,
            }
        })
        .collect()
}

/// Write all planned files under `project_root`, creating parent directories as needed.
/// Files whose content is already identical are skipped (counted as unchanged).
pub fn write_wizard_files(
    project_root: &Path,
    files: &[WizardPlannedFile],
) -> Result<WizardWriteResult, std::io::Error> {
    let mut written = Vec::new();
    let mut unchanged = Vec::new();

    for f in files {
        let path = project_root.join(&f.relative_path);

        if path.exists() {
            if let Ok(existing) = std::fs::read_to_string(&path) {
                if existing == f.content {
                    unchanged.push(f.relative_path.clone());
                    continue;
                }
            }
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&path, &f.content)?;
        written.push(f.relative_path.clone());
    }

    Ok(WizardWriteResult { written, unchanged })
}

// ---------------------------------------------------------------------------
// Example projects (SDK examples/ tree)
// ---------------------------------------------------------------------------

/// Failure reading an example project tree for `alp init --from-example`.
#[derive(Debug)]
pub enum ExampleReadError {
    /// The source directory does not exist or is not a directory.
    NotFound,
    /// A file could not be read as UTF-8 text, or a directory walk failed;
    /// carries a human-readable detail.
    Unreadable(String),
}

/// Read an example project directory into a set of planned files, copying every
/// regular file verbatim as UTF-8. Relative paths are forward-slash normalized and
/// the result is sorted by path for deterministic output. Symlinks and other
/// non-regular entries are skipped. Used by `alp init --from-example`.
///
/// UTF-8 only: `WizardPlannedFile.content` is a `String`, so a non-UTF-8 (binary)
/// file surfaces as `ExampleReadError::Unreadable` and aborts the copy. All shipped
/// SDK examples are text today; a binary-carrying example would need a bytes-based
/// planned-file model before it could be scaffolded.
pub fn read_example_tree(source_dir: &Path) -> Result<Vec<WizardPlannedFile>, ExampleReadError> {
    if !source_dir.is_dir() {
        return Err(ExampleReadError::NotFound);
    }
    let mut files = Vec::new();
    collect_example_files(source_dir, source_dir, &mut files)?;
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

/// Recursively collect regular files under `dir` into `out`, with paths relative
/// to `root` (forward-slash normalized).
fn collect_example_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<WizardPlannedFile>,
) -> Result<(), ExampleReadError> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| ExampleReadError::Unreadable(format!("{}: {e}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| ExampleReadError::Unreadable(e.to_string()))?;
        let file_type = entry
            .file_type()
            .map_err(|e| ExampleReadError::Unreadable(e.to_string()))?;
        let path = entry.path();
        if file_type.is_dir() {
            collect_example_files(root, &path, out)?;
        } else if file_type.is_file() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| ExampleReadError::Unreadable(format!("{}: {e}", path.display())))?;
            let rel = path
                .strip_prefix(root)
                .map_err(|e| ExampleReadError::Unreadable(e.to_string()))?;
            let relative_path = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            out.push(WizardPlannedFile {
                relative_path,
                content,
            });
        }
    }
    Ok(())
}

/// A discovered example project: its `category/name` source dir (relative to the
/// SDK `examples/` root) and the raw `README.md` contents when present.
pub struct ExampleDiscovery {
    /// Path relative to the SDK `examples/` root, e.g. `audio/i2s-tone`.
    pub source_dir: String,
    /// Raw `README.md` contents, if the example ships one.
    pub readme: Option<String>,
}

/// Scan `examples_root` (`<sdk>/examples`) two levels deep for example projects —
/// `<category>/<name>` directories that contain a `board.yaml`. Results are sorted
/// by source dir for deterministic output. A missing/unreadable root yields an empty
/// list (callers treat "no SDK / no examples" as an empty catalog, not an error).
pub fn discover_examples(examples_root: &Path) -> Vec<ExampleDiscovery> {
    let mut found = Vec::new();
    let Ok(categories) = std::fs::read_dir(examples_root) else {
        return found;
    };
    for category in categories.flatten() {
        if !category.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let cat_name = category.file_name().to_string_lossy().to_string();
        let Ok(projects) = std::fs::read_dir(category.path()) else {
            continue;
        };
        for project in projects.flatten() {
            if !project.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let proj_path = project.path();
            if !proj_path.join("board.yaml").is_file() {
                continue;
            }
            let name = project.file_name().to_string_lossy().to_string();
            let source_dir = format!("{cat_name}/{name}");
            let readme = std::fs::read_to_string(proj_path.join("README.md")).ok();
            found.push(ExampleDiscovery { source_dir, readme });
        }
    }
    found.sort_by(|a, b| a.source_dir.cmp(&b.source_dir));
    found
}

#[cfg(test)]
mod example_tests {
    use super::*;

    /// A fresh, unique temp dir (mirrors the pid-tagged pattern used elsewhere).
    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("alp-ex-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn read_example_tree_copies_files_recursively_sorted() {
        let root = temp_root("read");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("board.yaml"), "som:\n  sku: X\n").unwrap();
        std::fs::write(root.join("src/main.c"), "int main(){}").unwrap();
        std::fs::write(root.join("README.md"), "# Demo").unwrap();

        let files = read_example_tree(&root).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["README.md", "board.yaml", "src/main.c"]);
        let board = files
            .iter()
            .find(|f| f.relative_path == "board.yaml")
            .unwrap();
        assert_eq!(board.content, "som:\n  sku: X\n");

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn read_example_tree_missing_dir_is_not_found() {
        let root = temp_root("missing").join("nope");
        assert!(matches!(
            read_example_tree(&root),
            Err(ExampleReadError::NotFound)
        ));
    }

    #[test]
    fn discover_examples_finds_dirs_with_board_yaml_sorted() {
        let root = temp_root("disc");
        std::fs::create_dir_all(root.join("audio/i2s-tone")).unwrap();
        std::fs::write(root.join("audio/i2s-tone/board.yaml"), "x").unwrap();
        std::fs::write(
            root.join("audio/i2s-tone/README.md"),
            "# I2S Tone\n\nPlays a tone.",
        )
        .unwrap();
        // A category dir without board.yaml is skipped.
        std::fs::create_dir_all(root.join("audio/no-board")).unwrap();
        std::fs::write(root.join("audio/no-board/notes.txt"), "x").unwrap();
        std::fs::create_dir_all(root.join("peripheral-io/hello")).unwrap();
        std::fs::write(root.join("peripheral-io/hello/board.yaml"), "x").unwrap();

        let found = discover_examples(&root);
        let dirs: Vec<&str> = found.iter().map(|d| d.source_dir.as_str()).collect();
        assert_eq!(dirs, vec!["audio/i2s-tone", "peripheral-io/hello"]);
        assert!(found[0].readme.as_deref().unwrap().contains("I2S Tone"));

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn discover_examples_missing_root_is_empty() {
        let root = temp_root("empty").join("nope");
        assert!(discover_examples(&root).is_empty());
    }
}
