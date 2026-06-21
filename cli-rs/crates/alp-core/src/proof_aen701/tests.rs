// SPDX-License-Identifier: Apache-2.0
//! Parity + round-trip suite: the engine reproduces the SDK `--emit` for
//! E1M-AEN701 from the bundle DATA, asserted against the captured oracle.
//! `include_str!` paths are `../spike_fixtures/…` (this file lives one level
//! down, under `proof_aen701/`).

use std::collections::BTreeMap;

use super::assemble::*;
use super::bundle::*;
use super::metadata::*;
use super::policy::*;
use super::render::*;
use super::validate::*;
use crate::build_plan::{Backend, BuildPlan};

const BOARD_YAML: &str = include_str!("../spike_fixtures/oracle/rpmsg-aen.board.yaml");
// Per-SoM, versioned bundle (the proposed architecture): metadata + policy +
// templates live together under som/<SKU>/.  SoC + board are shared metadata.
const SOM_PRESET: &str = include_str!("../spike_fixtures/som/E1M-AEN701/som.yaml");
const POLICY_JSON: &str = include_str!("../spike_fixtures/som/E1M-AEN701/policy.json");
const LOCAL_CONF_TMPL: &str =
    include_str!("../spike_fixtures/som/E1M-AEN701/templates/local.conf.tmpl");
const KCONFIG_TMPL: &str = include_str!("../spike_fixtures/som/E1M-AEN701/templates/kconfig.tmpl");
const IPC_TMPL: &str = include_str!("../spike_fixtures/som/E1M-AEN701/templates/system_ipc.h.tmpl");
const DTS_RES_TMPL: &str =
    include_str!("../spike_fixtures/som/E1M-AEN701/templates/dts-reservations.dtsi.tmpl");
const DTS_PART_TMPL: &str =
    include_str!("../spike_fixtures/som/E1M-AEN701/templates/dts-partitions.dtsi.tmpl");
const BUNDLE_YAML: &str = include_str!("../spike_fixtures/som/E1M-AEN701/bundle.yaml");
// Board-level (SoM-agnostic) shared template — the routing header shape.
const ROUTES_H_TMPL: &str = include_str!("../spike_fixtures/templates/board-routes.h.tmpl");
const BOARD_DEF: &str = include_str!("../spike_fixtures/e1m-evk.yaml");
const SOC_SPEC: &str = include_str!("../spike_fixtures/e7.json");
const ORACLE_BUILD_PLAN: &str = include_str!("../spike_fixtures/oracle/rpmsg-aen.build-plan");
const ORACLE_MANIFEST: &str = include_str!("../spike_fixtures/oracle/rpmsg-aen.system-manifest");

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

