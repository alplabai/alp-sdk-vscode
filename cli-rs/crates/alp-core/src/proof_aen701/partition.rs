// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer (derivation)** — the storage-partition ALLOCATOR.
//! Allocates a physical offset for every board.yaml `storage:` entry by bump-
//! allocating BOTTOM-UP within each flash device (resolved from the SoM memory
//! map / on-module OSPI) — reproducing the SDK's `resolve_storage_partitions`
//! from DATA. It is the storage twin of `carveout.rs`: same resolved/blocked
//! convention, same `PAGE`, same `resolve_memory_map` device table. Carve-outs
//! grow top-down from a region ceiling; storage grows bottom-up from offset 0.

use std::collections::BTreeMap;

use super::carveout::{PAGE, align_up, region_size_bytes, resolve_memory_map};
use super::metadata::*;

/// One `storage:` entry after allocation (or blocked when unresolvable).
#[derive(Debug, Clone)]
pub(crate) struct ResolvedPartition {
    pub(crate) name: String,
    pub(crate) fs: String,
    pub(crate) flash_device: String,
    pub(crate) dt_label: String,
    pub(crate) base_kib: u64,
    pub(crate) size_kib: u64,
    pub(crate) mount: Option<String>,
    pub(crate) blocked: bool,
    pub(crate) reason: String,
}

struct FlashDescriptor {
    dt_label: String,
    size_bytes: u64,
}

fn blocked(entry: &StorageEntry, reason: String) -> ResolvedPartition {
    ResolvedPartition {
        name: entry.name.clone(),
        fs: entry.fs.clone(),
        flash_device: entry.flash_device.clone().unwrap_or_default(),
        dt_label: String::new(),
        base_kib: 0,
        size_kib: entry.size_kib,
        mount: entry.mount.clone(),
        blocked: true,
        reason,
    }
}

/// Resolve a `flash_device:` reference to a `(dt_label, capacity)`: a memory_map
/// region match first (covers the derived MRAM/SRAM table), then an
/// `on_module.ospi_memories` key. `Err(reason)` for a TBD/unknown device.
fn resolve_flash_device(
    device: &str,
    som: &SomPreset,
    soc: &SocSpec,
) -> Result<FlashDescriptor, String> {
    let sku = som.sku.clone().unwrap_or_else(|| "<unknown>".into());
    for region in resolve_memory_map(som, soc) {
        if region.name != device {
            continue;
        }
        let Some(size_bytes) = region_size_bytes(&region) else {
            return Err(format!(
                "flash device '{device}' resolves to a memory_map region but size_mib / size_kib is unset or TBD on SoM {sku}; the SoM hasn't been HW-mapped yet"
            ));
        };
        let dt_label = region
            .dt_label
            .clone()
            .unwrap_or_else(|| device.to_string());
        return Ok(FlashDescriptor {
            dt_label,
            size_bytes,
        });
    }

    // on_module.ospi_memories: key match (capacity_mbit → bytes).
    if let Some(serde_yaml::Value::Mapping(ospi)) = som.on_module.get("ospi_memories") {
        if let Some(entry) = ospi.get(serde_yaml::Value::String(device.to_string())) {
            let cap = entry.get("capacity_mbit");
            match cap {
                Some(serde_yaml::Value::String(s)) if s.trim().eq_ignore_ascii_case("TBD") => {
                    return Err(format!(
                        "on_module.ospi_memories.{device}.capacity_mbit is TBD on SoM {sku}; fill the value or move the storage entry to a sized flash device"
                    ));
                }
                Some(serde_yaml::Value::Number(n)) if n.as_u64().is_some() => {
                    let mbit = n.as_u64().unwrap();
                    let dt_label = entry
                        .get("dt_label")
                        .and_then(|v| v.as_str())
                        .unwrap_or(device)
                        .to_string();
                    return Ok(FlashDescriptor {
                        dt_label,
                        size_bytes: mbit * 1024 * 1024 / 8,
                    });
                }
                _ => {
                    return Err(format!(
                        "on_module.ospi_memories.{device}.capacity_mbit is missing on SoM {sku}; the storage allocator needs an authoritative capacity"
                    ));
                }
            }
        }
    }

    Err(format!(
        "flash device '{device}' is neither a memory_map region nor an on_module.ospi_memories key on SoM {sku}"
    ))
}

