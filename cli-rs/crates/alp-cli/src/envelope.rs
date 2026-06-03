// SPDX-License-Identifier: Apache-2.0
//! Machine-readable result envelope — byte-compatible with the TypeScript
//! CLI's `CliEnvelope`. JSON mode writes exactly one of these to stdout.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Project {
    pub root: Option<String>,
    #[serde(rename = "boardYaml")]
    pub board_yaml: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Envelope<T: Serialize> {
    pub command: String,
    pub ok: bool,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    pub project: Project,
    pub data: T,
    pub issues: Vec<Issue>,
}

impl<T: Serialize> Envelope<T> {
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
