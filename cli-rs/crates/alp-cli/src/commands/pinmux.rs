// SPDX-License-Identifier: Apache-2.0
//! `alp pinmux` — the E1M pinmux capability table for a SoM family, as the
//! single source the extension/LSP consume instead of reading
//! `<sdk>/metadata/pinmux/<family>.yaml` directly. Resolves the family from an
//! explicit `--family` or a `--sku` prefix map, reads the capability table, and
//! emits it in the envelope. Fail-soft: an unresolved SDK root, an unknown SKU,
//! or a family with no generated table each surface a warning + empty pads, not
//! a hard failure.

use std::path::Path;

use alp_core::{PinmuxPad, parse_pinmux_table, pinmux_family_for_sku};

use super::CommandRun;
use crate::cli::{GlobalArgs, PinmuxArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;
use crate::util::resolve_cli_project_context;

/// The `pinmux` command payload: the resolved family + its capability pads,
/// serialized with the same camelCase field names the extension's `PinmuxTable`
/// uses so it is consumed without a second parser.
#[derive(serde::Serialize)]
struct PinmuxData {
    /// Payload schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Resolved SDK root, or `None` when unresolved.
    #[serde(rename = "sdkRoot")]
    sdk_root: Option<String>,
    /// The `--sku` the family was resolved from, echoed back when provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    sku: Option<String>,
    /// Resolved pinmux family stem (`aen`/`v2n`/…), or `None` when unresolved.
    family: Option<String>,
    /// The capability table's `display_name`, when the table carries one.
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    /// The capability rows (E1M pad → silicon function), empty when unresolved.
    pads: Vec<PinmuxPad>,
}

/// Entry point for `alp pinmux`. Resolves the family, reads the capability table
/// from the SDK root, and emits the text or JSON envelope (always exit 0; the
/// unresolved cases are warnings).
pub fn run(g: &GlobalArgs, args: &PinmuxArgs) -> CommandRun {
    let context = resolve_cli_project_context(g);
    let mut issues = Vec::new();

    // Family resolution: explicit `--family` wins; else map `--sku` by prefix.
    let family: Option<String> = match (&args.family, &args.sku) {
        (Some(fam), _) => Some(fam.clone()),
        (None, Some(sku)) => match pinmux_family_for_sku(sku) {
            Some(stem) => Some(stem.to_string()),
            None => {
                issues.push(Issue {
                    code: "pinmux.unknown-sku".to_string(),
                    severity: "warning".to_string(),
                    message: format!("SKU '{sku}' maps to no known pinmux family."),
                });
                None
            }
        },
        (None, None) => {
            issues.push(Issue {
                code: "pinmux.no-target".to_string(),
                severity: "warning".to_string(),
                message: "Provide --sku <sku> or --family <family>.".to_string(),
            });
            None
        }
    };

    let (display_name, pads) = match (&context.sdk_root, &family) {
        (Some(root), Some(fam)) => {
            let path = Path::new(root)
                .join("metadata")
                .join("pinmux")
                .join(format!("{fam}.yaml"));
            match std::fs::read_to_string(&path) {
                Ok(text) => {
                    let table = parse_pinmux_table(&text);
                    (table.display_name, table.pads)
                }
                Err(_) => {
                    issues.push(Issue {
                        code: "pinmux.table-not-found".to_string(),
                        severity: "warning".to_string(),
                        message: format!(
                            "No pinmux capability table for family '{fam}' (metadata/pinmux/{fam}.yaml)."
                        ),
                    });
                    (None, Vec::new())
                }
            }
        }
        _ => {
            if context.sdk_root.is_none() {
                issues.push(Issue {
                    code: "pinmux.sdk-root-unresolved".to_string(),
                    severity: "warning".to_string(),
                    message: "alp-sdk root is unresolved; cannot read the pinmux table."
                        .to_string(),
                });
            }
            (None, Vec::new())
        }
    };

    let data = PinmuxData {
        schema_version: "1".to_string(),
        sdk_root: context.sdk_root.clone(),
        sku: args.sku.clone(),
        family,
        display_name,
        pads,
    };

    let text = if g.is_json() {
        Vec::new()
    } else {
        vec![format!(
            "pinmux: family={} pads={}",
            data.family.as_deref().unwrap_or("-"),
            data.pads.len()
        )]
    };
    let project = Project {
        root: context.workspace_root.clone(),
        board_yaml: context.board_yaml_path.clone(),
    };
    let json = g.is_json().then(|| {
        Envelope::new("pinmux", project, data, issues, ExitCode::Success.code()).to_json()
    });

    CommandRun {
        exit: ExitCode::Success,
        text,
        json,
    }
}
