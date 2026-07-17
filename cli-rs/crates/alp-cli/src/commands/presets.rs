// SPDX-License-Identifier: Apache-2.0
//! `alp presets` — list SDK presets (SKUs, carriers) plus built-in defaults.
//!
//! Mirrors TS `runPresetsCommand`: built-in library/inference/log/os defaults
//! come from `empty_preset_catalogue`; SKUs and carriers are discovered from
//! `<sdk>/metadata/e1m_modules` and `<sdk>/metadata/boards`. An unresolved
//! SDK root is a warning (not a failure) — defaults are still returned.

use std::path::Path;

use alp_core::{empty_preset_catalogue, parse_board_model, parse_board_preset, parse_som_preset};

use super::CommandRun;
use crate::cli::GlobalArgs;
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

/// One board preset discovered under `<sdk>/metadata/boards` (flat `<name>.yaml`
/// with a top-level `populated:` map). Serialized as the envelope `carriers`
/// entry for back-compat: its preset name and the sorted populated keys.
#[derive(serde::Serialize)]
struct CarrierEntry {
    /// Board preset name (the `<name>.yaml` file stem under `metadata/boards`,
    /// or the directory name under the pin-era `metadata/carriers` fallback).
    name: String,
    /// Sorted keys present in the board's `populated` map.
    #[serde(rename = "populatedKeys")]
    populated_keys: Vec<String>,
}

/// One SoM preset discovered under `<sdk>/metadata/e1m_modules`: SKU id,
/// display name, family, and per-core runtime topology.
#[derive(serde::Serialize)]
struct SomEntry {
    /// SoM SKU id (e.g. `E1M-...`).
    sku: String,
    /// Human-readable SoM name.
    #[serde(rename = "displayName")]
    display_name: String,
    /// SoM family classifier.
    family: String,
    /// Per-core runtime topology (id + resolved OS), for heterogeneous scaffolding.
    cores: Vec<SomCoreEntry>,
}

/// One core of a SoM's topology: its id and the runtime it naturally runs
/// (zephyr for a Cortex-M `board:`, yocto for a Cortex-A `machine:`).
#[derive(serde::Serialize)]
struct SomCoreEntry {
    /// Core id within the SoM topology.
    id: String,
    /// Resolved runtime for the core (`zephyr`, `yocto`, or heuristic fallback).
    os: String,
}

/// The `presets` command payload: discovered SDK presets (SKUs/SoMs, carriers)
/// plus the built-in library/inference/log/os defaults. Serialized as the
/// envelope `data` field.
#[derive(serde::Serialize)]
struct PresetsData {
    /// Payload schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Resolved SDK root, or `None` when unresolved.
    #[serde(rename = "sdkRoot")]
    sdk_root: Option<String>,
    /// Bare SKU ids (back-compat); derived from `soms`.
    skus: Vec<String>,
    /// Rich SoM presets discovered from `<sdk>/metadata/e1m_modules/*.yaml`.
    soms: Vec<SomEntry>,
    /// Board presets discovered from `<sdk>/metadata/boards` (pin-era
    /// `metadata/carriers` as a fallback). Field name kept for back-compat.
    carriers: Vec<CarrierEntry>,
    /// Built-in library defaults from `empty_preset_catalogue` (the per-core
    /// `cores.<id>.libraries` token set).
    libraries: Vec<String>,
    /// ADR-0018 curated libraries discovered from
    /// `<sdk>/metadata/libraries/*.yaml` — the values a board.yaml top-level
    /// `libraries:` entry names (distinct from the per-core `libraries` tokens
    /// above). Empty when the SDK root is unresolved.
    #[serde(rename = "boardLibraries")]
    board_libraries: Vec<String>,
    /// Built-in inference-backend defaults.
    #[serde(rename = "inferenceBackends")]
    inference_backends: Vec<String>,
    /// Built-in log-level defaults.
    #[serde(rename = "logLevels")]
    log_levels: Vec<String>,
    /// Built-in OS choices.
    #[serde(rename = "osChoices")]
    os_choices: Vec<String>,
}

