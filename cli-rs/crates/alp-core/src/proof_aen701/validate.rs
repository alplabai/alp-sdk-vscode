// SPDX-License-Identifier: Apache-2.0
//! **PARSER layer (validation)** — semantic compatibility checks over the parsed
//! metadata + policy, each emitting a structured [`Diagnostic`] with a stable
//! code, severity, a human message, and a fix hint. The rules are data-driven
//! (peripheral coverage uses the SoC inventory + the policy's aliases); the
//! messages are plain, greppable strings — NOT macro-generated — because the
//! message text is exactly what a user reads to fix their board.yaml.
//!
//! Severity stratification (mirrors the SDK's classification):
//! - WARNING (build proceeds): coverage gaps where the metadata may simply be
//!   incomplete — never block on a possible false-positive (ALP-B010, the
//!   chip-subsystem gap).
//! - ERROR (build blocks): genuine hardware incompatibilities the user must
//!   resolve (ALP-B011 carrier/family mismatch).

use std::collections::{BTreeMap, BTreeSet};

use super::metadata::*;
use super::policy::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Severity {
    Warning,
    Error,
}

/// One semantic finding: a stable `code` (e.g. `ALP-B010`), its `severity`, a
/// human-readable `message`, and an actionable `hint`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Diagnostic {
    pub(crate) code: &'static str,
    pub(crate) severity: Severity,
    pub(crate) message: String,
    pub(crate) hint: Option<String>,
}

impl Diagnostic {
    /// `true` if this diagnostic should block the build (exit non-zero).
    pub(crate) fn is_blocking(&self) -> bool {
        self.severity == Severity::Error
    }
}

/// Is `kind` (a `board.yaml` `peripherals[]` entry) present on the silicon?
/// Coverage is policy-driven: a direct hit, a variant-suffix hit (`i2c`→`i2c_lp`,
/// `can`→`can_fd`, `adc`→`adc_12bit` — any `<kind>_*` key), or an alias from the
/// policy (`counter`→`timer*`, `pwm`→`pwm|timer`; an empty alias list ⇒ an
/// always-present software abstraction like `sensor`).
pub(crate) fn soc_has_peripheral(soc: &SocSpec, p: &Policy, kind: &str) -> bool {
    if let Some(aliases) = p.peripheral_aliases.get(kind) {
        if aliases.is_empty() {
            return true; // pure software abstraction — always available
        }
        return aliases.iter().any(|a| soc_lists_kind(soc, a));
    }
    soc_lists_kind(soc, kind)
}

/// A direct or variant-suffix (`<kind>_*`) hit in the SoC inventory.
fn soc_lists_kind(soc: &SocSpec, kind: &str) -> bool {
    soc.peripherals.contains_key(kind)
        || soc.peripherals.keys().any(|k| {
            k.strip_prefix(kind)
                .is_some_and(|rest| rest.starts_with('_'))
        })
}

/// **ALP-B010** — every core's declared peripheral must appear on the silicon
/// (WARNING, never blocking: the SoC inventory may be incomplete or the
/// peripheral may be board-side).
pub(crate) fn check_peripherals(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    p: &Policy,
) -> Vec<Diagnostic> {
    let silicon = &som.silicon;
    let mut diags = Vec::new();
    // Deterministic order (BoardYaml.cores is a BTreeMap, already sorted).
    for (core_id, core) in &board.cores {
        for kind in &core.peripherals {
            if !soc_has_peripheral(soc, p, kind) {
                diags.push(Diagnostic {
                    code: "ALP-B010",
                    severity: Severity::Warning,
                    message: format!(
                        "core '{core_id}': peripheral kind '{kind}' is not listed on silicon \
                         '{silicon}' (the SoC inventory may be incomplete, or the peripheral is \
                         board-side)"
                    ),
                    hint: Some(format!(
                        "verify silicon '{silicon}' truly lacks '{kind}' before removing this \
                         entry; if the SoC has it but the metadata is stale, add it to \
                         metadata/socs/<vendor>/<family>/<part>.json `peripherals`"
                    )),
                });
            }
        }
    }
    diags
}

