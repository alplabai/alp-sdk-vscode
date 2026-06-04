// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE — not for dev.** Closes §8.5's three "still design" gaps with
//! real code + tests:
//!   1. **Real metadata deserialize** — the *actual* `E1M-AEN701.yaml` +
//!      `socs/alif/ensemble/e7.json` from SDK `dev` (vendored as fixtures) parse
//!      straight into Rust structs (incl. the `capacity_mbit: TBD` case).
//!   2. **Template / render** — a tiny `{{#each}}` template engine renders a DTS
//!      partitions overlay + a Kconfig fragment from data.
//!   3. **Engine → BuildPlan assemble** — the real SoM `topology` is assembled
//!      into a real `crate::build_plan::BuildPlan` that the **shipped consumer**
//!      (`parse_build_plan` / `summarize_plan`) accepts (round-trip).

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::build_plan::{Backend, BuildPlan, BuildSlice, GeneratedFile, ToolStep};

// ===========================================================================
// 1. Real metadata deserialize (vendored verbatim from SDK dev)
// ===========================================================================

/// `TBD` (string) or a real number — the SDK marks un-HW-mapped values `TBD`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MaybeTbd {
    Num(f64),
    Str(String),
}
impl MaybeTbd {
    pub fn is_tbd(&self) -> bool {
        matches!(self, MaybeTbd::Str(s) if s.eq_ignore_ascii_case("TBD"))
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OspiMemory {
    pub capacity_mbit: MaybeTbd,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct OnModule {
    #[serde(default)]
    pub ospi_memories: BTreeMap<String, OspiMemory>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TopologyCore {
    pub app: String,
    #[serde(default)]
    pub board: Option<String>, // Zephyr board target
    #[serde(default)]
    pub machine: Option<String>, // Yocto MACHINE
    pub toolchain: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Channel {
    pub id: u64,
    #[serde(default)]
    pub reserved_for: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Mailbox {
    #[serde(default)]
    pub controller: Option<String>,
    #[serde(default)]
    pub channels: Vec<Channel>,
}

/// A partial view of the real SoM preset — serde ignores the many fields we
/// don't model (pad_routes, helper_firmware, ...), proving the real file parses.
#[derive(Debug, Clone, Deserialize)]
pub struct SomPreset {
    pub sku: String,
    pub family: String,
    pub silicon: String,
    pub silicon_variant: String,
    #[serde(default)]
    pub on_module: OnModule,
    #[serde(default)]
    pub topology: BTreeMap<String, TopologyCore>,
    #[serde(default)]
    pub mailbox: Mailbox,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SocCore {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SocVariant {
    pub mram_mb: f64,
    #[serde(default)]
    pub sram_banks_kb: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SocSpec {
    pub cores: Vec<SocCore>,
    pub variants: Vec<SocVariant>,
}

pub fn parse_som(yaml: &str) -> Result<SomPreset, String> {
    serde_yaml::from_str(yaml).map_err(|e| e.to_string())
}
pub fn parse_soc(json: &str) -> Result<SocSpec, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

// ===========================================================================
// 2. Template / render — a tiny `{{#each}}` + `{{var}}` engine
// ===========================================================================

fn subst(s: &str, vars: &BTreeMap<&str, String>) -> String {
    let mut out = s.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

/// Render a template carrying exactly one `{{#each}}…{{/each}}` block: the inner
/// block is emitted once per row (`{{field}}` substituted from the row).
pub fn render_each(template: &str, rows: &[BTreeMap<&str, String>]) -> String {
    const OPEN: &str = "{{#each}}";
    const CLOSE: &str = "{{/each}}";
    match (template.find(OPEN), template.find(CLOSE)) {
        (Some(s), Some(e)) if s < e => {
            let head = &template[..s];
            let inner = &template[s + OPEN.len()..e];
            let tail = &template[e + CLOSE.len()..];
            let body: String = rows.iter().map(|r| subst(inner, r)).collect();
            format!("{head}{body}{tail}")
        }
        _ => template.to_string(),
    }
}

// ===========================================================================
// 3. Engine → BuildPlan assemble (produces the shipped consumer's type)
// ===========================================================================

/// Assemble the real SoM `topology` into a `BuildPlan` — the SAME type the
/// shipped consumer parses. Backend is derived from the topology entry (board →
/// Zephyr, machine → Yocto, else Baremetal); the command + build dir follow.
pub fn assemble_build_plan(som: &SomPreset, board_yaml: &str) -> BuildPlan {
    let build_root = "build";
    let mut slices = Vec::new();

    for (core_id, tc) in &som.topology {
        let (backend, os_tag, command) = if let Some(board) = &tc.board {
            (
                Backend::Zephyr,
                "zephyr",
                Some(ToolStep {
                    tool: "west".into(),
                    args: vec!["build".into(), "-b".into(), board.clone(), tc.app.clone()],
                    cwd: format!("{build_root}/{core_id}-zephyr"),
                }),
            )
        } else if tc.machine.is_some() {
            (
                Backend::Yocto,
                "yocto",
                Some(ToolStep {
                    tool: "bitbake".into(),
                    args: vec![tc.app.clone()],
                    cwd: format!("{build_root}/{core_id}-yocto"),
                }),
            )
        } else {
            (Backend::Baremetal, "baremetal", None)
        };

        let build_dir = format!("{build_root}/{core_id}-{os_tag}");
        // A rendered per-slice config artefact (template + data).
        let conf = render_each(
            "# generated for {{core}}\n{{#each}}{{symbol}}={{value}}\n{{/each}}",
            &[BTreeMap::from([
                ("symbol", "CONFIG_ALP_SDK".to_string()),
                ("value", "y".to_string()),
            ])],
        )
        .replace("{{core}}", core_id);

        let mut env = BTreeMap::new();
        env.insert("ALP_SDK_ROOT".to_string(), "/sdk".to_string());

        slices.push(BuildSlice {
            core_id: core_id.clone(),
            backend,
            build_dir: build_dir.clone(),
            config_artefacts: vec![GeneratedFile {
                path: format!("{build_dir}/alp.conf"),
                contents: conf,
            }],
            command,
            env,
        });
    }

    BuildPlan {
        schema_version: crate::build_plan::BUILD_PLAN_SCHEMA_VERSION,
        generated_by: "engine_e2e_spike".to_string(),
        board_yaml: board_yaml.to_string(),
        sku: som.sku.clone(),
        build_root: build_root.to_string(),
        slices,
        shared_artefacts: vec![GeneratedFile {
            path: "build/generated/dts-partitions.dtsi".to_string(),
            contents: render_each(
                "/ { partitions {\n{{#each}}  {{name}}: partition@{{off}} {{ reg = <{{off}} {{size}}>; }};\n{{/each}}}; };\n",
                &[BTreeMap::from([
                    ("name", "storage".to_string()),
                    ("off", "0x0".to_string()),
                    ("size", "0x20000".to_string()),
                ])],
            ),
        }],
        warnings: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build_plan::{parse_build_plan, summarize_plan};

    const SOM_YAML: &str = include_str!("spike_fixtures/E1M-AEN701.yaml");
    const SOC_JSON: &str = include_str!("spike_fixtures/e7.json");

    // ---- 1. real metadata deserialize ----

    #[test]
    fn real_som_yaml_deserializes() {
        let som = parse_som(SOM_YAML).expect("real E1M-AEN701.yaml must parse");
        assert_eq!(som.sku, "E1M-AEN701");
        assert_eq!(som.family, "alif-ensemble");
        assert_eq!(som.silicon, "alif:ensemble:e7");
        // topology carries the three real cores with their backends.
        assert_eq!(som.topology.len(), 3);
        assert_eq!(
            som.topology["m55_hp"].board.as_deref(),
            Some("alp_e1m_aen701_m55_hp")
        );
        assert_eq!(
            som.topology["a32_cluster"].machine.as_deref(),
            Some("e1m-aen701-a32")
        );
        assert!(som.topology["a32_cluster"].board.is_none());
        // mailbox controller is the real TBD; the alp_default_rpmsg channel exists.
        assert_eq!(som.mailbox.controller.as_deref(), Some("TBD"));
        assert!(
            som.mailbox
                .channels
                .iter()
                .any(|c| c.reserved_for.as_deref() == Some("alp_default_rpmsg"))
        );
        // ospi capacity is the real TBD → engine would block its flash device.
        assert!(som.on_module.ospi_memories["ospi0"].capacity_mbit.is_tbd());
    }

    #[test]
    fn real_soc_json_deserializes() {
        let soc = parse_soc(SOC_JSON).expect("real e7.json must parse");
        assert_eq!(
            soc.cores.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["a32_cluster", "m55_hp", "m55_he"]
        );
        let v0 = &soc.variants[0];
        assert_eq!(v0.mram_mb, 5.5);
        // the TCM-suffixed bank the memory-map derivation keys off is present.
        assert!(v0.sram_banks_kb.contains_key("SRAM2_M55_HP_ITCM"));
    }

    // ---- 2. template / render ----

    #[test]
    fn template_each_renders_rows() {
        let rows = vec![
            BTreeMap::from([("name", "a".to_string()), ("off", "0".to_string())]),
            BTreeMap::from([("name", "b".to_string()), ("off", "128".to_string())]),
        ];
        let out = render_each("P:\n{{#each}}  {{name}}@{{off}}\n{{/each}}END\n", &rows);
        assert_eq!(out, "P:\n  a@0\n  b@128\nEND\n");
    }

    // ---- 3. engine → BuildPlan assemble, accepted by the shipped consumer ----

    #[test]
    fn assemble_from_real_topology_round_trips_through_consumer() {
        let som = parse_som(SOM_YAML).unwrap();
        let plan = assemble_build_plan(&som, "/proj/board.yaml");

        assert_eq!(plan.sku, "E1M-AEN701");
        assert_eq!(plan.slices.len(), 3);
        // a32_cluster → Yocto (bitbake), m55_* → Zephyr (west build).
        let by: BTreeMap<_, _> = plan.slices.iter().map(|s| (s.core_id.clone(), s)).collect();
        assert_eq!(by["a32_cluster"].backend, Backend::Yocto);
        assert_eq!(by["m55_hp"].backend, Backend::Zephyr);
        let west = by["m55_hp"].command.as_ref().unwrap();
        assert_eq!(west.tool, "west");
        assert!(west.args.contains(&"alp_e1m_aen701_m55_hp".to_string()));

        // THE KEY ASSERTION: the engine's output is a valid input to the SHIPPED
        // consumer (parse_build_plan is the C0 entry point).
        let json = serde_json::to_string(&plan).unwrap();
        let reparsed =
            parse_build_plan(&json).expect("engine output must be a valid consumer BuildPlan");
        assert_eq!(reparsed, plan);

        let summary = summarize_plan(&plan).join("\n");
        assert!(summary.contains("E1M-AEN701"));
        assert!(summary.contains("a32_cluster [yocto]"));
        assert!(summary.contains("m55_hp [zephyr]"));
    }
}
