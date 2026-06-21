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
#![allow(dead_code)] // proof bench: the engine's only caller is its #[cfg(test)] parity suite

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use crate::build_plan::{Backend, BuildPlan, BuildSlice, GeneratedFile, ToolStep};

// ===========================================================================
// METADATA — board.yaml (the consumer's project file)
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
struct BoardYaml {
    som: BoardSom,
    #[serde(default)]
    hw_rev: Option<String>, // top-level board hw_rev (overrides the board def default)
    #[serde(default)]
    cores: BTreeMap<String, BoardCore>,
    #[serde(default)]
    diagnostics: Option<Diagnostics>,
    #[serde(default)]
    ipc: Vec<IpcChannel>,
    #[serde(default)]
    storage: Vec<serde_yaml::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct IpcChannel {
    kind: String,
    name: String,
    #[serde(default)]
    endpoints: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct BoardSom {
    sku: String,
    #[serde(default)]
    hw_rev: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct BoardCore {
    #[serde(default)]
    app: Option<String>,
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
    #[serde(default)]
    mailbox: Mailbox,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct Mailbox {
    #[serde(default)]
    controller: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct TopoCore {
    #[serde(default)]
    app: Option<String>,
    #[serde(default)]
    machine: Option<String>,
    #[serde(default)]
    board: Option<String>,
    #[serde(default)]
    toolchain: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct HelperFw {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    chip: Option<String>,
    #[serde(default)]
    firmware_path: Option<String>,
    #[serde(default)]
    flash_method: Option<String>,
    #[serde(default)]
    flash_args: Option<String>,
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
    default_hw_rev: Option<String>,
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
    let kind = if BLOCK_SLUGS.contains(&slug) {
        "BLOCK"
    } else {
        "CHIP"
    };
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
        "lsm6dso" | "ssd1306" | "bme280" | "lis2dw12" | "ov5640" | "icm42670" | "bmi323"
        | "bmp581" | "tmp112" | "rv3028c7" | "optiga_trust_m" | "eeprom_24c128" | "tcal9538"
        | "ina236" => &["I2C"],
        _ => &[],
    }
}

/// A library name → its Kconfig symbols, in declaration order (alp_project.py:711).
/// An unknown library yields no symbols (the caller emits a TODO instead).
fn library_kconfig(lib: &str) -> &'static [&'static str] {
    match lib {
        "cmsis_dsp" => &[
            "CONFIG_CMSIS_DSP=y",
            "CONFIG_CMSIS_DSP_BASICMATH=y",
            "CONFIG_CMSIS_DSP_COMPLEXMATH=y",
            "CONFIG_CMSIS_DSP_CONTROLLER=y",
            "CONFIG_CMSIS_DSP_FASTMATH=y",
            "CONFIG_CMSIS_DSP_FILTERING=y",
            "CONFIG_CMSIS_DSP_INTERPOLATION=y",
            "CONFIG_CMSIS_DSP_MATRIX=y",
            "CONFIG_CMSIS_DSP_STATISTICS=y",
            "CONFIG_CMSIS_DSP_SUPPORT=y",
            "CONFIG_CMSIS_DSP_TRANSFORM=y",
            "CONFIG_ALP_CMSIS_DSP_SCALAR=y",
        ],
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
            return match c
                .vector_extension
                .as_deref()
                .map(str::to_lowercase)
                .as_deref()
            {
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
    lines.push(format!(
        "# Per-core Kconfig fragment for slice `{core_id}` (zephyr)."
    ));
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
        lines.push(format!(
            "{}={}",
            slug_kconfig(chip),
            if *on { "y" } else { "n" }
        ));
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

    // 8. Libraries declared on the core (board.yaml `libraries:`), sorted
    if let Some(core) = board.cores.get(core_id) {
        if !core.libraries.is_empty() {
            lines.push(format!("# Libraries declared on core `{core_id}`"));
            let mut libs = core.libraries.clone();
            libs.sort();
            for lib in &libs {
                let kcs = library_kconfig(lib);
                if kcs.is_empty() {
                    lines.push(format!(
                        "# TODO: wire library '{lib}' once its v0.4 enable lands"
                    ));
                } else {
                    lines.extend(kcs.iter().map(|s| s.to_string()));
                }
            }
            lines.push(String::new());
        }
    }

    // 9. Inference dispatchers (from SoM capabilities)
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
        let backend = if som.silicon == "nxp:imx9:imx93" {
            "N93"
        } else {
            "AEN"
        };
        inf.push(format!(
            "CONFIG_ALP_SDK_INFERENCE_BACKEND_ETHOS_U_{backend}=y"
        ));
        for v in &variants {
            inf.push(format!(
                "CONFIG_ALP_SDK_INFERENCE_ETHOS_U_VARIANT_{}=y",
                v.to_uppercase()
            ));
        }
    }
    lines.push(
        "# Inference dispatchers (from SoM capabilities -- customer does not pick)".to_string(),
    );
    lines.extend(inf);
    lines.push(String::new());

    format!("{}\n", lines.join("\n"))
}

// ===========================================================================
// ENGINE — shared artefacts (Stage D): IPC contract header + DTS overlays
// ===========================================================================

/// True when an rpmsg channel can't be allocated because the SoM mailbox
/// controller is unset/TBD (alp_orchestrate.py:1336).
fn rpmsg_blocked(ch: &IpcChannel, mailbox: &Mailbox) -> bool {
    ch.kind == "rpmsg" && matches!(mailbox.controller.as_deref(), None | Some("TBD"))
}

/// The carve-out BLOCKED reason — embeds the SKU twice (alp_orchestrate.py:1339).
/// Note the deliberate double space after `metadata.`.
fn rpmsg_block_reason(sku: &str, controller: Option<&str>) -> String {
    let state = if controller.is_none() { "unset" } else { "TBD" };
    format!(
        "SoM {sku} mailbox controller is {state}; carve-out resolution requires authoritative mailbox metadata.  Fill `mailbox.controller:` in metadata/e1m_modules/{sku}.yaml with the vendor mailbox node name (e.g. `renesas_mhu`, `nxp_mu`, `alif_evtrtr`) or remove the rpmsg entries from board.yaml."
    )
}

/// `build/generated/alp/system_ipc.h` — the IPC contract header.
fn render_system_ipc_h(board: &BoardYaml, som: &SomPreset) -> String {
    let sku = &board.som.sku;
    let controller = som.mailbox.controller.as_deref();
    let mut lines: Vec<String> = vec![
        "/*".into(),
        " * Auto-generated by scripts/alp_orchestrate.py -- do not edit.".into(),
        " * Regenerate after changes to board.yaml `ipc:` or the SoM's".into(),
        " * memory_map / mailbox blocks.".into(),
        " */".into(),
        String::new(),
        "#ifndef ALP_SYSTEM_IPC_H".into(),
        "#define ALP_SYSTEM_IPC_H".into(),
        String::new(),
        format!("#define ALP_IPC_SKU \"{sku}\""),
        String::new(),
    ];
    for ch in &board.ipc {
        lines.push(format!(
            "/* {} channel '{}' -- endpoints {} */",
            ch.kind,
            ch.name,
            ch.endpoints.join(", ")
        ));
        if rpmsg_blocked(ch, &som.mailbox) {
            let reason = rpmsg_block_reason(sku, controller);
            let up = ch.name.to_uppercase();
            lines.push(format!("/* BLOCKED: {reason} */"));
            lines.push(format!(
                "/* IPC channel '{}' is blocked; fix the SoM metadata before depending on this channel at runtime. */",
                ch.name
            ));
            // Spacing is literal in the SDK's f-strings (7 spaces for the 4-char
            // suffixes, 4 for the 7-char ones — values land in one column).
            lines.push(format!("#define ALP_IPC_{up}_NAME       \"{}\"", ch.name));
            lines.push(format!(
                "#define ALP_IPC_{up}_ADDR       0x0u  /* stub: blocked */"
            ));
            lines.push(format!(
                "#define ALP_IPC_{up}_SIZE       0x0u  /* stub: blocked */"
            ));
            lines.push(format!(
                "#define ALP_IPC_{up}_SRC_EPT    0x0u  /* stub: blocked */"
            ));
            lines.push(format!(
                "#define ALP_IPC_{up}_DST_EPT    0x0u  /* stub: blocked */"
            ));
            lines.push(format!(
                "#define ALP_IPC_{up}_MBOX_CH    0u    /* stub: blocked */"
            ));
        }
    }
    lines.push(String::new());
    lines.push("#endif /* ALP_SYSTEM_IPC_H */".into());
    format!("{}\n", lines.join("\n"))
}

/// `build/generated/dts-reservations.dtsi` — the reserved-memory overlay.
fn render_dts_reservations(board: &BoardYaml, som: &SomPreset) -> String {
    let sku = &board.som.sku;
    let controller = som.mailbox.controller.as_deref();
    let mut lines: Vec<String> = vec![
        "/*".into(),
        " * Auto-generated by scripts/alp_orchestrate.py -- do not edit.".into(),
        " * Regenerate after changes to board.yaml `ipc:` or the SoM's".into(),
        " * memory_map block.  #include this file from your kernel /".into(),
        " * Zephyr DT.".into(),
        " */".into(),
        String::new(),
        "/ {".into(),
        "    reserved-memory {".into(),
        "        #address-cells = <2>;".into(),
        "        #size-cells = <2>;".into(),
        String::new(),
    ];
    for ch in &board.ipc {
        if rpmsg_blocked(ch, &som.mailbox) {
            let reason = rpmsg_block_reason(sku, controller);
            lines.push(format!("        /* BLOCKED: {} -- {reason} */", ch.name));
            lines.push(String::new());
        }
    }
    lines.push("    };".into());
    lines.push("};".into());
    format!("{}\n", lines.join("\n"))
}

/// `build/generated/dts-partitions.dtsi` — the storage-partition overlay.
fn render_dts_partitions(board: &BoardYaml) -> String {
    let mut lines: Vec<String> = vec![
        "/*".into(),
        " * Auto-generated by scripts/alp_orchestrate.py -- do not edit.".into(),
        " * Regenerate after changes to board.yaml `storage:` or the SoM's".into(),
        " * memory_map / on_module.ospi_memories blocks.  #include this file".into(),
        " * from your Zephyr DT.".into(),
        " */".into(),
        String::new(),
    ];
    if board.storage.is_empty() {
        lines.push("/* No `storage:` entries declared in board.yaml; nothing to emit. */".into());
    }
    format!("{}\n", lines.join("\n"))
}

// ===========================================================================
// ENGINE — Zephyr build-plan slice + the full plan assembly (Stage F)
// ===========================================================================

/// Assemble a Zephyr core's `BuildSlice` (`west build -b <board> <app>`).
/// `app_abs` (the on-disk app dir) + `sdk_root` are runtime path inputs, threaded
/// in; everything else (board target, the rendered alp.conf, build dir) derives.
fn build_zephyr_slice(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    core_id: &str,
    build_root: &str,
    app_abs: &str,
    sdk_root: &str,
) -> Option<BuildSlice> {
    let topo = som.topology.get(core_id)?;
    let board_target = topo.board.clone()?;
    let build_dir = format!("{build_root}/{core_id}-zephyr");
    Some(BuildSlice {
        core_id: core_id.to_string(),
        backend: Backend::Zephyr,
        build_dir: build_dir.clone(),
        config_artefacts: vec![GeneratedFile {
            path: format!("{build_dir}/alp.conf"),
            contents: render_zephyr_alp_conf(core_id, board, som, board_def, soc),
        }],
        command: Some(ToolStep {
            tool: "west".to_string(),
            args: vec![
                "build".into(),
                "-b".into(),
                board_target,
                app_abs.to_string(),
            ],
            cwd: build_dir,
        }),
        env: BTreeMap::from([("ALP_SDK_ROOT".to_string(), sdk_root.to_string())]),
    })
}

/// Assemble the WHOLE `BuildPlan` from data: every slice (Yocto + Zephyr) + the
/// three shared artefacts + the envelope. `board_yaml`/`sdk_root`/`zephyr_apps`
/// are the runtime path inputs (where files live on disk); all else is derived.
fn assemble_full_plan(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    board_yaml: &str,
    sdk_root: &str,
    zephyr_apps: &BTreeMap<String, String>,
) -> BuildPlan {
    let build_root = "build";
    let mut slices = Vec::new();
    for c in &soc.cores {
        let Some(topo) = som.topology.get(&c.id) else {
            continue;
        };
        if topo.machine.is_some() {
            if let Some(s) = build_yocto_slice(board, som, &c.id, build_root, sdk_root) {
                slices.push(s);
            }
        } else if topo.board.is_some() {
            let app = zephyr_apps.get(&c.id).cloned().unwrap_or_default();
            if let Some(s) = build_zephyr_slice(
                board, som, board_def, soc, &c.id, build_root, &app, sdk_root,
            ) {
                slices.push(s);
            }
        }
    }
    let shared_artefacts = vec![
        GeneratedFile {
            path: "build/generated/alp/system_ipc.h".to_string(),
            contents: render_system_ipc_h(board, som),
        },
        GeneratedFile {
            path: "build/generated/dts-reservations.dtsi".to_string(),
            contents: render_dts_reservations(board, som),
        },
        GeneratedFile {
            path: "build/generated/dts-partitions.dtsi".to_string(),
            contents: render_dts_partitions(board),
        },
    ];
    BuildPlan {
        schema_version: 1,
        generated_by: "scripts/alp_orchestrate.py".to_string(),
        board_yaml: board_yaml.to_string(),
        sku: board.som.sku.clone(),
        build_root: build_root.to_string(),
        slices,
        shared_artefacts,
        warnings: Vec::new(),
    }
}

// ===========================================================================
// MODEL — the system-manifest (Stage E). Compared STRUCTURALLY: the YAML text
// formatting (PyYAML folding/width) is an emit detail, not the engine's
// derivation. Parsing the oracle into this model and asserting struct equality
// proves the manifest CONTENT is derived from data.
// ===========================================================================

#[derive(Debug, PartialEq, Deserialize)]
struct SystemManifest {
    schema_version: u32,
    generated_by: String,
    hw_info: HwInfo,
    slices: Vec<ManifestSlice>,
    #[serde(default)]
    ipc: Vec<ManifestIpc>,
    #[serde(default)]
    helper_mcus: Vec<HelperMcu>,
    #[serde(default)]
    boot_order: Vec<String>,
}

#[derive(Debug, PartialEq, Deserialize)]
struct HwInfo {
    sku: String,
    som_hw_rev: String,
    board_name: String,
    board_hw_rev: String,
    silicon: String,
}

#[derive(Debug, PartialEq, Deserialize)]
struct ManifestSlice {
    core_id: String,
    os: String,
    app: String,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    machine: Option<String>,
    #[serde(default)]
    board: Option<String>,
    toolchain: String,
    status: String,
    flash_method: String,
    flash_args: BTreeMap<String, String>,
}

#[derive(Debug, PartialEq, Deserialize)]
struct ManifestIpc {
    name: String,
    kind: String,
    endpoints: Vec<String>,
    status: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, PartialEq, Deserialize)]
struct HelperMcu {
    name: String,
    chip: String,
    firmware_path: String,
    flash_method: String,
    flash_args: String,
    #[serde(default)]
    note: Option<String>,
}

// ===========================================================================
// ENGINE — assemble the system-manifest from metadata (Stage E)
// ===========================================================================

/// (flash_method, flash_args) per OS (alp_orchestrate.py:3533). `runner: openocd`
/// is the SDK's canonical Zephyr runner constant.
fn flash_recipe(os: &str, machine: Option<&str>) -> (String, BTreeMap<String, String>) {
    match os {
        "yocto" => (
            "yocto_wic_to_sd_or_emmc".into(),
            BTreeMap::from([("target".into(), machine.unwrap_or("").into())]),
        ),
        "zephyr" => (
            "zephyr_west_flash".into(),
            BTreeMap::from([("runner".into(), "openocd".into())]),
        ),
        _ => ("baremetal_cmake_flash".into(), BTreeMap::new()),
    }
}

fn build_system_manifest(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
) -> SystemManifest {
    let hw_info = HwInfo {
        sku: board.som.sku.clone(),
        som_hw_rev: board.som.hw_rev.clone().unwrap_or_default(),
        board_name: board_def.name.clone(),
        // board hw_rev: the board.yaml top-level value, else the board def default.
        board_hw_rev: board
            .hw_rev
            .clone()
            .or_else(|| board_def.default_hw_rev.clone())
            .unwrap_or_default(),
        silicon: som.silicon.clone(),
    };

    // Slice order follows the SoC spec's core list (a32_cluster, m55_hp, m55_he).
    let mut slices = Vec::new();
    for c in &soc.cores {
        let Some(topo) = som.topology.get(&c.id) else {
            continue;
        };
        let bc = board.cores.get(&c.id);
        // OS (POLICY): a topology `machine` ⇒ Yocto, a `board` ⇒ Zephyr.
        let os = if topo.machine.is_some() {
            "yocto"
        } else {
            "zephyr"
        };
        let app = bc
            .and_then(|x| x.app.clone())
            .or_else(|| topo.app.clone())
            .unwrap_or_default();
        let (flash_method, flash_args) = flash_recipe(os, topo.machine.as_deref());
        slices.push(ManifestSlice {
            core_id: c.id.clone(),
            os: os.to_string(),
            app,
            image: bc.and_then(|x| x.image.clone()),
            machine: topo.machine.clone(),
            board: topo.board.clone(),
            toolchain: topo.toolchain.clone().unwrap_or_default(),
            status: "pending".to_string(),
            flash_method,
            flash_args,
        });
    }

    // IPC carve-outs, sorted by name; blocked when the SoM mailbox is TBD.
    let controller = som.mailbox.controller.as_deref();
    let mut ipc: Vec<ManifestIpc> = board
        .ipc
        .iter()
        .map(|ch| {
            let blocked = rpmsg_blocked(ch, &som.mailbox);
            ManifestIpc {
                name: ch.name.clone(),
                kind: ch.kind.clone(),
                endpoints: ch.endpoints.clone(),
                status: if blocked {
                    "blocked".into()
                } else {
                    "ready".into()
                },
                reason: blocked.then(|| rpmsg_block_reason(&board.som.sku, controller)),
            }
        })
        .collect();
    ipc.sort_by(|a, b| a.name.cmp(&b.name));

    // Helper MCUs from the SoM `helper_firmware` block.
    let helper_mcus = som
        .helper_firmware
        .iter()
        .map(|hf| {
            let firmware_path = hf.firmware_path.clone().unwrap_or_default();
            let note = (firmware_path == "TBD").then(|| {
                "firmware_path TBD; populated when the upstream firmware release lands".to_string()
            });
            HelperMcu {
                name: hf.name.clone().unwrap_or_default(),
                chip: hf.chip.clone().unwrap_or_default(),
                firmware_path,
                flash_method: hf.flash_method.clone().unwrap_or_default(),
                flash_args: hf.flash_args.clone().unwrap_or_default(),
                note,
            }
        })
        .collect();

    SystemManifest {
        schema_version: 1,
        generated_by: "scripts/alp_orchestrate.py".to_string(),
        hw_info,
        slices,
        ipc,
        helper_mcus,
        boot_order: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOARD_YAML: &str = include_str!("spike_fixtures/oracle/rpmsg-aen.board.yaml");
    const SOM_PRESET: &str = include_str!("spike_fixtures/E1M-AEN701.yaml");
    const BOARD_DEF: &str = include_str!("spike_fixtures/e1m-evk.yaml");
    const SOC_SPEC: &str = include_str!("spike_fixtures/e7.json");
    const ORACLE_BUILD_PLAN: &str = include_str!("spike_fixtures/oracle/rpmsg-aen.build-plan");
    const ORACLE_MANIFEST: &str = include_str!("spike_fixtures/oracle/rpmsg-aen.system-manifest");

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
        assert_eq!(
            render_yocto_local_conf(&slice),
            oracle_artefact("a32_cluster")
        );
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

    /// STAGE C (m55_hp) — completes the Zephyr side: same as m55_he plus the
    /// CMSIS_DSP libraries section (board.yaml `libraries: [cmsis_dsp]` → 12 lines).
    #[test]
    fn m55_hp_alp_conf_matches_sdk_emit_byte_for_byte() {
        let (board, som, board_def, soc) = load();
        let ours = render_zephyr_alp_conf("m55_hp", &board, &som, &board_def, &soc);
        assert_eq!(ours, oracle_artefact("m55_hp"));
    }

    /// Pull a `sharedArtefacts[].contents` by path from the captured emit.
    fn oracle_shared(path: &str) -> String {
        let plan: serde_json::Value = serde_json::from_str(ORACLE_BUILD_PLAN).unwrap();
        plan["sharedArtefacts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["path"] == path)
            .unwrap_or_else(|| panic!("oracle has no shared artefact {path}"))["contents"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// STAGE D — the three SHARED artefacts, all byte-for-byte. AEN's mailbox
    /// controller is TBD, so the rpmsg carve-out is BLOCKED; the engine reproduces
    /// the blocked stubs + the exact reason string (SKU embedded twice).
    #[test]
    fn system_ipc_h_matches_sdk_emit_byte_for_byte() {
        let (board, som, ..) = load();
        assert_eq!(
            render_system_ipc_h(&board, &som),
            oracle_shared("build/generated/alp/system_ipc.h")
        );
    }

    #[test]
    fn dts_reservations_matches_sdk_emit_byte_for_byte() {
        let (board, som, ..) = load();
        assert_eq!(
            render_dts_reservations(&board, &som),
            oracle_shared("build/generated/dts-reservations.dtsi")
        );
    }

    #[test]
    fn dts_partitions_matches_sdk_emit_byte_for_byte() {
        let (board, ..) = load();
        assert_eq!(
            render_dts_partitions(&board),
            oracle_shared("build/generated/dts-partitions.dtsi")
        );
    }

    /// STAGE E — the system-manifest CONTENT matches the SDK emit (structural:
    /// hw_info, the 3 slices in SoC-core order with their flash recipes, the
    /// blocked ipc, and the helper MCU). Parsed into the same model, so PyYAML's
    /// text formatting is out of scope.
    #[test]
    fn system_manifest_content_matches_sdk_emit() {
        let (board, som, board_def, soc) = load();
        let ours = build_system_manifest(&board, &som, &board_def, &soc);
        let oracle: SystemManifest = serde_yaml::from_str(ORACLE_MANIFEST).unwrap();
        assert_eq!(
            ours, oracle,
            "the system-manifest content must match the SDK emit"
        );
    }

    /// Order is an emit detail, not a derivation: normalise before comparing.
    fn sort_plan(p: &mut BuildPlan) {
        p.slices.sort_by(|a, b| a.core_id.cmp(&b.core_id));
        p.shared_artefacts.sort_by(|a, b| a.path.cmp(&b.path));
    }

    /// STAGE F — the WHOLE build-plan, in one assert. The engine reproduces every
    /// slice (config + command + env) AND all three shared artefacts. Runtime path
    /// inputs (boardYaml, ALP_SDK_ROOT, the on-disk app dirs in the west commands)
    /// are threaded from the oracle; slice/artefact order is normalised. Every
    /// field the engine DERIVES equals the SDK emit.
    #[test]
    fn full_build_plan_matches_sdk_emit() {
        let (board, som, board_def, soc) = load();
        let oracle: BuildPlan = serde_json::from_str(ORACLE_BUILD_PLAN).unwrap();

        let sdk_root = oracle
            .slices
            .iter()
            .find_map(|s| s.env.get("ALP_SDK_ROOT").cloned())
            .unwrap();
        let zephyr_apps: BTreeMap<String, String> = oracle
            .slices
            .iter()
            .filter(|s| matches!(s.backend, Backend::Zephyr))
            .map(|s| {
                (
                    s.core_id.clone(),
                    s.command.as_ref().unwrap().args.last().unwrap().clone(),
                )
            })
            .collect();

        let mut ours = assemble_full_plan(
            &board,
            &som,
            &board_def,
            &soc,
            &oracle.board_yaml,
            &sdk_root,
            &zephyr_apps,
        );
        let mut oracle = oracle;
        sort_plan(&mut ours);
        sort_plan(&mut oracle);

        assert_eq!(
            serde_json::to_value(&ours).unwrap(),
            serde_json::to_value(&oracle).unwrap(),
            "the full build-plan must match the SDK emit"
        );
    }

    /// The `_SILICON_TO_KCONFIG` dissolution, isolated: computed, not table-driven.
    #[test]
    fn silicon_symbol_is_computed_not_table() {
        assert_eq!(
            silicon_soc_symbol("alif:ensemble:e7"),
            "ALP_SOC_ALIF_ENSEMBLE_E7"
        );
        assert_eq!(
            silicon_soc_symbol("nxp:imx9:imx93"),
            "ALP_SOC_NXP_IMX9_IMX93"
        );
    }

    #[test]
    fn library_recipe_transform() {
        assert_eq!(lib_to_recipe("mbedtls"), "lib-mbedtls");
        assert_eq!(lib_to_recipe("nlohmann_json"), "lib-nlohmann-json");
    }
}
