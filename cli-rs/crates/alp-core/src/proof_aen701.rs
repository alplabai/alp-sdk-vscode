// SPDX-License-Identifier: Apache-2.0
//! **PROOF BENCH** (branch `proof/pmt-aen701`). Reproduce the SDK's
//! `alp_orchestrate.py --emit build-plan` for **E1M-AEN701** from
//! **policy / metadata / template DATA alone**, parity-gated byte-for-byte
//! against the real SDK emit captured under `spike_fixtures/oracle/`.
//!
//! Thesis (issue alplabai/alp-sdk#235): per-silicon build knowledge is data, not
//! hardcoded Python. Each stage proves one more artefact derives from data:
//!   * **Stage A** — `a32_cluster` Yocto `local.conf`, byte-identical.
//!   * **Stage B** — the full `a32_cluster` build-plan `BuildSlice`.
//!   * **Stage C** — `m55_he` Zephyr `alp.conf` (Kconfig fragment), byte-identical,
//!     including `CONFIG_ALP_SOC_ALIF_ENSEMBLE_E7` **computed** from the silicon ref
//!     (no `_SILICON_TO_KCONFIG` table — the dissolution the RFC argues for).
//!
//! Layers kept explicit: METADATA (board.yaml + SoM preset + board def + SoC spec),
//! POLICY (the derivation rules — inline here; externalised to policy.json later),
//! TEMPLATE/ENGINE (resolve → render → build-plan slice).

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use crate::build_plan::{Backend, BuildSlice, GeneratedFile, ToolStep};

// ===========================================================================
// METADATA — board.yaml (the consumer's project file)
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
struct BoardYaml {
    som: BoardSom,
    #[serde(default)]
    cores: BTreeMap<String, BoardCore>,
    #[serde(default)]
    diagnostics: Option<Diagnostics>,
}

