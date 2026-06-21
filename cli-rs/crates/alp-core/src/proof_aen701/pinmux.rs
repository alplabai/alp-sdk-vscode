// SPDX-License-Identifier: Apache-2.0
//! **PARSER layer — the pin/peripheral domain, kept apart from the build policy.**
//! Two separate sources (RFC #235): a per-silicon pin-mux CAPABILITY table
//! ([`PinMux`], METADATA — a silicon fact: which pad carries which signal) and a
//! pin VALIDATION [`PinPolicy`] (the rules: conflict severities + allowlists).
//! The rule engine reads both → semantic [`Diagnostic`]s **and** a query API
//! (`functions_of` / `valid_pads_for` / `pad_supports`) that is the validation
//! source the CLI + VS Code extension drive an advanced pin-mux UI from.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::macros::check_schema_version;
use super::validate::{Diagnostic, Severity};

pub(crate) const SUPPORTED_PINMUX_SCHEMA: u32 = 1;
pub(crate) const SUPPORTED_PIN_POLICY_SCHEMA: u32 = 1;

/// The per-silicon pin-mux capability table (METADATA). Authoritative answer to
/// "which pin can carry which peripheral signal".
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PinMux {
    pub(crate) schema_version: u32,
    pub(crate) silicon: String,
    /// pad → the signal functions it can mux to (e.g. `P0_3 → [GPIO, I2C0_SDA]`).
    #[serde(default)]
    pub(crate) pads: BTreeMap<String, Vec<String>>,
    /// peripheral → signal → candidate pads (the inverse, for `valid_pads_for`).
    #[serde(default)]
    pub(crate) peripherals: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    /// Alternate-function blocks: pads that may serve only one peripheral at a
    /// time. Using a block for two different peripherals is ALP-P003.
    #[serde(default)]
    pub(crate) exclusivity_groups: Vec<Vec<String>>,
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

impl PinMux {
    // --- the validation-source query API (CLI + extension) ---

    /// Every signal function `pad` can mux to (empty if the pad is unknown).
    pub(crate) fn functions_of(&self, pad: &str) -> Vec<String> {
        self.pads.get(pad).cloned().unwrap_or_default()
    }

    /// The candidate pads a `peripheral`'s `signal` can route to — the legal set
    /// a pin-picker offers (empty if unknown).
    pub(crate) fn valid_pads_for(&self, peripheral: &str, signal: &str) -> Vec<String> {
        self.peripherals
            .get(peripheral)
            .and_then(|sigs| sigs.get(signal))
            .cloned()
            .unwrap_or_default()
    }

    /// Can `pad` physically carry `signal`? The single assignment-validity check
    /// the extension calls on every edit.
    pub(crate) fn pad_supports(&self, pad: &str, signal: &str) -> bool {
        self.pads
            .get(pad)
            .is_some_and(|fns| fns.iter().any(|f| f == signal))
    }

    /// All pads that can carry `signal` (across every peripheral) — used to
    /// suggest alternatives in an ALP-P001 hint.
    fn pads_with_signal(&self, signal: &str) -> Vec<String> {
        self.pads
            .iter()
            .filter(|(_, fns)| fns.iter().any(|f| f == signal))
            .map(|(pad, _)| pad.clone())
            .collect()
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
/// role claiming it) puts `signal` on silicon `pad`.
#[derive(Debug, Clone)]
pub(crate) struct PinAssignment {
    pub(crate) pad: String,
    pub(crate) signal: String,
    pub(crate) owner: String,
}

/// **The pin rule engine** — validate a set of pin assignments against the
/// silicon pin-mux (facts) + the pin policy (rules). This is exactly what the
/// CLI/extension calls to validate a pin configuration before a build.
///
/// - **ALP-P001** — the pad physically cannot carry the signal.
/// - **ALP-P002** — two owners contend for one pad (a pad carries one function).
/// - **ALP-P003** — two different peripherals use one alternate-function block.
pub(crate) fn check_assignments(
    pinmux: &PinMux,
    policy: &PinPolicy,
    assignments: &[PinAssignment],
) -> Vec<Diagnostic> {
    let mut diags = Vec::new();

    // P001 — signal not supported by the pad.
    for a in assignments {
        if !pinmux.pad_supports(&a.pad, &a.signal) {
            diags.push(Diagnostic {
                code: "ALP-P001",
                severity: policy.severity("padFunctionUnsupported", Severity::Error),
                message: format!(
                    "'{}' assigns {} to pad {}, but that pad cannot carry it on silicon {} \
                     (supports: {:?})",
                    a.owner,
                    a.signal,
                    a.pad,
                    pinmux.silicon,
                    pinmux.functions_of(&a.pad)
                ),
                hint: Some(format!(
                    "move {} to a pad that supports it: {:?}",
                    a.signal,
                    pinmux.pads_with_signal(&a.signal)
                )),
            });
        }
    }

    // P002 — two assignments contend for the same pad.
    let mut by_pad: BTreeMap<&str, Vec<&PinAssignment>> = BTreeMap::new();
    for a in assignments {
        by_pad.entry(a.pad.as_str()).or_default().push(a);
    }
    for (pad, claims) in &by_pad {
        if claims.len() > 1 {
            let who = claims
                .iter()
                .map(|a| format!("{} ({})", a.signal, a.owner))
                .collect::<Vec<_>>()
                .join(", ");
            diags.push(Diagnostic {
                code: "ALP-P002",
                severity: policy.severity("padContention", Severity::Error),
                message: format!(
                    "pad {pad} is claimed by multiple signals: {who} — a pad carries one \
                     function at a time"
                ),
                hint: Some(
                    "move one signal to another candidate pad (see valid_pads_for)".to_string(),
                ),
            });
        }
    }

    // P003 — an alternate-function block driven by two different peripherals.
    for group in &pinmux.exclusivity_groups {
        let mut owners: Vec<&str> = assignments
            .iter()
            .filter(|a| group.iter().any(|g| g == &a.pad))
            .map(|a| a.owner.as_str())
            .collect();
        owners.sort_unstable();
        owners.dedup();
        if owners.len() > 1 {
            diags.push(Diagnostic {
                code: "ALP-P003",
                severity: policy.severity("exclusivityViolation", Severity::Error),
                message: format!(
                    "pads {:?} are one alternate-function block, but {} different peripherals \
                     drive it: {} — a block serves one peripheral at a time",
                    group,
                    owners.len(),
                    owners.join(", ")
                ),
                hint: Some(
                    "route all signals in this block through one peripheral, or move a \
                     peripheral to a different block"
                        .to_string(),
                ),
            });
        }
    }

    diags
}
