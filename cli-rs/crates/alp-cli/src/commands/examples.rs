// SPDX-License-Identifier: Apache-2.0
//! `alp examples` — list the SDK's ready-made example projects as a catalog the
//! New Project flow can scaffold from via `alp init --from-example <sourceDir>`.
//!
//! Scans the resolved alp-sdk checkout's `examples/<category>/<name>/` tree for
//! directories carrying a `board.yaml`, deriving a display title/description from
//! each example's `README.md`. When no SDK root resolves, the catalog is empty —
//! not an error — so callers can render "no examples available" cleanly.

use alp_core::wizard::{
    discover_examples, example_description_from_readme, example_id_from_source_dir,
    example_title_from_readme,
};

use super::CommandRun;
use crate::cli::GlobalArgs;
use crate::envelope::{Envelope, Project};
use crate::exit::ExitCode;

/// One example project in the `examples` catalog envelope.
#[derive(serde::Serialize)]
struct ExampleEntry {
    /// Stable, unique id (equal to `source_dir`).
    id: String,
    /// `category/name` path relative to the SDK `examples/` root.
    #[serde(rename = "sourceDir")]
    source_dir: String,
    /// Human-readable title (README heading or title-cased leaf name).
    title: String,
    /// One-line description (README's first prose line; empty when absent).
    description: String,
}

/// JSON `data` payload of the `examples` envelope: the discovered example catalog.
#[derive(serde::Serialize)]
struct ExamplesData {
    /// Payload schema version (currently `"1"`).
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    /// Every discovered example project, sorted by `source_dir`.
    examples: Vec<ExampleEntry>,
}

/// Run `alp examples`: resolve the SDK root, scan `<sdk>/examples` for example
/// projects, and emit them as a catalog. A missing SDK root yields an empty
/// catalog with a success exit.
pub fn run(g: &GlobalArgs) -> CommandRun {
    let workspace_root = crate::util::cli_workspace_root(g);
    let examples: Vec<ExampleEntry> = match crate::util::resolve_sdk_root(g, &workspace_root) {
        Some(sdk_root) => discover_examples(&sdk_root.join("examples"))
            .into_iter()
            .map(|d| ExampleEntry {
                id: example_id_from_source_dir(&d.source_dir),
                title: example_title_from_readme(d.readme.as_deref(), &d.source_dir),
                description: example_description_from_readme(d.readme.as_deref()),
                source_dir: d.source_dir,
            })
            .collect(),
        None => Vec::new(),
    };

    let count = examples.len();
    let data = ExamplesData {
        schema_version: "1".to_string(),
        examples,
    };
    let project = Project {
        root: None,
        board_yaml: None,
    };
    let text = if g.is_json() {
        vec![]
    } else if count == 0 {
        vec![
            "examples: no example projects found (is the alp-sdk checkout resolvable? use --sdk-root)."
                .to_string(),
        ]
    } else {
        vec![format!("examples: {count} example project(s) available")]
    };
    let json = g.is_json().then(|| {
        Envelope::new("examples", project, data, vec![], ExitCode::Success.code()).to_json()
    });
    CommandRun {
        exit: ExitCode::Success,
        text,
        json,
    }
}

#[cfg(test)]
mod tests {
    use super::{ExampleEntry, ExamplesData};

    /// Pins the byte-fixed populated-catalog shape (camelCase `sourceDir`, field
    /// order) that the empty-catalog contract fixture cannot exercise and that the
    /// extension's `data.examples[].sourceDir` consumer depends on.
    #[test]
    fn examples_data_serializes_with_camelcase_source_dir_and_field_order() {
        let data = ExamplesData {
            schema_version: "1".to_string(),
            examples: vec![ExampleEntry {
                id: "audio/i2s-tone".to_string(),
                source_dir: "audio/i2s-tone".to_string(),
                title: "I2S Tone".to_string(),
                description: "Plays a tone.".to_string(),
            }],
        };
        let json = serde_json::to_string(&data).unwrap();
        assert_eq!(
            json,
            r#"{"schemaVersion":"1","examples":[{"id":"audio/i2s-tone","sourceDir":"audio/i2s-tone","title":"I2S Tone","description":"Plays a tone."}]}"#
        );
    }
}
