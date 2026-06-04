// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE — not for dev.** Rust port of the SDK's storage-partition
//! allocator (`alp_orchestrate.py::resolve_storage_partitions`, dev branch) to
//! measure: (a) clarity/LOC vs the ~120-line Python, (b) which bug classes the
//! Rust types/compiler catch, (c) byte-parity against the SDK's own test cases.
//!
//! Scope: the allocation *algorithm* only — flash-device capacity is an input
//! (the Python's `_resolve_flash_device` metadata lookup is the input-resolution
//! layer, not the algorithm). This is exactly the "generic engine" boundary: the
//! silicon specifics (device capacities) arrive as data; the engine is generic.

use std::collections::BTreeMap;

/// Flash erase-page granularity, matching the Python allocator (`_PAGE`).
const PAGE_BYTES: u64 = 4096;

/// One `storage[]` entry from board.yaml (mirrors the Python `StorageEntry`).
#[derive(Debug, Clone)]
pub struct StorageEntry {
    pub name: String,
    pub size_kib: u64,
    pub flash_device: Option<String>,
    /// Explicit offset override (page-aligned); `None` → bump-allocate.
    pub offset_kib: Option<u64>,
}

/// Allocation outcome. The `Blocked` reason mirrors the Python `reason:` strings
/// (substring-checked by the SDK tests). Making this an enum means every
/// consumer must handle both arms — the compiler enforces it (vs Python's
/// `status: str`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Ok,
    Blocked(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPartition {
    pub name: String,
    pub flash_device: String,
    pub base_kib: u64,
    pub size_kib: u64,
    pub status: Status,
}

fn align_up(bytes: u64, page: u64) -> u64 {
    bytes.div_ceil(page) * page
}

fn blocked(entry: &StorageEntry, reason: String) -> ResolvedPartition {
    ResolvedPartition {
        name: entry.name.clone(),
        flash_device: entry.flash_device.clone().unwrap_or_default(),
        base_kib: 0,
        size_kib: entry.size_kib,
        status: Status::Blocked(reason),
    }
}

/// Allocate physical offsets for every storage entry. Generic over silicon:
/// `device_capacity_kib` carries each flash device's capacity (a device absent
/// from the map is treated as unresolvable → block). Mirrors the Python
/// `resolve_storage_partitions` step-for-step.
pub fn allocate_partitions(
    entries: &[StorageEntry],
    device_capacity_kib: &BTreeMap<String, u64>,
) -> Vec<ResolvedPartition> {
    let mut resolved: Vec<ResolvedPartition> = Vec::new();

    // 1. Group by flash device; entries without one block immediately.
    let mut by_device: BTreeMap<String, Vec<&StorageEntry>> = BTreeMap::new();
    for entry in entries {
        match &entry.flash_device {
            None => resolved.push(blocked(
                entry,
                format!(
                    "storage entry '{}' has no flash_device: declared",
                    entry.name
                ),
            )),
            Some(dev) => by_device.entry(dev.clone()).or_default().push(entry),
        }
    }

    // 2. Devices in alphabetical order (BTreeMap iterates sorted) — determinism.
    for (device_name, group) in &by_device {
        let Some(&capacity_kib) = device_capacity_kib.get(device_name) else {
            for entry in group {
                resolved.push(blocked(
                    entry,
                    format!("flash device '{device_name}' is unresolvable (TBD in SoM metadata)"),
                ));
            }
            continue;
        };
        let capacity_bytes = capacity_kib * 1024;

        // Entries name-sorted for byte-stable allocation.
        let mut sorted: Vec<&StorageEntry> = group.clone();
        sorted.sort_by(|a, b| a.name.cmp(&b.name));

        let mut high_water_bytes: u64 = 0;
        let mut allocated: Vec<(u64, u64, &str)> = Vec::new(); // (lo, hi, name)

        for entry in sorted {
            let size_aligned = align_up(entry.size_kib * 1024, PAGE_BYTES);

            // 3. Explicit offset override vs bump allocation.
            let base_bytes = match entry.offset_kib {
                Some(off) => {
                    let base = off * 1024;
                    if base % PAGE_BYTES != 0 {
                        resolved.push(blocked(
                            entry,
                            format!(
                                "storage entry '{}' explicit offset_kib={off} is not page-aligned (4 KiB)",
                                entry.name
                            ),
                        ));
                        continue;
                    }
                    base
                }
                None => high_water_bytes,
            };

            let top_bytes = base_bytes + size_aligned;
            // 4a. Capacity overrun.
            if top_bytes > capacity_bytes {
                resolved.push(blocked(
                    entry,
                    format!(
                        "storage entry '{}' ({} KiB at offset {} KiB) overruns flash device '{device_name}' (capacity {} KiB)",
                        entry.name,
                        entry.size_kib,
                        base_bytes / 1024,
                        capacity_kib
                    ),
                ));
                continue;
            }
            // 4b. Sibling overlap (meaningful for explicit offsets).
            if let Some((_, _, peer)) = allocated
                .iter()
                .find(|(lo, hi, _)| !(top_bytes <= *lo || base_bytes >= *hi))
            {
                resolved.push(blocked(
                    entry,
                    format!(
                        "storage entry '{}' overlaps sibling partition '{peer}' on device '{device_name}'",
                        entry.name
                    ),
                ));
                continue;
            }

            allocated.push((base_bytes, top_bytes, &entry.name));
            // Explicit offsets don't shift the high-water mark.
            if entry.offset_kib.is_none() {
                high_water_bytes = top_bytes;
            }

            resolved.push(ResolvedPartition {
                name: entry.name.clone(),
                flash_device: device_name.clone(),
                base_kib: base_bytes / 1024,
                size_kib: size_aligned / 1024,
                status: Status::Ok,
            });
        }
    }

    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str, size_kib: u64, off: Option<u64>) -> StorageEntry {
        StorageEntry {
            name: name.to_string(),
            size_kib,
            flash_device: Some("mram_main".to_string()),
            offset_kib: off,
        }
    }
    fn caps() -> BTreeMap<String, u64> {
        BTreeMap::from([("mram_main".to_string(), 8192)]) // 8 MiB
    }
    fn by_name(parts: &[ResolvedPartition], n: &str) -> ResolvedPartition {
        parts.iter().find(|p| p.name == n).unwrap().clone()
    }

    // Parity with SDK test_resolve_storage_partitions_happy: name-sorted,
    // bottom-up, page-aligned (app_data@0, mcuboot_scratch@128, settings@160).
    #[test]
    fn happy_bottom_up_name_sorted() {
        let parts = allocate_partitions(
            &[
                e("settings", 64, None),
                e("app_data", 128, None),
                e("mcuboot_scratch", 32, None),
            ],
            &caps(),
        );
        assert_eq!(by_name(&parts, "app_data").base_kib, 0);
        assert_eq!(by_name(&parts, "app_data").size_kib, 128);
        assert_eq!(by_name(&parts, "mcuboot_scratch").base_kib, 128);
        assert_eq!(by_name(&parts, "mcuboot_scratch").size_kib, 32);
        assert_eq!(by_name(&parts, "settings").base_kib, 160);
        assert_eq!(by_name(&parts, "settings").size_kib, 64);
        assert!(parts.iter().all(|p| p.status == Status::Ok));
    }

    // Parity with test_resolve_storage_partitions_explicit_offset: honoured
    // verbatim; does NOT shift the bump allocator.
    #[test]
    fn explicit_offset_honoured_and_does_not_bump() {
        let parts = allocate_partitions(
            &[e("bump_alloc", 64, None), e("pinned_low", 32, Some(4096))],
            &caps(),
        );
        assert_eq!(by_name(&parts, "bump_alloc").base_kib, 0);
        assert_eq!(by_name(&parts, "bump_alloc").size_kib, 64);
        assert_eq!(by_name(&parts, "pinned_low").base_kib, 4096);
        assert_eq!(by_name(&parts, "pinned_low").size_kib, 32);
    }

    // test_resolve_storage_partitions_misaligned_offset
    #[test]
    fn misaligned_offset_blocks() {
        let parts = allocate_partitions(&[e("bad", 64, Some(5))], &caps());
        match &parts[0].status {
            Status::Blocked(r) => assert!(r.contains("page-aligned"), "got: {r}"),
            Status::Ok => panic!("expected blocked"),
        }
    }

    // test_resolve_storage_partitions_overflow
    #[test]
    fn overflow_blocks() {
        let parts = allocate_partitions(&[e("huge", 1_048_576, None)], &caps());
        match &parts[0].status {
            Status::Blocked(r) => assert!(r.contains("overruns"), "got: {r}"),
            Status::Ok => panic!("expected blocked"),
        }
    }

    // test_resolve_storage_partitions_overlap: a@0 (0..64KiB), b@32 overlaps.
    #[test]
    fn explicit_overlap_blocks() {
        let parts = allocate_partitions(&[e("a", 64, Some(0)), e("b", 64, Some(32))], &caps());
        assert_eq!(by_name(&parts, "a").status, Status::Ok);
        match &by_name(&parts, "b").status {
            Status::Blocked(r) => assert!(r.contains("overlaps"), "got: {r}"),
            Status::Ok => panic!("expected b blocked"),
        }
    }

    // test_resolve_storage_partitions_unknown_flash_device (device not in caps).
    #[test]
    fn unknown_device_blocks() {
        let mut entry = e("x", 64, None);
        entry.flash_device = Some("nope".to_string());
        let parts = allocate_partitions(&[entry], &caps());
        assert!(matches!(parts[0].status, Status::Blocked(_)));
    }

    // No flash_device → block immediately.
    #[test]
    fn missing_device_blocks() {
        let parts = allocate_partitions(
            &[StorageEntry {
                name: "x".to_string(),
                size_kib: 64,
                flash_device: None,
                offset_kib: None,
            }],
            &caps(),
        );
        match &parts[0].status {
            Status::Blocked(r) => assert!(r.contains("no flash_device")),
            Status::Ok => panic!("expected blocked"),
        }
    }
}