/// Allocate physical offsets for every `storage:` entry (the SDK's
/// `resolve_storage_partitions`): group by flash device (devices iterated
/// alphabetically), name-sort within each device, then bump bottom-up from
/// offset 0 page-aligned. An explicit `offset_kib:` is honoured verbatim (with
/// page-alignment + sibling-overlap checks). Capacity overrun, TBD/unknown
/// device, misaligned offset, or overlap → blocked.
pub(crate) fn resolve_storage_partitions(
    board: &BoardYaml,
    som: &SomPreset,
    soc: &SocSpec,
) -> Vec<ResolvedPartition> {
    if board.storage.is_empty() {
        return Vec::new();
    }

    let mut by_device: BTreeMap<String, Vec<&StorageEntry>> = BTreeMap::new();
    let mut no_device: Vec<&StorageEntry> = Vec::new();
    for entry in &board.storage {
        match &entry.flash_device {
            Some(dev) if !dev.is_empty() => by_device.entry(dev.clone()).or_default().push(entry),
            _ => no_device.push(entry),
        }
    }

    let mut resolved = Vec::new();

    for entry in no_device {
        resolved.push(blocked(
            entry,
            format!(
                "storage entry '{}' has no flash_device: declared; add one referencing a SoM memory_map region or an on_module.ospi_memories key",
                entry.name
            ),
        ));
    }

    // BTreeMap already iterates devices in sorted (alphabetical) order.
    for (device_name, mut entries) in by_device {
        let descriptor = match resolve_flash_device(&device_name, som, soc) {
            Ok(d) => d,
            Err(reason) => {
                for entry in entries {
                    resolved.push(blocked(entry, reason.clone()));
                }
                continue;
            }
        };
        let capacity_bytes = descriptor.size_bytes;
        entries.sort_by(|a, b| a.name.cmp(&b.name));

        let mut high_water: u64 = 0;
        let mut allocated: Vec<(u64, u64, String)> = Vec::new(); // (lo, hi, name)

        for entry in entries {
            let size_aligned = align_up(entry.size_kib * 1024, PAGE);

            let base_bytes = if let Some(off_kib) = entry.offset_kib {
                let base = off_kib * 1024;
                if base % PAGE != 0 {
                    resolved.push(blocked(
                        entry,
                        format!(
                            "storage entry '{}' explicit offset_kib={off_kib} is not page-aligned (4 KiB)",
                            entry.name
                        ),
                    ));
                    continue;
                }
                base
            } else {
                high_water
            };

            let top_bytes = base_bytes + size_aligned;
            if top_bytes > capacity_bytes {
                resolved.push(blocked(
                    entry,
                    format!(
                        "storage entry '{}' ({} KiB at offset {} KiB) overruns flash device '{device_name}' (capacity {} KiB)",
                        entry.name,
                        entry.size_kib,
                        base_bytes / 1024,
                        capacity_bytes / 1024
                    ),
                ));
                continue;
            }

            if let Some((_, _, peer)) = allocated
                .iter()
                .find(|(lo, hi, _)| !(top_bytes <= *lo || base_bytes >= *hi))
            {
                resolved.push(blocked(
                    entry,
                    format!(
                        "storage entry '{}' explicit offset_kib={} overlaps sibling partition '{peer}' on device '{device_name}'",
                        entry.name,
                        entry.offset_kib.unwrap_or(0)
                    ),
                ));
                continue;
            }

            allocated.push((base_bytes, top_bytes, entry.name.clone()));
            if entry.offset_kib.is_none() {
                high_water = top_bytes;
            }

            resolved.push(ResolvedPartition {
                name: entry.name.clone(),
                fs: entry.fs.clone(),
                flash_device: device_name.clone(),
                dt_label: descriptor.dt_label.clone(),
                base_kib: base_bytes / 1024,
                size_kib: size_aligned / 1024,
                mount: entry.mount.clone(),
                blocked: false,
                reason: String::new(),
            });
        }
    }

    resolved
}
