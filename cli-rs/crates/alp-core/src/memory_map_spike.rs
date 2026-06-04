// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE — not for dev.** Rust port of the SDK's memory-map *derivation*
//! (`alp_project.py::resolve_memory_map`, dev branch — the bank→region transform
//! after the override / SoC-`memory_regions` short-circuits).
//!
//! Third spike datapoint: this is a **transform**, not an allocator. It tests
//! the "silicon = data" thesis directly — the SoC variant (MRAM size, SRAM
//! banks) arrives as DATA; the derivation is one generic rule applied to
//! whatever banks are declared (no per-SoC branching). The file I/O +
//! override/`memory_regions` short-circuits stay in the input-resolution layer;
//! here we port the generic derivation that's the "engine" part.

/// SoC variant facts (DATA — from the SoC JSON). Bank order preserved as a Vec
/// to match the Python dict's insertion order (YAML-declared order).
#[derive(Debug, Clone)]
pub struct SocVariant {
    pub mram_mb: Option<f64>,
    pub sram_banks_kb: Vec<(String, i64)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryRegion {
    pub name: String,
    pub size_kib: u64,
    pub accessible_from: Vec<String>,
    pub cacheable: bool,
}

/// Derive the effective region table from a SoC variant + its core ids.
/// Mirrors `resolve_memory_map`'s derivation step-for-step:
///   * MRAM → one `mram_main` region, all cores, cacheable.
///   * each SRAM bank → one region; a `_<CORE>_` suffix pins it to that core,
///     else shared across all cores; ITCM/DTCM banks are non-cacheable.
pub fn derive_memory_map(variant: &SocVariant, soc_cores: &[String]) -> Vec<MemoryRegion> {
    let mut regions: Vec<MemoryRegion> = Vec::new();

    // MRAM as one region (mram_mb -> KiB; int() truncates toward zero).
    if let Some(mram_mb) = variant.mram_mb {
        if mram_mb > 0.0 {
            regions.push(MemoryRegion {
                name: "mram_main".to_string(),
                size_kib: (mram_mb * 1024.0) as u64,
                accessible_from: soc_cores.to_vec(),
                cacheable: true,
            });
        }
    }

    // SRAM banks. Per-core TCM banks get `accessible_from: [<core>]`; the rest
    // are shared across every core in the SoC.
    for (bank_name, size_kib) in &variant.sram_banks_kb {
        if *size_kib <= 0 {
            continue;
        }
        let bank_upper = bank_name.to_uppercase();

        let mut accessible: Vec<String> = soc_cores.to_vec();
        for core_id in soc_cores {
            let suffix_token = format!("_{}_", core_id.to_uppercase());
            if bank_upper.contains(&suffix_token) {
                accessible = vec![core_id.clone()];
                break;
            }
        }

        let is_tcm = bank_upper.contains("ITCM") || bank_upper.contains("DTCM");
        regions.push(MemoryRegion {
            name: bank_name.to_lowercase(),
            size_kib: *size_kib as u64,
            accessible_from: accessible,
            cacheable: !is_tcm,
        });
    }

    regions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cores() -> Vec<String> {
        vec!["m55_hp".to_string(), "m55_he".to_string()]
    }

    // Rule parity (cites resolve_memory_map): MRAM → one region, all cores,
    // cacheable; size = mram_mb * 1024.
    #[test]
    fn mram_becomes_one_shared_cacheable_region() {
        let v = SocVariant {
            mram_mb: Some(5.5),
            sram_banks_kb: vec![],
        };
        let regions = derive_memory_map(&v, &cores());
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].name, "mram_main");
        assert_eq!(regions[0].size_kib, 5632); // 5.5 * 1024
        assert_eq!(regions[0].accessible_from, cores());
        assert!(regions[0].cacheable);
    }

    // Per-core TCM by `_<CORE>_` suffix → single core; ITCM/DTCM → non-cacheable.
    #[test]
    fn tcm_suffix_pins_to_core_and_is_noncacheable() {
        let v = SocVariant {
            mram_mb: None,
            sram_banks_kb: vec![
                ("SRAM_M55_HE_ITCM".to_string(), 256),
                ("SRAM_M55_HP_DTCM".to_string(), 128),
            ],
        };
        let regions = derive_memory_map(&v, &cores());
        assert_eq!(regions.len(), 2);
        // name lowercased
        assert_eq!(regions[0].name, "sram_m55_he_itcm");
        assert_eq!(regions[0].accessible_from, vec!["m55_he".to_string()]);
        assert!(!regions[0].cacheable); // ITCM
        assert_eq!(regions[1].accessible_from, vec!["m55_hp".to_string()]);
        assert!(!regions[1].cacheable); // DTCM
    }

    // Bulk SRAM (no core suffix) → shared across all cores, cacheable.
    #[test]
    fn bulk_sram_is_shared_and_cacheable() {
        let v = SocVariant {
            mram_mb: None,
            sram_banks_kb: vec![("sram0".to_string(), 4096)],
        };
        let regions = derive_memory_map(&v, &cores());
        assert_eq!(regions[0].name, "sram0");
        assert_eq!(regions[0].accessible_from, cores());
        assert!(regions[0].cacheable);
    }

    // Non-positive bank size is skipped; declared order is preserved.
    #[test]
    fn skips_nonpositive_and_preserves_order() {
        let v = SocVariant {
            mram_mb: Some(2.0),
            sram_banks_kb: vec![
                ("sram_a".to_string(), 1024),
                ("sram_bad".to_string(), 0),
                ("sram_b".to_string(), 512),
            ],
        };
        let regions = derive_memory_map(&v, &cores());
        let names: Vec<&str> = regions.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["mram_main", "sram_a", "sram_b"]); // bad skipped, order kept
    }
}
