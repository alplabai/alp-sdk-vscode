// SPDX-License-Identifier: Apache-2.0
//! **PARSER layer — the pin/peripheral domain, kept apart from the build policy.**
//! Two separate sources (RFC #235): a per-silicon pin-mux CAPABILITY table
//! ([`PinMux`], METADATA — a silicon fact: which E1M pad carries which function,
//! and where it lands on silicon, derived verbatim from the SDK's `from-*.tsv`
//! pinout) and a pin VALIDATION [`PinPolicy`] (the rules: conflict severities +
//! allowlists). The rule engine reads both → semantic [`Diagnostic`]s **and** a
//! query API (`function_of` / `pads_for_peripheral` / `owner_of`) that is the
//! validation source the CLI + VS Code extension drive an advanced pin-mux UI from.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use super::macros::check_schema_version;
use super::metadata::BoardYaml;
use super::validate::{Diagnostic, Severity};

pub(crate) const SUPPORTED_PINMUX_SCHEMA: u32 = 1;
pub(crate) const SUPPORTED_PIN_POLICY_SCHEMA: u32 = 1;

/// The per-silicon pin-mux capability table (METADATA). Authoritative answer to
/// "which pin can carry which peripheral signal" — one entry per E1M connector pad.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PinMux {
    pub(crate) schema_version: u32,
    pub(crate) silicon: String,
    /// E1M pad (the connector ball, e.g. `AD2`) → its standardized function.
    #[serde(default)]
    pub(crate) pads: BTreeMap<String, PadFunction>,
    /// Board-facing E1M name (`E1M_I2C0`, the whole bus) → the per-signal
    /// functions it covers (`[I2C0_SDA, I2C0_SCL]`). The board↔pin-mux bridge.
    #[serde(default)]
    pub(crate) aliases: BTreeMap<String, Vec<String>>,
}

/// One E1M pad's fixed function: what signal it carries, who owns it (the Alif SoC
/// directly, or the on-module CC3501E), the silicon pad it lands on, and the
/// silicon peripheral instance.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PadFunction {
    pub(crate) function: String,
    pub(crate) owner: String,
    /// The silicon pad (e.g. `P5_7`, or `GPIO_33` on the CC3501E).
    pub(crate) silicon: String,
    #[serde(default)]
    pub(crate) peripheral: Option<String>,
}

/// The pin/peripheral VALIDATION rules (POLICY) — separate from the build policy.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PinPolicy {
    pub(crate) schema_version: u32,
    /// Conflict-code key → `"error"` | `"warning"`.
    #[serde(default)]
    pub(crate) conflict_severity: BTreeMap<String, String>,
    /// ALP-B013 allowlist (E1M routing-level pad double-claims). Lives here, not
    /// in the build policy.
    #[serde(default)]
    pub(crate) pad_dual_claim_allowlist: Vec<String>,
}

pub(crate) fn load_pinmux(yaml: &str) -> Result<PinMux, String> {
    let m: PinMux = serde_yaml::from_str(yaml).map_err(|e| format!("invalid pinmux: {e}"))?;
    check_schema_version!("pinmux", m.schema_version, SUPPORTED_PINMUX_SCHEMA);
    Ok(m)
}

pub(crate) fn load_pin_policy(json: &str) -> Result<PinPolicy, String> {
    let p: PinPolicy =
        serde_json::from_str(json).map_err(|e| format!("invalid pin-policy: {e}"))?;
    check_schema_version!("pin-policy", p.schema_version, SUPPORTED_PIN_POLICY_SCHEMA);
    Ok(p)
}

/// The silicon pad ignoring its alternate-function suffix (`P4_1/JTAG0_TDATA1` →
/// `P4_1`) — two E1M pads sharing a base silicon pad are mutually exclusive.
fn base_silicon(pad: &str) -> &str {
    pad.split('/').next().unwrap_or(pad)
}

impl PinMux {
    // --- the validation-source query API (CLI + extension) ---

    /// The standardized function on an E1M `pad` (`None` if the pad is unknown).
    pub(crate) fn function_of(&self, pad: &str) -> Option<&str> {
        self.pads.get(pad).map(|f| f.function.as_str())
    }