#[derive(Debug, Clone, Deserialize)]
struct BoardSom {
    sku: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct BoardCore {
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    libraries: Vec<String>,
    #[serde(default)]
    peripherals: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Diagnostics {
    #[serde(default)]
    log_level: Option<String>,
}

// ===========================================================================
// METADATA — the SoM preset (topology + on-module facts + inference)
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
struct SomPreset {
    silicon: String,
    #[serde(default)]
    topology: BTreeMap<String, TopoCore>,
    #[serde(default)]
    on_module: BTreeMap<String, serde_yaml::Value>,
    #[serde(default)]
    helper_firmware: Vec<HelperFw>,
    #[serde(default)]
    inference: Inference,
}

#[derive(Debug, Clone, Deserialize)]
struct TopoCore {
    #[serde(default)]
    machine: Option<String>,
    #[serde(default)]
    board: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct HelperFw {
    #[serde(default)]
    chip: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct Inference {
    #[serde(default)]
    npu_population: Vec<NpuEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct NpuEntry {
    #[serde(default)]
    variant: Option<String>,
}

// ===========================================================================
// METADATA — the resolved board definition + the SoC spec
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
struct BoardDef {
    name: String,
    #[serde(default)]
    populated: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct SocSpec {
    #[serde(default)]
    cores: Vec<SocCore>,
}

#[derive(Debug, Clone, Deserialize)]
struct SocCore {
    id: String,
    #[serde(default)]
    vector_extension: Option<String>,
}

// ===========================================================================
// POLICY — the per-silicon rules (inline now; externalised to policy.json later)
// ===========================================================================

/// on_module scalar fields that are NOT chip slugs (alp_orchestrate.py:2582).
const ON_MODULE_NON_CHIP: &[&str] = &[
    "silicon",
    "ethernet_phy_count",
    "i2c_devices",
    "ospi_memories",
    "nor_flash",
    "emmc",
];

/// Slugs that are SDK *blocks* (CONFIG_ALP_SDK_BLOCK_*) not chip drivers
/// (alp_orchestrate.py:2868).
const BLOCK_SLUGS: &[&str] = &["button_led", "pdm_mic"];

/// A Yocto library name → its bitbake recipe (alp_orchestrate.py:3294).
fn lib_to_recipe(lib: &str) -> String {
    format!("lib-{}", lib.replace('_', "-"))
}

/// MACHINE: topology value, else `e1m-<sku sans e1m->` (alp_orchestrate.py:3285).
fn yocto_machine(topo_machine: Option<&str>, sku: &str) -> String {
    match topo_machine {
        Some(m) => m.to_string(),
        None => format!("e1m-{}", sku.to_lowercase().replace("e1m-", "")),
    }
}

/// **The `_SILICON_TO_KCONFIG` dissolution.** The SoC Kconfig symbol is *computed*
/// from the silicon ref — no lookup table. `alif:ensemble:e7` → `ALP_SOC_ALIF_ENSEMBLE_E7`.
/// The membership allowlist is "the SoC spec exists" (checked by the caller), exactly
/// as the maintainer noted; this replaces the hand-synced 8-entry Python dict.
fn silicon_soc_symbol(silicon: &str) -> String {
    format!("ALP_SOC_{}", silicon.to_uppercase().replace(':', "_"))
}

/// Board name → the `ALP_BOARD_*` compile-define suffix (alp_orchestrate.py:536).
fn board_define_slug(name: &str) -> String {
    name.to_lowercase().replace('-', "_").to_uppercase()
}

/// A chip/block slug → its Kconfig symbol (alp_orchestrate.py:2870).
fn slug_kconfig(slug: &str) -> String {
    let kind = if BLOCK_SLUGS.contains(&slug) { "BLOCK" } else { "CHIP" };
    format!("CONFIG_ALP_SDK_{kind}_{}", slug.to_uppercase())
}

/// `diagnostics.log_level` → `CONFIG_LOG_DEFAULT_LEVEL` (alp_orchestrate.py:2817).
fn log_level_n(level: &str) -> Option<u8> {
    match level {
        "error" => Some(1),
        "warn" => Some(2),
        "info" => Some(3),
        "debug" | "trace" => Some(4),
        _ => None,
    }
}

/// A chip slug → the Zephyr subsystems it needs (alp_project.py:601). Only the
/// slugs reachable on this board are encoded; an unknown slug needs none.
fn chip_subsystems(slug: &str) -> &'static [&'static str] {
    match slug {
        "cc3501e" | "ssd1331" => &["SPI", "GPIO"],
        "tas2563" => &["I2C", "GPIO"],
        "button_led" | "cam_mux_pi3wvr626" => &["GPIO"],
        "lsm6dso" | "ssd1306" | "bme280" | "lis2dw12" | "ov5640" | "icm42670"
        | "bmi323" | "bmp581" | "tmp112" | "rv3028c7" | "optiga_trust_m"
        | "eeprom_24c128" | "tcal9538" | "ina236" => &["I2C"],
        _ => &[],
    }
}

// ===========================================================================
// ENGINE — Yocto slice (Stage A/B)
// ===========================================================================

struct YoctoSlice {
    core_id: String,
    image: String,
    machine: String,
    libraries: Vec<String>,
}

fn resolve_yocto_slice(board: &BoardYaml, som: &SomPreset, core_id: &str) -> Option<YoctoSlice> {
    let topo = som.topology.get(core_id)?;
    if topo.machine.is_none() || topo.board.is_some() {
        return None; // backend selection (POLICY): `machine` ⇒ Yocto
    }
    let core = board.cores.get(core_id)?;
    Some(YoctoSlice {
        core_id: core_id.to_string(),
        image: core.image.clone()?,
        machine: yocto_machine(topo.machine.as_deref(), &board.som.sku),
        libraries: core.libraries.clone(),
    })
}

fn render_yocto_local_conf(s: &YoctoSlice) -> String {
    let mut lines = vec![
        "# Auto-generated by scripts/alp_orchestrate.py -- append to local.conf.".to_string(),
        format!("# Per-core slice `{}` (image: {})", s.core_id, s.image),
        format!("MACHINE = \"{}\"", s.machine),
    ];
    if !s.libraries.is_empty() {
        let recipes: Vec<String> = s.libraries.iter().map(|l| lib_to_recipe(l)).collect();
        lines.push(format!("IMAGE_INSTALL:append = \" {}\"", recipes.join(" ")));
    }
    lines.push(format!("# bitbake target: {}", s.image));
    format!("{}\n", lines.join("\n"))
}

fn build_yocto_slice(
    board: &BoardYaml,
    som: &SomPreset,
    core_id: &str,
    build_root: &str,
    sdk_root: &str,
) -> Option<BuildSlice> {
    let slice = resolve_yocto_slice(board, som, core_id)?;
    let build_dir = format!("{build_root}/{core_id}-yocto");
    Some(BuildSlice {
        core_id: core_id.to_string(),
        backend: Backend::Yocto,
        build_dir: build_dir.clone(),
        config_artefacts: vec![GeneratedFile {
            path: format!("{build_dir}/local.conf"),
            contents: render_yocto_local_conf(&slice),
        }],
        command: Some(ToolStep {
            tool: "bitbake".to_string(),
            args: vec![slice.image.clone()],
            cwd: build_dir,
        }),
        env: BTreeMap::from([("ALP_SDK_ROOT".to_string(), sdk_root.to_string())]),
    })
}

// ===========================================================================
// ENGINE — Zephyr Kconfig fragment (Stage C)
// ===========================================================================

/// The SoM-intrinsic chip set: scalar `on_module` fields (minus non-chip keys) +
/// `helper_firmware[].chip`. Deduped + sorted (BTreeSet).
fn som_chip_set(som: &SomPreset) -> BTreeSet<String> {
    let mut chips = BTreeSet::new();
    for (key, val) in &som.on_module {
        if ON_MODULE_NON_CHIP.contains(&key.as_str()) {
            continue;
        }
        if let Some(s) = val.as_str() {
            chips.insert(s.to_string());
        }
    }
    for hf in &som.helper_firmware {
        if let Some(chip) = &hf.chip {
            chips.insert(chip.clone());
        }
    }
    chips
}

/// The TFLM kernel symbol for a core (alp_orchestrate.py:3036): Helium ⇒ HELIUM,
/// Neon/Cortex-A ⇒ NEON, else REF.
fn tflm_kernel(soc: &SocSpec, core_id: &str) -> &'static str {
    for c in &soc.cores {
        if c.id == core_id {
            return match c.vector_extension.as_deref().map(str::to_lowercase).as_deref() {
                Some("neon") => "NEON",
                Some("helium") => "HELIUM",
                _ => "REF",
            };
        }
    }
    "REF"
}

/// Render the per-core Zephyr Kconfig fragment (`alp.conf`), byte-for-byte as the
/// SDK emits it — derived entirely from the four metadata inputs.
fn render_zephyr_alp_conf(
    core_id: &str,
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
) -> String {
    let sku = &board.som.sku;
    let mut lines: Vec<String> = Vec::new();

    // 1. Header
    lines.push("# Auto-generated by scripts/alp_orchestrate.py -- do not edit.".to_string());
    lines.push(format!("# Per-core Kconfig fragment for slice `{core_id}` (zephyr)."));
    lines.push(String::new());

    // 2. Base defaults
    lines.push("CONFIG_ALP_SDK=y".to_string());
    lines.push("CONFIG_LOG=y".to_string());
    lines.push("CONFIG_PRINTK=y".to_string());
    lines.push("CONFIG_THREAD_LOCAL_STORAGE=y".to_string());
    if let Some(n) = board
        .diagnostics
        .as_ref()
        .and_then(|d| d.log_level.as_deref())
        .and_then(log_level_n)
    {
        lines.push(format!("CONFIG_LOG_DEFAULT_LEVEL={n}"));
    }
    lines.push(String::new());

    // 3. SoM silicon — CONFIG symbol COMPUTED from the silicon ref (no table)
    lines.push(format!("# SoM silicon ({} via {sku})", som.silicon));
    lines.push(format!("CONFIG_{}=y", silicon_soc_symbol(&som.silicon)));
    lines.push(String::new());

    // 4. Cross-EVK board facade selector
    lines.push(
        "# Cross-EVK board facade selector (<alp/board.h>); CONFIG_COMPILER_OPT is single-value (do not also set in prj.conf)."
            .to_string(),
    );
    lines.push(format!(
        "CONFIG_COMPILER_OPT=\"-DALP_BOARD_{}\"",
        board_define_slug(&board_def.name)
    ));
    lines.push(String::new());

    // collect Zephyr subsystems as we walk the enabled chips
    let mut subsystems: BTreeSet<&'static str> = BTreeSet::new();

    // 5. SoM-intrinsic chip drivers
    let som_chips = som_chip_set(som);
    lines.push(format!(
        "# SoM-intrinsic chip drivers (from `{sku}` on_module + helper_firmware)"
    ));
    for chip in &som_chips {
        lines.push(format!("{}=y", slug_kconfig(chip)));
        subsystems.extend(chip_subsystems(chip));
    }
    lines.push(String::new());

    // 6. Board-populated chip drivers (skip ones already emitted as SoM =y)
    lines.push("# Board-populated chip drivers (from the resolved board definition)".to_string());
    for (chip, on) in &board_def.populated {
        if *on && som_chips.contains(chip) {
            continue;
        }
        lines.push(format!("{}={}", slug_kconfig(chip), if *on { "y" } else { "n" }));
        if *on {
            subsystems.extend(chip_subsystems(chip));
        }
    }
    lines.push(String::new());

    // 7. Zephyr subsystems (chip drivers + the core's declared peripherals)
    if let Some(core) = board.cores.get(core_id) {
        for p in &core.peripherals {
            // minimal peripheral→subsystem map (only what this board needs)
            match p.as_str() {
                "i2c" => subsystems.insert("I2C"),
                "spi" => subsystems.insert("SPI"),
                "gpio" => subsystems.insert("GPIO"),
                _ => false,
            };
        }
    }
    if !subsystems.is_empty() {
        lines.push(format!(
            "# Zephyr subsystems required on core `{core_id}` (chip drivers + peripherals)"
        ));
        for s in &subsystems {
            lines.push(format!("CONFIG_{s}=y"));
        }
        lines.push(String::new());
    }

    // 7.5 Inference dispatchers (from SoM capabilities)
    let mut inf = vec!["CONFIG_ALP_SDK_INFERENCE_BACKEND_TFLM=y".to_string()];
    inf.push(format!(
        "CONFIG_ALP_SDK_INFERENCE_TFLM_KERNEL_{}=y",
        tflm_kernel(soc, core_id)
    ));
    let variants: BTreeSet<String> = som
        .inference
        .npu_population
        .iter()
        .filter_map(|e| e.variant.as_ref().map(|v| v.to_lowercase()))
        .collect();
    if !variants.is_empty() {
        let backend = if som.silicon == "nxp:imx9:imx93" { "N93" } else { "AEN" };
        inf.push(format!("CONFIG_ALP_SDK_INFERENCE_BACKEND_ETHOS_U_{backend}=y"));
        for v in &variants {
            inf.push(format!(
                "CONFIG_ALP_SDK_INFERENCE_ETHOS_U_VARIANT_{}=y",
                v.to_uppercase()
            ));
        }
    }
    lines.push("# Inference dispatchers (from SoM capabilities -- customer does not pick)".to_string());
    lines.extend(inf);
    lines.push(String::new());

    format!("{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOARD_YAML: &str = include_str!("spike_fixtures/oracle/rpmsg-aen.board.yaml");
    const SOM_PRESET: &str = include_str!("spike_fixtures/E1M-AEN701.yaml");
    const BOARD_DEF: &str = include_str!("spike_fixtures/e1m-evk.yaml");
    const SOC_SPEC: &str = include_str!("spike_fixtures/e7.json");
    const ORACLE_BUILD_PLAN: &str = include_str!("spike_fixtures/oracle/rpmsg-aen.build-plan");

    fn load() -> (BoardYaml, SomPreset, BoardDef, SocSpec) {
        (
            serde_yaml::from_str(BOARD_YAML).unwrap(),
            serde_yaml::from_str(SOM_PRESET).unwrap(),
            serde_yaml::from_str(BOARD_DEF).unwrap(),
            serde_json::from_str(SOC_SPEC).unwrap(),
        )
    }

    fn oracle_artefact(core_id: &str) -> String {
        let plan: serde_json::Value = serde_json::from_str(ORACLE_BUILD_PLAN).unwrap();
        plan["slices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["coreId"] == core_id)
            .unwrap_or_else(|| panic!("oracle has no slice {core_id}"))["configArtefacts"][0]
            ["contents"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn metadata_deserialises() {
        let (board, som, board_def, soc) = load();
        assert_eq!(board.som.sku, "E1M-AEN701");
        assert_eq!(som.silicon, "alif:ensemble:e7");
        assert_eq!(board_def.name, "E1M-EVK");
        assert!(soc.cores.iter().any(|c| c.id == "m55_he"));
    }

    /// STAGE A — a32_cluster local.conf byte-for-byte from data.
    #[test]
    fn a32_cluster_local_conf_matches_sdk_emit_byte_for_byte() {
        let (board, som, ..) = load();
        let slice = resolve_yocto_slice(&board, &som, "a32_cluster").unwrap();
        assert_eq!(render_yocto_local_conf(&slice), oracle_artefact("a32_cluster"));
    }

    /// STAGE B — the full a32_cluster build-plan slice equals the SDK emit
    /// (env.ALP_SDK_ROOT is a runtime path, threaded in from the oracle).
    #[test]
    fn a32_cluster_full_slice_matches_sdk_emit() {
        let (board, som, ..) = load();
        let plan: serde_json::Value = serde_json::from_str(ORACLE_BUILD_PLAN).unwrap();
        let oracle_slice = plan["slices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["coreId"] == "a32_cluster")
            .unwrap();
        let sdk_root = oracle_slice["env"]["ALP_SDK_ROOT"].as_str().unwrap();
        let ours = build_yocto_slice(&board, &som, "a32_cluster", "build", sdk_root).unwrap();
        assert_eq!(&serde_json::to_value(&ours).unwrap(), oracle_slice);
    }

    /// STAGE C — the m55_he Zephyr alp.conf, byte-for-byte from data. Includes the
    /// `_SILICON_TO_KCONFIG` dissolution (CONFIG_ALP_SOC_ALIF_ENSEMBLE_E7 computed),
    /// SoM/board chip drivers, subsystems, and SoM-capability inference dispatchers.
    #[test]
    fn m55_he_alp_conf_matches_sdk_emit_byte_for_byte() {
        let (board, som, board_def, soc) = load();
        let ours = render_zephyr_alp_conf("m55_he", &board, &som, &board_def, &soc);
        assert_eq!(
            ours,
            oracle_artefact("m55_he"),
            "the m55_he Kconfig fragment must equal the SDK emit byte-for-byte"
        );
    }

    /// The `_SILICON_TO_KCONFIG` dissolution, isolated: computed, not table-driven.
    #[test]
    fn silicon_symbol_is_computed_not_table() {
        assert_eq!(silicon_soc_symbol("alif:ensemble:e7"), "ALP_SOC_ALIF_ENSEMBLE_E7");
        assert_eq!(silicon_soc_symbol("nxp:imx9:imx93"), "ALP_SOC_NXP_IMX9_IMX93");
    }

    #[test]
    fn library_recipe_transform() {
        assert_eq!(lib_to_recipe("mbedtls"), "lib-mbedtls");
        assert_eq!(lib_to_recipe("nlohmann_json"), "lib-nlohmann-json");
    }
}
