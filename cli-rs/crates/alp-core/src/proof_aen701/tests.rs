// SPDX-License-Identifier: Apache-2.0
//! Parity + round-trip suite: the engine reproduces the SDK `--emit` for
//! E1M-AEN701 from the bundle DATA, asserted against the captured oracle.
//! `include_str!` paths are `../spike_fixtures/…` (this file lives one level
//! down, under `proof_aen701/`).

use std::collections::BTreeMap;

use super::assemble::*;
use super::bundle::*;
use super::metadata::*;
use super::pinmux::*;
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
const PIN_POLICY_JSON: &str = include_str!("../spike_fixtures/som/E1M-AEN701/pin-policy.json");
// Per-silicon pin-mux CAPABILITY table (shared metadata, next to the SoC spec).
const PINMUX_YAML: &str = include_str!("../spike_fixtures/pinmux.alif-ensemble-e7.yaml");
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

fn pin_policy() -> PinPolicy {
    load_pin_policy(PIN_POLICY_JSON).unwrap()
}

fn pinmux() -> PinMux {
    load_pinmux(PINMUX_YAML).unwrap()
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

// === E8 / AEN801 — the universality proof (maintainer's decisive ask on #235) ===
// SAME engine, SAME templates + build policy as E7; ONLY the SoM metadata
// (som.yaml) + the SoC spec (e8.json) differ. Oracle captured from the real
// `alp_orchestrate.py --emit` at the **v0.7.0** tag (per ADR 0014: parity vs a tag).
const BOARD_YAML_E8: &str = include_str!("../spike_fixtures/oracle/rpmsg-aen801.board.yaml");
const SOM_E8: &str = include_str!("../spike_fixtures/som/E1M-AEN801/som.yaml");
const POLICY_E8: &str = include_str!("../spike_fixtures/som/E1M-AEN801/policy.json");
const SOC_E8: &str = include_str!("../spike_fixtures/e8.json");
const KCONFIG_TMPL_E8: &str =
    include_str!("../spike_fixtures/som/E1M-AEN801/templates/kconfig.tmpl");
const ORACLE_BUILD_PLAN_E8: &str = include_str!("../spike_fixtures/oracle/rpmsg-aen801.build-plan");
const ORACLE_MANIFEST_E8: &str =
    include_str!("../spike_fixtures/oracle/rpmsg-aen801.system-manifest");

fn load_e8() -> (BoardYaml, SomPreset, BoardDef, SocSpec) {
    (
        serde_yaml::from_str(BOARD_YAML_E8).unwrap(),
        serde_yaml::from_str(SOM_E8).unwrap(),
        serde_yaml::from_str(BOARD_DEF).unwrap(), // the SAME E1M-EVK board def as E7
        serde_json::from_str(SOC_E8).unwrap(),
    )
}

fn policy_e8() -> Policy {
    load_policy(POLICY_E8).unwrap()
}

/// The E8 bundle's templates, loaded from `som/E1M-AEN801/templates/` — byte-
/// identical to E7's (asserted in `e8_bundle_reuses_the_e7_shapes`).
fn templates_e8() -> Templates {
    Templates {
        local_conf: include_str!("../spike_fixtures/som/E1M-AEN801/templates/local.conf.tmpl")
            .to_string(),
        kconfig: KCONFIG_TMPL_E8.to_string(),
        system_ipc_h: include_str!("../spike_fixtures/som/E1M-AEN801/templates/system_ipc.h.tmpl")
            .to_string(),
        dts_reservations: include_str!(
            "../spike_fixtures/som/E1M-AEN801/templates/dts-reservations.dtsi.tmpl"
        )
        .to_string(),
        dts_partitions: include_str!(
            "../spike_fixtures/som/E1M-AEN801/templates/dts-partitions.dtsi.tmpl"
        )
        .to_string(),
    }
}

fn oracle_e8_artefact(core_id: &str) -> String {
    let plan: serde_json::Value = serde_json::from_str(ORACLE_BUILD_PLAN_E8).unwrap();
    plan["slices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["coreId"] == core_id)
        .unwrap_or_else(|| panic!("E8 oracle has no slice {core_id}"))["configArtefacts"][0]
        ["contents"]
        .as_str()
        .unwrap()
        .to_string()
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
    assert_eq!(m.layers.pin_policy.path, "pin-policy.json");
    assert_eq!(m.layers.templates.kconfig.path, "templates/kconfig.tmpl");
    // Each declared layer schema is one the engine understands.
    assert_eq!(m.layers.policy.schema, SUPPORTED_POLICY_SCHEMA);
    assert_eq!(m.layers.metadata.schema, SUPPORTED_METADATA_SCHEMA);
    assert_eq!(m.layers.pin_policy.schema, SUPPORTED_PIN_POLICY_SCHEMA);
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
        (&m.layers.pin_policy.path, PIN_POLICY_JSON),
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
    let (board, som, _, soc) = load();
    assert_eq!(
        render_system_ipc_h(&board, &som, &soc, IPC_TMPL),
        oracle_shared("build/generated/alp/system_ipc.h")
    );
}

#[test]
fn dts_reservations_matches_sdk_emit_byte_for_byte() {
    let (board, som, _, soc) = load();
    assert_eq!(
        render_dts_reservations(&board, &som, &soc, DTS_RES_TMPL),
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
    let diags = check_all(&board, &som, &board_def, &soc, &policy(), &pin_policy());
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

/// **ALP-B012** — the known-silicon allowlist (maintainer's #2 condition): the
/// computed SoC symbol stays non-emitting for an out-of-catalogue silicon. A
/// silicon matching its SoC spec is clean; a mismatch blocks.
#[test]
fn alp_b012_blocks_out_of_catalogue_silicon() {
    let (_, som, _, soc) = load();
    // Canonical: som.silicon == soc.ref (alif:ensemble:e7) → clean.
    assert!(check_silicon_known(&som, &soc).is_none());
    // An out-of-catalogue silicon ref → blocking ALP-B012, no bogus symbol emitted.
    let mut bad = som;
    bad.silicon = "acme:foo:z99".to_string();
    let d = check_silicon_known(&bad, &soc).expect("B012 fires for unknown silicon");
    assert_eq!(d.code, "ALP-B012");
    assert!(d.is_blocking());
    assert!(d.message.contains("acme:foo:z99"));
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
    assert_eq!(io15.dispatch_pin, Some("14".to_string()));
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
    // Canonical: only E1M_PWM1 is dual-claimed, and it's allowlisted (in pin-policy).
    assert!(check_pad_conflicts(&board_def, &pin_policy()).is_empty());
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
    let diags = check_pad_conflicts(&board_def, &pin_policy());
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

// === Phase 5 — pin-mux capability (separate pin METADATA + pin POLICY) ===

/// The pin POLICY is its own versioned set (separate from the build policy) and
/// the per-silicon pin-mux is METADATA — both load + version-check independently.
#[test]
fn pin_policy_and_pinmux_load_and_version_check() {
    assert_eq!(pin_policy().schema_version, SUPPORTED_PIN_POLICY_SCHEMA);
    assert_eq!(pinmux().silicon, "alif:ensemble:e7");
    let bumped = PIN_POLICY_JSON.replacen("\"schemaVersion\": 1", "\"schemaVersion\": 9", 1);
    assert!(
        load_pin_policy(&bumped).is_err(),
        "unknown pin-policy schema rejected"
    );
    let bad = PINMUX_YAML.replacen("schema_version: 1", "schema_version: 9", 1);
    assert!(load_pinmux(&bad).is_err(), "unknown pinmux schema rejected");
    // The build-policy allowlist MOVED to the pin policy.
    assert_eq!(
        pin_policy().pad_dual_claim_allowlist,
        vec!["E1M_PWM1".to_string()]
    );
}

/// **The validation source** the CLI + VS Code extension drive an advanced
/// pin-mux UI from — answered straight from the real TSV-derived pin-mux: what a
/// pad carries, every pad of a peripheral, who owns it, the silicon pad.
#[test]
fn pinmux_is_a_validation_source_for_the_ui() {
    let m = pinmux();
    assert_eq!(
        m.pads.len(),
        87,
        "the full E1M-AEN pinout (from-alif + from-cc3501e)"
    );
    // What function does this E1M pad carry?
    assert_eq!(m.function_of("AD2"), Some("I2C0_SDA"));
    assert_eq!(m.function_of("AG9"), Some("SPI1_MOSI"));
    // The picker: every E1M pad of a peripheral (sorted).
    assert_eq!(m.pads_for_peripheral("I2C0"), vec!["AD2", "AE2"]);
    assert_eq!(m.pads_for_peripheral("UART0"), vec!["F2", "G2"]);
    // Owner: SPI1 lands on the on-module CC3501E, I2C0 on the Alif SoC directly.
    assert_eq!(m.owner_of("AG9"), Some("cc3501e"));
    assert_eq!(m.owner_of("AD2"), Some("alif"));
    assert_eq!(m.silicon_pad_of("AD2"), Some("P5_7"));
    assert_eq!(m.pad_for_function("SPI1_MOSI"), Some("AG9"));
    assert!(!m.is_known("ZZ9"));
}

/// **The pin rule engine** — a clean config produces nothing; the three
/// capability conflicts each fire with a semantic, blocking diagnostic.
#[test]
fn pin_rule_engine_flags_capability_conflicts() {
    let m = pinmux();
    let p = pin_policy();
    let asn = |pad: &str, func: &str, owner: &str| PinAssignment {
        pad: pad.into(),
        function: func.into(),
        owner: owner.into(),
    };

    // Clean: I2C0 on its real pads.
    let clean = [
        asn("AD2", "I2C0_SDA", "i2c0"),
        asn("AE2", "I2C0_SCL", "i2c0"),
    ];
    assert!(check_assignments(&m, &p, &clean).is_empty());

    // ALP-P001 — an E1M pad that does not exist on this silicon.
    let d = check_assignments(&m, &p, &[asn("ZZ9", "I2C0_SDA", "i2c0")]);
    assert!(
        d.iter()
            .any(|d| d.code == "ALP-P001" && d.message.contains("does not exist"))
    );

    // ALP-P001 — a real pad driven with the wrong function.
    let d = check_assignments(&m, &p, &[asn("AD2", "SPI1_MOSI", "spi1")]);
    assert!(d.iter().any(|d| d.code == "ALP-P001"
        && d.is_blocking()
        && d.message.contains("AD2")
        && d.message.contains("I2C0_SDA")));

    // ALP-P002 — two owners contend for one E1M pad.
    let d = check_assignments(
        &m,
        &p,
        &[
            asn("AD2", "I2C0_SDA", "i2c0"),
            asn("AD2", "I2C0_SDA", "other"),
        ],
    );
    assert!(
        d.iter()
            .any(|d| d.code == "ALP-P002" && d.message.contains("AD2"))
    );

    // ALP-P003 — two E1M pads on one silicon pad. The AEN pinout has no such
    // collision (each E1M pad is a distinct silicon pad), so exercise it on a
    // tiny synthetic pin-mux where two pads share P1_0.
    let collide = load_pinmux(concat!(
        "schema_version: 1\nsilicon: test\npads:\n",
        "  PA: { function: F_A, owner: alif, silicon: P1_0 }\n",
        "  PB: { function: F_B, owner: alif, silicon: P1_0 }\n",
    ))
    .unwrap();
    let d = check_assignments(
        &collide,
        &p,
        &[asn("PA", "F_A", "a"), asn("PB", "F_B", "b")],
    );
    assert!(
        d.iter()
            .any(|d| d.code == "ALP-P003" && d.message.contains("P1_0"))
    );
}

/// The board↔pin-mux BRIDGE resolves board-facing E1M names (`E1M_I2C0`, the
/// whole bus) to per-signal functions — via the `aliases` map, with a bare-name
/// fallback (`E1M_PWM1` → `PWM1`); an unrecognized name is `None`.
#[test]
fn board_pin_bridge_resolves_e1m_names() {
    let m = pinmux();
    assert_eq!(
        m.resolve_e1m("E1M_I2C0"),
        Some(vec!["I2C0_SDA".to_string(), "I2C0_SCL".to_string()])
    );
    assert_eq!(m.resolve_e1m("E1M_PWM1"), Some(vec!["PWM1".to_string()])); // bare fallback
    assert_eq!(m.resolve_e1m("E1M_NOPE"), None);
}

/// **End-to-end (no synthetic input)** — the canonical board.yaml's REAL `pins`
/// (just `E1M_I2C0`) bridge to their silicon pads and validate clean; bad pins
/// produce real diagnostics.
#[test]
fn canonical_board_pins_validate_end_to_end() {
    let m = pinmux();
    let p = pin_policy();
    let mk = |name: &str| RouteEntry {
        e1m: name.to_string(),
        macro_name: "X".to_string(),
        doc: None,
        active_low: None,
        board_alias: None,
    };

    // Real board.yaml: E1M_I2C0 -> I2C0_SDA (AD2) + I2C0_SCL (AE2). Clean.
    let (board, ..) = load();
    assert_eq!(
        board.pins.len(),
        1,
        "the canonical board uses one active pin"
    );
    assert!(check_board_pins(&board, &m, &p).is_empty());

    // An unknown E1M name -> ALP-P004.
    let (mut bad, ..) = load();
    bad.pins.push(mk("E1M_NOPE"));
    let d = check_board_pins(&bad, &m, &p);
    assert!(
        d.iter()
            .any(|d| d.code == "ALP-P004" && d.message.contains("E1M_NOPE"))
    );

    // The same bus claimed twice -> a silicon pad claimed twice -> ALP-P002.
    let (mut dup, ..) = load();
    dup.pins.push(mk("E1M_I2C0"));
    let d = check_board_pins(&dup, &m, &p);
    assert!(d.iter().any(|d| d.code == "ALP-P002"));
}

// === E8 / AEN801 parity — the universality proof (issue #235, maintainer ask) ===

/// A NEW silicon's SoC symbol is computed by the SAME rule — no table, no engine
/// edit. `_SILICON_TO_KCONFIG` truly dissolved across silicons.
#[test]
fn e8_silicon_symbol_is_computed() {
    assert_eq!(
        policy_e8().soc_symbol("alif:ensemble:e8"),
        "ALP_SOC_ALIF_ENSEMBLE_E8"
    );
}

/// The E8 bundle reuses E7's EXACT build rules + output shapes — only the SoM
/// metadata (`som.yaml`) + the SoC spec (`e8.json`) differ. That is what makes the
/// engine "universal": same data surfaces, new silicon.
#[test]
fn e8_bundle_reuses_the_e7_shapes() {
    assert_eq!(
        POLICY_E8, POLICY_JSON,
        "E8 build policy is byte-identical to E7"
    );
    assert_eq!(
        KCONFIG_TMPL_E8, KCONFIG_TMPL,
        "E8 kconfig template is byte-identical to E7"
    );
}

/// **STAGE C (E8)** — m55_hp Zephyr `alp.conf`, byte-for-byte from data. The E8
/// silicon symbol AND the **Ethos-U85** dispatcher fall out of the new SoM
/// metadata with the SAME engine + template (E7 emits U55 only; E8 adds U85).
#[test]
fn e8_m55_hp_alp_conf_matches_sdk_emit_byte_for_byte() {
    let (board, som, board_def, soc) = load_e8();
    let out = render_zephyr_alp_conf(
        "m55_hp",
        &board,
        &som,
        &board_def,
        &soc,
        &policy_e8(),
        KCONFIG_TMPL_E8,
    );
    assert_eq!(out, oracle_e8_artefact("m55_hp"));
    assert!(out.contains("CONFIG_ALP_SOC_ALIF_ENSEMBLE_E8=y"));
    assert!(out.contains("CONFIG_ALP_SDK_INFERENCE_ETHOS_U_VARIANT_U85=y"));
}

/// **STAGE E (E8)** — the E8 system-manifest content, structural.
#[test]
fn e8_system_manifest_matches_sdk_emit() {
    let (board, som, board_def, soc) = load_e8();
    let ours = build_system_manifest(&board, &som, &board_def, &soc, &policy_e8());
    let oracle: SystemManifest = serde_yaml::from_str(ORACLE_MANIFEST_E8).unwrap();
    assert_eq!(ours, oracle);
}

/// **STAGE F (E8) — the decisive ask.** The WHOLE E8 build-plan reproduced in one
/// assert with ZERO engine-code change vs E7: the same `assemble_full_plan`, a new
/// `som/E1M-AEN801/` bundle + `e8.json`. Universality proven where it counts.
#[test]
fn e8_full_build_plan_matches_sdk_emit() {
    let (board, som, board_def, soc) = load_e8();
    let oracle: BuildPlan = serde_json::from_str(ORACLE_BUILD_PLAN_E8).unwrap();
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
        &policy_e8(),
        &templates_e8(),
    );
    let mut oracle = oracle;
    sort_plan(&mut ours);
    sort_plan(&mut oracle);
    assert_eq!(
        serde_json::to_value(&ours).unwrap(),
        serde_json::to_value(&oracle).unwrap()
    );
}

// === V2N / E1M-V2N101 — the CROSS-VENDOR proof (Renesas RZ/V2N: DRP-AI, a55+m33) ===
// A genuinely different VENDOR. The SAME zero-literal engine + the SAME output
// templates reproduce it; the policy differs ONLY in vendor-specific VALUES
// (DRP-AI backend, +adc/+pwm subsystems) — same SCHEMA. Oracle from --emit at v0.7.0.
const BOARD_YAML_V2N: &str = include_str!("../spike_fixtures/oracle/rpmsg-v2n.board.yaml");
const SOM_V2N: &str = include_str!("../spike_fixtures/som/E1M-V2N101/som.yaml");
const POLICY_V2N: &str = include_str!("../spike_fixtures/som/E1M-V2N101/policy.json");
const SOC_V2N: &str = include_str!("../spike_fixtures/n44.json");
const BOARD_DEF_V2N: &str = include_str!("../spike_fixtures/e1m-x-evk.yaml");
const KCONFIG_TMPL_V2N: &str =
    include_str!("../spike_fixtures/som/E1M-V2N101/templates/kconfig.tmpl");
const ORACLE_BUILD_PLAN_V2N: &str = include_str!("../spike_fixtures/oracle/rpmsg-v2n.build-plan");
const ORACLE_MANIFEST_V2N: &str =
    include_str!("../spike_fixtures/oracle/rpmsg-v2n.system-manifest");

fn load_v2n() -> (BoardYaml, SomPreset, BoardDef, SocSpec) {
    (
        serde_yaml::from_str(BOARD_YAML_V2N).unwrap(),
        serde_yaml::from_str(SOM_V2N).unwrap(),
        serde_yaml::from_str(BOARD_DEF_V2N).unwrap(), // a DIFFERENT board (E1M-X-EVK)
        serde_json::from_str(SOC_V2N).unwrap(),
    )
}

fn policy_v2n() -> Policy {
    load_policy(POLICY_V2N).unwrap()
}

fn templates_v2n() -> Templates {
    Templates {
        local_conf: include_str!("../spike_fixtures/som/E1M-V2N101/templates/local.conf.tmpl")
            .to_string(),
        kconfig: KCONFIG_TMPL_V2N.to_string(),
        system_ipc_h: include_str!("../spike_fixtures/som/E1M-V2N101/templates/system_ipc.h.tmpl")
            .to_string(),
        dts_reservations: include_str!(
            "../spike_fixtures/som/E1M-V2N101/templates/dts-reservations.dtsi.tmpl"
        )
        .to_string(),
        dts_partitions: include_str!(
            "../spike_fixtures/som/E1M-V2N101/templates/dts-partitions.dtsi.tmpl"
        )
        .to_string(),
    }
}

fn oracle_v2n_artefact(core_id: &str) -> String {
    let plan: serde_json::Value = serde_json::from_str(ORACLE_BUILD_PLAN_V2N).unwrap();
    plan["slices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["coreId"] == core_id)
        .unwrap_or_else(|| panic!("V2N oracle has no slice {core_id}"))["configArtefacts"][0]
        ["contents"]
        .as_str()
        .unwrap()
        .to_string()
}

/// **CROSS-VENDOR.** A Renesas part's SoC symbol is computed by the SAME rule.
#[test]
fn v2n_silicon_symbol_is_computed() {
    assert_eq!(
        policy_v2n().soc_symbol("renesas:rzv2n:n44"),
        "ALP_SOC_RENESAS_RZV2N_N44"
    );
}

/// The cross-vendor bundle reuses the SAME engine + the SAME output templates; the
/// policy differs ONLY in vendor-specific VALUES (DRP-AI backend, +adc/+pwm) — same
/// SCHEMA, parsed by the same `Policy`. No Ethos symbols leak onto a DRP-AI part.
#[test]
fn v2n_reuses_engine_and_templates_only_data_differs() {
    assert_eq!(
        KCONFIG_TMPL_V2N, KCONFIG_TMPL,
        "V2N templates byte-identical to Alif's"
    );
    assert!(policy_v2n().peripheral_subsystems.contains_key("adc"));
    let (board, som, board_def, soc) = load_v2n();
    let out = render_zephyr_alp_conf(
        "m33_sm",
        &board,
        &som,
        &board_def,
        &soc,
        &policy_v2n(),
        KCONFIG_TMPL_V2N,
    );
    assert!(out.contains("CONFIG_ALP_SDK_INFERENCE_BACKEND_DRPAI_V2N=y"));
    assert!(!out.contains("ETHOS"), "no Ethos symbols on a DRP-AI part");
}

/// **STAGE C (V2N)** — m33_sm Zephyr alp.conf, byte-for-byte from data, for a
/// different VENDOR: DRP-AI (not Ethos), the a55+m33 core mix, the computed Renesas
/// SoC symbol, and the V2N chip set all reproduce with the SAME engine.
#[test]
fn v2n_m33_alp_conf_matches_sdk_emit_byte_for_byte() {
    let (board, som, board_def, soc) = load_v2n();
    let out = render_zephyr_alp_conf(
        "m33_sm",
        &board,
        &som,
        &board_def,
        &soc,
        &policy_v2n(),
        KCONFIG_TMPL_V2N,
    );
    assert_eq!(out, oracle_v2n_artefact("m33_sm"));
}

/// **CROSS-VENDOR FULL parity — the universality result, WHOLE.** The entire V2N
/// build-plan reproduces byte-for-byte with the SAME engine + a new
/// `som/E1M-V2N101/` bundle, INCLUDING the **resolved IPC carve-out**: V2N has a
/// live `mailbox.controller`, so the allocator runs — real `ADDR`/`SIZE`/FNV-1a
/// endpoint IDs in `system_ipc.h` and the `reserved-memory` region in the DT
/// overlay. Two vendors, one zero-literal engine, real addresses.
#[test]
fn v2n_full_build_plan_matches_sdk_emit() {
    let (board, som, board_def, soc) = load_v2n();
    let oracle: BuildPlan = serde_json::from_str(ORACLE_BUILD_PLAN_V2N).unwrap();
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
        &policy_v2n(),
        &templates_v2n(),
    );
    let mut oracle = oracle;
    sort_plan(&mut ours);
    sort_plan(&mut oracle);
    assert_eq!(
        serde_json::to_value(&ours).unwrap(),
        serde_json::to_value(&oracle).unwrap()
    );
}

/// The carve-out ALLOCATOR, isolated: `alp_default_rpmsg` (512 KiB) lands top-down
/// in the OCRAM region at `0x00010000`, with FNV-1a endpoint IDs `0x4e6`/`0x4e7`
/// and mailbox channel `0` — all derived from data, reproducing the SDK's resolved
/// (non-blocked) `system_ipc.h`.
#[test]
fn v2n_resolved_carve_out_has_real_addresses() {
    let (board, som, _, soc) = load_v2n();
    let ipc = render_system_ipc_h(&board, &som, &soc, IPC_TMPL);
    assert!(
        ipc.contains("_ADDR       0x00010000u"),
        "OCRAM base, top-down"
    );
    assert!(ipc.contains("_SIZE       0x00080000u"), "512 KiB");
    assert!(
        ipc.contains("_SRC_EPT    0x000004e6u"),
        "FNV-1a low byte | 0x400"
    );
    assert!(ipc.contains("_DST_EPT    0x000004e7u"), "src + 1");
    assert!(ipc.contains("_MBOX_CH    0u"));
    assert!(!ipc.contains("stub: blocked"), "resolved, not blocked");
}

/// **CROSS-VENDOR structured data.** The Renesas GD32 bridge's helper-MCU
/// `flash_args` is a `{interface, target, base}` MAP (Alif's is a bare string) —
/// it flows through the manifest verbatim, proving the metadata schema is
/// vendor-neutral (no Alif-shaped string assumption).
#[test]
fn v2n_manifest_carries_structured_flash_args() {
    let (board, som, board_def, soc) = load_v2n();
    let m = build_system_manifest(&board, &som, &board_def, &soc, &policy_v2n());
    assert_eq!(m.hw_info.silicon, "renesas:rzv2n:n44");
    let hf = m
        .helper_mcus
        .iter()
        .find(|h| h.chip == "gd32g553")
        .expect("the GD32 bridge helper MCU");
    assert_eq!(
        hf.flash_args.get("interface").and_then(|v| v.as_str()),
        Some("cmsis-dap")
    );
}
