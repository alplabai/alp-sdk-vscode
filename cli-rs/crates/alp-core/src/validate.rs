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
    /// Validation passed with no issues.
    Clean,
    /// SoM/preset could not be resolved (validator exit 2); treated as a warning.
    MissingPreset,
    /// Schema/structural violation (validator exit 1).
    SchemaViolation,
    /// Hardware-revision incompatibility (validator exit 3).
    HardwareRevision,
    /// Validation could not be completed (validator crashed / unknown exit status).
    Failed,
}

impl Outcome {
    /// Stable string identifier for this outcome, as emitted in the CLI envelope.
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Clean => "clean",
            Outcome::MissingPreset => "missing-preset",
            Outcome::SchemaViolation => "schema-violation",
            Outcome::HardwareRevision => "hardware-revision",
            Outcome::Failed => "failed",
        }
    }
}

/// Per-issue severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Suggestion,
}

impl Severity {
    /// Stable lowercase string identifier for this severity.
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Suggestion => "suggestion",
        }
    }
}

/// A single validation finding: human-readable `message` plus its `severity`.
#[derive(Debug, Clone)]
pub struct ValidationIssue {
    pub message: String,
    pub severity: Severity,
}

/// Aggregate validation result: overall `outcome` plus the list of `issues`.
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub outcome: Outcome,
    pub issues: Vec<ValidationIssue>,
}

/// Error returned when board.yaml text cannot be parsed into a `BoardModel`.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// The input was not syntactically valid YAML.
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

// ───────────────────────── full (spawn) validation ─────────────────────────
//
// The real `alp validate` shells out to `<sdk>/scripts/validate_board_yaml.py`.
// The analysis below mirrors TS `analyzeValidationResult` + `parseValidationIssues`:
// classify by the process exit status, then turn stderr into structured issues.

/// Result of spawning the Python validator (mirrors TS `ValidatorExecutionResult`).
pub struct ValidatorExecution {
    /// Process exit status; `None` if the process was killed / never started.
    pub status: Option<i32>,
    /// Captured standard output of the validator process.
    pub stdout: String,
    /// Captured standard error; the source of structured issues.
    pub stderr: String,
}

/// Map the validator's exit status to an [`Outcome`] (TS `classifyValidationOutcome`).
pub fn classify_validation_outcome(status: Option<i32>) -> Outcome {
    match status {
        Some(0) => Outcome::Clean,
        Some(2) => Outcome::MissingPreset,
        Some(3) => Outcome::HardwareRevision,
        Some(1) => Outcome::SchemaViolation,
        _ => Outcome::Failed,
    }
}

fn severity_for_outcome(outcome: Outcome) -> Severity {
    if outcome == Outcome::MissingPreset {
        Severity::Warning
    } else {
        Severity::Error
    }
}

/// True when validator stderr is an unhandled interpreter/environment crash
/// rather than a validation verdict — detected by the Python traceback header.
/// The validator exits 1 both for a genuine schema violation AND when it crashes
/// (e.g. `ImportError: jsonschema` on a host missing the deps); a real
/// validation failure never prints a traceback, so this header reliably tells a
/// broken validator environment apart from a "board.yaml is invalid" result.
fn is_interpreter_crash(stderr: &str) -> bool {
    stderr.lines().any(|line| {
        line.trim_start()
            .starts_with("Traceback (most recent call last):")
    })
}

/// Classify + parse a validator execution into a [`ValidationResult`]
/// (TS `analyzeValidationResult`).
pub fn analyze_validation_result(execution: &ValidatorExecution) -> ValidationResult {
    let mut outcome = classify_validation_outcome(execution.status);
    // A crashed validator (exit 1 with a Python traceback) collides with a
    // genuine schema violation on exit code alone. Reclassify it as `Failed`
    // (infra, exit 1) so a broken validator environment is never surfaced to
    // consumers as a real board.yaml verdict (exit 2). (issue #38)
    if outcome == Outcome::SchemaViolation && is_interpreter_crash(&execution.stderr) {
        outcome = Outcome::Failed;
    }
    let issues = parse_validation_issues(&execution.stderr, severity_for_outcome(outcome));
    ValidationResult { outcome, issues }
}

