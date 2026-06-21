// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer** — the per-output generators. Each fills a bundle template
//! (`template::render_template`) with vars/lists the engine computes from policy
//! and metadata; NO output text is hardcoded here. Pure functions over
//! (metadata, policy, template) producing a config-file string.

use std::collections::{BTreeMap, BTreeSet};

use super::metadata::*;
use super::policy::*;
use super::template::*;

// --- small derivation helpers (shared by the generators) ---

/// MACHINE: topology value, else `e1m-<sku sans e1m->` (alp_orchestrate.py:3285).
pub(crate) fn yocto_machine(topo_machine: Option<&str>, sku: &str) -> String {
    match topo_machine {
        Some(m) => m.to_string(),
        None => format!("e1m-{}", sku.to_lowercase().replace("e1m-", "")),
    }
}

/// Board name → the compile-define suffix (alp_orchestrate.py:536), e.g. `E1M_EVK`.
pub(crate) fn board_define_slug(name: &str) -> String {
    name.to_lowercase().replace('-', "_").to_uppercase()
}

/// The TFLM kernel policy key for a core's vector extension (neon/helium/ref).
pub(crate) fn tflm_kernel_key(soc: &SocSpec, core_id: &str) -> &'static str {
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

// --- Yocto local.conf (Stage A/B) ---

pub(crate) struct YoctoSlice {
    core_id: String,
    pub(crate) image: String,
    machine: String,
    libraries: Vec<String>,
}

