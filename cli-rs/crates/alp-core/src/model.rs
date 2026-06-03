// SPDX-License-Identifier: Apache-2.0
//! Board configuration model — Rust mirror of the TypeScript
//! `@alp-sdk/core` board/configurator model.
//!
//! The contract (shared JSON schema + fixtures) is the single source of
//! truth across the TS and Rust implementations.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Parsed `board.yaml` document. Unknown fields are ignored so that the
/// first Rust phases can expand safely while YAML keeps richer data.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BoardModel {
    /// Schema revision. Absent in YAML is treated as v1 (matches TS, where
    /// `model.schema_version >= 2` is false for `undefined`).
    #[serde(default)]
    pub schema_version: Option<u32>,

    #[serde(default)]
    pub som: Option<Som>,

    #[serde(default)]
    pub carrier: Option<Carrier>,

    /// v1 only. In v2 this moves into a per-core `cores:` block.
    #[serde(default)]
    pub os: Option<String>,

    #[serde(default)]
    pub preset: Option<String>,

    #[serde(default)]
    pub cores: Option<BTreeMap<String, CoreEntry>>,

    #[serde(default)]
    pub ipc: Option<Vec<IpcCarveOut>>,

    #[serde(default)]
    pub inference: Option<Inference>,

    #[serde(default)]
    pub libraries: Option<Vec<String>>,

    #[serde(default)]
    pub iot: Option<Iot>,

    #[serde(default)]
    pub diagnostics: Option<Diagnostics>,

    #[serde(default)]
    pub populated: Option<BTreeMap<String, bool>>,

    #[serde(default)]
    pub chips: Option<Vec<String>>,

    #[serde(default)]
    pub e1m_routes: Option<BTreeMap<String, serde_yaml::Value>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Som {
    #[serde(default)]
    pub sku: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Carrier {
    #[serde(default)]
    pub name: Option<String>,

    #[serde(default)]
    pub populated: Option<BTreeMap<String, bool>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CoreEntry {
    #[serde(default)]
    pub os: Option<String>,

    #[serde(default)]
    pub app: Option<String>,

    #[serde(default)]
    pub image: Option<String>,

    #[serde(default)]
    pub peripherals: Option<Vec<String>>,

    #[serde(default)]
    pub libraries: Option<Vec<String>>,

    #[serde(default)]
    pub inference: Option<Inference>,

    #[serde(default)]
    pub iot: Option<Iot>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct IpcCarveOut {
    pub name: String,
    pub endpoints: Vec<String>,
    pub size_kib: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Inference {
    #[serde(default)]
    pub backend: Option<String>,

    #[serde(default)]
    pub default_arena_kib: Option<u32>,
}

impl Inference {
    pub fn is_empty(&self) -> bool {
        self.backend.as_deref().unwrap_or_default().is_empty() && self.default_arena_kib.is_none()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Iot {
    #[serde(default)]
    pub wifi: Option<bool>,

    #[serde(default)]
    pub mqtt: Option<bool>,

    #[serde(default)]
    pub ble: Option<bool>,

    #[serde(default)]
    pub tls: Option<bool>,
}

impl Iot {
    pub fn any_enabled(&self) -> bool {
        matches!(self.wifi, Some(true))
            || matches!(self.mqtt, Some(true))
            || matches!(self.ble, Some(true))
            || matches!(self.tls, Some(true))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Diagnostics {
    #[serde(default)]
    pub last_error: Option<bool>,

    #[serde(default)]
    pub log_level: Option<String>,
}

impl BoardModel {
    /// Effective schema version, defaulting to 1 when absent.
    pub fn effective_schema_version(&self) -> u32 {
        self.schema_version.unwrap_or(1)
    }
}

/// Normalize a parsed board model using the same cleanup rules as
/// TypeScript `normalizeBoardModel`.
pub fn normalize_board_model(mut model: BoardModel) -> BoardModel {
    if model.effective_schema_version() < 2 {
        if model.libraries.as_ref().is_some_and(Vec::is_empty) {
            model.libraries = None;
        }

        if model.iot.as_ref().is_some_and(|iot| !iot.any_enabled()) {
            model.iot = None;
        }

        if model.inference.as_ref().is_some_and(Inference::is_empty) {
            model.inference = None;
        }

        if let Some(carrier) = &mut model.carrier {
            if carrier.populated.as_ref().is_some_and(BTreeMap::is_empty) {
                carrier.populated = None;
            }
        }
    }

    if model.effective_schema_version() >= 2 {
        model.os = None;
    }

    model
}
