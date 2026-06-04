// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE — not for dev.** 5th datapoint: pushing the "fully data" claim
//! to 100%. The two hardcoded registry tables in `alp_project.py` are the last
//! "code-as-data" residue; this shows each becomes either pure data or a pure
//! rule, with a tiny generic loader.
//!
//! Findings:
//!   * `_sku_family` (`{AEN:aen, V2N:v2n, V2M:v2n-m1, NX9:imx93}` + a regex whose
//!     alternation hardcodes the same tokens) is **genuine data** — `V2M→v2n-m1`
//!     is arbitrary, not derivable. → a JSON registry + a generic lookup; a new
//!     family is one JSON row, zero code (the valid-prefix set IS the data keys,
//!     so even the regex alternation disappears).
//!   * `_SILICON_TO_KCONFIG` (8 rows) is **not data at all — it's a pure rule**:
//!     every row equals `ALP_SOC_ + silicon.to_uppercase().replace(':','_')`. The
//!     table can be deleted and computed; the SoC-JSON's existence is the real
//!     whitelist.

use std::collections::BTreeMap;

use serde::Deserialize;

/// The SoM registry — DATA the SDK would ship (e.g. `metadata/registries/som.json`).
#[derive(Debug, Clone, Deserialize)]
pub struct SomRegistry {
    /// SKU family token (after `E1M-`) → metadata family directory.
    #[serde(rename = "skuPrefixToFamily")]
    pub sku_prefix_to_family: BTreeMap<String, String>,
}

impl SomRegistry {
    /// Resolve a SKU's family dir purely from data: the valid prefixes ARE the
    /// registry keys, so adding a family is a JSON row (no regex/code change).
    /// Longest-prefix match guards against any future prefix that is itself a
    /// prefix of another.
    pub fn family_for_sku(&self, sku: &str) -> Option<&str> {
        let rest = sku.strip_prefix("E1M-")?;
        self.sku_prefix_to_family
            .iter()
            .filter(|(prefix, _)| rest.starts_with(prefix.as_str()))
            .max_by_key(|(prefix, _)| prefix.len())
            .map(|(_, family)| family.as_str())
    }
}

/// `_SILICON_TO_KCONFIG` as the pure rule it actually is — no table needed.
/// `alif:ensemble:e7` → `ALP_SOC_ALIF_ENSEMBLE_E7`.
pub fn kconfig_for_silicon(silicon: &str) -> String {
    format!("ALP_SOC_{}", silicon.to_uppercase().replace(':', "_"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The draft data file the SDK would ship (verbatim from the Python dict).
    const SOM_REGISTRY_JSON: &str = r#"{
      "skuPrefixToFamily": { "AEN": "aen", "V2N": "v2n", "V2M": "v2n-m1", "NX9": "imx93" }
    }"#;

    fn registry() -> SomRegistry {
        serde_json::from_str(SOM_REGISTRY_JSON).unwrap()
    }

    // Parity with `_sku_family`, incl. the non-derivable V2M→v2n-m1 row.
    #[test]
    fn family_lookup_from_data() {
        let r = registry();
        assert_eq!(r.family_for_sku("E1M-AEN701"), Some("aen"));
        assert_eq!(r.family_for_sku("E1M-V2N102"), Some("v2n"));
        assert_eq!(r.family_for_sku("E1M-V2M101"), Some("v2n-m1")); // arbitrary → must be data
        assert_eq!(r.family_for_sku("E1M-NX9101"), Some("imx93"));
        assert_eq!(r.family_for_sku("E1M-ZZZ999"), None); // unknown → graceful
        assert_eq!(r.family_for_sku("NOTASKU"), None);
    }

    // The "add a family = one JSON row, zero code" property.
    #[test]
    fn new_family_is_pure_data() {
        let extended = r#"{
          "skuPrefixToFamily": { "AEN": "aen", "QRS": "qorvo-rs" }
        }"#;
        let r: SomRegistry = serde_json::from_str(extended).unwrap();
        assert_eq!(r.family_for_sku("E1M-QRS900"), Some("qorvo-rs"));
        assert_eq!(r.family_for_sku("E1M-AEN701"), Some("aen"));
    }

    // The Kconfig "table" is a pure rule — reproduce all 8 SDK rows exactly.
    #[test]
    fn kconfig_rule_reproduces_every_sdk_row() {
        let sdk_rows = [
            ("alif:ensemble:e3", "ALP_SOC_ALIF_ENSEMBLE_E3"),
            ("alif:ensemble:e4", "ALP_SOC_ALIF_ENSEMBLE_E4"),
            ("alif:ensemble:e5", "ALP_SOC_ALIF_ENSEMBLE_E5"),
            ("alif:ensemble:e6", "ALP_SOC_ALIF_ENSEMBLE_E6"),
            ("alif:ensemble:e7", "ALP_SOC_ALIF_ENSEMBLE_E7"),
            ("alif:ensemble:e8", "ALP_SOC_ALIF_ENSEMBLE_E8"),
            ("renesas:rzv2n:n44", "ALP_SOC_RENESAS_RZV2N_N44"),
            ("nxp:imx9:imx93", "ALP_SOC_NXP_IMX9_IMX93"),
        ];
        for (silicon, expected) in sdk_rows {
            assert_eq!(kconfig_for_silicon(silicon), expected, "silicon {silicon}");
        }
    }

    // A new silicon needs no table edit — the rule just applies (the SoC JSON's
    // existence is the real whitelist).
    #[test]
    fn new_silicon_needs_no_table_edit() {
        assert_eq!(
            kconfig_for_silicon("alif:ensemble:e9"),
            "ALP_SOC_ALIF_ENSEMBLE_E9"
        );
    }
}