/// Parse validator stderr into structured issues — a faithful port of TS
/// `parseValidationIssues`. Handles rich `error[ALP-B*]` blocks (with `-->`
/// location arrows + indented source/hint continuation), legacy `FAIL`/`WARN`
/// lines with indented continuations, and standalone `hint:` suggestions.
///
/// The CLI only consumes `message` + `severity` (it rewrites the issue code to
/// `validate.<outcome>`), so block code/line/col are parsed for correct line
/// skipping but not retained.
fn parse_validation_issues(stderr: &str, severity: Severity) -> Vec<ValidationIssue> {
    let lines: Vec<&str> = stderr
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();

    let mut issues = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];

        if line.trim().is_empty() || is_summary_line(line) {
            i += 1;
            continue;
        }

        // Rich ALP-B* block.
        if let Some((sev, message)) = parse_rich_header(line) {
            let issue_severity = match sev {
                "error" => Severity::Error,
                "warning" => Severity::Warning,
                _ => Severity::Suggestion,
            };
            let issue = ValidationIssue {
                message: message.trim().to_string(),
                severity: issue_severity,
            };
            if i + 1 < lines.len() && is_arrow_line(lines[i + 1]) {
                i += 2;
                while i < lines.len() && is_block_continuation(lines[i]) {
                    i += 1;
                }
                issues.push(issue);
                continue;
            }
            issues.push(issue);
            i += 1;
            continue;
        }

        // Legacy FAIL / WARN lines.
        if let Some((level, rest)) = parse_fail_warn(line) {
            let issue_severity = if level == "WARN" {
                Severity::Warning
            } else {
                severity
            };
            let mut parts = vec![rest.trim().to_string()];
            while i + 1 < lines.len() && is_fail_continuation(lines[i + 1]) {
                i += 1;
                parts.push(lines[i].trim().to_string());
            }
            issues.push(ValidationIssue {
                message: parts.join("  "),
                severity: issue_severity,
            });
            i += 1;
            continue;
        }

        // Standalone hint / suggestion lines.
        if is_hint_line(line) {
            issues.push(ValidationIssue {
                message: line.trim().to_string(),
                severity: Severity::Suggestion,
            });
            i += 1;
            continue;
        }

        i += 1;
    }

    issues
}

/// `^\S.*\.yaml:\s+(missing-preset|hardware|capability)` — non-actionable
/// summary lines emitted by `validate_board_yaml.py main()`.
fn is_summary_line(line: &str) -> bool {
    let Some(first) = line.chars().next() else {
        return false;
    };
    if first.is_whitespace() {
        return false;
    }
    let after_first = &line[first.len_utf8()..];
    let Some(rel) = after_first.find(".yaml:") else {
        return false;
    };
    let rest = &after_first[rel + ".yaml:".len()..];
    let trimmed = rest.trim_start();
    if trimmed.len() == rest.len() {
        return false; // needs at least one whitespace (\s+)
    }
    trimmed.starts_with("missing-preset")
        || trimmed.starts_with("hardware")
        || trimmed.starts_with("capability")
}

/// `^(error|warning|note)\[(ALP-[A-Z]\d+)\]:\s*(.+)` — returns (severity, message).
fn parse_rich_header(line: &str) -> Option<(&str, &str)> {
    for kw in ["error", "warning", "note"] {
        if let Some(rest) = line.strip_prefix(kw) {
            if let Some(rest) = rest.strip_prefix('[') {
                if let Some(close) = rest.find("]:") {
                    if is_alp_code(&rest[..close]) {
                        let message = rest[close + 2..].trim_start();
                        if !message.is_empty() {
                            return Some((kw, message));
                        }
                    }
                }
            }
        }
    }
    None
}

/// `ALP-[A-Z]\d+`
fn is_alp_code(code: &str) -> bool {
    let Some(rest) = code.strip_prefix("ALP-") else {
        return false;
    };
    let mut chars = rest.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() => {}
        _ => return false,
    }
    let digits = chars.as_str();
    !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
}

/// `^\s+-->\s+\S+:(\d+):(\d+)` — the location arrow inside a rich block.
fn is_arrow_line(line: &str) -> bool {
    if !line.starts_with(char::is_whitespace) {
        return false;
    }
    let Some(after) = line.trim_start().strip_prefix("-->") else {
        return false;
    };
    if !after.starts_with(char::is_whitespace) {
        return false;
    }
    // `split_whitespace` already skips the leading `\s+` after `-->`.
    let Some(token) = after.split_whitespace().next() else {
        return false;
    };
    let parts: Vec<&str> = token.rsplitn(3, ':').collect();
    if parts.len() < 3 {
        return false;
    }
    let is_num = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    !parts[2].is_empty() && is_num(parts[0]) && is_num(parts[1])
}

/// `^\s+[|0-9^= ]` — indented source/underline/hint continuation of a rich block.
fn is_block_continuation(line: &str) -> bool {
    let mut chars = line.chars();
    match chars.next() {
        Some(c) if c.is_whitespace() => {}
        _ => return false,
    }
    match chars.next() {
        Some(c) if c.is_whitespace() => true, // ≥2 leading whitespace (space ∈ set)
        Some(c) if c == '|' || c == '^' || c == '=' || c.is_ascii_digit() => true,
        _ => false,
    }
}

