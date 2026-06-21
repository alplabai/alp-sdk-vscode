// SPDX-License-Identifier: Apache-2.0
//! **PROOF BENCH** (branch `proof/pmt-aen701`). Reproduce the SDK's
//! `alp_orchestrate.py --emit` for **E1M-AEN701** from **policy / metadata /
//! template DATA alone**, parity-gated against the real SDK emit captured under
//! `spike_fixtures/oracle/`. Thesis: per-silicon build knowledge is DATA, not
//! hardcoded code (issue alplabai/alp-sdk#235).
//!
//! The engine holds **no** silicon/board/OS config knowledge: the Kconfig
//! symbols, chip→subsystem map, library expansions, log-level table, flash
//! recipes and inference dispatchers all come from `spike_fixtures/policy.json`,
//! deserialized into `Policy`. Swapping a policy value changes the output with no
//! code change (`policy_change_alters_output`); the default policy reproduces the
//! SDK emit byte-for-byte (Stages A–F).
//!
//! Layers: METADATA (board.yaml + SoM preset + board def + SoC spec) · POLICY
//! (`policy.json` → `Policy`) · TEMPLATE/ENGINE (resolve → render → assemble).
#![allow(dead_code)] // proof bench: the engine's only caller is its #[cfg(test)] parity suite
#![allow(clippy::too_many_arguments)] // assemblers take the 4 metadata inputs + policy + runtime paths

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
// POLICY — the per-silicon/board/OS build rules, loaded from DATA (policy.json).
// The engine reads these and applies them generically; NO silicon/board/OS
// config knowledge is hardcoded in the engine. (RFC #235: rules are data.)
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    schema_version: u32,
    base_kconfig: Vec<String>,
    soc_symbol_prefix: String,
    board_define_prefix: String,
    chip_kconfig_prefix: String,
    yocto_lib_prefix: String,
    block_slugs: Vec<String>,
    on_module_non_chip: Vec<String>,
    log_levels: BTreeMap<String, u8>,
    peripheral_subsystems: BTreeMap<String, String>,
    chip_subsystems: BTreeMap<String, Vec<String>>,
    library_kconfig: BTreeMap<String, Vec<String>>,
    flash: BTreeMap<String, FlashPolicy>,
    inference: InferencePolicy,
}

