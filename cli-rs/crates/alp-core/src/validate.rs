// SPDX-License-Identifier: Apache-2.0
//! Local (offline) board.yaml validation.
//!
//! Mirrors the TypeScript `validateBoardYamlLocally` in
//! `@alp-sdk/core/validation/service.ts`. This is the offline parity
//! target shared by the conformance fixtures; full SDK-spawn validation
//! arrives in a later phase.

use crate::model::BoardModel;

/// Validation outcome — stable string identifiers shared with the CLI
/// envelope and the TS implementation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Clean,
    SchemaViolation,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Clean => "clean",
            Outcome::SchemaViolation => "schema-violation",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Suggestion,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Suggestion => "suggestion",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ValidationIssue {
    pub message: String,
    pub severity: Severity,
}

#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub outcome: Outcome,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("board.yaml is not valid YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),
}

/// Parse board.yaml text into a [`BoardModel`].
///
/// Matches TS `parseBoardModel`: a YAML scalar/null parses to the default
/// model rather than an error; only true syntax errors fail.
pub fn parse_board_model(text: &str) -> Result<BoardModel, ParseError> {
    match serde_yaml::from_str::<Option<BoardModel>>(text) {
        Ok(Some(model)) => Ok(model),
        Ok(None) => Ok(BoardModel::default()),
        Err(e) => Err(ParseError::Yaml(e)),
    }
}

/// Local structural validation. Mirrors `validateBoardYamlLocally`:
/// for schema_version >= 2, top-level `os:` is rejected and a non-empty
/// `cores:` block is required.
pub fn validate_board_yaml_local(text: &str) -> Result<ValidationResult, ParseError> {
    let model = parse_board_model(text)?;
    let mut issues = Vec::new();

    if model.effective_schema_version() >= 2 {
        if model.os.is_some() {
            issues.push(ValidationIssue {
                message:
                    "board.yaml v2: top-level 'os:' is not valid; move it into a 'cores:' block"
                        .to_string(),
                severity: Severity::Error,
            });
        }
        let has_cores = model.cores.as_ref().is_some_and(|c| !c.is_empty());
        if !has_cores {
            issues.push(ValidationIssue {
                message:
                    "board.yaml v2: 'cores:' block is required and must have at least one entry"
                        .to_string(),
                severity: Severity::Error,
            });
        }
    }

    let outcome = if issues.is_empty() {
        Outcome::Clean
    } else {
        Outcome::SchemaViolation
    };

    Ok(ValidationResult { outcome, issues })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_board_passes_without_errors() {
        let text = "som:\n  sku: E1M-AEN701\npreset: e1m-evk\n";
        let r = validate_board_yaml_local(text).unwrap();
        assert_eq!(r.outcome, Outcome::Clean);
        assert!(r.issues.is_empty());
    }

    #[test]
    fn v2_clean_board_passes() {
        let text = "schema_version: 2\nsom:\n  sku: E1M-AEN701\ncores:\n  m55_hp:\n    app: ./src\n";
        let r = validate_board_yaml_local(text).unwrap();
        assert_eq!(r.outcome, Outcome::Clean);
    }

    #[test]
    fn v2_top_level_os_is_rejected() {
        let text = "schema_version: 2\nos: zephyr\ncores:\n  m55_hp:\n    app: ./src\n";
        let r = validate_board_yaml_local(text).unwrap();
        assert_eq!(r.outcome, Outcome::SchemaViolation);
        assert_eq!(r.issues.len(), 1);
    }

    #[test]
    fn v2_without_cores_is_rejected() {
        let text = "schema_version: 2\nsom:\n  sku: E1M-AEN701\n";
        let r = validate_board_yaml_local(text).unwrap();
        assert_eq!(r.outcome, Outcome::SchemaViolation);
        assert_eq!(r.issues.len(), 1);
    }
}
