// SPDX-License-Identifier: Apache-2.0
//! Build-plan contract (Wave C) — the **consumed** shape of the SDK's
//! `alp_orchestrate.py --emit build-plan` JSON, locked as ADR 0014
//! (alp-sdk `docs/adr/0014-build-plan-emit-cli-contract.md`, 2026-06-04).
//!
//! The CLI *consumes* this plan; it does **not** compute it. The planner — the
//! fast-moving, vendor-heavy part (partition allocation, sysbuild, TF-M) — stays
//! the SDK's single source of truth (see `docs/BUILD_ORCHESTRATION.md` and
//! `docs/PROPOSAL-alp-build-core.md`). This module is pure: it only models +
//! parses the plan JSON. Materialise / execute / schedule live in the CLI
//! (`alp-cli`).
//!
//! Contract notes (ADR 0014, mirrored here so the types stay honest):
//!   * camelCase keys; `schemaVersion` independent of board.yaml's version.
//!   * Every artefact carries its `contents` (`GeneratedFile`) so materialise is
//!     pure byte-write IO — no content-derivation leaks to the consumer.
//!   * **No `inputHash`** (the consumer computes its own cache key over the plan)
//!     and **no `sequential`** (parallelism policy is the consumer's scheduler).
//!   * One slice per non-`off` core, sorted by `coreId`. A slice the script
//!     cannot build yet carries `command: null` + a `no-command` warning — never
//!     dropped.
//!   * The per-slice `command` shape is **not frozen** (it will grow, e.g.
//!     `--sysbuild`); we never assume a fixed arg layout.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The build-plan schema version this CLI knows how to consume. A plan with a
/// different `schemaVersion` is rejected rather than silently mis-applied.
pub const BUILD_PLAN_SCHEMA_VERSION: u32 = 1;

/// Per-core build backend. Serialized lowercase to match the emit + `BuildOs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    /// Zephyr RTOS build (`west`).
    Zephyr,
    /// Yocto/OpenEmbedded build (`bitbake`).
    Yocto,
    /// Bare-metal build (`cmake`).
    Baremetal,
}

impl Backend {
    /// The lowercase wire string for this backend (matches the serde encoding).
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Zephyr => "zephyr",
            Backend::Yocto => "yocto",
            Backend::Baremetal => "baremetal",
        }
    }
}

/// A file the SDK's planner wants written verbatim (config or shared artefact).
/// `contents` is REQUIRED — the CLI byte-writes it; it never derives content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedFile {
    /// Destination path (relative to the build root) the consumer writes to.
    pub path: String,
    /// Verbatim file body to write; never derived by the consumer.
    pub contents: String,
}

/// One concrete tool invocation (`west` / `bitbake` / `cmake`). Its shape is
/// **not frozen** — it comes from the emit and will grow (e.g. `--sysbuild`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolStep {
    /// Executable to run (e.g. `west`, `bitbake`, `cmake`).
    pub tool: String,
    /// Arguments passed to `tool`, in order.
    pub args: Vec<String>,
    /// Working directory the invocation runs in.
    pub cwd: String,
}

impl ToolStep {
    /// `tool arg arg ...` for display.
    pub fn display(&self) -> String {
        if self.args.is_empty() {
            self.tool.clone()
        } else {
            format!("{} {}", self.tool, self.args.join(" "))
        }
    }
}

/// One build slice — a single non-`off` core. Lean by contract (ADR 0014): the
/// command already encodes the board/app, so the consumer needs only what it
/// runs + writes, not the planner's intermediate fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSlice {
    /// Identifier of the core this slice builds (e.g. `m55_hp`).
    pub core_id: String,
    /// Build backend driving this slice.
    pub backend: Backend,
    /// Output directory for this slice's build.
    pub build_dir: String,
    /// Per-slice config files to materialise before running `command`.
    #[serde(default)]
    pub config_artefacts: Vec<GeneratedFile>,
    /// `None` when the planner cannot build this core yet (paired with a
    /// `no-command` warning); the slice is reported, never dropped.
    #[serde(default)]
    pub command: Option<ToolStep>,
    /// Environment overrides applied when running `command`.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// A non-fatal note from the planner (e.g. "core X has no build command").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanWarning {
    /// Machine-readable warning code (e.g. `no-command`).
    pub code: String,
    /// Set when the warning is about a specific core (e.g. `no-command`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub core_id: Option<String>,
    /// Human-readable warning text.
    pub message: String,
}

/// The whole plan — the deserialization target for `--emit build-plan`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlan {
    /// Plan schema version; must equal `BUILD_PLAN_SCHEMA_VERSION` to be consumed.
    pub schema_version: u32,
    /// Tool/script that emitted the plan (e.g. `scripts/alp_orchestrate.py`).
    #[serde(default)]
    pub generated_by: String,
    /// Path to the source `board.yaml` the plan was derived from.
    pub board_yaml: String,
    /// Board SKU the plan targets.
    pub sku: String,
    /// Root directory for all build output.
    pub build_root: String,
    /// One slice per non-`off` core, sorted by `coreId`.
    pub slices: Vec<BuildSlice>,
    /// Cross-slice generated files (e.g. IPC headers, DTS overlays).
    #[serde(default)]
    pub shared_artefacts: Vec<GeneratedFile>,
    /// Non-fatal planner notes.
    #[serde(default)]
    pub warnings: Vec<PlanWarning>,
}

