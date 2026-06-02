// SPDX-License-Identifier: Apache-2.0
//! Board configuration model — Rust mirror of the TypeScript
//! `@alp-sdk/core` board/configurator model.
//!
//! Phase 0 keeps only the fields the local validator inspects. The
//! contract (shared JSON schema + fixtures) is the single source of
//! truth across the TS and Rust implementations.

use serde::Deserialize;
use std::collections::BTreeMap;

/// Parsed `board.yaml` document. Unknown fields are ignored so that the
/// model can stay minimal while the YAML keeps richer data.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BoardModel {
    /// Schema revision. Absent in YAML is treated as v1 (matches TS, where
    /// `model.schema_version >= 2` is false for `undefined`).
    #[serde(default)]
    pub schema_version: Option<u32>,

    #[serde(default)]
    pub som: Option<Som>,

    /// v1 only. In v2 this moves into a per-core `cores:` block.
    #[serde(default)]
    pub os: Option<String>,

    #[serde(default)]
    pub preset: Option<String>,

    #[serde(default)]
    pub cores: Option<BTreeMap<String, CoreEntry>>,

    #[serde(default)]
    pub diagnostics: Option<Diagnostics>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Som {
    #[serde(default)]
    pub sku: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CoreEntry {
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub app: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Diagnostics {
    #[serde(default)]
    pub log_level: Option<String>,
}

impl BoardModel {
    /// Effective schema version, defaulting to 1 when absent.
    pub fn effective_schema_version(&self) -> u32 {
        self.schema_version.unwrap_or(1)
    }
}
