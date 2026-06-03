// SPDX-License-Identifier: Apache-2.0
//! `alp presets` — list SDK presets (SKUs, carriers) plus built-in defaults.
//!
//! Mirrors TS `runPresetsCommand`: built-in library/inference/log/os defaults
//! come from `empty_preset_catalogue`; SKUs and carriers are discovered from
//! `<sdk>/metadata/e1m_modules` and `<sdk>/metadata/carriers`. An unresolved
//! SDK root is a warning (not a failure) — defaults are still returned.

use std::path::Path;

use alp_core::{empty_preset_catalogue, parse_board_model};

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
struct PresetsData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "sdkRoot")]
    sdk_root: Option<String>,
    skus: Vec<String>,
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

    let (skus, carriers) = match &context.sdk_root {
        Some(root) => (read_skus(root), read_carriers(root)),
        None => (Vec::new(), Vec::new()),
    };

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

fn read_skus(sdk_root: &str) -> Vec<String> {
    let dir = Path::new(sdk_root).join("metadata").join("e1m_modules");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut skus: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("E1M-") {
                return None;
            }
            if dir.join(&name).join("som.yaml").exists() {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    skus.sort();
    skus
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
