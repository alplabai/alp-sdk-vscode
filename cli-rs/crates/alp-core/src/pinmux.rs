// SPDX-License-Identifier: Apache-2.0
//! Pinmux capability table (`metadata/pinmux/<family>.yaml`, schema
//! `pinmux-capability-v1`): each E1M edge pad and the silicon function backing
//! it. Rust twin of the extension's `@alp-sdk/core/pinmux/{models,parse}` — the
//! serialized field names match `PinmuxPad`/`PinmuxTable` there so the CLI
//! envelope is consumed without a second parser.

/// One row of a pinmux capability table: an E1M edge pad and the silicon
/// function backing it. `silicon_peripheral` is empty for plain GPIO.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PinmuxPad {
    #[serde(rename = "e1mPad")]
    pub e1m_pad: String,
    #[serde(rename = "e1mFunction")]
    pub e1m_function: String,
    pub owner: String,
    #[serde(rename = "siliconPeripheral")]
    pub silicon_peripheral: String,
    #[serde(rename = "siliconPad")]
    pub silicon_pad: String,
}

/// A parsed `metadata/pinmux/<family>.yaml` capability table.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PinmuxTable {
    pub family: String,
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub pads: Vec<PinmuxPad>,
}

#[derive(serde::Deserialize)]
struct RawTable {
    family: Option<String>,
    display_name: Option<String>,
    pads: Option<Vec<RawPad>>,
}

#[derive(serde::Deserialize)]
struct RawPad {
    e1m_pad: Option<String>,
    e1m_function: Option<String>,
    owner: Option<String>,
    silicon_peripheral: Option<String>,
    silicon_pad: Option<String>,
}

/// Parse a `pinmux-capability-v1` YAML document into a `PinmuxTable`. Fail-soft
/// (never errors): a malformed document yields an empty table; a pad missing
/// `e1m_pad` or `e1m_function` is dropped; other string fields default to "".
/// Mirrors the extension's `parsePinmuxTable`.
pub fn parse_pinmux_table(text: &str) -> PinmuxTable {
    let raw: RawTable = serde_yaml::from_str(text).unwrap_or(RawTable {
        family: None,
        display_name: None,
        pads: None,
    });
    let pads = raw
        .pads
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            Some(PinmuxPad {
                e1m_pad: p.e1m_pad?,
                e1m_function: p.e1m_function?,
                owner: p.owner.unwrap_or_default(),
                silicon_peripheral: p.silicon_peripheral.unwrap_or_default(),
                silicon_pad: p.silicon_pad.unwrap_or_default(),
            })
        })
        .collect();
    PinmuxTable {
        family: raw.family.unwrap_or_default(),
        display_name: raw.display_name,
        pads,
    }
}

/// Resolve a SoM SKU to its pinmux family stem (the `metadata/pinmux/<stem>.yaml`
/// basename). Mirrors the extension's `pinmuxFamilyForSku` prefix table; returns
/// `None` for an unrecognized SKU.
pub fn pinmux_family_for_sku(sku: &str) -> Option<&'static str> {
    const TABLE: &[(&str, &str)] = &[
        ("E1M-AEN", "aen"),
        ("E1M-NX9", "imx93"),
        ("E1M-V2N", "v2n"),
        ("E1M-V2M", "v2n-m1"),
    ];
    TABLE
        .iter()
        .find(|(prefix, _)| sku.starts_with(prefix))
        .map(|(_, stem)| *stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
schemaVersion: pinmux-capability-v1
family: aen
display_name: \"E1M-AEN (Alif Ensemble)\"
pads:
  - { e1m_pad: \"A3\", e1m_function: \"PWM6\", owner: \"alif\", silicon_peripheral: \"UT3_T1_C\", silicon_pad: \"P10_7\" }
  - { e1m_pad: \"A15\", e1m_function: \"ANA_S0\", owner: \"alif\", silicon_peripheral: \"\", silicon_pad: \"P0_0\" }
";

    #[test]
    fn parses_family_display_and_pads() {
        let t = parse_pinmux_table(SAMPLE);
        assert_eq!(t.family, "aen");
        assert_eq!(t.display_name.as_deref(), Some("E1M-AEN (Alif Ensemble)"));
        assert_eq!(t.pads.len(), 2);
        assert_eq!(t.pads[0].e1m_pad, "A3");
        assert_eq!(t.pads[0].e1m_function, "PWM6");
        assert_eq!(t.pads[0].silicon_pad, "P10_7");
        assert_eq!(t.pads[1].silicon_peripheral, ""); // plain GPIO
    }

    #[test]
    fn drops_pads_missing_required_keys_and_defaults_strings() {
        let t = parse_pinmux_table(
            "family: aen\npads:\n  - { e1m_pad: \"A3\" }\n  - { e1m_pad: \"A4\", e1m_function: \"PWM4\" }\n",
        );
        // first pad has no e1m_function -> dropped; second keeps, owner defaults to "".
        assert_eq!(t.pads.len(), 1);
        assert_eq!(t.pads[0].e1m_function, "PWM4");
        assert_eq!(t.pads[0].owner, "");
    }

    #[test]
    fn fail_soft_on_malformed_yaml() {
        let t = parse_pinmux_table(": : not yaml : :");
        assert_eq!(t.family, "");
        assert!(t.pads.is_empty());
    }

    #[test]
    fn sku_to_family_prefix_map() {
        assert_eq!(pinmux_family_for_sku("E1M-AEN701"), Some("aen"));
        assert_eq!(pinmux_family_for_sku("E1M-V2N44"), Some("v2n"));
        assert_eq!(pinmux_family_for_sku("E1M-V2M01"), Some("v2n-m1"));
        assert_eq!(pinmux_family_for_sku("E1M-NX93"), Some("imx93"));
        assert_eq!(pinmux_family_for_sku("E1M-UNKNOWN"), None);
    }
}
