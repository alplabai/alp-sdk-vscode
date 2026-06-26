// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer (derivation)** — the IPC carve-out / memory-map ALLOCATOR.
//! Resolves each `board.yaml` `ipc:` entry to real `(base, size, endpoint IDs,
//! mailbox channel)` by allocating top-down from the SoM/SoC memory regions —
//! reproducing the SDK's `resolve_carve_outs` (spec §6.1) from DATA, vendor-neutral.
//! A SoM with a `TBD`/unset mailbox (or no reserved channel) lands BLOCKED (the
//! stub path the AEN bench hits); a HW-mapped mailbox (V2N) resolves to addresses.

use std::collections::{BTreeMap, BTreeSet};

use super::metadata::*;

pub(crate) const PAGE: u64 = 4096;

/// FNV-1a 32-bit — the SDK's endpoint-ID hash (`alp_orchestrate.py:_fnv1a_32`).
pub(crate) fn fnv1a_32(data: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &b in data {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// One ipc entry after allocation (or blocked when the SoM isn't HW-mapped).
#[derive(Debug, Clone)]
pub(crate) struct ResolvedCarveOut {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) endpoints: Vec<String>,
    pub(crate) blocked: bool,
    pub(crate) reason: String,
    pub(crate) base: u64,
    pub(crate) size: u64,
    pub(crate) src_ept: u32,
    pub(crate) dst_ept: u32,
    pub(crate) mbox_ch: u32,
}

pub(crate) fn region_size_bytes(r: &MemRegion) -> Option<u64> {
    if let Some(m) = r.size_mib {
        return Some(m * 1024 * 1024);
    }
    r.size_kib.map(|k| k * 1024)
}

fn align_down(v: u64, a: u64) -> u64 {
    v - (v % a)
}
pub(crate) fn align_up(v: u64, a: u64) -> u64 {
    v.div_ceil(a) * a
}

/// The effective region table (the SDK's `resolve_memory_map`, 3-tier precedence):
/// the SoM `memory_map:` (verbatim override); else the SoC's explicit
/// `memory_regions` (authoritative bases, e.g. V2N OCRAM); else DERIVE from the
/// selected SoC variant's MRAM + SRAM banks (the Alif/AEN path). Shared by the
/// carve-out allocator and the storage-partition allocator.
pub(crate) fn resolve_memory_map(som: &SomPreset, soc: &SocSpec) -> Vec<MemRegion> {
    if !som.memory_map.is_empty() {
        return som.memory_map.clone();
    }
    if !soc.memory_regions.is_empty() {
        return soc.memory_regions.clone();
    }
    derive_memory_map_from_variant(som, soc)
}

/// Tier 3: each named SRAM bank becomes one region, the MRAM becomes one region.
/// Per-core TCM banks (suffix `_<CORE>_(ITCM|DTCM)`) get `accessible_from: [core]`
/// and non-cacheable; the rest are shared and cacheable. Bases stay unset (the
/// silicon defaults them, so emitters that need a base like the carve-out block on
/// it; the storage allocator is offset-within-device, so it does not).
fn derive_memory_map_from_variant(som: &SomPreset, soc: &SocSpec) -> Vec<MemRegion> {
    let Some(variant) = som
        .silicon_variant
        .as_deref()
        .and_then(|oc| soc.variants.iter().find(|v| v.order_code == oc))
        .or_else(|| soc.variants.first())
    else {
        return Vec::new();
    };
    let cores: Vec<String> = soc.cores.iter().map(|c| c.id.clone()).collect();
    let mut regions = Vec::new();

    if let Some(mb) = variant.mram_mb {
        if mb > 0.0 {
            regions.push(MemRegion {
                name: "mram_main".to_string(),
                base: None,
                size_kib: Some((mb * 1024.0) as u64),
                size_mib: None,
                accessible_from: cores.clone(),
                cacheable: Some(true),
                dt_label: None,
            });
        }
    }
    for (bank, &size_kib) in &variant.sram_banks_kb {
        if size_kib == 0 {
            continue;
        }
        let upper = bank.to_uppercase();
        let accessible = cores
            .iter()
            .find(|c| upper.contains(&format!("_{}_", c.to_uppercase())))
            .map(|c| vec![c.clone()])
            .unwrap_or_else(|| cores.clone());
        let is_tcm = upper.contains("ITCM") || upper.contains("DTCM");
        regions.push(MemRegion {
            name: bank.to_lowercase(),
            base: None,
            size_kib: Some(size_kib),
            size_mib: None,
            accessible_from: accessible,
            cacheable: Some(!is_tcm),
            dt_label: None,
        });
    }
    regions
}

/// The rpmsg block reason (spec §6.4): an unset/TBD controller, or no channel
/// reserved for `alp_default_rpmsg`. `None` ⇒ the mailbox is HW-mapped.
fn mailbox_block_reason(
    sku: &str,
    mailbox: &Mailbox,
    ipc: &[IpcChannel],
    alif_example: &str,
) -> Option<String> {
    if !ipc.iter().any(|e| e.kind == "rpmsg") {
        return None;
    }
    match mailbox.controller.as_deref() {
        None | Some("TBD") => {
            let state = if mailbox.controller.is_none() {
                "unset"
            } else {
                "TBD"
            };
            Some(format!(
                "SoM {sku} mailbox controller is {state}; carve-out resolution requires authoritative mailbox metadata.  Fill `mailbox.controller:` in metadata/e1m_modules/{sku}.yaml with the vendor mailbox node name (e.g. `renesas_mhu`, `nxp_mu`, `{alif_example}`) or remove the rpmsg entries from board.yaml."
            ))
        }
        Some(_) => {
            let reserved = mailbox
                .channels
                .iter()
                .any(|c| c.reserved_for.as_deref() == Some("alp_default_rpmsg"));
            if reserved {
                None
            } else {
                Some(format!(
                    "no mailbox channel reserved for alp_default_rpmsg in {sku}; add one with `reserved_for: alp_default_rpmsg` to metadata/e1m_modules/{sku}.yaml mailbox.channels (e.g. `- {{ id: 0, reserved_for: alp_default_rpmsg }}`)."
                ))
            }
        }
    }
}

fn blocked(entry: &IpcChannel, reason: String) -> ResolvedCarveOut {
    ResolvedCarveOut {
        name: entry.name.clone(),
        kind: entry.kind.clone(),
        endpoints: entry.endpoints.clone(),
        blocked: true,
        reason,
        base: 0,
        size: 0,
        src_ept: 0,
        dst_ept: 0,
        mbox_ch: 0,
    }
}

/// Resolve every ipc entry to a carve-out — the SDK's `resolve_carve_outs`:
/// allocate in name-sorted order (determinism), emit in `board.yaml` order.
pub(crate) fn resolve_carve_outs(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
    profile: &SdkProfile,
) -> Vec<ResolvedCarveOut> {
    if board.ipc.is_empty() {
        return Vec::new();
    }
    let memory_map = resolve_memory_map(som, soc);
    let block_reason = mailbox_block_reason(
        &board.som.sku,
        &som.mailbox,
        &board.ipc,
        profile.alif_mailbox_example,
    );

    let mut sorted: Vec<&IpcChannel> = board.ipc.iter().collect();
    sorted.sort_by(|a, b| a.name.cmp(&b.name));

    let mut region_top: BTreeMap<String, u64> = BTreeMap::new();
    let mut seen_low: BTreeMap<u8, String> = BTreeMap::new();
    let mut by_name: BTreeMap<String, ResolvedCarveOut> = BTreeMap::new();

    for entry in sorted {
        if entry.kind == "rpmsg" {
            if let Some(reason) = &block_reason {
                by_name.insert(entry.name.clone(), blocked(entry, reason.clone()));
                continue;
            }
        }
        let endpoint_set: BTreeSet<&str> = entry.endpoints.iter().map(String::as_str).collect();
        let prefers_cacheable = entry.cacheable.unwrap_or(false);

        let mut candidates: Vec<&MemRegion> = memory_map
            .iter()
            .filter(|r| {
                let af: BTreeSet<&str> = r.accessible_from.iter().map(String::as_str).collect();
                endpoint_set.iter().all(|e| af.contains(e))
            })
            .collect();
        if candidates.is_empty() {
            by_name.insert(
                entry.name.clone(),
                blocked(
                    entry,
                    format!(
                        "ipc entry '{}' endpoints {:?} have no matching memory_map region in SoM {}",
                        entry.name, entry.endpoints, board.som.sku
                    ),
                ),
            );
            continue;
        }
        // Rank: a region whose `cacheable` matches the preference first, then the
        // smaller region (don't eat a giant DDR region with a tiny carve-out).
        candidates.sort_by_key(|r| {
            let cm = r.cacheable.unwrap_or(false) == prefers_cacheable;
            (
                if cm { 0 } else { 1 },
                region_size_bytes(r).unwrap_or(1 << 62),
            )
        });
        let chosen = candidates[0];
        let Some(region_lo) = chosen.base else {
            by_name.insert(
                entry.name.clone(),
                blocked(
                    entry,
                    format!(
                        "memory_map.base is TBD for region '{}' in SoM {}",
                        chosen.name, board.som.sku
                    ),
                ),
            );
            continue;
        };
        let Some(size_bytes) = region_size_bytes(chosen) else {
            by_name.insert(
                entry.name.clone(),
                blocked(
                    entry,
                    format!(
                        "memory_map.size is unresolvable for region '{}' in SoM {}",
                        chosen.name, board.som.sku
                    ),
                ),
            );
            continue;
        };
        let top = *region_top
            .entry(chosen.name.clone())
            .or_insert_with(|| align_down(region_lo + size_bytes, PAGE));

        let carve_size = entry.carve_out_kb.unwrap_or(0) as u64 * 1024;
        let carve_aligned = align_up(carve_size, PAGE);
        let base = if let Some(addr) = entry.address {
            addr
        } else {
            let new_top = top.saturating_sub(carve_aligned);
            if new_top < region_lo {
                by_name.insert(
                    entry.name.clone(),
                    blocked(
                        entry,
                        format!(
                            "ipc entry '{}' ({} KiB) doesn't fit in region '{}' after prior allocations",
                            entry.name,
                            entry.carve_out_kb.unwrap_or(0),
                            chosen.name
                        ),
                    ),
                );
                continue;
            }
            region_top.insert(chosen.name.clone(), new_top);
            new_top
        };

        // Endpoint IDs: low byte of FNV-1a(name), ORed with 0x400; dst = src+1.
        let low = (fnv1a_32(entry.name.as_bytes()) & 0xFF) as u8;
        if let Some(prior) = seen_low.get(&low) {
            by_name.insert(
                entry.name.clone(),
                blocked(
                    entry,
                    format!(
                        "ipc entry '{}' endpoint-id low byte 0x{:02x} collides with prior entry '{}'.  Rename one of the channels.",
                        entry.name, low, prior
                    ),
                ),
            );
            continue;
        }
        seen_low.insert(low, entry.name.clone());

        let mbox = som
            .mailbox
            .channels
            .iter()
            .find(|c| c.reserved_for.as_deref() == Some(entry.name.as_str()))
            .map(|c| c.id)
            .unwrap_or(0);

        by_name.insert(
            entry.name.clone(),
            ResolvedCarveOut {
                name: entry.name.clone(),
                kind: entry.kind.clone(),
                endpoints: entry.endpoints.clone(),
                blocked: false,
                reason: String::new(),
                base,
                size: carve_size,
                src_ept: 0x400 | (low as u32),
                dst_ept: (0x400 | (low as u32)) + 1,
                mbox_ch: mbox,
            },
        );
    }

    // Emit in board.yaml order.
    board
        .ipc
        .iter()
        .filter_map(|e| by_name.get(&e.name).cloned())
        .collect()
}
