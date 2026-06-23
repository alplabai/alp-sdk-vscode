// SPDX-License-Identifier: Apache-2.0
//! **READINESS layer (P/M/T improvement #3)** — the SoM bring-up contract.
//! Aggregates the engine's resolver-level blocked states into ONE structured
//! report: for a SoM bundle, which facts are HW-mapped vs pending (`TBD`), what each
//! pending fact BLOCKS (which outputs degrade to stubs), and the one-line fix.
//! The SDK emits the blocked stubs per-board; THIS is the cross-cutting view our
//! IDE/CLI is positioned to render (a "SoM Readiness" surface). Each finding carries
//! a stable CODE (improvement #2 — structured blocked-reason codes, not free text),
//! so the IDE can offer a keyed quick-fix instead of regex-matching a message.

use super::metadata::*;

/// One readiness finding: a pending (`TBD`) metadata fact + its build impact.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReadinessFinding {
    /// dotted metadata path, e.g. `mailbox.controller`.
    pub(crate) field: String,
    /// stable machine code (the structured blocked-reason — improvement #2).
    pub(crate) code: &'static str,
    /// does this gate a real build output (vs an informational pending field)?
    pub(crate) blocking: bool,
    /// the outputs that degrade to stubs until this is filled.
    pub(crate) blocks: Vec<&'static str>,
    /// the one-line fix to unblock it.
    pub(crate) fix_hint: String,
}

/// A SoM's bring-up readiness — the data behind a "SoM Readiness" IDE view.
#[derive(Debug, Clone)]
pub(crate) struct SomReadiness {
    pub(crate) sku: String,
    pub(crate) preliminary: bool,
    pub(crate) partial_hw_config: bool,
    pub(crate) findings: Vec<ReadinessFinding>,
}

impl SomReadiness {
    pub(crate) fn blocking(&self) -> Vec<&ReadinessFinding> {
        self.findings.iter().filter(|f| f.blocking).collect()
    }
    /// HW-mapped enough that every output resolves (no blocking finding) AND the
    /// silicon is released (not preliminary).
    pub(crate) fn is_ready(&self) -> bool {
        self.blocking().is_empty() && !self.preliminary
    }
    pub(crate) fn has_code(&self, code: &str) -> bool {
        self.findings.iter().any(|f| f.code == code)
    }
}

fn is_tbd_str(v: Option<&str>) -> bool {
    matches!(v.map(str::trim), Some("TBD") | None)
}
fn val_is_tbd(v: &serde_yaml::Value) -> bool {
    v.as_str().map(str::trim) == Some("TBD")
}

/// Compute the readiness report for a SoM bundle (the bring-up contract). The
/// field→output mapping is the engine's own resolver knowledge (which `TBD` gates
/// which output), aggregated and coded.
pub(crate) fn compute_readiness(som: &SomPreset, soc: &SocSpec) -> SomReadiness {
    let sku = som.sku.clone().unwrap_or_default();
    let mut findings = Vec::new();

    // 1. silicon_variant TBD → the MRAM/SRAM region table can't be derived, so the
    //    storage allocator (and the carve-out's resolved path) block — UNLESS the SoC
    //    ships explicit memory_regions (V2N) or the SoM a memory_map.
    if is_tbd_str(som.silicon_variant.as_deref()) {
        let has_explicit_map = !soc.memory_regions.is_empty() || !som.memory_map.is_empty();
        findings.push(ReadinessFinding {
            field: "silicon_variant".into(),
            code: "SILICON_VARIANT_TBD",
            blocking: !has_explicit_map,
            blocks: if has_explicit_map {
                vec![]
            } else {
                vec!["dts-partitions (storage)", "memory-map-derived regions"]
            },
            fix_hint: "set silicon_variant to the SoC order-code (see the SoC variants[]) so the MRAM/SRAM region table derives".into(),
        });
    }

    // 2. mailbox.controller TBD/unset → the IPC carve-out blocks → system_ipc.h +
    //    dts-reservations emit stubs instead of resolved addresses.
    if is_tbd_str(som.mailbox.controller.as_deref()) {
        findings.push(ReadinessFinding {
            field: "mailbox.controller".into(),
            code: "MAILBOX_TBD",
            blocking: true,
            blocks: vec![
                "system_ipc.h (resolved IPC #defines)",
                "dts-reservations (carve-out region)",
            ],
            fix_hint: "fill mailbox.controller with the vendor mailbox node (renesas_mhu, nxp_mu, alif_evtrtr)".into(),
        });
    }

    // 3. on_module.ospi_memories[*].capacity_mbit TBD → storage on that flash device
    //    can't be sized → those partitions block.
    if let Some(serde_yaml::Value::Mapping(ospi)) = som.on_module.get("ospi_memories") {
        for (k, entry) in ospi {
            let dev = k.as_str().unwrap_or("<ospi>");
            if entry.get("capacity_mbit").map(val_is_tbd).unwrap_or(false) {
                findings.push(ReadinessFinding {
                    field: format!("on_module.ospi_memories.{dev}.capacity_mbit"),
                    code: "OSPI_CAPACITY_TBD",
                    blocking: true,
                    blocks: vec!["dts-partitions (storage on this flash device)"],
                    fix_hint: format!(
                        "set capacity_mbit for '{dev}' (megabits) so the storage allocator can size partitions on it"
                    ),
                });
            }
        }
    }

    // 4. Unpopulated on-module chips (wifi_ble / ethernet_phy: TBD) — INFORMATIONAL:
    //    a pending BOM choice, not a build-config block (no CHIP_ is emitted).
    for key in ["wifi_ble", "ethernet_phy"] {
        if som.on_module.get(key).map(val_is_tbd).unwrap_or(false) {
            findings.push(ReadinessFinding {
                field: format!("on_module.{key}"),
                code: "CHIP_PENDING",
                blocking: false,
                blocks: vec![],
                fix_hint: format!(
                    "pick the {key} part once the BOM freezes (informational; no output blocked)"
                ),
            });
        }
    }

    // 5. Memory sizing (dram_mbit / flash_mbit: TBD) — INFORMATIONAL (Yocto image
    //    sizing in a later milestone; no v0.7 build-config block).
    for key in ["dram_mbit", "flash_mbit"] {
        if som.memory.get(key).map(val_is_tbd).unwrap_or(false) {
            findings.push(ReadinessFinding {
                field: format!("memory.{key}"),
                code: "MEMORY_SIZE_TBD",
                blocking: false,
                blocks: vec![],
                fix_hint: format!("fill {key} once the HW design freezes (informational)"),
            });
        }
    }

    SomReadiness {
        sku,
        preliminary: som.status.preliminary,
        partial_hw_config: som.status.partial_hw_config,
        findings,
    }
}