    /// Who reaches the silicon for this E1M `pad`: `alif` (direct) or `cc3501e`
    /// (dispatched through the on-module coprocessor).
    pub(crate) fn owner_of(&self, pad: &str) -> Option<&str> {
        self.pads.get(pad).map(|f| f.owner.as_str())
    }

    /// The silicon pad an E1M `pad` lands on.
    pub(crate) fn silicon_pad_of(&self, pad: &str) -> Option<&str> {
        self.pads.get(pad).map(|f| f.silicon.as_str())
    }

    /// The E1M pad carrying exactly `function` (functions are unique per pad).
    pub(crate) fn pad_for_function(&self, function: &str) -> Option<&str> {
        self.pads
            .iter()
            .find(|(_, f)| f.function == function)
            .map(|(pad, _)| pad.as_str())
    }

    /// Every E1M pad whose function belongs to `peripheral` (a function prefix,
    /// e.g. `I2C0` → `[AD2, AE2]`, `SPI1` → the CC3501E pads). The legal set a
    /// pin-picker offers for a peripheral — sorted, deterministic.
    pub(crate) fn pads_for_peripheral(&self, peripheral: &str) -> Vec<String> {
        self.pads
            .iter()
            .filter(|(_, f)| f.function.starts_with(peripheral))
            .map(|(pad, _)| pad.clone())
            .collect()
    }

    /// Is `pad` a known E1M pad on this silicon?
    pub(crate) fn is_known(&self, pad: &str) -> bool {
        self.pads.contains_key(pad)
    }

    /// **The board↔pin-mux bridge** — resolve a board-facing E1M name (`E1M_I2C0`)
    /// to the per-signal functions it covers. Tries the `aliases` map first
    /// (grouped names → signal sets), then falls back to a bare `E1M_`-stripped
    /// name that is itself a known function (`E1M_PWM1` → `PWM1`). `None` if the
    /// name resolves to neither (→ ALP-P004).
    pub(crate) fn resolve_e1m(&self, name: &str) -> Option<Vec<String>> {
        if let Some(funcs) = self.aliases.get(name) {
            return Some(funcs.clone());
        }
        let bare = name.strip_prefix("E1M_").unwrap_or(name);
        self.pad_for_function(bare).map(|_| vec![bare.to_string()])
    }
}

impl PinPolicy {
    fn severity(&self, key: &str, default: Severity) -> Severity {
        match self.conflict_severity.get(key).map(String::as_str) {
            Some("warning") => Severity::Warning,
            Some("error") => Severity::Error,
            _ => default,
        }
    }
}

/// One concrete pin assignment a board/app makes: `owner` (the peripheral or
/// role) drives `function` on E1M `pad`.
#[derive(Debug, Clone)]
pub(crate) struct PinAssignment {
    pub(crate) pad: String,
    pub(crate) function: String,
    pub(crate) owner: String,
}