pub(crate) fn resolve_yocto_slice(
    board: &BoardYaml,
    som: &SomPreset,
    core_id: &str,
) -> Option<YoctoSlice> {
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
pub(crate) fn render_yocto_local_conf(s: &YoctoSlice, p: &Policy, tmpl: &str) -> String {
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
    render_template(tmpl, &vars, &no_lists())
}

// --- Zephyr Kconfig fragment (Stage C) ---

/// SoM-intrinsic chip set: scalar `on_module` fields (minus the policy's non-chip
/// keys) + `helper_firmware[].chip`. Deduped + sorted.
pub(crate) fn som_chip_set(som: &SomPreset, p: &Policy) -> BTreeSet<String> {
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

/// Render the per-core Zephyr Kconfig fragment (`alp.conf`) from the SoM bundle's
/// `templates/kconfig.tmpl`. The engine computes the CONFIG lists/vars from the
/// policy and metadata; the template owns the section structure and line shapes.
/// No output text is hardcoded in the engine.
pub(crate) fn render_zephyr_alp_conf(
    core_id: &str,
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    p: &Policy,
    tmpl: &str,
) -> String {
    let mut subsystems: BTreeSet<String> = BTreeSet::new();

    // SoM-intrinsic chips (collecting their subsystems)
    let som_chips = som_chip_set(som, p);
    let som_chip_rows: Vec<Row> = som_chips
        .iter()
        .map(|c| {
            subsystems.extend(p.subsystems_of(c));
            Row::from([("symbol", p.chip_symbol(c))])
        })
        .collect();

    // Board-populated chips (skip SoM dups; collect subsystems for enabled ones)
    let board_chip_rows: Vec<Row> = board_def
        .populated
        .iter()
        .filter(|(chip, on)| !(**on && som_chips.contains(*chip)))
        .map(|(chip, on)| {
            if *on {
                subsystems.extend(p.subsystems_of(chip));
            }
            Row::from([
                ("symbol", p.chip_symbol(chip)),
                ("value", if *on { "y".into() } else { "n".into() }),
            ])
        })
        .collect();

    // Peripherals → subsystems, then the sorted subsystem rows
    if let Some(core) = board.cores.get(core_id) {
        for periph in &core.peripherals {
            if let Some(sub) = p.peripheral_subsystems.get(periph) {
                subsystems.insert(sub.clone());
            }
        }
    }
    let subsystem_rows: Vec<Row> = subsystems
        .iter()
        .map(|s| Row::from([("name", s.clone())]))
        .collect();

    // Libraries (sorted) → policy Kconfig lines (or a TODO)
    let mut library_rows: Vec<Row> = Vec::new();
    if let Some(core) = board.cores.get(core_id) {
        let mut libs = core.libraries.clone();
        libs.sort();
        for lib in &libs {
            match p.library_kconfig.get(lib) {
                Some(kcs) => {
                    library_rows.extend(kcs.iter().map(|l| Row::from([("line", l.clone())])))
                }
                None => library_rows.push(Row::from([(
                    "line",
                    format!("# TODO: wire library '{lib}' once its v0.4 enable lands"),
                )])),
            }
        }
    }

    // Inference dispatchers (policy symbol set + SoM/SoC facts)
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
    let inference_rows: Vec<Row> = inf.into_iter().map(|l| Row::from([("line", l)])).collect();

    let log_level = board
        .diagnostics
        .as_ref()
        .and_then(|d| d.log_level.as_deref())
        .and_then(|lvl| p.log_levels.get(lvl))
        .map(|n| n.to_string())
        .unwrap_or_default();

    let vars = BTreeMap::from([
        ("core", core_id.to_string()),
        ("silicon", som.silicon.clone()),
        ("sku", board.som.sku.clone()),
        ("socSymbol", p.soc_symbol(&som.silicon)),
        (
            "boardDefine",
            format!(
                "{}{}",
                p.board_define_prefix,
                board_define_slug(&board_def.name)
            ),
        ),
        ("logLevel", log_level),
        (
            "hasSubsystems",
            if subsystem_rows.is_empty() { "" } else { "1" }.to_string(),
        ),
        (
            "hasLibraries",
            if library_rows.is_empty() { "" } else { "1" }.to_string(),
        ),
    ]);
    let lists = BTreeMap::from([
        (
            "baseKconfig",
            p.base_kconfig
                .iter()
                .map(|l| Row::from([("line", l.clone())]))
                .collect::<Vec<_>>(),
        ),
        ("somChips", som_chip_rows),
        ("boardChips", board_chip_rows),
        ("subsystems", subsystem_rows),
        ("libraryLines", library_rows),
        ("inference", inference_rows),
    ]);
    render_template(tmpl, &vars, &lists)
}

// --- shared artefacts (Stage D): IPC contract header + DTS overlays ---
// These carry no per-silicon CONFIG knowledge (structural text + the blocked
// reason), so they don't consume the Policy.

pub(crate) fn rpmsg_blocked(ch: &IpcChannel, mailbox: &Mailbox) -> bool {
    ch.kind == "rpmsg" && matches!(mailbox.controller.as_deref(), None | Some("TBD"))
}

pub(crate) fn rpmsg_block_reason(sku: &str, controller: Option<&str>) -> String {
    let state = if controller.is_none() { "unset" } else { "TBD" };
    format!(
        "SoM {sku} mailbox controller is {state}; carve-out resolution requires authoritative mailbox metadata.  Fill `mailbox.controller:` in metadata/e1m_modules/{sku}.yaml with the vendor mailbox node name (e.g. `renesas_mhu`, `nxp_mu`, `alif_evtrtr`) or remove the rpmsg entries from board.yaml."
    )
}

pub(crate) fn render_system_ipc_h(board: &BoardYaml, som: &SomPreset, tmpl: &str) -> String {
    let sku = &board.som.sku;
    let controller = som.mailbox.controller.as_deref();
    let channels: Vec<Row> = board
        .ipc
        .iter()
        .map(|ch| {
            let blocked = rpmsg_blocked(ch, &som.mailbox);
            Row::from([
                ("kind", ch.kind.clone()),
                ("name", ch.name.clone()),
                ("up", ch.name.to_uppercase()),
                ("endpoints", ch.endpoints.join(", ")),
                ("blocked", if blocked { "1".into() } else { String::new() }),
                (
                    "reason",
                    if blocked {
                        rpmsg_block_reason(sku, controller)
                    } else {
                        String::new()
                    },
                ),
            ])
        })
        .collect();
    render_template(
        tmpl,
        &BTreeMap::from([("sku", sku.clone())]),
        &BTreeMap::from([("channels", channels)]),
    )
}

pub(crate) fn render_dts_reservations(board: &BoardYaml, som: &SomPreset, tmpl: &str) -> String {
    let sku = &board.som.sku;
    let controller = som.mailbox.controller.as_deref();
    let blocked: Vec<Row> = board
        .ipc
        .iter()
        .filter(|ch| rpmsg_blocked(ch, &som.mailbox))
        .map(|ch| {
            Row::from([
                ("name", ch.name.clone()),
                ("reason", rpmsg_block_reason(sku, controller)),
            ])
        })
        .collect();
    render_template(
        tmpl,
        &BTreeMap::new(),
        &BTreeMap::from([("blocked", blocked)]),
    )
}

pub(crate) fn render_dts_partitions(board: &BoardYaml, tmpl: &str) -> String {
    let vars = BTreeMap::from([(
        "noStorage",
        if board.storage.is_empty() { "1" } else { "" }.to_string(),
    )]);
    render_template(tmpl, &vars, &no_lists())
}
