// SPDX-License-Identifier: Apache-2.0
//! SDK release catalogue + local readiness — a port of the IO-free parts of TS
//! `@alp-sdk/core/sdk/service`. Network (GitHub) and filesystem effects stay in
//! the CLI; this module parses the releases payload and inspects a local SDK
//! path through injected predicates.

use serde::Serialize;
use serde_json::Value;

/// GitHub Releases API endpoint for the `alplabai/alp-sdk` repository.
pub const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/alplabai/alp-sdk/releases";

const LOADER_SCRIPT_RELATIVE: &str = "scripts/alp_project.py";
const VERSION_FILE_RELATIVE: &str = "VERSION";
const METADATA_DIR_RELATIVE: &str = "metadata";

/// A single SDK release entry parsed from the GitHub Releases API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkRelease {
    /// Release tag name (e.g. `v1.5.0`).
    pub tag: String,
    /// ISO-8601 publish timestamp from GitHub.
    pub published_at: String,
    /// URL of the source tarball for this release.
    pub tarball_url: String,
    /// First paragraph of the release body (compact headline).
    pub release_notes_summary: String,
    /// Full release body (Markdown), for an expandable changelog.
    pub release_notes: String,
}

/// Parse the GitHub Releases API payload into typed releases (mirror of
/// `listRemoteSdkReleases`'s mapping). Errors on a non-array response.
pub fn parse_remote_sdk_releases(raw: &Value) -> Result<Vec<SdkRelease>, String> {
    let Some(items) = raw.as_array() else {
        return Err("Alp SDK: unexpected response shape from GitHub Releases API.".to_string());
    };

    Ok(items
        .iter()
        .filter(|item| item.get("tag_name").and_then(Value::as_str).is_some())
        .map(|item| {
            let str_field = |key: &str| {
                item.get(key)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            let body = item.get("body").and_then(Value::as_str).unwrap_or("");
            SdkRelease {
                tag: str_field("tag_name"),
                published_at: str_field("published_at"),
                tarball_url: str_field("tarball_url"),
                release_notes_summary: extract_first_paragraph(body),
                release_notes: body.trim().to_string(),
            }
        })
        .collect())
}

fn extract_first_paragraph(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match trimmed.find("\n\n") {
        Some(idx) => trimmed[..idx].trim().to_string(),
        None => trimmed.to_string(),
    }
}

/// Overall readiness of a local SDK path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SdkReadinessState {
    /// Loader script present and no issues found.
    Ready,
    /// Loader script present but some non-fatal issues exist.
    Partial,
    /// Loader script absent — not a valid SDK root.
    Missing,
}

/// Result of inspecting a local SDK path for readiness.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkReadinessReport {
    /// The inspected SDK root path.
    pub sdk_path: String,
    /// Trimmed contents of the `VERSION` file, if present and non-empty.
    pub version: Option<String>,
    /// Whether `scripts/alp_project.py` exists under the SDK root.
    pub loader_script_present: bool,
    /// Whether the `metadata/` directory exists under the SDK root.
    pub metadata_present: bool,
    /// Computed readiness verdict.
    pub state: SdkReadinessState,
    /// Human-readable descriptions of any problems found.
    pub issues: Vec<String>,
}

/// Inspect a local SDK path (mirror of `checkSdkReadiness`). `path_exists` and
/// `read_file` are injected so this stays pure/testable.
pub fn check_sdk_readiness(
    sdk_path: &str,
    path_exists: impl Fn(&str) -> bool,
    read_file: impl Fn(&str) -> Option<String>,
) -> SdkReadinessReport {
    let mut issues = Vec::new();
    let join = |rel: &str| join_path(sdk_path, rel);

    let loader_script_present = path_exists(&join(LOADER_SCRIPT_RELATIVE));
    if !loader_script_present {
        issues.push(format!(
            "scripts/alp_project.py not found — \"{sdk_path}\" is not a valid ALP SDK root."
        ));
    }

    let metadata_present = path_exists(&join(METADATA_DIR_RELATIVE));
    if !metadata_present {
        issues.push("metadata/ directory is missing.".to_string());
    }

    let mut version: Option<String> = None;
    let version_file = join(VERSION_FILE_RELATIVE);
    if path_exists(&version_file) {
        match read_file(&version_file) {
            Some(contents) => {
                let trimmed = contents.trim();
                version = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            None => issues.push("VERSION file could not be read.".to_string()),
        }
    }

    let state = if !loader_script_present {
        SdkReadinessState::Missing
    } else if !issues.is_empty() {
        SdkReadinessState::Partial
    } else {
        SdkReadinessState::Ready
    };

    SdkReadinessReport {
        sdk_path: sdk_path.to_string(),
        version,
        loader_script_present,
        metadata_present,
        state,
        issues,
    }
}

/// Read the active-SDK pointer (`.alp/sdk-path`) under `workspace_root`, if any
/// (mirror of `resolveActiveSdk`).
pub fn resolve_active_sdk(
    workspace_root: &str,
    path_exists: impl Fn(&str) -> bool,
    read_file: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    let pointer = join_path(workspace_root, ".alp/sdk-path");
    if !path_exists(&pointer) {
        return None;
    }
    let raw = read_file(&pointer)?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("sdkPath")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Join a path with a relative segment, normalizing the separator to the host.
fn join_path(base: &str, relative: &str) -> String {
    let mut path = std::path::PathBuf::from(base);
    for part in relative.split('/') {
        path.push(part);
    }
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_releases_filtering_untagged() {
        let raw = json!([
            {"tag_name": "v1.5.0", "published_at": "2024-01-02T00:00:00Z", "tarball_url": "u", "body": "First line.\n\nrest"},
            {"published_at": "x"},
        ]);
        let releases = parse_remote_sdk_releases(&raw).unwrap();
        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].tag, "v1.5.0");
        assert_eq!(releases[0].release_notes_summary, "First line.");
        assert_eq!(releases[0].release_notes, "First line.\n\nrest");
    }

    #[test]
    fn non_array_response_errors() {
        assert!(parse_remote_sdk_releases(&json!({"message": "rate limited"})).is_err());
    }

    #[test]
    fn readiness_missing_when_no_loader() {
        let report = check_sdk_readiness("/sdk", |_| false, |_| None);
        assert_eq!(report.state, SdkReadinessState::Missing);
        assert!(!report.loader_script_present);
    }

    #[test]
    fn readiness_ready_when_complete() {
        let report = check_sdk_readiness(
            "/sdk",
            |p| p.ends_with("alp_project.py") || p.ends_with("metadata") || p.ends_with("VERSION"),
            |_| Some("v1.5.0\n".to_string()),
        );
        assert_eq!(report.state, SdkReadinessState::Ready);
        assert_eq!(report.version.as_deref(), Some("v1.5.0"));
        assert!(report.issues.is_empty());
    }

    #[test]
    fn active_sdk_pointer_parsed() {
        let resolved = resolve_active_sdk(
            "/ws",
            |p| p.ends_with("sdk-path"),
            |_| Some("{\"sdkPath\": \"/cache/v1\"}".to_string()),
        );
        assert_eq!(resolved.as_deref(), Some("/cache/v1"));
    }
}