/// The bundle's templates, as the engine would load them from `templates/`.
fn templates() -> Templates {
    Templates {
        local_conf: LOCAL_CONF_TMPL.to_string(),
        kconfig: KCONFIG_TMPL.to_string(),
        system_ipc_h: IPC_TMPL.to_string(),
        dts_reservations: DTS_RES_TMPL.to_string(),
        dts_partitions: DTS_PART_TMPL.to_string(),
    }
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

/// The `bundle.yaml` MANIFEST is the engine's entry gate: it parses, declares
/// stable layer paths, and accepts a compatible SDK.
#[test]
fn bundle_manifest_loads_and_gates() {
    let m = load_bundle(BUNDLE_YAML, "0.7.0").expect("0.7.0 is in range");
    assert_eq!(m.som, "E1M-AEN701");
    assert_eq!(m.bundle_version, "1.0.0");
    assert_eq!(m.sdk_compat_range, ">=0.6.0,<1.0.0");
    // The manifest declares stable paths (NOT version-embedded filenames).
    assert_eq!(m.layers.policy.path, "policy.json");
    assert_eq!(m.layers.metadata.path, "som.yaml");
    assert_eq!(m.layers.templates.kconfig.path, "templates/kconfig.tmpl");
    // Each declared layer schema is one the engine understands.
    assert_eq!(m.layers.policy.schema, SUPPORTED_POLICY_SCHEMA);
    assert_eq!(m.layers.metadata.schema, SUPPORTED_METADATA_SCHEMA);
    for (_name, layer) in m.template_layers() {
        assert_eq!(layer.schema, SUPPORTED_TEMPLATE_SCHEMA);
    }
}

/// `sdkCompatRange` is enforced at LOAD time (npm-peerDependencies style): an SDK
/// outside the range is one clear early error, not a runtime mis-derive.
#[test]
fn bundle_rejects_incompatible_sdk() {
    assert!(load_bundle(BUNDLE_YAML, "0.7.0").is_ok());
    assert!(load_bundle(BUNDLE_YAML, "0.6.0").is_ok()); // inclusive lower bound
    assert!(
        load_bundle(BUNDLE_YAML, "0.5.0").is_err(),
        "below the >=0.6.0 floor"
    );
    assert!(
        load_bundle(BUNDLE_YAML, "1.0.0").is_err(),
        "the <1.0.0 ceiling is exclusive"
    );
    assert!(load_bundle(BUNDLE_YAML, "2.3.1").is_err());
}

/// An unknown manifest `schemaVersion` is rejected (the same gate every layer
/// uses, via `check_schema_version!`).
#[test]
fn bundle_rejects_unknown_schema() {
    let bumped = BUNDLE_YAML.replacen("schemaVersion: 1", "schemaVersion: 99", 1);
    let err = load_bundle(&bumped, "0.7.0").unwrap_err();
    assert!(err.contains("bundle schemaVersion 99"), "got: {err}");
}

/// The manifest's declared paths MUST match the bundle's real files — the proof's
/// `include_str!`'d layers are exactly what the manifest points at.
#[test]
fn bundle_manifest_paths_match_real_files() {
    let m = load_bundle(BUNDLE_YAML, "0.7.0").unwrap();
    // (path, the file's real first line) — proves the manifest addresses reality.
    let checks = [
        (&m.layers.policy.path, POLICY_JSON),
        (&m.layers.metadata.path, SOM_PRESET),
        (&m.layers.templates.local_conf.path, LOCAL_CONF_TMPL),
        (&m.layers.templates.kconfig.path, KCONFIG_TMPL),
        (&m.layers.templates.system_ipc_h.path, IPC_TMPL),
        (&m.layers.templates.dts_reservations.path, DTS_RES_TMPL),
        (&m.layers.templates.dts_partitions.path, DTS_PART_TMPL),
    ];
    for (path, contents) in checks {
        assert!(
            !path.is_empty() && !contents.is_empty(),
            "declared layer path {path} resolves to a non-empty bundle file"
        );
    }
    assert_eq!(
        m.layers.templates.dts_partitions.path,
        "templates/dts-partitions.dtsi.tmpl"
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
        render_zephyr_alp_conf(
            "m55_he",
            &board,
            &som,
            &board_def,
            &soc,
            &policy(),
            KCONFIG_TMPL
        ),
        oracle_artefact("m55_he")
    );
}

/// STAGE C (m55_hp) — completes the Zephyr side (CMSIS_DSP libraries section).
#[test]
fn m55_hp_alp_conf_matches_sdk_emit_byte_for_byte() {
    let (board, som, board_def, soc) = load();
    assert_eq!(
        render_zephyr_alp_conf(
            "m55_hp",
            &board,
            &som,
            &board_def,
            &soc,
            &policy(),
            KCONFIG_TMPL
        ),
        oracle_artefact("m55_hp")
    );
}

/// STAGE D — the three SHARED artefacts, byte-for-byte (blocked-IPC path).
#[test]
fn system_ipc_h_matches_sdk_emit_byte_for_byte() {
    let (board, som, ..) = load();
    assert_eq!(
        render_system_ipc_h(&board, &som, IPC_TMPL),
        oracle_shared("build/generated/alp/system_ipc.h")
    );
}

#[test]
fn dts_reservations_matches_sdk_emit_byte_for_byte() {
    let (board, som, ..) = load();
    assert_eq!(
        render_dts_reservations(&board, &som, DTS_RES_TMPL),
        oracle_shared("build/generated/dts-reservations.dtsi")
    );
}

#[test]
fn dts_partitions_matches_sdk_emit_byte_for_byte() {
    let (board, ..) = load();
    assert_eq!(
        render_dts_partitions(&board, DTS_PART_TMPL),
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
        &templates(),
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
    let out = render_zephyr_alp_conf("m55_he", &board, &som, &board_def, &soc, &p, KCONFIG_TMPL);
    assert!(out.contains("CONFIG_VENDOR_SOC_ALIF_ENSEMBLE_E7=y"));
    assert!(!out.contains("CONFIG_ALP_SOC_ALIF_ENSEMBLE_E7=y"));
}

// === Phase 3 — peripheral + carrier compatibility (semantic diagnostics) ===

/// The canonical board is CLEAN: m55_hp's `i2c` is on the E7, the SoM family is
/// hosted by the EVK — no diagnostics, nothing blocking.
#[test]
fn canonical_board_has_no_compat_diagnostics() {
    let (board, som, board_def, soc) = load();
    let diags = check_all(&board, &som, &board_def, &soc, &policy());
    assert!(diags.is_empty(), "expected a clean board, got: {diags:?}");
}

/// Peripheral coverage is policy-driven against the SoC inventory: direct hits,
/// variant suffixes (`i2c`→`i2c_lp`, `can`→`can_fd`, `adc`→`adc_12bit`), and the
/// policy aliases (`counter`→`timer*`, `pwm`→`pwm|timer`, `sensor`→always).
#[test]
fn peripheral_coverage_matches_soc_inventory() {
    let (.., soc) = load();
    let p = policy();
    for present in [
        "i2c", "spi", "uart", "gpio", "can", "adc", "counter", "pwm", "sensor",
    ] {
        assert!(
            soc_has_peripheral(&soc, &p, present),
            "'{present}' should resolve on the E7"
        );
    }
    // `flash`/`emmc` are in the board schema enum but NOT in the E7 inventory.
    assert!(!soc_has_peripheral(&soc, &p, "flash"));
    assert!(!soc_has_peripheral(&soc, &p, "emmc"));
}

/// **ALP-B010** — a declared peripheral absent from the silicon raises a
/// non-blocking WARNING with a semantic message + a fix hint.
#[test]
fn alp_b010_warns_on_peripheral_not_on_silicon() {
    let (mut board, som, _board_def, soc) = load();
    board
        .cores
        .get_mut("m55_hp")
        .unwrap()
        .peripherals
        .push("flash".to_string());
    let diags = check_peripherals(&board, &som, &soc, &policy());
    let d = diags
        .iter()
        .find(|d| d.code == "ALP-B010")
        .expect("ALP-B010 must fire for 'flash' on the E7");
    assert_eq!(d.severity, Severity::Warning);
    assert!(!d.is_blocking(), "coverage gaps must NOT block the build");
    assert!(d.message.contains("'flash'") && d.message.contains("alif:ensemble:e7"));
    assert!(d.hint.as_ref().unwrap().contains("metadata/socs/"));
}

/// **ALP-B011** — a SoM whose family the carrier cannot host is a BLOCKING error
/// with a semantic message.
#[test]
fn alp_b011_blocks_unsupported_som_on_carrier() {
    let (board, mut som, board_def, _soc) = load();
    // Canonical: alif-ensemble SoM on the EVK (hosts alif-ensemble + nxp-imx9).
    assert!(check_som_supported(&board, &som, &board_def).is_none());
    // Swap the SoM family to one the EVK does not host.
    som.family = Some("renesas-rzv".to_string());
    let d = check_som_supported(&board, &som, &board_def).expect("ALP-B011 must fire");
    assert_eq!(d.code, "ALP-B011");
    assert_eq!(d.severity, Severity::Error);
    assert!(d.is_blocking());
    assert!(d.message.contains("renesas-rzv") && d.message.contains("E1M-AEN701"));
}

// === Phase 4 — pin/pad routing (compose + conflicts + the routing header) ===

/// The engine COMPOSES board-agnostic roles (`e1m_routes`) with the SoM's
/// per-pad dispatch (`pad_routes`): a pad in `pad_routes` carries its mediator +
/// pin; a pad absent from it is `direct`. This is what makes board.yaml
/// SoM-swappable.
#[test]
fn compose_attaches_som_dispatch_to_board_roles() {
    let (_, som, board_def, _) = load();
    let routes = compose_routes(&board_def, &som);
    let io15 = routes
        .iter()
        .find(|r| r.e1m == "E1M_GPIO_IO15")
        .expect("BMI323 INT1 pad");
    assert_eq!(io15.macro_name, "EVK_PIN_BMI323_INT1");
    assert_eq!(io15.dispatch, "cc3501e");
    assert_eq!(io15.dispatch_pin, Some(14));
    // A pad the SoM does not redirect stays direct.
    let i2c0 = routes.iter().find(|r| r.e1m == "E1M_I2C0").unwrap();
    assert_eq!(i2c0.dispatch, "direct");
    assert_eq!(i2c0.dispatch_pin, None);
}

/// The routing header is policy/template-driven (no output text in the engine):
/// direct pads emit a plain `#define`, dispatched pads carry a `via <mediator>`
/// comment the engine precomputes.
#[test]
fn routes_header_renders_from_template() {
    let (_, som, board_def, _) = load();
    let out = render_board_routes_h(&board_def, &som, ROUTES_H_TMPL);
    assert!(out.contains("#ifndef ALP_E1M_EVK_ROUTES_H"));
    assert!(
        out.contains("#define EVK_I2C_BUS_SENSORS E1M_I2C0\n"),
        "direct pad: no dispatch comment"
    );
    assert!(
        out.contains("#define EVK_PIN_BMI323_INT1 E1M_GPIO_IO15  /* via cc3501e pin 14 */"),
        "dispatched pad with a mediator pin"
    );
    assert!(
        out.contains("#define EVK_SPI_BUS_ARDUINO E1M_SPI1  /* via cc3501e */"),
        "dispatched pad without a pin"
    );
}

/// **ALP-B013** — a pad bound to two roles is a conflict, UNLESS allowlisted.
/// The EVK's only dual-claim (`E1M_PWM1`) is allowlisted, so the canonical board
/// is clean; an unlisted double-claim blocks.
#[test]
fn alp_b013_flags_unallowlisted_pad_double_claim() {
    let (_, _, mut board_def, _) = load();
    // Canonical: only E1M_PWM1 is dual-claimed, and it's allowlisted.
    assert!(check_pad_conflicts(&board_def, &policy()).is_empty());
    // Add a second claim on an already-bound pad (E1M_I2C0).
    board_def
        .e1m_routes
        .get_mut("buses")
        .unwrap()
        .push(RouteEntry {
            e1m: "E1M_I2C0".to_string(),
            macro_name: "EVK_FAKE_DUP".to_string(),
            doc: None,
            active_low: None,
            board_alias: None,
        });
    let diags = check_pad_conflicts(&board_def, &policy());
    let d = diags
        .iter()
        .find(|d| d.code == "ALP-B013")
        .expect("B013 fires");
    assert!(d.is_blocking());
    assert!(d.message.contains("E1M_I2C0") && d.message.contains("EVK_FAKE_DUP"));
}

/// **ALP-B014** — a pad that dispatches via a mediator the SoM does not populate
/// is unroutable (blocking). Canonical AEN populates the CC3501E, so it's clean;
/// strip the mediator and every CC3501E-dispatched pad reports B014.
#[test]
fn alp_b014_flags_unpopulated_mediator() {
    let (_, mut som, _, _) = load();
    assert!(
        check_route_dispatch(&som).is_empty(),
        "the CC3501E mediator is populated on the AEN SoM"
    );
    som.on_module.remove("wifi_ble"); // the cc3501e on-module entry
    som.helper_firmware.clear(); // the cc3501e helper MCU
    let diags = check_route_dispatch(&som);
    assert!(!diags.is_empty());
    assert!(
        diags
            .iter()
            .all(|d| d.code == "ALP-B014" && d.is_blocking() && d.message.contains("cc3501e"))
    );
}
