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
            WizardFileChange { relative_path: f.relative_path.clone(), kind }
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