/// `^(FAIL|WARN)\s+(.+)` — returns (level, message-without-leading-ws).
fn parse_fail_warn(line: &str) -> Option<(&str, &str)> {
    for level in ["FAIL", "WARN"] {
        if let Some(rest) = line.strip_prefix(level) {
            if rest.starts_with(char::is_whitespace) {
                let message = rest.trim_start();
                if !message.is_empty() {
                    return Some((level, message));
                }
            }
        }
    }
    None
}

/// `^\s{2,}\S` — indented continuation of a legacy FAIL/WARN line.
fn is_fail_continuation(line: &str) -> bool {
    let leading_ws = line.chars().take_while(|c| c.is_whitespace()).count();
    leading_ws >= 2 && !line.trim_start().is_empty()
}

/// `^\s*(hint|suggestion|suggest):` (case-insensitive)
fn is_hint_line(line: &str) -> bool {
    let lowered = line.trim_start().to_ascii_lowercase();
    lowered.starts_with("hint:")
        || lowered.starts_with("suggestion:")
        || lowered.starts_with("suggest:")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Carrier, Inference, Iot, Som, normalize_board_model};
    use std::collections::BTreeMap;

    #[test]
    fn v1_board_passes_without_errors() {
        let text = "som:\n  sku: E1M-AEN701\npreset: e1m-evk\n";
        let r = validate_board_yaml_local(text).unwrap();
        assert_eq!(r.outcome, Outcome::Clean);
        assert!(r.issues.is_empty());
    }

    #[test]
    fn v2_clean_board_passes() {
        let text =
            "schema_version: 2\nsom:\n  sku: E1M-AEN701\ncores:\n  m55_hp:\n    app: ./src\n";
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

    #[test]
    fn parse_rich_board_fields() {
        let text = r#"
schema_version: 2
som:
  sku: E1M-AEN701
cores:
  m55_hp:
    os: zephyr
    app: ./src
    image: app.bin
    peripherals: [i2c, spi]
    libraries: [mbedtls]
    inference:
      backend: ethos_u
      default_arena_kib: 256
    iot:
      wifi: true
ipc:
  - name: telemetry
    endpoints: [m55_hp, a32_cluster]
    size_kib: 64
"#;
        let model = parse_board_model(text).unwrap();
        let core = model.cores.unwrap().remove("m55_hp").unwrap();
        assert_eq!(core.os.as_deref(), Some("zephyr"));
        assert_eq!(core.peripherals.unwrap(), vec!["i2c", "spi"]);
        assert_eq!(core.inference.unwrap().default_arena_kib, Some(256));
        assert_eq!(model.ipc.unwrap()[0].size_kib, 64);
    }

    #[test]
    fn normalize_v1_removes_empty_optional_blocks() {
        let model = BoardModel {
            schema_version: Some(1),
            som: Some(Som {
                sku: Some("E1M-AEN701".to_string()),
            }),
            carrier: Some(Carrier {
                name: Some("e1m-evk".to_string()),
                populated: Some(BTreeMap::new()),
            }),
            inference: Some(Inference::default()),
            libraries: Some(Vec::new()),
            iot: Some(Iot::default()),
            ..BoardModel::default()
        };

        let normalized = normalize_board_model(model);
        assert!(normalized.libraries.is_none());
        assert!(normalized.iot.is_none());
        assert!(normalized.inference.is_none());
        assert!(normalized.carrier.unwrap().populated.is_none());
    }

    #[test]
    fn normalize_v2_removes_top_level_os() {
        let model = BoardModel {
            schema_version: Some(2),
            os: Some("zephyr".to_string()),
            ..BoardModel::default()
        };

        assert!(normalize_board_model(model).os.is_none());
    }

    #[test]
    fn classify_maps_exit_status_to_outcome() {
        assert_eq!(classify_validation_outcome(Some(0)), Outcome::Clean);
        assert_eq!(
            classify_validation_outcome(Some(1)),
            Outcome::SchemaViolation
        );
        assert_eq!(classify_validation_outcome(Some(2)), Outcome::MissingPreset);
        assert_eq!(
            classify_validation_outcome(Some(3)),
            Outcome::HardwareRevision
        );
        assert_eq!(classify_validation_outcome(Some(9)), Outcome::Failed);
        assert_eq!(classify_validation_outcome(None), Outcome::Failed);
    }

    #[test]
    fn analyze_parses_rich_alp_block() {
        let stderr = "error[ALP-B005]: SoM SKU 'E1M-NX9999' does not resolve\n  --> board.yaml:3:8\n   |\n 3 | som: {sku: E1M-NX9999}\n   |          ^^^^^^^^^^^^\n   = hint: did you mean E1M-NX9?\n   = see: docs/diagnostics/ALP-B005.md\n";
        let execution = ValidatorExecution {
            status: Some(1),
            stdout: String::new(),
            stderr: stderr.to_string(),
        };
        let result = analyze_validation_result(&execution);
        assert_eq!(result.outcome, Outcome::SchemaViolation);
        assert_eq!(result.issues.len(), 1, "block continuation must be skipped");
        assert_eq!(result.issues[0].severity, Severity::Error);
        assert_eq!(
            result.issues[0].message,
            "SoM SKU 'E1M-NX9999' does not resolve"
        );
    }

    #[test]
    fn analyze_parses_legacy_fail_warn_with_continuation() {
        let stderr = "FAIL som preset: no preset for E1M-NX9999\n     expected shared definition at metadata/boards/...\nWARN hw_compat: minor version mismatch\n";
        let execution = ValidatorExecution {
            status: Some(2),
            stdout: String::new(),
            stderr: stderr.to_string(),
        };
        let result = analyze_validation_result(&execution);
        assert_eq!(result.outcome, Outcome::MissingPreset);
        assert_eq!(result.issues.len(), 2);
        // FAIL line folds in its indented continuation; severity follows outcome.
        assert_eq!(
            result.issues[0].message,
            "som preset: no preset for E1M-NX9999  expected shared definition at metadata/boards/..."
        );
        assert_eq!(result.issues[0].severity, Severity::Warning); // missing-preset outcome
        // WARN line is always a warning regardless of outcome.
        assert_eq!(result.issues[1].severity, Severity::Warning);
        assert_eq!(
            result.issues[1].message,
            "hw_compat: minor version mismatch"
        );
    }

    #[test]
    fn analyze_skips_summary_lines_and_keeps_hints() {
        let stderr = "board.yaml: missing-preset\nhint: run `alp presets` to list valid SKUs\n";
        let execution = ValidatorExecution {
            status: Some(2),
            stdout: String::new(),
            stderr: stderr.to_string(),
        };
        let result = analyze_validation_result(&execution);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].severity, Severity::Suggestion);
        assert!(result.issues[0].message.starts_with("hint:"));
    }

    #[test]
    fn clean_execution_has_no_issues() {
        let execution = ValidatorExecution {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        };
        let result = analyze_validation_result(&execution);
        assert_eq!(result.outcome, Outcome::Clean);
        assert!(result.issues.is_empty());
    }

    #[test]
    fn rich_header_rejects_non_alp_code() {
        assert!(parse_rich_header("error[B005]: nope").is_none());
        assert!(parse_rich_header("error[ALP-B005]: ok").is_some());
        assert!(parse_rich_header("note[ALP-Z9]: hi").is_some());
    }

    #[test]
    fn crashed_validator_reclassifies_exit1_traceback_as_failed() {
        // A missing python dep: the validator crashes with a traceback and exits
        // 1 — the same exit code as a real schema violation. It must NOT be a
        // schema-violation verdict; a broken env is an infra failure. (issue #38)
        let stderr = "Traceback (most recent call last):\n  File \"/sdk/scripts/validate_board_yaml.py\", line 7, in <module>\n    import jsonschema\nModuleNotFoundError: No module named 'jsonschema'\n";
        let execution = ValidatorExecution {
            status: Some(1),
            stdout: String::new(),
            stderr: stderr.to_string(),
        };
        let result = analyze_validation_result(&execution);
        assert_eq!(result.outcome, Outcome::Failed);
        // A traceback yields no parseable diagnostics.
        assert!(result.issues.is_empty());
    }

    #[test]
    fn genuine_schema_violation_on_exit1_stays_schema_violation() {
        // A real validation failure (no traceback) is unchanged by the crash guard.
        let stderr = "FAIL som preset: no preset for E1M-NX9999\n";
        let execution = ValidatorExecution {
            status: Some(1),
            stdout: String::new(),
            stderr: stderr.to_string(),
        };
        let result = analyze_validation_result(&execution);
        assert_eq!(result.outcome, Outcome::SchemaViolation);
        assert_eq!(result.issues.len(), 1);
    }

    #[test]
    fn crash_guard_detects_indented_traceback_and_ignores_other_exits() {
        assert!(is_interpreter_crash(
            "  Traceback (most recent call last):\n    ...\n"
        ));
        assert!(!is_interpreter_crash("FAIL som preset: nope\n"));
        // The guard only fires on the exit-1 collision; a traceback on a
        // non-schema-violation exit code leaves that outcome untouched.
        let execution = ValidatorExecution {
            status: Some(2),
            stdout: String::new(),
            stderr: "Traceback (most recent call last):\n".to_string(),
        };
        assert_eq!(
            analyze_validation_result(&execution).outcome,
            Outcome::MissingPreset
        );
    }
}
