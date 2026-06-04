// SPDX-License-Identifier: Apache-2.0
//! Build-plan contract (Wave C) — the **consumed** shape of the SDK's
//! `alp_orchestrate.py --emit build-plan` JSON.
//!
//! The CLI *consumes* this plan; it does **not** compute it. The planner — the
//! fast-moving, vendor-heavy part (partition allocation, sysbuild, TF-M) — stays
//! the SDK's single source of truth (see `docs/BUILD_ORCHESTRATION.md` and
//! `docs/PROPOSAL-alp-build-core.md`). This module is pure: it only models +
//! parses the plan JSON. Materialise / execute / schedule live in the CLI
//! (`alp-cli`).
//!
//! The emit carries the generated-file **contents** (`GeneratedFile`) so the
//! CLI's materialise step is pure IO — no content derivation leaks back here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The build-plan schema version this CLI knows how to consume. A plan with a
/// different `schemaVersion` is rejected rather than silently mis-applied.
pub const BUILD_PLAN_SCHEMA_VERSION: u32 = 1;

/// Per-core build backend. Serialized lowercase to match the emit + `BuildOs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Zephyr,
    Yocto,
    Baremetal,
}

impl Backend {
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
    pub path: String,
    pub contents: String,
}

/// One concrete tool invocation (`west` / `bitbake` / `cmake`). Its shape is
/// **not frozen** — it comes from the emit and will grow (e.g. `--sysbuild`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolStep {
    pub tool: String,
    pub args: Vec<String>,
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

/// One build slice — a single non-`off` core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSlice {
    pub core_id: String,
    pub backend: Backend,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolchain: Option<String>,
    #[serde(default)]
    pub peripherals: Vec<String>,
    #[serde(default)]
    pub libraries: Vec<String>,
    pub build_dir: String,
    #[serde(default)]
    pub config_artefacts: Vec<GeneratedFile>,
    pub command: ToolStep,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub input_hash: String,
}

/// A non-fatal note from the planner (e.g. "core X is off", "toolchain TBD").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanWarning {
    pub code: String,
    pub message: String,
}

/// The whole plan — the deserialization target for `--emit build-plan`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlan {
    pub schema_version: u32,
    pub board_yaml: String,
    pub sku: String,
    pub build_root: String,
    pub slices: Vec<BuildSlice>,
    #[serde(default)]
    pub shared_artefacts: Vec<GeneratedFile>,
    #[serde(default)]
    pub sequential: bool,
    #[serde(default)]
    pub warnings: Vec<PlanWarning>,
}

/// Why a build-plan JSON could not be consumed.
#[derive(Debug, thiserror::Error)]
pub enum BuildPlanError {
    #[error("build plan is not valid JSON: {0}")]
    Json(String),
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
    let order = if plan.sequential {
        "sequential"
    } else {
        "parallel"
    };
    lines.push(format!(
        "build plan (schema v{}) — {}",
        plan.schema_version, plan.sku
    ));
    lines.push(format!("  board.yaml: {}", plan.board_yaml));
    lines.push(format!("  build root: {} ({order})", plan.build_root));
    lines.push(format!("  slices ({}):", plan.slices.len()));
    for s in &plan.slices {
        lines.push(format!(
            "    - {} [{}] {}  -> {}",
            s.core_id,
            s.backend.as_str(),
            s.command.display(),
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
            lines.push(format!("    - [{}] {}", w.code, w.message));
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "schemaVersion": 1,
      "boardYaml": "/proj/board.yaml",
      "sku": "E1M-AEN701",
      "buildRoot": "build",
      "slices": [
        {
          "coreId": "m55_hp",
          "backend": "zephyr",
          "app": "app",
          "board": "alif_e7_dk_rtss_hp",
          "toolchain": "zephyr-sdk",
          "peripherals": ["uart", "gpio"],
          "buildDir": "build/m55_hp-zephyr",
          "configArtefacts": [{ "path": "build/m55_hp-zephyr/alp.conf", "contents": "CONFIG_GPIO=y\n" }],
          "command": { "tool": "west", "args": ["build", "-b", "alif_e7_dk_rtss_hp", "app"], "cwd": "build/m55_hp-zephyr" },
          "env": { "ALP_SDK_ROOT": "/sdk" },
          "inputHash": "abc123"
        },
        {
          "coreId": "m55_he",
          "backend": "baremetal",
          "app": "he_app",
          "buildDir": "build/m55_he-baremetal",
          "command": { "tool": "cmake", "args": ["-S", "he_app", "-B", "build/m55_he-baremetal"], "cwd": "build/m55_he-baremetal" }
        }
      ],
      "sharedArtefacts": [
        { "path": "build/generated/alp/system_ipc.h", "contents": "/* ipc */\n" },
        { "path": "build/generated/dts-partitions.dtsi", "contents": "/* parts */\n" }
      ],
      "sequential": false,
      "warnings": []
    }"#;

    #[test]
    fn parses_a_well_formed_plan() {
        let plan = parse_build_plan(SAMPLE).expect("sample should parse");
        assert_eq!(plan.schema_version, 1);
        assert_eq!(plan.sku, "E1M-AEN701");
        assert_eq!(plan.slices.len(), 2);
        assert_eq!(plan.slices[0].backend, Backend::Zephyr);
        assert_eq!(plan.slices[0].board.as_deref(), Some("alif_e7_dk_rtss_hp"));
        assert_eq!(
            plan.slices[0].env.get("ALP_SDK_ROOT").map(String::as_str),
            Some("/sdk")
        );
        assert_eq!(plan.slices[1].backend, Backend::Baremetal);
        // Defaulted optionals on the lean second slice.
        assert!(plan.slices[1].peripherals.is_empty());
        assert_eq!(plan.slices[1].input_hash, "");
        assert_eq!(plan.shared_artefacts.len(), 2);
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
        assert_eq!(
            plan.slices[0].command.display(),
            "west build -b alif_e7_dk_rtss_hp app"
        );
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
        let lines = summarize_plan(&plan);
        let joined = lines.join("\n");
        assert!(joined.contains("E1M-AEN701"));
        assert!(joined.contains("m55_hp [zephyr] west build -b alif_e7_dk_rtss_hp app"));
        assert!(joined.contains("m55_he [baremetal] cmake -S he_app -B build/m55_he-baremetal"));
        assert!(joined.contains("shared artefacts (2):"));
        assert!(joined.contains("warnings: 0"));
    }
}