/// **ALP-B011** — the SoM's family must be one the carrier board can host
/// (ERROR: a genuine hardware mismatch). Skipped when the board declares no
/// `hosts_som_families` (older board defs) or the SoM declares no `family`.
pub(crate) fn check_som_supported(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
) -> Option<Diagnostic> {
    let family = som.family.as_deref()?;
    if board_def.hosts_som_families.is_empty() {
        return None;
    }
    if board_def.hosts_som_families.iter().any(|f| f == family) {
        return None;
    }
    Some(Diagnostic {
        code: "ALP-B011",
        severity: Severity::Error,
        message: format!(
            "board '{}' hosts SoM families {:?}, but SKU '{}' is family '{}' — this SoM is not \
             supported on this carrier",
            board_def.name, board_def.hosts_som_families, board.som.sku, family
        ),
        hint: Some(
            "choose a board preset whose `hosts_som_families` covers this SoM, or a SoM whose \
             family the board supports"
                .to_string(),
        ),
    })
}

/// On-module mediators a SoM populates (chips that can host pad dispatch): the
/// `on_module` component values + the `helper_firmware` chips. Computed locally
/// so validation (parser layer) never reaches into the writer layer.
fn som_mediators(som: &SomPreset) -> BTreeSet<String> {
    let mut set = BTreeSet::new();
    for v in som.on_module.values() {
        if let Some(s) = v.as_str() {
            set.insert(s.to_string());
        }
    }
    for hf in &som.helper_firmware {
        if let Some(chip) = &hf.chip {
            set.insert(chip.clone());
        }
    }
    set
}

/// **ALP-B013** — an E1M pad bound to two different roles in `e1m_routes` is a
/// conflict (ERROR), unless the pad is in the policy's `padDualClaimAllowlist`
/// (a muxed pad whose two functions are never opened at once, e.g. `E1M_PWM1`).
pub(crate) fn check_pad_conflicts(board_def: &BoardDef, p: &Policy) -> Vec<Diagnostic> {
    // Stable order: BTreeMap of pad → the macros that claim it.
    let mut claims: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for entries in board_def.e1m_routes.values() {
        for e in entries {
            claims
                .entry(e.e1m.as_str())
                .or_default()
                .push(e.macro_name.as_str());
        }
    }
    let mut diags = Vec::new();
    for (pad, macros) in &claims {
        if macros.len() > 1 && !p.pad_dual_claim_allowlist.iter().any(|a| a == pad) {
            diags.push(Diagnostic {
                code: "ALP-B013",
                severity: Severity::Error,
                message: format!(
                    "E1M pad '{}' is claimed by multiple roles: {} — each pad routes to exactly \
                     one function",
                    pad,
                    macros.join(", ")
                ),
                hint: Some(format!(
                    "resolve the conflict in e1m_routes, or add '{pad}' to the policy \
                     padDualClaimAllowlist (and document why) if the dual-claim is intentional"
                )),
            });
        }
    }
    diags
}

/// **ALP-B014** — a SoM `pad_route` that dispatches via a mediator the SoM does
/// not populate is unroutable on this module (ERROR).
pub(crate) fn check_route_dispatch(som: &SomPreset) -> Vec<Diagnostic> {
    let mediators = som_mediators(som);
    let sku = som.sku.as_deref().unwrap_or("<sku>");
    let mut diags = Vec::new();
    for pr in &som.pad_routes {
        if pr.dispatch == "direct" || mediators.contains(&pr.dispatch) {
            continue;
        }
        diags.push(Diagnostic {
            code: "ALP-B014",
            severity: Severity::Error,
            message: format!(
                "E1M pad '{}' dispatches via '{}', but SoM '{}' does not populate '{}' — this \
                 route is unroutable on this module",
                pr.e1m, pr.dispatch, sku, pr.dispatch
            ),
            hint: Some(format!(
                "pick a SoM that populates '{}', or move the role to a directly-routed pad",
                pr.dispatch
            )),
        });
    }
    diags
}

/// Run every compatibility check, in a stable order. The caller decides what to
/// do with the result (the engine surfaces warnings on the build plan; a
/// blocking diagnostic ⇒ refuse the build).
pub(crate) fn check_all(
    board: &BoardYaml,
    som: &SomPreset,
    board_def: &BoardDef,
    soc: &SocSpec,
    p: &Policy,
) -> Vec<Diagnostic> {
    let mut diags = Vec::new();
    diags.extend(check_som_supported(board, som, board_def));
    diags.extend(check_peripherals(board, som, soc, p));
    diags.extend(check_pad_conflicts(board_def, p));
    diags.extend(check_route_dispatch(som));
    diags
}