#[derive(Debug, Clone, Deserialize)]
struct FlashPolicy {
    method: String,
    #[serde(default)]
    args: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InferencePolicy {
    tflm_backend: String,
    tflm_kernel: BTreeMap<String, String>,
    ethos_backend: BTreeMap<String, String>,
    ethos_variant_prefix: String,
}

impl Policy {
    /// **The `_SILICON_TO_KCONFIG` dissolution** — the SoC symbol is *computed*
    /// from the silicon ref + the policy prefix; no lookup table. The membership
    /// allowlist is "the SoC spec exists" (the caller already has it).
    fn soc_symbol(&self, silicon: &str) -> String {
        format!(
            "{}{}",
            self.soc_symbol_prefix,
            silicon.to_uppercase().replace(':', "_")
        )
    }
    /// A chip/block slug → its Kconfig symbol (block vs chip from the policy set).
    fn chip_symbol(&self, slug: &str) -> String {
        let kind = if self.block_slugs.iter().any(|b| b == slug) {
            "BLOCK"
        } else {
            "CHIP"
        };
        format!(
            "{}{}_{}",
            self.chip_kconfig_prefix,
            kind,
            slug.to_uppercase()
        )
    }
    /// A Yocto library name → its bitbake recipe.
    fn lib_recipe(&self, lib: &str) -> String {
        format!("{}{}", self.yocto_lib_prefix, lib.replace('_', "-"))
    }
    /// The Zephyr subsystems a chip needs (empty for an unknown chip).
    fn subsystems_of(&self, slug: &str) -> Vec<String> {
        self.chip_subsystems.get(slug).cloned().unwrap_or_default()
    }
    /// (flash_method, flash_args) for an OS; `$machine` in an arg is substituted.
    fn flash_for(&self, os: &str, machine: Option<&str>) -> (String, BTreeMap<String, String>) {
        match self.flash.get(os) {
            Some(fp) => {
                let args = fp
                    .args
                    .iter()
                    .map(|(k, v)| {
                        let val = if v == "$machine" {
                            machine.unwrap_or("").to_string()
                        } else {
                            v.clone()
                        };
                        (k.clone(), val)
                    })
                    .collect();
                (fp.method.clone(), args)
            }
            None => (String::new(), BTreeMap::new()),
        }
    }
}

/// The policy schema this engine understands. A bundle declaring a different
/// version is rejected (fail loud, never silently mis-derive) — that's what the
/// per-layer versioning in the SoM bundle is for.
const SUPPORTED_POLICY_SCHEMA: u32 = 1;

/// Load + version-check a SoM bundle's `policy.json`.
fn load_policy(json: &str) -> Result<Policy, String> {
    let p: Policy = serde_json::from_str(json).map_err(|e| format!("invalid policy: {e}"))?;
    if p.schema_version != SUPPORTED_POLICY_SCHEMA {
        return Err(format!(
            "unsupported policy schemaVersion {} (engine understands {})",
            p.schema_version, SUPPORTED_POLICY_SCHEMA
        ));
    }
    Ok(p)
}

/// A tiny template renderer — the TEMPLATE layer is DATA (a `.tmpl` in the SoM
/// bundle), not engine code. Supports `{{var}}` substitution and `{{#if key}} …
/// {{/if}}` blocks (kept when the var is non-empty). The engine computes the
/// vars from policy + metadata; the template owns the output *shape*.
fn render_template(tmpl: &str, vars: &BTreeMap<&str, String>) -> String {
    let mut s = tmpl.to_string();
    while let Some(start) = s.find("{{#if ") {
        let hdr_end = s[start..]
            .find("}}")
            .map(|i| start + i + 2)
            .expect("unterminated {{#if");
        let key = s[start + 6..hdr_end - 2].trim().to_string();
        let close = "{{/if}}";
        let end = s[hdr_end..]
            .find(close)
            .map(|i| hdr_end + i)
            .expect("missing {{/if}}");
        let keep = vars.get(key.as_str()).is_some_and(|v| !v.is_empty());
        let inner = if keep {
            s[hdr_end..end].to_string()
        } else {
            String::new()
        };
        s = format!("{}{}{}", &s[..start], inner, &s[end + close.len()..]);
    }
    for (k, v) in vars {
        s = s.replace(&format!("{{{{{k}}}}}"), v);
    }
    s
}

/// MACHINE: topology value, else `e1m-<sku sans e1m->` (alp_orchestrate.py:3285).
fn yocto_machine(topo_machine: Option<&str>, sku: &str) -> String {
    match topo_machine {
        Some(m) => m.to_string(),
        None => format!("e1m-{}", sku.to_lowercase().replace("e1m-", "")),
    }
}

/// Board name → the compile-define suffix (alp_orchestrate.py:536), e.g. `E1M_EVK`.
fn board_define_slug(name: &str) -> String {
    name.to_lowercase().replace('-', "_").to_uppercase()
}

/// The TFLM kernel policy key for a core's vector extension (neon/helium/ref).
fn tflm_kernel_key(soc: &SocSpec, core_id: &str) -> &'static str {
    for c in &soc.cores {
        if c.id == core_id {
            return match c
                .vector_extension
                .as_deref()
                .map(str::to_lowercase)
                .as_deref()
            {
                Some("neon") => "neon",
                Some("helium") => "helium",
                _ => "ref",
            };
        }
    }
    "ref"
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
        return None; // backend selection: a `machine` ⇒ Yocto
    }
    let core = board.cores.get(core_id)?;
    Some(YoctoSlice {
        core_id: core_id.to_string(),
        image: core.image.clone()?,
        machine: yocto_machine(topo.machine.as_deref(), &board.som.sku),
        libraries: core.libraries.clone(),
    })
}