impl BuildPlan {
    /// Every generated file the consumer must materialise, in a deterministic
    /// order: shared artefacts first, then each slice's config artefacts in
    /// slice order. Pure — the CLI does the byte-writes. The SDK guarantees
    /// these `contents` match what `west alp-build` would write itself, so
    /// materialising them cannot drift from the on-disk build.
    pub fn all_artefacts(&self) -> Vec<&GeneratedFile> {
        let mut out: Vec<&GeneratedFile> = self.shared_artefacts.iter().collect();
        for slice in &self.slices {
            out.extend(slice.config_artefacts.iter());
        }
        out
    }
}

/// Why a build-plan JSON could not be consumed.
#[derive(Debug, thiserror::Error)]
pub enum BuildPlanError {
    /// The document failed JSON deserialization; holds the parse error text.
    #[error("build plan is not valid JSON: {0}")]
    Json(String),
    /// The plan's `schemaVersion` differs from the version this CLI consumes.
    #[error(
        "unsupported build-plan schemaVersion {found} (this CLI consumes v{supported}); \
         upgrade the CLI or the SDK so the versions match"
    )]
    UnsupportedSchemaVersion { found: u32, supported: u32 },
}

/// Parse + version-guard a build-plan JSON document. Pure: no IO.
pub fn parse_build_plan(json: &str) -> Result<BuildPlan, BuildPlanError> {
    let plan: BuildPlan =
        serde_json::from_str(json).map_err(|e| BuildPlanError::Json(e.to_string()))?;
    if plan.schema_version != BUILD_PLAN_SCHEMA_VERSION {
        return Err(BuildPlanError::UnsupportedSchemaVersion {
            found: plan.schema_version,
            supported: BUILD_PLAN_SCHEMA_VERSION,
        });
    }
    Ok(plan)
}

