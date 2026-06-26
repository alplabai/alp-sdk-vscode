// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer** — the per-output generators. Each fills a bundle template
//! (`template::render_template`) with vars/lists the engine computes from policy
//! and metadata; NO output text is hardcoded here. Pure functions over
//! (metadata, policy, template) producing a config-file string.

use std::collections::{BTreeMap, BTreeSet};

use super::carveout::resolve_carve_outs;
use super::macros::vars;
use super::metadata::*;
use super::partition::{ResolvedPartition, resolve_storage_partitions};
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
    let vars = vars! {
        "core" => s.core_id.clone(),
        "image" => s.image.clone(),
        "machine" => s.machine.clone(),
        "imageInstall" => image_install,
    };
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
            // Unpopulated / pending chips (`TBD`, empty) are not real drivers —
            // an i.MX 93 SoM with `wifi_ble: TBD` emits no CHIP_TBD.
            if !s.is_empty() && s != "TBD" {
                chips.insert(s.to_string());
            }
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

    // Inference dispatchers (policy symbols + SoM/SoC facts). Accelerator-AGNOSTIC:
    // the backend is emitted when the SILICON declares an NPU (`soc.npus`), keyed
    // by silicon in the policy — Ethos-U on Alif, DRP-AI on Renesas, … the engine
    // never names a vendor. Per-NPU variants follow when the SoM lists them
    // (Ethos-U has `npu_population[].variant`; DRP-AI has none).
    let mut inf = vec![format!("{}=y", p.inference.tflm_backend)];
    if let Some(sym) = p.inference.tflm_kernel.get(tflm_kernel_key(soc, core_id)) {
        inf.push(format!("{sym}=y"));
    }
    if !soc.npus.is_empty() {
        if let Some(b) = p
            .inference
            .accelerator_backend
            .get(&som.silicon)
            .or_else(|| p.inference.accelerator_backend.get("default"))
        {
            inf.push(format!("{b}=y"));
        }
        let mut variants: BTreeSet<String> = som
            .inference
            .npu_population
            .iter()
            .filter_map(|e| e.variant.as_ref().map(|v| v.to_lowercase()))
            .collect();
        // Capability-count fallback for SoMs that don't list `npu_population[]`
        // (e.g. i.MX 93 declares only `ethos_u65_count: 1`). Vendor-neutral: keyed
        // by the count name, not the silicon.
        for (cap, variant) in [
            ("ethos_u55_count", "u55"),
            ("ethos_u65_count", "u65"),
            ("ethos_u85_count", "u85"),
        ] {
            if soc
                .capabilities
                .get(cap)
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                > 0
            {
                variants.insert(variant.to_string());
            }
        }
        for v in &variants {
            inf.push(format!(
                "{}{}=y",
                p.inference.npu_variant_prefix,
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

    let extra_sections = render_slice_extra_sections(core_id, board, som, soc, p);

    let vars = vars! {
        "core" => core_id.to_string(),
        "silicon" => som.silicon.clone(),
        "sku" => board.som.sku.clone(),
        "socSymbol" => p.soc_symbol(&som.silicon),
        "boardDefine" => format!("{}{}", p.board_define_prefix, board_define_slug(&board_def.name)),
        "logLevel" => log_level,
        "hasSubsystems" => if subsystem_rows.is_empty() { "" } else { "1" }.to_string(),
        "hasLibraries" => if library_rows.is_empty() { "" } else { "1" }.to_string(),
        "extraSections" => extra_sections,
    };
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

/// The board-feature sections appended after `# Inference …` (the SDK's
/// `_slice_alp_conf` tail): per-slice memory tuning, power profile, storage
/// partitions, OTA client, per-module log levels. Each emits nothing when its
/// board.yaml block is absent — a board without them (the RPMsg bench) stays
/// byte-identical. The silicon/fs-specific bits (fs→Kconfig, level→N) are policy;
/// the section shapes are board-feature (not silicon) writer text.
fn render_slice_extra_sections(
    core_id: &str,
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    p: &Policy,
) -> String {
    let bc = board.cores.get(core_id);
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();

    // Per-slice memory tuning.
    let mut mem: Vec<String> = Vec::new();
    if let Some(m) = bc.and_then(|c| c.memory.as_ref()) {
        if let Some(n) = m.stack_kib.filter(|&n| n != 0) {
            mem.push(format!("CONFIG_MAIN_STACK_SIZE={}", n * 1024));
        }
        if let Some(n) = m.isr_stack_kib.filter(|&n| n != 0) {
            mem.push(format!("CONFIG_ISR_STACK_SIZE={}", n * 1024));
        }
        if let Some(n) = m.heap_kib {
            mem.push(format!("CONFIG_HEAP_MEM_POOL_SIZE={}", n * 1024));
        }
    }
    if !mem.is_empty() {
        sections.push((
            "# Per-slice memory tuning (board.yaml cores.<id>.memory:)".into(),
            mem,
        ));
    }

    // Per-slice power-management profile (sleep/wakeup land as hint comments).
    let mut pwr: Vec<String> = Vec::new();
    if let Some(pw) = bc.and_then(|c| c.power.as_ref()) {
        let sleep = pw
            .sleep_mode
            .as_deref()
            .unwrap_or("disabled")
            .to_lowercase();
        if sleep != "disabled" {
            pwr.push("CONFIG_PM=y".into());
            pwr.push("CONFIG_PM_DEVICE=y".into());
            pwr.push(format!("# Sleep target: {sleep}"));
        }
        for wake in &pw.wakeup_sources {
            if wake.starts_with("E1M_") {
                pwr.push(format!(
                    "# wakeup source: {wake} (per-silicon Kconfig pending)"
                ));
            } else {
                pwr.push(format!(
                    "# wakeup source: {wake} (DT wakeup-source; + pm_device_wakeup_enable() pending v0.7)"
                ));
            }
        }
    }
    if !pwr.is_empty() {
        sections.push((
            "# Per-slice power-management profile (board.yaml cores.<id>.power:)".into(),
            pwr,
        ));
    }

    // Storage partitions: per-fs Kconfig (policy) + per-littlefs mount hint comments.
    let parts = resolve_storage_partitions(board, som, soc);
    if !parts.is_empty() {
        let ok: Vec<&ResolvedPartition> = parts.iter().filter(|p| !p.blocked).collect();
        let fs_seen: BTreeSet<&str> = ok.iter().map(|p| p.fs.as_str()).collect();
        let mut fs_kc: BTreeSet<String> = BTreeSet::new();
        for fs in &fs_seen {
            if let Some(ls) = p.storage.fs_kconfig.get(*fs) {
                fs_kc.extend(ls.iter().cloned());
            }
        }
        if !fs_kc.is_empty() || !ok.is_empty() {
            let mut body: Vec<String> = fs_kc.into_iter().collect(); // sorted
            for part in &ok {
                if part.fs == "littlefs" {
                    body.push(format!(
                        "# partition[{0}] -> mount at runtime via FIXED_PARTITION_ID({0}_partition)",
                        part.name
                    ));
                }
            }
            for part in parts.iter().filter(|p| p.blocked) {
                let reason = if part.reason.is_empty() {
                    "unknown reason"
                } else {
                    &part.reason
                };
                body.push(format!("# BLOCKED storage[{}]: {}", part.name, reason));
            }
            sections.push(("# Storage partitions (board.yaml `storage:`)".into(), body));
        }
    }

    // OTA Zephyr client (provider-driven). mender → hint comments (v0.7 pending);
    // hawkbit / mcumgr → live CONFIG (faithful to the SDK; only mender is oracle-verified).
    if let Some(ota) = board.ota.as_ref() {
        let provider = ota.provider.as_deref().unwrap_or("").to_lowercase();
        if matches!(provider.as_str(), "mender" | "hawkbit" | "mcumgr") {
            let srv = ota.server.as_ref();
            let mut body: Vec<String> = Vec::new();
            match provider.as_str() {
                "mender" => {
                    body.push("# Mender-MCU-client wiring is pending the v0.7 OTA module".into());
                    body.push("# (mender-mcu-client west group activation).".into());
                    body.push("# CONFIG_MENDER_MCU_CLIENT=y".into());
                    if let Some(url) = srv.and_then(|s| s.url.as_deref()) {
                        body.push(format!("# CONFIG_MENDER_SERVER_URL=\"{url}\""));
                    }
                    if let Some(t) = srv.and_then(|s| s.tenant.as_deref()) {
                        body.push(format!("# CONFIG_MENDER_TENANT_TOKEN=\"{t}\""));
                    }
                    if let Some(a) = ota.artifact_name.as_deref() {
                        body.push(format!("# CONFIG_MENDER_ARTIFACT_NAME=\"{a}\""));
                    }
                    if let Some(poll) = ota.poll_interval_s.filter(|&n| n > 0) {
                        body.push(format!("# CONFIG_MENDER_UPDATE_POLL_INTERVAL={poll}"));
                    }
                }
                "hawkbit" => {
                    body.push("CONFIG_HAWKBIT=y".into());
                    body.push("CONFIG_HAWKBIT_SHELL=y".into());
                    if let Some(url) = srv.and_then(|s| s.url.as_deref()) {
                        body.push(format!("CONFIG_HAWKBIT_SERVER=\"{url}\""));
                    }
                    if let Some(poll) = ota.poll_interval_s.filter(|&n| n > 0) {
                        body.push(format!("CONFIG_HAWKBIT_POLL_INTERVAL={poll}"));
                    }
                }
                _ => {
                    body.push("CONFIG_MCUMGR=y".into());
                    body.push("CONFIG_MCUMGR_GRP_IMG=y".into());
                    body.push("CONFIG_MCUMGR_GRP_OS=y".into());
                    body.push("# MCUmgr transport (UART/BLE/UDP) is the app's call;".into());
                    body.push(
                        "# enable the matching CONFIG_MCUMGR_TRANSPORT_* in your prj.conf.".into(),
                    );
                }
            }
            sections.push((
                format!("# OTA Zephyr client (board.yaml `ota.provider: {provider}`)"),
                body,
            ));
        }
    }

    // Per-module log-level overrides (ALP_* downgraded to hint comments).
    let mut diag: Vec<String> = Vec::new();
    if let Some(d) = board.diagnostics.as_ref() {
        for (module, lvl) in &d.modules {
            if let Some(n) = p.log_levels.get(&lvl.to_lowercase()) {
                let stem = module.to_uppercase();
                if stem.starts_with("ALP_") {
                    diag.push(format!(
                        "# CONFIG_{stem}_LOG_LEVEL={n} (pending LOG_MODULE_REGISTER on this SDK module)"
                    ));
                } else {
                    diag.push(format!("CONFIG_{stem}_LOG_LEVEL={n}"));
                }
            }
        }
    }
    if !diag.is_empty() {
        sections.push((
            "# Per-module log-level overrides (board.yaml diagnostics.modules:)".into(),
            diag,
        ));
    }

    // Each section: header + body + a trailing blank line (the SDK's `lines.append("")`).
    sections
        .iter()
        .map(|(header, body)| {
            if body.is_empty() {
                format!("{header}\n\n")
            } else {
                format!("{header}\n{}\n\n", body.join("\n"))
            }
        })
        .collect()
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

/// Render the IPC contract header from the RESOLVED carve-outs. A HW-mapped
/// mailbox yields real `ADDR`/`SIZE`/endpoint-ID `#define`s (the allocator did the
/// work); a TBD/blocked mailbox yields `0x0u` stubs + the BLOCKED comment. The
/// engine precomputes each field string; the template owns the shape.
pub(crate) fn render_system_ipc_h(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    profile: &SdkProfile,
    tmpl: &str,
) -> String {
    let channels: Vec<Row> = resolve_carve_outs(board, som, soc, profile)
        .iter()
        .map(|c| {
            let (addr, size, src, dst, mbox) = if c.blocked {
                (
                    "0x0u  /* stub: blocked */".to_string(),
                    "0x0u  /* stub: blocked */".to_string(),
                    "0x0u  /* stub: blocked */".to_string(),
                    "0x0u  /* stub: blocked */".to_string(),
                    "0u    /* stub: blocked */".to_string(),
                )
            } else {
                (
                    format!("0x{:08x}u", c.base),
                    format!("0x{:08x}u", c.size),
                    format!("0x{:08x}u", c.src_ept),
                    format!("0x{:08x}u", c.dst_ept),
                    format!("{}u", c.mbox_ch),
                )
            };
            Row::from([
                ("kind", c.kind.clone()),
                ("name", c.name.clone()),
                ("up", c.name.to_uppercase()),
                ("endpoints", c.endpoints.join(", ")),
                (
                    "blocked",
                    if c.blocked { "1".into() } else { String::new() },
                ),
                ("reason", c.reason.clone()),
                ("addr", addr),
                ("size", size),
                ("srcEpt", src),
                ("dstEpt", dst),
                ("mboxCh", mbox),
            ])
        })
        .collect();
    render_template(
        tmpl,
        &vars! {
            "sku" => board.som.sku.clone(),
            "noChannels" => if channels.is_empty() { "1" } else { "" }.to_string(),
        },
        &BTreeMap::from([("channels", channels)]),
    )
}

/// Render the DT `reserved-memory` overlay from the resolved carve-outs: a real
/// `shared-dma-pool` region per allocated channel, or a `BLOCKED` comment per
/// stubbed one. The engine precomputes each node block; the template frames them.
pub(crate) fn render_dts_reservations(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    profile: &SdkProfile,
    tmpl: &str,
) -> String {
    let rows: Vec<Row> = resolve_carve_outs(board, som, soc, profile)
        .iter()
        .map(|c| {
            let block = if c.blocked {
                format!("        /* BLOCKED: {} -- {} */\n\n", c.name, c.reason)
            } else {
                format!(
                    "        {n}: {n}@{ah:x} {{\n            compatible = \"shared-dma-pool\";\n            reg = <0x0 0x{addr:08x} 0x0 0x{size:08x}>;\n            no-map;\n            label = \"{n}\";\n        }};\n\n",
                    n = c.name,
                    ah = c.base,
                    addr = c.base,
                    size = c.size
                )
            };
            Row::from([("block", block)])
        })
        .collect();
    render_template(
        tmpl,
        &vars! { "noCarveouts" => if rows.is_empty() { "1" } else { "" }.to_string() },
        &BTreeMap::from([("carveouts", rows)]),
    )
}

/// Render the `dts-partitions.dtsi` overlay from the RESOLVED storage partitions
/// (`partition.rs`): a `fixed-partitions` child node per flash device decorated by
/// its `dt_label`, each partition base-sorted; blocked entries become comments;
/// no `storage:` ⇒ the "nothing to emit" stub. The template supplies the header
/// banner (DATA); the engine mirrors the SDK's `emit_dts_partitions` line list.
pub(crate) fn render_dts_partitions(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    tmpl: &str,
) -> String {
    let partitions = resolve_storage_partitions(board, som, soc);
    let header = tmpl.trim_end();
    let mut body: Vec<String> = Vec::new();

    if partitions.is_empty() {
        body.push("/* No `storage:` entries declared in board.yaml; nothing to emit. */".into());
        body.push(String::new());
    } else {
        // Group resolved partitions by dt_label (BTreeMap → sorted); blocked
        // entries get a standalone comment block.
        let mut by_label: BTreeMap<String, Vec<&ResolvedPartition>> = BTreeMap::new();
        let mut blocked: Vec<&ResolvedPartition> = Vec::new();
        for p in &partitions {
            if p.blocked {
                blocked.push(p);
            } else {
                by_label.entry(p.dt_label.clone()).or_default().push(p);
            }
        }
        for (label, parts) in &by_label {
            body.push(format!("&{label} {{"));
            body.push("    partitions {".into());
            body.push("        compatible = \"fixed-partitions\";".into());
            body.push("        #address-cells = <1>;".into());
            body.push("        #size-cells = <1>;".into());
            body.push(String::new());
            let mut sorted = parts.clone();
            sorted.sort_by_key(|p| p.base_kib);
            for p in sorted {
                let base = p.base_kib * 1024;
                let size = p.size_kib * 1024;
                body.push(format!(
                    "        {}_partition: partition@{:x} {{",
                    p.name, base
                ));
                body.push(format!("            label = \"{}\";", p.name));
                body.push(format!("            reg = <0x{base:x} 0x{size:x}>;"));
                body.push("        };".into());
                body.push(String::new());
            }
            body.push("    };".into());
            body.push("};".into());
            body.push(String::new());
        }
        if !blocked.is_empty() {
            body.push(
                "/* Blocked storage entries -- see system-manifest.yaml for details. */".into(),
            );
            for p in &blocked {
                let reason = if p.reason.is_empty() {
                    "unknown reason"
                } else {
                    &p.reason
                };
                body.push(format!("/* BLOCKED: {} -- {} */", p.name, reason));
            }
            body.push(String::new());
        }
    }
    format!("{}\n\n{}", header, body.join("\n"))
}

/// Render `storage_mount_table.c` — a static `fs_mount_t[]` from the resolved
/// partitions that declare a `mount:` (non-`raw`). The per-fs C shape (include,
/// `.type`, declaration, `.fs_data`) is POLICY data with `{name}`/`{mount}`
/// placeholders; the engine carries zero fs literals. The Zephyr scaffolding
/// (clang-format markers, base includes, the table) is the writer's known shape.
pub(crate) fn render_storage_mounts_c(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    p: &Policy,
    tmpl: &str,
) -> String {
    let partitions = resolve_storage_partitions(board, som, soc);
    let mountable: Vec<&ResolvedPartition> = partitions
        .iter()
        .filter(|p| !p.blocked && p.mount.is_some() && p.fs != "raw")
        .collect();

    let header = tmpl.trim_end();
    let mut lines: Vec<String> = vec![
        "/* clang-format off */".into(),
        String::new(),
        "#include <zephyr/fs/fs.h>".into(),
        "#include <zephyr/storage/flash_map.h>".into(),
        String::new(),
    ];

    if mountable.is_empty() {
        lines.push("/* No mountable storage[] entries declared; emitting empty table. */".into());
        lines.push(String::new());
        lines.push("const struct fs_mount_t *alp_storage_mounts[] = { 0 };".into());
        lines.push("const size_t alp_storage_mount_count = 0;".into());
        lines.push("/* clang-format on */".into());
        lines.push(String::new());
        return format!("{}\n{}", header, lines.join("\n"));
    }

    // Per-fs includes — first occurrence in mountable order.
    let mut fs_seen: BTreeSet<&str> = BTreeSet::new();
    for part in &mountable {
        if fs_seen.insert(part.fs.as_str()) {
            if let Some(prof) = p.storage.fs_profiles.get(&part.fs) {
                if !prof.include.is_empty() {
                    lines.push(prof.include.clone());
                }
            }
        }
    }
    lines.push(String::new());

    // Per-partition mount block (shape from policy, name/mount filled here).
    for part in &mountable {
        let name = &part.name;
        let mount = part.mount.as_deref().unwrap_or_default();
        if let Some(prof) = p.storage.fs_profiles.get(&part.fs) {
            if !prof.declare.is_empty() {
                lines.push(prof.declare.replace("{name}", name));
            }
            lines.push(format!("static struct fs_mount_t alp_mnt_{name} = {{"));
            lines.push(format!("    .type = {},", prof.fs_type));
            if !prof.fs_data.is_empty() {
                lines.push(format!(
                    "    .fs_data = {},",
                    prof.fs_data.replace("{name}", name)
                ));
            }
            lines.push(format!(
                "    .storage_dev = (void *)FIXED_PARTITION_ID({name}_partition),"
            ));
            lines.push(format!("    .mnt_point = \"{mount}\","));
            lines.push("};".into());
        }
        lines.push(String::new());
    }

    lines.push("const struct fs_mount_t *alp_storage_mounts[] = {".into());
    for part in &mountable {
        lines.push(format!("    &alp_mnt_{},", part.name));
    }
    lines.push("};".into());
    lines.push(format!(
        "const size_t alp_storage_mount_count = {};",
        mountable.len()
    ));
    lines.push("/* clang-format on */".into());
    lines.push(String::new());
    format!("{}\n{}", header, lines.join("\n"))
}

// --- board E1M-pad routing header (compose board roles + SoM dispatch) ---

/// One fully-resolved route: a board-agnostic role (`macro_name` → `e1m` pad)
/// joined with the SoM's dispatch (`direct`, or a mediator + optional pin).
pub(crate) struct ComposedRoute {
    pub(crate) e1m: String,
    pub(crate) macro_name: String,
    pub(crate) dispatch: String,
    pub(crate) dispatch_pin: Option<String>,
}

/// Compose the board's `e1m_routes` (board-agnostic roles) with the SoM's
/// `pad_routes` (per-pad dispatch). A pad absent from `pad_routes` is `direct`.
/// This is what makes a board.yaml SoM-swappable: the roles stay the same; only
/// the SoM's dispatch differs. Order follows the board's route sections.
pub(crate) fn compose_routes(board_def: &BoardDef, som: &SomPreset) -> Vec<ComposedRoute> {
    let dispatch: BTreeMap<&str, &PadRoute> = som
        .pad_routes
        .iter()
        .map(|pr| (pr.e1m.as_str(), pr))
        .collect();
    let mut out = Vec::new();
    for entries in board_def.e1m_routes.values() {
        for e in entries {
            let (disp, pin) = match dispatch.get(e.e1m.as_str()) {
                Some(pr) => (
                    pr.dispatch.clone(),
                    pr.dispatch_pin.as_ref().and_then(pin_to_string),
                ),
                None => ("direct".to_string(), None),
            };
            out.push(ComposedRoute {
                e1m: e.e1m.clone(),
                macro_name: e.macro_name.clone(),
                dispatch: disp,
                dispatch_pin: pin,
            });
        }
    }
    out
}

/// Render the board's pad-routing header (`alp_<board>_routes.h`) from a template.
/// The engine composes the roles + dispatch and precomputes the per-line dispatch
/// comment (so the template stays flat — no nested conditionals); the template
/// owns the `#define` shape + the include guard. No output text in the engine.
pub(crate) fn render_board_routes_h(board_def: &BoardDef, som: &SomPreset, tmpl: &str) -> String {
    let rows: Vec<Row> = compose_routes(board_def, som)
        .iter()
        .map(|r| {
            let comment = match (r.dispatch.as_str(), &r.dispatch_pin) {
                ("direct", _) => String::new(),
                (m, Some(pin)) => format!("  /* via {m} pin {pin} */"),
                (m, None) => format!("  /* via {m} */"),
            };
            Row::from([
                ("macro", r.macro_name.clone()),
                ("e1m", r.e1m.clone()),
                ("dispatchComment", comment),
            ])
        })
        .collect();
    let guard = format!("ALP_{}_ROUTES_H", board_define_slug(&board_def.name));
    let vars = vars! {
        "board" => board_def.name.clone(),
        "sku" => som.sku.clone().unwrap_or_default(),
        "guard" => guard,
    };
    render_template(tmpl, &vars, &BTreeMap::from([("routes", rows)]))
}