/// Render `local.conf` from the SoM bundle's `templates/local.conf.tmpl`. The
/// engine computes the vars (using the policy's lib→recipe rule); the template
/// owns the shape. No output text is hardcoded in the engine.
fn render_yocto_local_conf(s: &YoctoSlice, p: &Policy, tmpl: &str) -> String {
    let image_install = if s.libraries.is_empty() {
        String::new()
    } else {
        s.libraries
            .iter()
            .map(|l| p.lib_recipe(l))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let vars = BTreeMap::from([
        ("core", s.core_id.clone()),
        ("image", s.image.clone()),
        ("machine", s.machine.clone()),
        ("imageInstall", image_install),
    ]);
    render_template(tmpl, &vars)
}

fn build_yocto_slice(
    board: &BoardYaml,
    som: &SomPreset,
    core_id: &str,
    build_root: &str,
    sdk_root: &str,
    p: &Policy,
    local_conf_tmpl: &str,
) -> Option<BuildSlice> {
    let slice = resolve_yocto_slice(board, som, core_id)?;
    let build_dir = format!("{build_root}/{core_id}-yocto");
    Some(BuildSlice {
        core_id: core_id.to_string(),
        backend: Backend::Yocto,
        build_dir: build_dir.clone(),
        config_artefacts: vec![GeneratedFile {
            path: format!("{build_dir}/local.conf"),
            contents: render_yocto_local_conf(&slice, p, local_conf_tmpl),
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

/// SoM-intrinsic chip set: scalar `on_module` fields (minus the policy's non-chip
/// keys) + `helper_firmware[].chip`. Deduped + sorted.
fn som_chip_set(som: &SomPreset, p: &Policy) -> BTreeSet<String> {
    let mut chips = BTreeSet::new();
    for (key, val) in &som.on_module {
        if p.on_module_non_chip.iter().any(|k| k == key) {
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

/// Render the per-core Zephyr Kconfig fragment (`alp.conf`) — every CONFIG line
/// comes from the metadata + the `Policy`; nothing is hardcoded in the engine.
fn render_zephyr_alp_conf(
    core_id: &str,
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    p: &Policy,
) -> String {
    let sku = &board.som.sku;
    let mut lines: Vec<String> = Vec::new();

    // 1. Header
    lines.push("# Auto-generated by scripts/alp_orchestrate.py -- do not edit.".to_string());
    lines.push(format!(
        "# Per-core Kconfig fragment for slice `{core_id}` (zephyr)."
    ));
    lines.push(String::new());

    // 2. Base defaults (from policy) + the log level (policy table)
    lines.extend(p.base_kconfig.iter().cloned());
    if let Some(n) = board
        .diagnostics
        .as_ref()
        .and_then(|d| d.log_level.as_deref())
        .and_then(|lvl| p.log_levels.get(lvl).copied())
    {
        lines.push(format!("CONFIG_LOG_DEFAULT_LEVEL={n}"));
    }
    lines.push(String::new());

    // 3. SoM silicon — CONFIG symbol COMPUTED from the silicon ref + policy prefix
    lines.push(format!("# SoM silicon ({} via {sku})", som.silicon));
    lines.push(format!("CONFIG_{}=y", p.soc_symbol(&som.silicon)));
    lines.push(String::new());

    // 4. Cross-EVK board facade selector
    lines.push(
        "# Cross-EVK board facade selector (<alp/board.h>); CONFIG_COMPILER_OPT is single-value (do not also set in prj.conf)."
            .to_string(),
    );
    lines.push(format!(
        "CONFIG_COMPILER_OPT=\"-D{}{}\"",
        p.board_define_prefix,
        board_define_slug(&board_def.name)
    ));
    lines.push(String::new());

    let mut subsystems: BTreeSet<String> = BTreeSet::new();

    // 5. SoM-intrinsic chip drivers
    let som_chips = som_chip_set(som, p);
    lines.push(format!(
        "# SoM-intrinsic chip drivers (from `{sku}` on_module + helper_firmware)"
    ));
    for chip in &som_chips {
        lines.push(format!("{}=y", p.chip_symbol(chip)));
        subsystems.extend(p.subsystems_of(chip));
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
            p.chip_symbol(chip),
            if *on { "y" } else { "n" }
        ));
        if *on {
            subsystems.extend(p.subsystems_of(chip));
        }
    }
    lines.push(String::new());

    // 7. Zephyr subsystems (chip drivers + the core's declared peripherals)
    if let Some(core) = board.cores.get(core_id) {
        for periph in &core.peripherals {
            if let Some(sub) = p.peripheral_subsystems.get(periph) {
                subsystems.insert(sub.clone());
            }
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
                match p.library_kconfig.get(lib) {
                    Some(kcs) => lines.extend(kcs.iter().cloned()),
                    None => lines.push(format!(
                        "# TODO: wire library '{lib}' once its v0.4 enable lands"
                    )),
                }
            }
            lines.push(String::new());
        }
    }

    // 9. Inference dispatchers (from SoM capabilities + the policy symbol set)
    let mut inf = vec![format!("{}=y", p.inference.tflm_backend)];
    if let Some(sym) = p.inference.tflm_kernel.get(tflm_kernel_key(soc, core_id)) {
        inf.push(format!("{sym}=y"));
    }
    let variants: BTreeSet<String> = som
        .inference
        .npu_population
        .iter()
        .filter_map(|e| e.variant.as_ref().map(|v| v.to_lowercase()))
        .collect();
    if !variants.is_empty() {
        if let Some(b) = p
            .inference
            .ethos_backend
            .get(&som.silicon)
            .or_else(|| p.inference.ethos_backend.get("default"))
        {
            inf.push(format!("{b}=y"));
        }
        for v in &variants {
            inf.push(format!(
                "{}{}=y",
                p.inference.ethos_variant_prefix,
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
// ENGINE — shared artefacts (Stage D): IPC contract header + DTS overlays.
// These carry no per-silicon CONFIG knowledge (structural text + the blocked
// reason), so they don't consume the Policy.
// ===========================================================================

fn rpmsg_blocked(ch: &IpcChannel, mailbox: &Mailbox) -> bool {
    ch.kind == "rpmsg" && matches!(mailbox.controller.as_deref(), None | Some("TBD"))
}

fn rpmsg_block_reason(sku: &str, controller: Option<&str>) -> String {
    let state = if controller.is_none() { "unset" } else { "TBD" };
    format!(
        "SoM {sku} mailbox controller is {state}; carve-out resolution requires authoritative mailbox metadata.  Fill `mailbox.controller:` in metadata/e1m_modules/{sku}.yaml with the vendor mailbox node name (e.g. `renesas_mhu`, `nxp_mu`, `alif_evtrtr`) or remove the rpmsg entries from board.yaml."
    )
}

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

fn build_zephyr_slice(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    core_id: &str,
    build_root: &str,
    app_abs: &str,
    sdk_root: &str,
    p: &Policy,
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
            contents: render_zephyr_alp_conf(core_id, board, som, board_def, soc, p),
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

fn assemble_full_plan(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    board_yaml: &str,
    sdk_root: &str,
    zephyr_apps: &BTreeMap<String, String>,
    p: &Policy,
    local_conf_tmpl: &str,
) -> BuildPlan {
    let build_root = "build";
    let mut slices = Vec::new();
    for c in &soc.cores {
        let Some(topo) = som.topology.get(&c.id) else {
            continue;
        };
        if topo.machine.is_some() {
            if let Some(s) =
                build_yocto_slice(board, som, &c.id, build_root, sdk_root, p, local_conf_tmpl)
            {
                slices.push(s);
            }
        } else if topo.board.is_some() {
            let app = zephyr_apps.get(&c.id).cloned().unwrap_or_default();
            if let Some(s) = build_zephyr_slice(
                board, som, board_def, soc, &c.id, build_root, &app, sdk_root, p,
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
// MODEL — the system-manifest (Stage E). Compared STRUCTURALLY (PyYAML text
// formatting is an emit detail, not the engine's derivation).
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

fn build_system_manifest(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    p: &Policy,
) -> SystemManifest {
    let hw_info = HwInfo {
        sku: board.som.sku.clone(),
        som_hw_rev: board.som.hw_rev.clone().unwrap_or_default(),
        board_name: board_def.name.clone(),
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
        let os = if topo.machine.is_some() {
            "yocto"
        } else {
            "zephyr"
        };
        let app = bc
            .and_then(|x| x.app.clone())
            .or_else(|| topo.app.clone())
            .unwrap_or_default();
        let (flash_method, flash_args) = p.flash_for(os, topo.machine.as_deref());
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
    // Per-SoM, versioned bundle (the proposed architecture): metadata + policy +
    // templates live together under som/<SKU>/.  SoC + board are shared metadata.
    const SOM_PRESET: &str = include_str!("spike_fixtures/som/E1M-AEN701/som.yaml");
    const POLICY_JSON: &str = include_str!("spike_fixtures/som/E1M-AEN701/policy.json");
    const LOCAL_CONF_TMPL: &str =
        include_str!("spike_fixtures/som/E1M-AEN701/templates/local.conf.tmpl");
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

    fn policy() -> Policy {
        load_policy(POLICY_JSON).unwrap()
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

    fn sort_plan(p: &mut BuildPlan) {
        p.slices.sort_by(|a, b| a.core_id.cmp(&b.core_id));
        p.shared_artefacts.sort_by(|a, b| a.path.cmp(&b.path));
    }

    #[test]
    fn metadata_and_policy_deserialise() {
        let (board, som, board_def, soc) = load();
        assert_eq!(board.som.sku, "E1M-AEN701");
        assert_eq!(som.silicon, "alif:ensemble:e7");
        assert_eq!(board_def.name, "E1M-EVK");
        assert!(soc.cores.iter().any(|c| c.id == "m55_he"));
        assert_eq!(policy().soc_symbol_prefix, "ALP_SOC_");
    }

    /// STAGE A — a32_cluster local.conf byte-for-byte from data.
    #[test]
    fn a32_cluster_local_conf_matches_sdk_emit_byte_for_byte() {
        let (board, som, ..) = load();
        let slice = resolve_yocto_slice(&board, &som, "a32_cluster").unwrap();
        assert_eq!(
            render_yocto_local_conf(&slice, &policy(), LOCAL_CONF_TMPL),
            oracle_artefact("a32_cluster")
        );
    }

    /// The bundle's policy is VERSIONED, and the engine rejects a schema it does
    /// not understand (the per-layer versioning the architecture is built on).
    #[test]
    fn policy_is_versioned_and_version_checked() {
        assert_eq!(policy().schema_version, SUPPORTED_POLICY_SCHEMA);
        let bumped = POLICY_JSON.replacen("\"schemaVersion\": 1", "\"schemaVersion\": 99", 1);
        assert!(
            load_policy(&bumped).is_err(),
            "unknown schema must be rejected"
        );
    }

    /// STAGE B — the full a32_cluster build-plan slice (env.ALP_SDK_ROOT threaded).
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
        let ours = build_yocto_slice(
            &board,
            &som,
            "a32_cluster",
            "build",
            sdk_root,
            &policy(),
            LOCAL_CONF_TMPL,
        )
        .unwrap();
        assert_eq!(&serde_json::to_value(&ours).unwrap(), oracle_slice);
    }

    /// STAGE C — the m55_he Zephyr alp.conf, byte-for-byte from data + policy.
    #[test]
    fn m55_he_alp_conf_matches_sdk_emit_byte_for_byte() {
        let (board, som, board_def, soc) = load();
        assert_eq!(
            render_zephyr_alp_conf("m55_he", &board, &som, &board_def, &soc, &policy()),
            oracle_artefact("m55_he")
        );
    }

    /// STAGE C (m55_hp) — completes the Zephyr side (CMSIS_DSP libraries section).
    #[test]
    fn m55_hp_alp_conf_matches_sdk_emit_byte_for_byte() {
        let (board, som, board_def, soc) = load();
        assert_eq!(
            render_zephyr_alp_conf("m55_hp", &board, &som, &board_def, &soc, &policy()),
            oracle_artefact("m55_hp")
        );
    }

    /// STAGE D — the three SHARED artefacts, byte-for-byte (blocked-IPC path).
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

    /// STAGE E — the system-manifest content (structural).
    #[test]
    fn system_manifest_content_matches_sdk_emit() {
        let (board, som, board_def, soc) = load();
        let ours = build_system_manifest(&board, &som, &board_def, &soc, &policy());
        let oracle: SystemManifest = serde_yaml::from_str(ORACLE_MANIFEST).unwrap();
        assert_eq!(ours, oracle);
    }

    /// STAGE F — the WHOLE build-plan, one assert (runtime paths threaded; order
    /// normalised).
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
            &policy(),
            LOCAL_CONF_TMPL,
        );
        let mut oracle = oracle;
        sort_plan(&mut ours);
        sort_plan(&mut oracle);
        assert_eq!(
            serde_json::to_value(&ours).unwrap(),
            serde_json::to_value(&oracle).unwrap()
        );
    }

    /// The `_SILICON_TO_KCONFIG` dissolution, isolated: computed from the policy
    /// prefix + the silicon ref, not a table.
    #[test]
    fn silicon_symbol_is_computed_not_table() {
        let p = policy();
        assert_eq!(p.soc_symbol("alif:ensemble:e7"), "ALP_SOC_ALIF_ENSEMBLE_E7");
        assert_eq!(p.soc_symbol("nxp:imx9:imx93"), "ALP_SOC_NXP_IMX9_IMX93");
    }

    /// **The "it's really data" proof.** Mutate ONE policy value and the engine's
    /// output changes predictably — with no engine code change. Here: a different
    /// SoC-symbol prefix flips every `CONFIG_ALP_SOC_*` line.
    #[test]
    fn policy_change_alters_output() {
        let (board, som, board_def, soc) = load();
        let mut p = policy();
        p.soc_symbol_prefix = "VENDOR_SOC_".to_string();
        let out = render_zephyr_alp_conf("m55_he", &board, &som, &board_def, &soc, &p);
        assert!(out.contains("CONFIG_VENDOR_SOC_ALIF_ENSEMBLE_E7=y"));
        assert!(!out.contains("CONFIG_ALP_SOC_ALIF_ENSEMBLE_E7=y"));
    }
}
