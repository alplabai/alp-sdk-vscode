// SPDX-License-Identifier: Apache-2.0
//! Effective-config preview helpers (Rust mirror of LSP preview payload).

use serde::Serialize;

use crate::model::{BoardModel, normalize_board_model};
use crate::validate::{ParseError, parse_board_model};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub workspace_root: Option<String>,
    pub sdk_root: Option<String>,
    pub board_yaml_path: Option<String>,
    pub west_cwd: Option<String>,
    pub python_binary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveConfigPreviewPayload {
    pub schema_version: String,
    pub generated_at: String,
    pub board_yaml_path: String,
    pub project_context: ProjectContext,
    pub effective_config: BoardModel,
}

/// Create an effective-config preview payload equivalent to TS
/// `createEffectiveConfigPreviewPayload`:
/// parse board.yaml, normalize it, and wrap with metadata.
pub fn create_effective_config_preview_payload(
    document_text: &str,
    board_yaml_path: &str,
    project_context: ProjectContext,
    generated_at: impl Into<String>,
) -> Result<EffectiveConfigPreviewPayload, ParseError> {
    let parsed = parse_board_model(document_text)?;
    let effective_config = normalize_board_model(parsed);

    Ok(EffectiveConfigPreviewPayload {
        schema_version: "1".to_string(),
        generated_at: generated_at.into(),
        board_yaml_path: board_yaml_path.to_string(),
        project_context,
        effective_config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_payload_uses_normalized_model() {
        let text = "schema_version: 2\nos: zephyr\ncores:\n  m55_hp:\n    app: ./src\n";
        let payload = create_effective_config_preview_payload(
            text,
            "board.yaml",
            ProjectContext {
                workspace_root: Some("/ws".to_string()),
                sdk_root: Some("/sdk".to_string()),
                board_yaml_path: Some("/ws/board.yaml".to_string()),
                west_cwd: Some("/ws".to_string()),
                python_binary: "python3".to_string(),
            },
            "2026-01-01T00:00:00.000Z",
        )
        .unwrap();

        assert_eq!(payload.schema_version, "1");
        assert_eq!(payload.board_yaml_path, "board.yaml");
        assert!(payload.effective_config.os.is_none());
    }
}
