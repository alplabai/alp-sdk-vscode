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
    diags
}