/// Entry point for `alp presets`. Resolves the project context, discovers SoMs
/// and carriers from the SDK root (empty + a warning issue when unresolved),
/// merges in built-in defaults, and emits the text or JSON envelope.
pub fn run(g: &GlobalArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let defaults = empty_preset_catalogue();

    let (soms, carriers, carriers_found, board_libraries) = match &context.sdk_root {
        Some(root) => {
            let (carriers, carriers_found) = read_carriers(root);
            (
                read_soms(root),
                carriers,
                carriers_found,
                read_board_libraries(root),
            )
        }
        // Unresolved root is already reported below; treat as "found" so the
        // boards-dir-missing warning is not emitted on top of it.
        None => (Vec::new(), Vec::new(), true, Vec::new()),
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
    } else if !carriers_found {
        issues.push(Issue {
            code: "presets.boards-dir-missing".to_string(),
            severity: "warning".to_string(),
            message:
                "No board presets found: neither metadata/boards/ nor metadata/carriers/ exists under the SDK root."
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
        board_libraries,
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
                    // Prefer the schema-authoritative `topology.<core>.os`
                    // (som-preset-v1.schema.json enum) when the preset sets
                    // it. Legacy presets that only declare `board:`/
                    // `machine:` fall back to the board/machine heuristic: a
                    // `board:` is a Zephyr (Cortex-M) target, a `machine:` is
                    // a Yocto (Cortex-A) one; otherwise the shared
                    // silicon-class heuristic decides.
                    let os = t.os.clone().unwrap_or_else(|| {
                        match (t.board.is_some(), t.machine.is_some()) {
                            (true, _) => "zephyr".to_string(),
                            (_, true) => "yocto".to_string(),
                            _ => alp_core::wizard::infer_runtime_for_core_id(&t.id).to_string(),
                        }
                    });
                    SomCoreEntry {
                        id: t.id.clone(),
                        os,
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

/// Discover board presets from the SDK. The current SDK layout (v0.11+) ships
/// flat `<sdk>/metadata/boards/<name>.yaml` files with a top-level `populated:`
/// map, parsed via the shared `parse_board_preset` (mirroring the TS
/// `parseBoardPreset`); the pin-era `<sdk>/metadata/carriers/<name>/board.yaml`
/// layout (`carrier.populated`) is kept only as a fallback. Malformed presets
/// are skipped (matches TS). Result is sorted by name. The returned bool is
/// `false` only when NEITHER layout directory exists — letting the caller warn
/// instead of reporting an empty list as success.
fn read_carriers(sdk_root: &str) -> (Vec<CarrierEntry>, bool) {
    let meta = Path::new(sdk_root).join("metadata");

    // Primary: flat `metadata/boards/<name>.yaml` with a top-level `populated:`.
    if let Ok(entries) = std::fs::read_dir(meta.join("boards")) {
        let mut carriers: Vec<CarrierEntry> = Vec::new();
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".yaml") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else {
                continue;
            };
            // Ignore malformed board presets in listing mode (matches TS).
            let Ok(preset) = parse_board_preset(&text) else {
                continue;
            };
            let mut populated_keys: Vec<String> = preset.populated.into_keys().collect();
            populated_keys.sort();
            carriers.push(CarrierEntry {
                name: name.trim_end_matches(".yaml").to_string(),
                populated_keys,
            });
        }
        carriers.sort_by(|a, b| a.name.cmp(&b.name));
        return (carriers, true);
    }

    // Fallback: pin-era `metadata/carriers/<name>/board.yaml` (`carrier.populated`).
    let dir = meta.join("carriers");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return (Vec::new(), false);
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
    (carriers, true)
}

/// Discover the ADR-0018 curated libraries from `<sdk>/metadata/libraries`: the
/// stem of each `<name>.yaml` manifest (`README*` + non-yaml entries skipped),
/// sorted + de-duplicated. These are the values a board.yaml top-level
/// `libraries:` entry names — distinct from the built-in per-core token
/// defaults in `libraries`.
fn read_board_libraries(sdk_root: &str) -> Vec<String> {
    let dir = Path::new(sdk_root).join("metadata").join("libraries");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".yaml") || name.to_ascii_lowercase().starts_with("readme") {
                return None;
            }
            Some(name.trim_end_matches(".yaml").to_string())
        })
        .collect();
    names.sort();
    names.dedup();
    names
}

/// Render the human-readable (non-JSON) output lines: a summary count line,
/// plus per-SKU and per-carrier lines when `g.verbose` is set.
fn presets_text(data: &PresetsData, g: &GlobalArgs) -> Vec<String> {
    let mut lines = vec![format!(
        "presets: skus={} carriers={} libraries={} boardLibraries={}",
        data.skus.len(),
        data.carriers.len(),
        data.libraries.len(),
        data.board_libraries.len()
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

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_SDK: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../contract/fixtures/presets/sdk-present"
    );

    #[test]
    fn read_board_libraries_lists_yaml_stems_sorted_and_skips_readme() {
        assert_eq!(read_board_libraries(FIXTURE_SDK), vec!["aws-iot", "lvgl"]);
    }

    #[test]
    fn read_board_libraries_empty_when_dir_missing() {
        assert!(read_board_libraries("/no/such/sdk/root").is_empty());
    }

    #[test]
    fn read_carriers_reads_flat_boards_layout() {
        let (carriers, found) = read_carriers(FIXTURE_SDK);
        assert!(found);
        let names: Vec<&str> = carriers.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["bare", "e1m-evk"]);
        let evk = carriers.iter().find(|c| c.name == "e1m-evk").unwrap();
        assert_eq!(evk.populated_keys, vec!["ble", "wifi"]);
    }

    #[test]
    fn read_carriers_reports_missing_when_no_layout() {
        let (carriers, found) = read_carriers("/no/such/sdk/root");
        assert!(carriers.is_empty());
        assert!(!found);
    }
}
