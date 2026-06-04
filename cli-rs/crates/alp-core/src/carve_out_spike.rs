// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE — not for dev.** Rust port of the SDK's *hardest* allocator:
//! IPC carve-out allocation (`alp_orchestrate.py::resolve_carve_outs`, dev). The
//! 4th datapoint — deliberately the trickiest: region-ranking heuristic +
//! top-down per-region bump allocator + FNV-1a endpoint IDs + collision
//! detection + rpmsg/mailbox metadata validation.
//!
//! Inputs (memory_map regions, mailbox) are DATA — the metadata I/O
//! (`resolve_memory_map`) is the input layer, ported separately. Here we port
//! the generic allocation engine. Parity oracle: the SDK's own
//! `test_resolve_carve_outs_*` cases + the canonical FNV-1a test vectors.

use std::collections::HashMap;

const PAGE: u64 = 4096;

/// FNV-1a 32-bit (matches the Python `_fnv1a_32`).
fn fnv1a_32(data: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &b in data {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

fn align_up(v: u64, a: u64) -> u64 {
    v.div_ceil(a) * a
}
fn align_down(v: u64, a: u64) -> u64 {
    v - (v % a)
}

#[derive(Debug, Clone)]
pub struct IpcEntry {
    pub name: String,
    pub kind: String, // "rpmsg" | ...
    pub endpoints: Vec<String>,
    pub carve_out_kb: u64,
    pub cacheable: Option<bool>,
    pub address: Option<u64>, // explicit base override
}

#[derive(Debug, Clone)]
pub struct Region {
    pub name: String,
    /// `None` models a `TBD` base (un-HW-mapped SoM → block).
    pub base: Option<u64>,
    /// Size in bytes, pre-resolved from size_mib/size_kib (the input layer);
    /// `None` → unresolvable.
    pub size_bytes: Option<u64>,
    pub accessible_from: Vec<String>,
    pub cacheable: bool,
}

#[derive(Debug, Clone)]
pub struct Channel {
    pub id: u64,
    pub reserved_for: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Mailbox {
    pub controller: Option<String>, // None or "TBD" → rpmsg blocks
    pub channels: Vec<Channel>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Ok,
    Blocked(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCarveOut {
    pub name: String,
    pub base: u64,
    pub size: u64,
    pub region: String,
    pub cacheable: bool,
    pub src_ept: u32,
    pub dst_ept: u32,
    pub mailbox_channel: u64,
    pub status: Status,
}

fn blocked(entry: &IpcEntry, reason: String) -> ResolvedCarveOut {
    ResolvedCarveOut {
        name: entry.name.clone(),
        base: 0,
        size: 0,
        region: String::new(),
        cacheable: false,
        src_ept: 0,
        dst_ept: 0,
        mailbox_channel: 0,
        status: Status::Blocked(reason),
    }
}

fn mailbox_channel_for(mailbox: &Mailbox, entry_name: &str) -> u64 {
    mailbox
        .channels
        .iter()
        .find(|c| c.reserved_for.as_deref() == Some(entry_name))
        .map(|c| c.id)
        .unwrap_or(0)
}

/// Lazily init a region's top-down high-water mark (`top = align_down(base+size)`).
/// Returns `Err(reason)` for a TBD base or unresolvable size.
fn region_top_init(region: &Region, region_top: &mut HashMap<String, u64>) -> Result<u64, String> {
    if let Some(&t) = region_top.get(&region.name) {
        return Ok(t);
    }
    let base = region.base.ok_or_else(|| {
        format!(
            "memory_map.base is TBD for region '{}'; SoM not HW-mapped yet",
            region.name
        )
    })?;
    let size = region.size_bytes.ok_or_else(|| {
        format!(
            "memory_map.size is unresolvable for region '{}'",
            region.name
        )
    })?;
    let top = align_down(base + size, PAGE);
    region_top.insert(region.name.clone(), top);
    Ok(top)
}

/// Allocate IPC carve-outs top-down within memory regions. Mirrors
/// `resolve_carve_outs` step-for-step.
pub fn resolve_carve_outs(
    ipc: &[IpcEntry],
    memory_map: &[Region],
    mailbox: &Mailbox,
) -> Vec<ResolvedCarveOut> {
    if ipc.is_empty() {
        return Vec::new();
    }

    // rpmsg / mailbox metadata gate (spec §6.4).
    let has_rpmsg = ipc.iter().any(|e| e.kind == "rpmsg");
    let rpmsg_block: Option<String> = if has_rpmsg {
        match mailbox.controller.as_deref() {
            None | Some("TBD") => Some(
                "mailbox controller is unset/TBD; fill mailbox.controller or remove rpmsg entries"
                    .to_string(),
            ),
            Some(_) => {
                let has_default = mailbox
                    .channels
                    .iter()
                    .any(|c| c.reserved_for.as_deref() == Some("alp_default_rpmsg"));
                if has_default {
                    None
                } else {
                    Some(
                        "no mailbox channel reserved for alp_default_rpmsg; add one to mailbox.channels"
                            .to_string(),
                    )
                }
            }
        }
    } else {
        None
    };

    let mut region_top: HashMap<String, u64> = HashMap::new();
    let mut seen_low: HashMap<u8, String> = HashMap::new();
    let mut resolved: Vec<ResolvedCarveOut> = Vec::new();

    // Entries name-sorted for determinism.
    let mut entries: Vec<&IpcEntry> = ipc.iter().collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    for entry in entries {
        if entry.kind == "rpmsg" {
            if let Some(reason) = &rpmsg_block {
                resolved.push(blocked(entry, reason.clone()));
                continue;
            }
        }
        let prefers_cacheable = entry.cacheable.unwrap_or(false);

        // Candidates: accessibility covers every endpoint.
        let mut candidates: Vec<&Region> = memory_map
            .iter()
            .filter(|r| {
                entry
                    .endpoints
                    .iter()
                    .all(|e| r.accessible_from.contains(e))
            })
            .collect();
        if candidates.is_empty() {
            resolved.push(blocked(
                entry,
                format!(
                    "ipc entry '{}' endpoints {:?} have no matching memory_map region",
                    entry.name, entry.endpoints
                ),
            ));
            continue;
        }

        // Rank: cacheable-match first, then smaller region first (stable sort
        // preserves memory_map order on ties).
        candidates.sort_by_key(|r| {
            let cacheable_match = if r.cacheable == prefers_cacheable {
                0
            } else {
                1
            };
            (cacheable_match, r.size_bytes.unwrap_or(1 << 62))
        });
        let chosen = candidates[0];

        let top = match region_top_init(chosen, &mut region_top) {
            Ok(t) => t,
            Err(reason) => {
                resolved.push(blocked(entry, reason));
                continue;
            }
        };

        let carve_size_aligned = align_up(entry.carve_out_kb * 1024, PAGE);

        // Explicit address override vs top-down bump.
        let base = if let Some(addr) = entry.address {
            if addr % PAGE != 0 {
                resolved.push(blocked(
                    entry,
                    format!(
                        "ipc entry '{}' explicit address 0x{addr:x} is not page-aligned (4 KiB)",
                        entry.name
                    ),
                ));
                continue;
            }
            addr
        } else {
            let region_lo = chosen.base.expect("init succeeded → base is Some");
            // `top` is the current cursor (init value on first touch).
            let current_top = *region_top.get(&chosen.name).unwrap_or(&top);
            if current_top < carve_size_aligned || current_top - carve_size_aligned < region_lo {
                resolved.push(blocked(
                    entry,
                    format!(
                        "ipc entry '{}' ({} KiB) doesn't fit in region '{}' after prior allocations",
                        entry.name, entry.carve_out_kb, chosen.name
                    ),
                ));
                continue;
            }
            let new_top = current_top - carve_size_aligned;
            region_top.insert(chosen.name.clone(), new_top);
            new_top
        };

        // Endpoint IDs: FNV-1a low byte, collision-checked.
        let low = (fnv1a_32(entry.name.as_bytes()) & 0xFF) as u8;
        if let Some(prior) = seen_low.get(&low) {
            resolved.push(blocked(
                entry,
                format!(
                    "ipc entry '{}' endpoint-id low byte 0x{low:02x} collides with '{prior}'",
                    entry.name
                ),
            ));
            continue;
        }
        seen_low.insert(low, entry.name.clone());
        let src_ept = 0x400u32 | low as u32;
        let dst_ept = src_ept + 1;

        resolved.push(ResolvedCarveOut {
            name: entry.name.clone(),
            base,
            size: carve_size_aligned,
            region: chosen.name.clone(),
            cacheable: entry.cacheable.unwrap_or(chosen.cacheable),
            src_ept,
            dst_ept,
            mailbox_channel: mailbox_channel_for(mailbox, &entry.name),
            status: Status::Ok,
        });
    }

    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    // Canonical FNV-1a 32-bit test vectors — pins the hash port exactly.
    #[test]
    fn fnv1a_known_vectors() {
        assert_eq!(fnv1a_32(b""), 0x811c_9dc5);
        assert_eq!(fnv1a_32(b"a"), 0xe40c_292c);
        assert_eq!(fnv1a_32(b"foobar"), 0xbf9c_f968);
    }

    fn region(
        name: &str,
        base: Option<u64>,
        size_kib: u64,
        af: &[&str],
        cacheable: bool,
    ) -> Region {
        Region {
            name: name.to_string(),
            base,
            size_bytes: Some(size_kib * 1024),
            accessible_from: af.iter().map(|s| s.to_string()).collect(),
            cacheable,
        }
    }

    // Parity with test_resolve_carve_outs_happy: ocram_low base=0x10000,
    // size=512KiB → top=0x90000; carve 512KiB → new_top=0x10000.
    #[test]
    fn happy_top_down_allocation_matches_sdk() {
        let mm = vec![region(
            "ocram_low",
            Some(0x0001_0000),
            512,
            &["a55_cluster", "m33_sm"],
            false,
        )];
        let ipc = vec![IpcEntry {
            name: "telemetry".to_string(),
            kind: "shm".to_string(),
            endpoints: vec!["a55_cluster".to_string(), "m33_sm".to_string()],
            carve_out_kb: 512,
            cacheable: None,
            address: None,
        }];
        let out = resolve_carve_outs(&ipc, &mm, &Mailbox::default());
        assert_eq!(out.len(), 1);
        let c = &out[0];
        assert_eq!(c.status, Status::Ok);
        assert_eq!(c.base, 0x0001_0000);
        assert_eq!(c.size, 0x8_0000); // 512 KiB
        assert_eq!(c.region, "ocram_low");
        assert_eq!(c.src_ept & 0xFFFF_FF00, 0x400);
        assert_eq!(c.dst_ept, c.src_ept + 1);
    }

    // Two carve-outs stack top-down in the same region.
    #[test]
    fn two_carveouts_stack_top_down() {
        let mm = vec![region("r", Some(0x0), 1024, &["c"], false)]; // top = 0x100000
        let ipc = vec![
            IpcEntry {
                name: "aaa".to_string(),
                kind: "shm".to_string(),
                endpoints: vec!["c".to_string()],
                carve_out_kb: 256,
                cacheable: None,
                address: None,
            },
            IpcEntry {
                name: "bbb".to_string(),
                kind: "shm".to_string(),
                endpoints: vec!["c".to_string()],
                carve_out_kb: 256,
                cacheable: None,
                address: None,
            },
        ];
        let out = resolve_carve_outs(&ipc, &mm, &Mailbox::default());
        // name-sorted: aaa first (top), then bbb below it.
        let aaa = out.iter().find(|c| c.name == "aaa").unwrap();
        let bbb = out.iter().find(|c| c.name == "bbb").unwrap();
        assert_eq!(aaa.base, 0x10_0000 - 0x4_0000); // 1MiB - 256KiB = 0xC0000
        assert_eq!(bbb.base, 0x10_0000 - 0x8_0000); // - another 256KiB = 0x80000
    }

    // TBD base → blocked.
    #[test]
    fn tbd_base_blocks() {
        let mm = vec![region("r", None, 512, &["c"], false)];
        let ipc = vec![IpcEntry {
            name: "x".to_string(),
            kind: "shm".to_string(),
            endpoints: vec!["c".to_string()],
            carve_out_kb: 64,
            cacheable: None,
            address: None,
        }];
        let out = resolve_carve_outs(&ipc, &mm, &Mailbox::default());
        assert!(matches!(out[0].status, Status::Blocked(_)));
    }

    // No region covers the endpoints → blocked.
    #[test]
    fn no_candidate_region_blocks() {
        let mm = vec![region("r", Some(0), 512, &["other"], false)];
        let ipc = vec![IpcEntry {
            name: "x".to_string(),
            kind: "shm".to_string(),
            endpoints: vec!["c".to_string()],
            carve_out_kb: 64,
            cacheable: None,
            address: None,
        }];
        let out = resolve_carve_outs(&ipc, &mm, &Mailbox::default());
        match &out[0].status {
            Status::Blocked(r) => assert!(r.contains("no matching memory_map region")),
            Status::Ok => panic!("expected blocked"),
        }
    }

    // rpmsg with no reserved alp_default_rpmsg channel → blocked.
    #[test]
    fn rpmsg_without_reserved_channel_blocks() {
        let mm = vec![region("r", Some(0), 512, &["c"], false)];
        let ipc = vec![IpcEntry {
            name: "rp".to_string(),
            kind: "rpmsg".to_string(),
            endpoints: vec!["c".to_string()],
            carve_out_kb: 64,
            cacheable: None,
            address: None,
        }];
        let mbox = Mailbox {
            controller: Some("renesas_mhu".to_string()),
            channels: vec![],
        };
        let out = resolve_carve_outs(&ipc, &mm, &mbox);
        match &out[0].status {
            Status::Blocked(r) => assert!(r.contains("alp_default_rpmsg")),
            Status::Ok => panic!("expected blocked"),
        }
    }

    // Explicit page-misaligned address → blocked.
    #[test]
    fn misaligned_explicit_address_blocks() {
        let mm = vec![region("r", Some(0), 512, &["c"], false)];
        let ipc = vec![IpcEntry {
            name: "x".to_string(),
            kind: "shm".to_string(),
            endpoints: vec!["c".to_string()],
            carve_out_kb: 64,
            cacheable: None,
            address: Some(0x1001), // not 4 KiB-aligned
        }];
        let out = resolve_carve_outs(&ipc, &mm, &Mailbox::default());
        match &out[0].status {
            Status::Blocked(r) => assert!(r.contains("page-aligned")),
            Status::Ok => panic!("expected blocked"),
        }
    }
}
