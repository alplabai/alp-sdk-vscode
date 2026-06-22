// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer (assembly)** — wire the per-output generators (`render`) into
//! the two top-level emit shapes: the `BuildPlan` (per-core slices + shared
//! artefacts) and the `SystemManifest` (hw_info + slices + ipc + helper MCUs).
//! Pure functions over (metadata, policy, templates).

use std::collections::BTreeMap;

use serde::Deserialize;

use super::bundle::*;
use super::metadata::*;
use super::policy::*;
use super::render::*;
use crate::build_plan::{Backend, BuildPlan, BuildSlice, GeneratedFile, ToolStep};

// --- build-plan slices + the full plan (Stage B/F) ---

pub(crate) fn build_yocto_slice(
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

pub(crate) fn build_zephyr_slice(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    core_id: &str,
    build_root: &str,
    app_abs: &str,
    sdk_root: &str,
    p: &Policy,
    kconfig_tmpl: &str,
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
            contents: render_zephyr_alp_conf(core_id, board, som, board_def, soc, p, kconfig_tmpl),
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

pub(crate) fn assemble_full_plan(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    board_yaml: &str,
    sdk_root: &str,
    zephyr_apps: &BTreeMap<String, String>,
    p: &Policy,
    t: &Templates,
) -> BuildPlan {
    let build_root = "build";
    let mut slices = Vec::new();
    for c in &soc.cores {
        let Some(topo) = som.topology.get(&c.id) else {
            continue;
        };
        if topo.machine.is_some() {
            if let Some(s) =
                build_yocto_slice(board, som, &c.id, build_root, sdk_root, p, &t.local_conf)
            {
                slices.push(s);
            }
        } else if topo.board.is_some() {
            let app = zephyr_apps.get(&c.id).cloned().unwrap_or_default();
            if let Some(s) = build_zephyr_slice(
                board, som, board_def, soc, &c.id, build_root, &app, sdk_root, p, &t.kconfig,
            ) {
                slices.push(s);
            }
        }
    }
    let shared_artefacts = vec![
        GeneratedFile {
            path: "build/generated/alp/system_ipc.h".to_string(),
            contents: render_system_ipc_h(board, som, soc, &t.system_ipc_h),
        },
        GeneratedFile {
            path: "build/generated/dts-reservations.dtsi".to_string(),
            contents: render_dts_reservations(board, som, soc, &t.dts_reservations),
        },
        GeneratedFile {
            path: "build/generated/dts-partitions.dtsi".to_string(),
            contents: render_dts_partitions(board, som, soc, &t.dts_partitions),
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

// --- the system-manifest (Stage E) ---
// Compared STRUCTURALLY (PyYAML text formatting is an emit detail, not the
// engine's derivation), hence the `Deserialize` derives for the oracle compare.

#[derive(Debug, PartialEq, Deserialize)]
pub(crate) struct SystemManifest {
    pub(crate) schema_version: u32,
    pub(crate) generated_by: String,
    pub(crate) hw_info: HwInfo,
    pub(crate) slices: Vec<ManifestSlice>,
    #[serde(default)]
    pub(crate) ipc: Vec<ManifestIpc>,
    #[serde(default)]
    pub(crate) helper_mcus: Vec<HelperMcu>,
    #[serde(default)]
    pub(crate) boot_order: Vec<String>,
}

#[derive(Debug, PartialEq, Deserialize)]
pub(crate) struct HwInfo {
    pub(crate) sku: String,
    pub(crate) som_hw_rev: String,
    pub(crate) board_name: String,
    pub(crate) board_hw_rev: String,
    pub(crate) silicon: String,
}

#[derive(Debug, PartialEq, Deserialize)]
pub(crate) struct ManifestSlice {
    pub(crate) core_id: String,
    pub(crate) os: String,
    pub(crate) app: String,
    #[serde(default)]
    pub(crate) image: Option<String>,
    #[serde(default)]
    pub(crate) machine: Option<String>,
    #[serde(default)]
    pub(crate) board: Option<String>,
    pub(crate) toolchain: String,
    pub(crate) status: String,
    pub(crate) flash_method: String,
    pub(crate) flash_args: BTreeMap<String, String>,
}

#[derive(Debug, PartialEq, Deserialize)]
pub(crate) struct ManifestIpc {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) endpoints: Vec<String>,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) reason: Option<String>,
}

#[derive(Debug, PartialEq, Deserialize)]
pub(crate) struct HelperMcu {
    pub(crate) name: String,
    pub(crate) chip: String,
    pub(crate) firmware_path: String,
    pub(crate) flash_method: String,
    /// Vendor-neutral: a string on Alif, a `{interface,target,base}` map on the
    /// Renesas GD32 bridge — passed through from the SoM verbatim.
    pub(crate) flash_args: serde_yaml::Value,
    #[serde(default)]
    pub(crate) note: Option<String>,
}

pub(crate) fn build_system_manifest(
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
                flash_args: hf.flash_args.clone().unwrap_or(serde_yaml::Value::Null),
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
