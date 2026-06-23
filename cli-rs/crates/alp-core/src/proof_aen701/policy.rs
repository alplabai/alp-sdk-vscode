// SPDX-License-Identifier: Apache-2.0
//! **PARSER layer** — POLICY: the per-silicon/board/OS build rules, loaded from
//! DATA (`policy.json`). The engine reads these and applies them generically; NO
//! silicon/board/OS config knowledge is hardcoded in the engine (RFC #235: rules
//! are data). The loader is `schemaVersion`-checked — an unknown schema is
//! rejected loud, never silently mis-derived.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::macros::check_schema_version;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Policy {
    pub(crate) schema_version: u32,
    pub(crate) base_kconfig: Vec<String>,
    pub(crate) soc_symbol_prefix: String,
    pub(crate) board_define_prefix: String,
    pub(crate) chip_kconfig_prefix: String,
    pub(crate) yocto_lib_prefix: String,
    pub(crate) block_slugs: Vec<String>,
    pub(crate) on_module_non_chip: Vec<String>,
    pub(crate) log_levels: BTreeMap<String, u8>,
    pub(crate) peripheral_subsystems: BTreeMap<String, String>,
    /// ALP-B010 coverage aliases: kind → SoC-inventory kinds that satisfy it
    /// (empty ⇒ always-present software abstraction, e.g. `sensor`).
    #[serde(default)]
    pub(crate) peripheral_aliases: BTreeMap<String, Vec<String>>,
    // NOTE: pad/pin rules (the ALP-B013 allowlist, conflict severities) live in
    // the SEPARATE pin-policy.json (see `pinmux::PinPolicy`), not in the build
    // policy — silicon pin facts + their rules are their own concern.
    pub(crate) chip_subsystems: BTreeMap<String, Vec<String>>,
    pub(crate) library_kconfig: BTreeMap<String, Vec<String>>,
    pub(crate) flash: BTreeMap<String, FlashPolicy>,
    pub(crate) inference: InferencePolicy,
    /// Filesystem profiles for the storage-mounts writer (zero C literals leak in).
    #[serde(default)]
    pub(crate) storage: StoragePolicy,
    /// Secure-boot / TF-M rule data (signing algos, swap modes, attestation roots).
    #[serde(default)]
    pub(crate) secure: SecurePolicy,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoragePolicy {
    /// fs name → its Zephyr mount profile; `{name}`/`{mount}` placeholders are
    /// filled by the engine. The C struct skeleton is data, not engine literal.
    #[serde(default)]
    pub(crate) fs_profiles: BTreeMap<String, FsProfile>,
    /// fs name → the per-slice `alp.conf` Kconfig lines that enable it (distinct
    /// from `fsProfiles` — e.g. fat → `CONFIG_FAT_FILESYSTEM_ELM`, not `<ff.h>`).
    #[serde(default)]
    pub(crate) fs_kconfig: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsProfile {
    /// The `#include` line emitted once when any mount uses this fs.
    #[serde(default)]
    pub(crate) include: String,
    /// The `.type` value (`FS_LITTLEFS`, `FS_FATFS`, `FS_EXT2`).
    #[serde(default)]
    pub(crate) fs_type: String,
    /// The per-mount declaration line (`{name}`-templated); empty ⇒ none (ext4).
    #[serde(default)]
    pub(crate) declare: String,
    /// The `.fs_data` value (`{name}`-templated); empty ⇒ omit the `.fs_data` line.
    #[serde(default)]
    pub(crate) fs_data: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecurePolicy {
    /// signing algorithm → SB_CONFIG line(s) (`\n`-joined for RSA's two lines).
    #[serde(default)]
    pub(crate) signing_algorithms: BTreeMap<String, String>,
    /// MCUboot swap mode → SB_CONFIG line.
    #[serde(default)]
    pub(crate) swap_algorithms: BTreeMap<String, String>,
    /// `boot.build_type` → canonical CMake TF-M build type.
    #[serde(default)]
    pub(crate) tfm_build_type_aliases: BTreeMap<String, String>,
    /// PSA persistent-slot count default when the board omits it.
    #[serde(default)]
    pub(crate) tfm_default_persistent_slots: u32,
    /// attestation root → its comment lines + the CONFIG symbol (none ⇒ absent).
    #[serde(default)]
    pub(crate) attestation_roots: BTreeMap<String, AttestationRoot>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct AttestationRoot {
    #[serde(default)]
    pub(crate) comment: Vec<String>,
    #[serde(default)]
    pub(crate) config: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct FlashPolicy {
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) args: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InferencePolicy {
    pub(crate) tflm_backend: String,
    pub(crate) tflm_kernel: BTreeMap<String, String>,
    /// The AI-accelerator backend Kconfig, keyed by silicon ref (with a
    /// `default`). Vendor-neutral: `default`→Ethos-U on Alif, `renesas:rzv2n:n44`
    /// →DRP-AI, … — the engine looks it up by silicon, it does not know "Ethos".
    pub(crate) accelerator_backend: BTreeMap<String, String>,
    /// Prefix for per-NPU variant symbols (Ethos-U `…_VARIANT_U85`); only used
    /// when the SoM lists `npu_population[].variant` (DRP-AI has none).
    pub(crate) npu_variant_prefix: String,
}

impl Policy {
    /// **The `_SILICON_TO_KCONFIG` dissolution** — the SoC symbol is *computed*
    /// from the silicon ref + the policy prefix; no lookup table. The membership
    /// allowlist is "the SoC spec exists" (the caller already has it).
    pub(crate) fn soc_symbol(&self, silicon: &str) -> String {
        format!(
            "{}{}",
            self.soc_symbol_prefix,
            silicon.to_uppercase().replace(':', "_")
        )
    }
    /// A chip/block slug → its Kconfig symbol (block vs chip from the policy set).
    pub(crate) fn chip_symbol(&self, slug: &str) -> String {
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
    pub(crate) fn lib_recipe(&self, lib: &str) -> String {
        format!("{}{}", self.yocto_lib_prefix, lib.replace('_', "-"))
    }
    /// The Zephyr subsystems a chip needs (empty for an unknown chip).
    pub(crate) fn subsystems_of(&self, slug: &str) -> Vec<String> {
        self.chip_subsystems.get(slug).cloned().unwrap_or_default()
    }
    /// (flash_method, flash_args) for an OS; `$machine` in an arg is substituted.
    pub(crate) fn flash_for(
        &self,
        os: &str,
        machine: Option<&str>,
    ) -> (String, BTreeMap<String, String>) {
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
pub(crate) const SUPPORTED_POLICY_SCHEMA: u32 = 1;

/// Load + version-check a SoM bundle's `policy.json`.
pub(crate) fn load_policy(json: &str) -> Result<Policy, String> {
    let p: Policy = serde_json::from_str(json).map_err(|e| format!("invalid policy: {e}"))?;
    check_schema_version!("policy", p.schema_version, SUPPORTED_POLICY_SCHEMA);
    Ok(p)
}
