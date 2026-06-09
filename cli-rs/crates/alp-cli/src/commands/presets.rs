// SPDX-License-Identifier: Apache-2.0
//! `alp presets` — list SDK presets (SKUs, carriers) plus built-in defaults.
//!
//! Mirrors TS `runPresetsCommand`: built-in library/inference/log/os defaults
//! come from `empty_preset_catalogue`; SKUs and carriers are discovered from
//! `<sdk>/metadata/e1m_modules` and `<sdk>/metadata/carriers`. An unresolved
//! SDK root is a warning (not a failure) — defaults are still returned.

use std::path::Path;

use alp_core::{empty_preset_catalogue, parse_board_model, parse_som_preset};

use super::CommandRun;
use crate::cli::GlobalArgs;
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

#[derive(serde::Serialize)]
struct CarrierEntry {
    name: String,
    #[serde(rename = "populatedKeys")]
    populated_keys: Vec<String>,
}

#[derive(serde::Serialize)]
struct SomEntry {
    sku: String,
    #[serde(rename = "displayName")]
    display_name: String,
    family: String,
    /// Per-core runtime topology (id + resolved OS), for heterogeneous scaffolding.
    cores: Vec<SomCoreEntry>,
}

/// One core of a SoM's topology: its id and the runtime it naturally runs
/// (zephyr for a Cortex-M `board:`, yocto for a Cortex-A `machine:`).
#[derive(serde::Serialize)]
struct SomCoreEntry {
    id: String,
    os: String,
}

#[derive(serde::Serialize)]
struct PresetsData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "sdkRoot")]
    sdk_root: Option<String>,
    /// Bare SKU ids (back-compat); derived from `soms`.
    skus: Vec<String>,
    /// Rich SoM presets discovered from `<sdk>/metadata/e1m_modules/*.yaml`.
    soms: Vec<SomEntry>,
    carriers: Vec<CarrierEntry>,
    libraries: Vec<String>,
    #[serde(rename = "inferenceBackends")]
    inference_backends: Vec<String>,
    #[serde(rename = "logLevels")]
    log_levels: Vec<String>,
    #[serde(rename = "osChoices")]
    os_choices: Vec<String>,
}

pub fn run(g: &GlobalArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let defaults = empty_preset_catalogue();

    let (soms, carriers) = match &context.sdk_root {
        Some(root) => (read_soms(root), read_carriers(root)),
        None => (Vec::new(), Vec::new()),
    };
    let skus: Vec<String> = soms.iter().map(|s| s.sku.clone()).collect();

    let mut issues = Vec::new();
    if context.sdk_root.is_none() {
        issues.push(Issue {
            code: "presets.sdk-root-unresolved".to_string(),
            severity: "warning".to_string(),
            message:
                "alp-sdk root is unresolved. Returning built-in defaults and empty SDK preset lists."
                    .to_string(),
        });
    }

    let data = PresetsData {
        schema_version: "1".to_string(),
        sdk_root: context.sdk_root.clone(),
        skus,
        soms,
        carriers,
        libraries: defaults.libraries,
        inference_backends: defaults.inference_backends,
        log_levels: defaults.log_levels,
        os_choices: defaults.os_choices,
    };

    let text = if g.is_json() {
        Vec::new()
    } else {
        presets_text(&data, g)
    };
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };
    let json = g.is_json().then(|| {
        Envelope::new("presets", project, data, issues, ExitCode::Success.code()).to_json()
    });

    CommandRun {
        exit: ExitCode::Success,
        text,
        json,
    }
}

/// Discover SoM presets from `<sdk>/metadata/e1m_modules`, parsing each
/// (sku + display_name + family) via the shared catalogue parser. Supports both
/// layouts the SDK has used: a flat `E1M-X.yaml` file, or an `E1M-X/som.yaml`
/// directory. Entries that aren't `E1M-*` or lack a yaml are skipped.
fn read_soms(sdk_root: &str) -> Vec<SomEntry> {
    let dir = Path::new(sdk_root).join("metadata").join("e1m_modules");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut soms: Vec<SomEntry> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("E1M-") {
                return None;
            }
            let path = entry.path();
            let yaml_path = if path.is_dir() {
                path.join("som.yaml")
            } else if name.ends_with(".yaml") {
                path
            } else {
                return None;
            };
            let text = std::fs::read_to_string(&yaml_path).ok()?;
            let som = parse_som_preset(&text).ok()?;
            let cores = som
                .topology
                .iter()
                .map(|t| {
                    // OS is resolved from the topology: a `board:` is a Zephyr
                    // (Cortex-M) target, a `machine:` is a Yocto (Cortex-A) one;
                    // fall back to the core id's silicon class.
                    let os = match (t.board.is_some(), t.machine.is_some()) {
                        (true, _) => "zephyr",
                        (_, true) => "yocto",
                        _ if t.id.to_lowercase().starts_with('a') => "yocto",
                        _ => "zephyr",
                    };
                    SomCoreEntry {
                        id: t.id.clone(),
                        os: os.to_string(),
                    }
                })
                .collect();
            Some(SomEntry {
                sku: som.sku,
                display_name: som.display_name,
                family: som.family,
                cores,
            })
        })
        .collect();
    soms.sort_by(|a, b| a.sku.cmp(&b.sku));
    soms
}

fn read_carriers(sdk_root: &str) -> Vec<CarrierEntry> {
    let dir = Path::new(sdk_root).join("metadata").join("carriers");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut carriers: Vec<CarrierEntry> = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        let board = dir.join(&name).join("board.yaml");
        if !board.exists() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&board) else {
            continue;
        };
        // Ignore malformed carrier presets in listing mode (matches TS).
        let Ok(model) = parse_board_model(&text) else {
            continue;
        };
        let mut populated_keys: Vec<String> = model
            .carrier
            .and_then(|c| c.populated)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        populated_keys.sort();
        carriers.push(CarrierEntry {
            name,
            populated_keys,
        });
    }
    carriers.sort_by(|a, b| a.name.cmp(&b.name));
    carriers
}

fn presets_text(data: &PresetsData, g: &GlobalArgs) -> Vec<String> {
    let mut lines = vec![format!(
        "presets: skus={} carriers={} libraries={}",
        data.skus.len(),
        data.carriers.len(),
        data.libraries.len()
    )];
    if g.verbose {
        for sku in &data.skus {
            lines.push(format!("sku: {sku}"));
        }
        for carrier in &data.carriers {
            lines.push(format!("carrier: {}", carrier.name));
        }
    }
    lines
}
