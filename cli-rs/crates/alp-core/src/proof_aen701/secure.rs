// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer (derivation)** — the SECURE-WORLD config. Reproduces the SDK's
//! `emit_tfm_sysbuild_conf` (P2): the TF-M sysbuild child-image overlay derived
//! from board.yaml `security.psa:` + `boot.build_type`, with every silicon/secure
//! specific (signing/swap Kconfig, build-type aliases, attestation roots) pushed
//! into `policy.secure` — the engine carries zero secure literals. Gated like the
//! NPU-dispatch capability: emitted only when the project opts into TF-M.

use super::metadata::*;
use super::policy::Policy;

/// Render the TF-M sysbuild conf from `security.psa:`. Returns `""` when the
/// project omits `security.psa:` or sets `tfm: false` (PSA Crypto then runs
/// entirely non-secure — no child image). The header banner is per-SoM template
/// DATA (it names the silicon's secure boundary core); the body is all facts.
pub(crate) fn render_tfm_sysbuild_conf(board: &BoardYaml, p: &Policy, tmpl: &str) -> String {
    let Some(psa) = board.security.as_ref().and_then(|s| s.psa.as_ref()) else {
        return String::new();
    };
    if psa.tfm != Some(true) {
        return String::new();
    }

    // TF-M build type follows the project's MCUboot `boot.build_type` (default
    // Release) so the secure + bootloader artefacts ship the same flavour;
    // canonicalised via the policy alias map (passed through verbatim otherwise).
    let raw = board
        .boot
        .as_ref()
        .and_then(|b| b.build_type.clone())
        .unwrap_or_else(|| "Release".into());
    let tfm_build_type = p
        .secure
        .tfm_build_type_aliases
        .get(&raw.to_lowercase())
        .cloned()
        .unwrap_or(raw);

    let header = tmpl.trim_end();
    let mut lines: Vec<String> = vec![
        "SB_CONFIG_TFM=y".into(),
        format!("SB_CONFIG_TFM_BUILD_TYPE={tfm_build_type}"),
    ];

    let slots = psa
        .persistent_slots
        .unwrap_or(p.secure.tfm_default_persistent_slots);
    lines.push(format!("CONFIG_PSA_CRYPTO_PERSISTENT_SLOT_COUNT={slots}"));

    if let Some(its) = psa.its_storage.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("CONFIG_PSA_CRYPTO_ITS_BACKING_STORE=\"{its}\""));
    }
    if let Some(ps) = psa.ps_storage.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("CONFIG_PSA_CRYPTO_PS_BACKING_STORE=\"{ps}\""));
    }

    let att = psa
        .attestation_root
        .as_deref()
        .unwrap_or("none")
        .to_lowercase();
    if let Some(root) = p.secure.attestation_roots.get(&att) {
        lines.extend(root.comment.iter().cloned());
        if !root.config.is_empty() {
            lines.push(root.config.clone());
        }
    }

    format!("{}\n\n{}\n", header, lines.join("\n"))
}