/// **The pin rule engine** — validate a set of pin assignments against the
/// silicon pin-mux (facts) + the pin policy (rules). Exactly what the
/// CLI/extension calls to validate a pin configuration before a build.
///
/// - **ALP-P001** — an unknown E1M pad, or a function the pad does not carry.
/// - **ALP-P002** — two owners contend for one E1M pad.
/// - **ALP-P003** — two E1M pads share one silicon pad (mutually exclusive).
pub(crate) fn check_assignments(
    pinmux: &PinMux,
    policy: &PinPolicy,
    assignments: &[PinAssignment],
) -> Vec<Diagnostic> {
    let mut diags = Vec::new();

    // P001 — unknown pad, or a function the pad cannot carry.
    for a in assignments {
        match pinmux.function_of(&a.pad) {
            None => diags.push(Diagnostic {
                code: "ALP-P001",
                severity: policy.severity("padFunctionUnsupported", Severity::Error),
                message: format!(
                    "'{}' uses E1M pad {}, which does not exist on silicon {}",
                    a.owner, a.pad, pinmux.silicon
                ),
                hint: Some("check the E1M pad name against the silicon's pin-mux".to_string()),
            }),
            Some(real) if real != a.function => diags.push(Diagnostic {
                code: "ALP-P001",
                severity: policy.severity("padFunctionUnsupported", Severity::Error),
                message: format!(
                    "'{}' drives {} on E1M pad {}, but that pad carries {} on silicon {}",
                    a.owner, a.function, a.pad, real, pinmux.silicon
                ),
                hint: pinmux.pad_for_function(&a.function).map(|p| {
                    format!(
                        "function {} is on E1M pad {} — use that pad instead",
                        a.function, p
                    )
                }),
            }),
            Some(_) => {}
        }
    }

    // P002 — two assignments contend for the same E1M pad.
    let mut by_pad: BTreeMap<&str, Vec<&PinAssignment>> = BTreeMap::new();
    for a in assignments {
        by_pad.entry(a.pad.as_str()).or_default().push(a);
    }
    for (pad, claims) in &by_pad {
        if claims.len() > 1 {
            let who = claims
                .iter()
                .map(|a| format!("{} ({})", a.function, a.owner))
                .collect::<Vec<_>>()
                .join(", ");
            diags.push(Diagnostic {
                code: "ALP-P002",
                severity: policy.severity("padContention", Severity::Error),
                message: format!(
                    "E1M pad {pad} is claimed by multiple owners: {who} — a pad carries one \
                     function at a time"
                ),
                hint: Some("give one owner a different pad (see pads_for_peripheral)".to_string()),
            });
        }
    }

    // P003 — two DIFFERENT E1M pads landing on one silicon pad are mutually
    // exclusive (only one can be muxed in). Derived from the `silicon` fact.
    let mut by_silicon: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for a in assignments {
        if let Some(sil) = pinmux.silicon_pad_of(&a.pad) {
            by_silicon
                .entry(base_silicon(sil))
                .or_default()
                .insert(a.pad.as_str());
        }
    }
    for (sil, pads) in &by_silicon {
        if pads.len() > 1 {
            diags.push(Diagnostic {
                code: "ALP-P003",
                severity: policy.severity("exclusivityViolation", Severity::Error),
                message: format!(
                    "E1M pads {:?} all land on silicon pad {sil} — only one can be muxed in at a time",
                    pads
                ),
                hint: Some("drop all but one of these pads — they are the same physical pin".to_string()),
            });
        }
    }

    diags
}

/// **End-to-end board pin validation** — the real pipeline: read a `board.yaml`'s
/// active `pins`, BRIDGE each E1M name to its pin-mux functions (`resolve_e1m`),
/// resolve those to silicon pads, and run the rule engine. A name that bridges to
/// nothing is **ALP-P004**. Functions the silicon does not own directly (CC3501E-
/// dispatched, absent from `pads`) are skipped here — they are validated via the
/// SoM `pad_routes` (ALP-B014). This is what a CLI/extension calls to validate a
/// board's pin config against the silicon, with no synthetic input.
pub(crate) fn check_board_pins(
    board: &BoardYaml,
    pinmux: &PinMux,
    policy: &PinPolicy,
) -> Vec<Diagnostic> {
    let mut diags = Vec::new();
    let mut assignments = Vec::new();
    for pin in &board.pins {
        match pinmux.resolve_e1m(&pin.e1m) {
            Some(funcs) => {
                for f in &funcs {
                    if let Some(pad) = pinmux.pad_for_function(f) {
                        assignments.push(PinAssignment {
                            pad: pad.to_string(),
                            function: f.clone(),
                            owner: pin.e1m.clone(),
                        });
                    }
                }
            }
            None => diags.push(Diagnostic {
                code: "ALP-P004",
                severity: policy.severity("unknownBoardPin", Severity::Error),
                message: format!(
                    "board pin '{}' is not a known E1M pad on silicon {} (no pin-mux entry or alias)",
                    pin.e1m, pinmux.silicon
                ),
                hint: Some(
                    "check the E1M name against the silicon's pin-mux `pads` + `aliases`"
                        .to_string(),
                ),
            }),
        }
    }
    diags.extend(check_assignments(pinmux, policy, &assignments));
    diags
}
