// SPDX-License-Identifier: Apache-2.0
//! Machine-readable result envelope — byte-compatible with the TypeScript
//! CLI's `CliEnvelope`. JSON mode writes exactly one of these to stdout.

use serde::Serialize;

/// A single diagnostic carried in an envelope's `issues` list.
#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    /// Stable machine-readable issue identifier.
    pub code: String,
    /// Severity label (e.g. `error`, `warning`).
    pub severity: String,
    /// Human-readable description.
    pub message: String,
}

/// Project context attached to every envelope; fields are absent when unresolved.
#[derive(Debug, Clone, Serialize)]
pub struct Project {
    /// Absolute project root path, if resolved.
    pub root: Option<String>,
    /// Absolute path to the project's `board.yaml`, if found.
    #[serde(rename = "boardYaml")]
    pub board_yaml: Option<String>,
}

/// Top-level result envelope serialized to stdout in JSON mode; `T` is the
/// command-specific payload.
#[derive(Debug, Clone, Serialize)]
pub struct Envelope<T: Serialize> {
    /// Name of the command that produced this envelope.
    pub command: String,
    /// Whether the command succeeded (mirrors `exit_code == 0`).
    pub ok: bool,
    /// Process exit code (0 success; see crate exit-code contract).
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    /// Resolved project context.
    pub project: Project,
    /// Command-specific result payload.
    pub data: T,
    /// Diagnostics emitted by the command.
    pub issues: Vec<Issue>,
}

impl<T: Serialize> Envelope<T> {
    /// Build an envelope; `ok` is derived from `exit_code == 0`.
    pub fn new(
        command: &str,
        project: Project,
        data: T,
        issues: Vec<Issue>,
        exit_code: i32,
    ) -> Self {
        Self {
            command: command.to_string(),
            ok: exit_code == 0,
            exit_code,
            project,
            data,
            issues,
        }
    }

    /// Serialize to a single-line JSON document (stdout contract).
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("envelope serialization is infallible")
    }
}
