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

/// Render the MCUboot sysbuild conf from `boot:` (the SDK's `emit_sysbuild_conf`,
/// P3 — the signing path). `""` when the project omits `boot:` (stock per-family
/// defaults apply). The signing algorithm + swap mode map to SB_CONFIG via
/// `policy.secure`; slot/scratch sizes are `size_kib * 1024`. The engine never
/// names a signing symbol. (The signed *artefact* itself is imgtool's job — out
/// of scope; only the conf the build consumes is reproduced.)
pub(crate) fn render_sysbuild_conf(board: &BoardYaml, p: &Policy, tmpl: &str) -> String {
    let Some(boot) = board.boot.as_ref() else {
        return String::new();
    };
    let method = boot.method.as_deref().unwrap_or("mcuboot").to_lowercase();
    if method == "none" {
        return "# Auto-generated from board.yaml `boot:` block.\nSB_CONFIG_BOOTLOADER_MCUBOOT=n\n"
            .to_string();
    }
    if method != "mcuboot" {
        return String::new();
    }

    let header = tmpl.trim_end();
    let mut lines: Vec<String> = vec!["SB_CONFIG_BOOTLOADER_MCUBOOT=y".into()];

    if let Some(sign) = &boot.signing {
        if let Some(algo) = sign.algorithm.as_deref() {
            if let Some(kc) = p.secure.signing_algorithms.get(&algo.to_lowercase()) {
                lines.push(kc.clone()); // RSA carries two `\n`-joined lines
            }
        }
        if let Some(kf) = sign.key_file.as_deref().filter(|s| !s.is_empty()) {
            lines.push(format!("SB_CONFIG_BOOT_SIGNATURE_KEY_FILE=\"{kf}\""));
        }
    }
    if let Some(slots) = &boot.slots {
        if let Some(sz) = slots.primary.as_ref().and_then(|s| s.size_kib) {
            lines.push(format!(
                "SB_CONFIG_BOOT_PRIMARY_PARTITION_SIZE={}",
                sz * 1024
            ));
        }
        if let Some(sz) = slots.secondary.as_ref().and_then(|s| s.size_kib) {
            lines.push(format!(
                "SB_CONFIG_BOOT_SECONDARY_PARTITION_SIZE={}",
                sz * 1024
            ));
        }
    }
    let swap = boot
        .swap_algorithm
        .as_deref()
        .unwrap_or("scratch")
        .to_lowercase();
    if let Some(kc) = p.secure.swap_algorithms.get(&swap) {
        lines.push(kc.clone());
    }
    if swap == "scratch" {
        if let Some(sz) = boot.scratch_size_kib {
            lines.push(format!(
                "SB_CONFIG_BOOT_SCRATCH_PARTITION_SIZE={}",
                sz * 1024
            ));
        }
    }
    if boot.anti_rollback == Some(true) {
        lines.push("SB_CONFIG_BOOT_COUNTERS_MCUBOOT=y".into());
    }

    format!("{}\n\n{}\n", header, lines.join("\n"))
}