/// Human-readable, deterministic summary lines for `alp build --plan` (text
/// mode). Pure so it is unit-testable without the CLI.
pub fn summarize_plan(plan: &BuildPlan) -> Vec<String> {
    let mut lines = Vec::new();
    lines.push(format!(
        "build plan (schema v{}) — {}",
        plan.schema_version, plan.sku
    ));
    lines.push(format!("  board.yaml: {}", plan.board_yaml));
    lines.push(format!("  build root: {}", plan.build_root));
    lines.push(format!("  slices ({}):", plan.slices.len()));
    for s in &plan.slices {
        let cmd = s
            .command
            .as_ref()
            .map(ToolStep::display)
            .unwrap_or_else(|| "(no command)".to_string());
        lines.push(format!(
            "    - {} [{}] {}  -> {}",
            s.core_id,
            s.backend.as_str(),
            cmd,
            s.build_dir
        ));
    }
    let shared: Vec<&str> = plan
        .shared_artefacts
        .iter()
        .map(|f| f.path.as_str())
        .collect();
    lines.push(format!(
        "  shared artefacts ({}): {}",
        shared.len(),
        if shared.is_empty() {
            "-".to_string()
        } else {
            shared.join(", ")
        }
    ));
    if plan.warnings.is_empty() {
        lines.push("  warnings: 0".to_string());
    } else {
        lines.push(format!("  warnings ({}):", plan.warnings.len()));
        for w in &plan.warnings {
            match &w.core_id {
                Some(c) => lines.push(format!("    - [{}] {}: {}", w.code, c, w.message)),
                None => lines.push(format!("    - [{}] {}", w.code, w.message)),
            }
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mirrors the ADR 0014 emit shape: lean slices (sorted by coreId), nullable
    // command, `generatedBy`, no `sequential`/`inputHash`, warnings carry coreId.
    const SAMPLE: &str = r#"{
      "schemaVersion": 1,
      "generatedBy": "scripts/alp_orchestrate.py",
      "boardYaml": "/proj/board.yaml",
      "sku": "E1M-AEN701",
      "buildRoot": "build",
      "slices": [
        {
          "coreId": "m55_he",
          "backend": "baremetal",
          "buildDir": "build/m55_he-baremetal",
          "configArtefacts": [{ "path": "build/m55_he-baremetal/cmake-args.txt", "contents": "-DALP_CORE_ID=m55_he\n" }],
          "command": { "tool": "cmake", "args": ["-S", "he_app", "-B", "build/m55_he-baremetal"], "cwd": "build/m55_he-baremetal" },
          "env": { "ALP_SDK_ROOT": "/sdk" }
        },
        {
          "coreId": "m55_hp",
          "backend": "zephyr",
          "buildDir": "build/m55_hp-zephyr",
          "configArtefacts": [{ "path": "build/m55_hp-zephyr/alp.conf", "contents": "CONFIG_GPIO=y\n" }],
          "command": { "tool": "west", "args": ["build", "-b", "alif_e7_dk_rtss_hp", "app"], "cwd": "build/m55_hp-zephyr" },
          "env": { "ALP_SDK_ROOT": "/sdk" }
        }
      ],
      "sharedArtefacts": [
        { "path": "build/generated/alp/system_ipc.h", "contents": "/* ipc */\n" },
        { "path": "build/generated/dts-reservations.dtsi", "contents": "/* res */\n" },
        { "path": "build/generated/dts-partitions.dtsi", "contents": "/* parts */\n" }
      ],
      "warnings": []
    }"#;

    #[test]
    fn parses_a_well_formed_plan() {
        let plan = parse_build_plan(SAMPLE).expect("sample should parse");
        assert_eq!(plan.schema_version, 1);
        assert_eq!(plan.generated_by, "scripts/alp_orchestrate.py");
        assert_eq!(plan.sku, "E1M-AEN701");
        // One slice per core, sorted by coreId (m55_he before m55_hp).
        assert_eq!(
            plan.slices
                .iter()
                .map(|s| s.core_id.as_str())
                .collect::<Vec<_>>(),
            vec!["m55_he", "m55_hp"]
        );
        assert_eq!(plan.slices[0].backend, Backend::Baremetal);
        assert_eq!(plan.slices[1].backend, Backend::Zephyr);
        assert_eq!(
            plan.slices[1].env.get("ALP_SDK_ROOT").map(String::as_str),
            Some("/sdk")
        );
        assert_eq!(plan.shared_artefacts.len(), 3);
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn round_trips_through_json() {
        let plan = parse_build_plan(SAMPLE).unwrap();
        let json = serde_json::to_string(&plan).unwrap();
        let again = parse_build_plan(&json).unwrap();
        assert_eq!(plan, again);
    }

    #[test]
    fn command_display_joins_args() {
        let plan = parse_build_plan(SAMPLE).unwrap();
        let cmd = plan.slices[1]
            .command
            .as_ref()
            .expect("zephyr slice has a command");
        assert_eq!(cmd.display(), "west build -b alif_e7_dk_rtss_hp app");
    }

    #[test]
    fn carries_commandless_slice_with_warning() {
        // A core the planner can't build yet: command is null, paired with a
        // `no-command` warning that names the core. The slice is still present.
        let json = r#"{
          "schemaVersion": 1,
          "boardYaml": "/p/board.yaml",
          "sku": "E1M-X",
          "buildRoot": "build",
          "slices": [
            { "coreId": "m33_sm", "backend": "zephyr", "buildDir": "build/m33_sm-zephyr", "command": null }
          ],
          "warnings": [
            { "code": "no-command", "coreId": "m33_sm", "message": "no build command for core 'm33_sm'" }
          ]
        }"#;
        let plan = parse_build_plan(json).unwrap();
        assert_eq!(plan.slices.len(), 1);
        assert!(plan.slices[0].command.is_none());
        assert_eq!(plan.warnings[0].code, "no-command");
        assert_eq!(plan.warnings[0].core_id.as_deref(), Some("m33_sm"));
        // Defaulted optionals on the lean slice.
        assert!(plan.slices[0].config_artefacts.is_empty());
        assert!(plan.slices[0].env.is_empty());

        let summary = summarize_plan(&plan).join("\n");
        assert!(summary.contains("m33_sm [zephyr] (no command)"));
        assert!(summary.contains("[no-command] m33_sm: no build command"));
    }

    #[test]
    fn all_artefacts_collects_shared_then_per_slice() {
        let plan = parse_build_plan(SAMPLE).unwrap();
        let arts = plan.all_artefacts();
        // 3 shared + 1 config per slice (2 slices) = 5, shared first.
        assert_eq!(arts.len(), 5);
        assert_eq!(arts[0].path, "build/generated/alp/system_ipc.h");
        let paths: Vec<&str> = arts.iter().map(|a| a.path.as_str()).collect();
        assert!(paths.contains(&"build/m55_he-baremetal/cmake-args.txt"));
        assert!(paths.contains(&"build/m55_hp-zephyr/alp.conf"));
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let bumped = SAMPLE.replace("\"schemaVersion\": 1", "\"schemaVersion\": 99");
        match parse_build_plan(&bumped) {
            Err(BuildPlanError::UnsupportedSchemaVersion { found, supported }) => {
                assert_eq!(found, 99);
                assert_eq!(supported, BUILD_PLAN_SCHEMA_VERSION);
            }
            other => panic!("expected schema-version error, got {other:?}"),
        }
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(matches!(
            parse_build_plan("{not json"),
            Err(BuildPlanError::Json(_))
        ));
    }

    #[test]
    fn summary_lists_each_slice() {
        let plan = parse_build_plan(SAMPLE).unwrap();
        let joined = summarize_plan(&plan).join("\n");
        assert!(joined.contains("E1M-AEN701"));
        assert!(joined.contains("m55_he [baremetal] cmake -S he_app -B build/m55_he-baremetal"));
        assert!(joined.contains("m55_hp [zephyr] west build -b alif_e7_dk_rtss_hp app"));
        assert!(joined.contains("shared artefacts (3):"));
        assert!(joined.contains("warnings: 0"));
    }
}
