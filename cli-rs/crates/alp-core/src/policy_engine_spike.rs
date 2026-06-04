// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE — not for dev.** The load-bearing proof: *rules are loaded from
//! DATA first, then the engine runs on them.* No allocation/derivation constant
//! is hardcoded — page size, allocation strategy, region ranking, endpoint-id
//! scheme, TCM convention and the Kconfig rule all come from a `Policy`
//! deserialized at runtime.
//!
//! Strong-evidence tests:
//!   * with the DEFAULT policy the engine reproduces the SDK's exact offsets /
//!     endpoint masks (data-driven, yet faithful), and
//!   * changing the policy DATA changes the engine's output predictably
//!     (top-down vs bottom-up, a different endpoint mask, a different page size,
//!     a different Kconfig prefix), and
//!   * an unknown strategy in the JSON is a hard load error, never silent.
//!
//! This closes the gap the earlier spikes left open: they proved the algorithms
//! are generic + the inputs can be data; this proves the RULES live in data.

use serde::Deserialize;

// ----------------------------------------------------------------------------
// Policy — the rules, loaded from data (e.g. metadata/policy/build.json).
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub page_bytes: u64,
    pub partition: PartitionPolicy,
    pub carve_out: CarveOutPolicy,
    pub memory_map: MemoryMapPolicy,
    pub kconfig: KconfigPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum AllocStrategy {
    #[serde(rename = "bottom-up-bump")]
    BottomUpBump,
    #[serde(rename = "top-down-bump")]
    TopDownBump,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RankKey {
    #[serde(rename = "cacheable-match")]
    CacheableMatch,
    #[serde(rename = "smaller-first")]
    SmallerFirst,
    #[serde(rename = "larger-first")]
    LargerFirst,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum HashKind {
    #[serde(rename = "fnv1a-32")]
    Fnv1a32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionPolicy {
    pub strategy: AllocStrategy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarveOutPolicy {
    pub strategy: AllocStrategy,
    pub region_ranking: Vec<RankKey>,
    pub endpoint_id: EndpointIdPolicy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointIdPolicy {
    pub hash: HashKind,
    pub src_mask: u32,
    pub dst_offset: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMapPolicy {
    /// e.g. "_{CORE}_" — `{CORE}` is replaced by each core id (uppercased).
    pub tcm_suffix: String,
    pub tcm_cacheable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KconfigPolicy {
    /// e.g. "ALP_SOC_" — prepended to `silicon.to_uppercase().replace(':','_')`.
    pub soc_symbol_prefix: String,
}

/// Load the rules from data. An unknown strategy / hash / rank key is a hard
/// error here — the engine never runs on a policy it doesn't understand.
pub fn load_policy(json: &str) -> Result<Policy, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid build policy: {e}"))
}

// ----------------------------------------------------------------------------
// Engine — runs *according to the loaded policy*. No hardcoded rules.
// ----------------------------------------------------------------------------

fn align_up(v: u64, page: u64) -> u64 {
    v.div_ceil(page) * page
}

fn fnv1a_32(data: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &b in data {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// (name, base_kib, size_kib)
pub type Partition = (String, u64, u64);

/// Allocate partitions per the loaded policy: page size + direction both come
/// from `policy`. Name-sorted for determinism.
pub fn allocate_partitions(
    entries: &[(String, u64)], // (name, size_kib)
    capacity_kib: u64,
    policy: &Policy,
) -> Vec<Partition> {
    let page = policy.page_bytes;
    let mut sorted = entries.to_vec();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out = Vec::new();
    match policy.partition.strategy {
        AllocStrategy::BottomUpBump => {
            let mut hw = 0u64;
            for (name, size_kib) in sorted {
                let sz = align_up(size_kib * 1024, page);
                out.push((name, hw / 1024, sz / 1024));
                hw += sz;
            }
        }
        AllocStrategy::TopDownBump => {
            let mut top = capacity_kib * 1024;
            for (name, size_kib) in sorted {
                let sz = align_up(size_kib * 1024, page);
                top -= sz;
                out.push((name, top / 1024, sz / 1024));
            }
        }
    }
    out
}

/// Endpoint IDs per the loaded policy (hash kind + src mask + dst offset).
pub fn endpoint_ids(name: &str, policy: &Policy) -> (u32, u32) {
    let h = match policy.carve_out.endpoint_id.hash {
        HashKind::Fnv1a32 => fnv1a_32(name.as_bytes()),
    };
    let low = h & 0xFF;
    let src = policy.carve_out.endpoint_id.src_mask | low;
    let dst = src + policy.carve_out.endpoint_id.dst_offset;
    (src, dst)
}

/// Rank candidate regions per the loaded `regionRanking` list. Returns the index
/// order; the first is chosen. Demonstrates ranking is data-driven.
pub fn rank_regions(
    sizes_and_cacheable: &[(u64, bool)],
    prefers_cacheable: bool,
    policy: &Policy,
) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..sizes_and_cacheable.len()).collect();
    idx.sort_by(|&a, &b| {
        for key in &policy.carve_out.region_ranking {
            let (sa, ca) = sizes_and_cacheable[a];
            let (sb, cb) = sizes_and_cacheable[b];
            let ord = match key {
                RankKey::CacheableMatch => {
                    let ma = (ca == prefers_cacheable) as u8;
                    let mb = (cb == prefers_cacheable) as u8;
                    mb.cmp(&ma) // match (true=1) first
                }
                RankKey::SmallerFirst => sa.cmp(&sb),
                RankKey::LargerFirst => sb.cmp(&sa),
            };
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
        }
        std::cmp::Ordering::Equal
    });
    idx
}

/// `(name, size_kib, accessible_from, cacheable)` regions derived per policy:
/// the TCM suffix convention + TCM cacheability come from `policy`.
pub fn derive_tcm_region(
    bank_name: &str,
    cores: &[String],
    policy: &Policy,
) -> (Vec<String>, bool) {
    let bank_upper = bank_name.to_uppercase();
    let mut accessible = cores.to_vec();
    for core in cores {
        let token = policy
            .memory_map
            .tcm_suffix
            .replace("{CORE}", &core.to_uppercase());
        if bank_upper.contains(&token.to_uppercase()) {
            accessible = vec![core.clone()];
            break;
        }
    }
    let is_tcm = bank_upper.contains("ITCM") || bank_upper.contains("DTCM");
    let cacheable = if is_tcm {
        policy.memory_map.tcm_cacheable
    } else {
        true
    };
    (accessible, cacheable)
}

/// SoC Kconfig symbol per the loaded prefix rule.
pub fn kconfig_for_silicon(silicon: &str, policy: &Policy) -> String {
    format!(
        "{}{}",
        policy.kconfig.soc_symbol_prefix,
        silicon.to_uppercase().replace(':', "_")
    )
}

/// The default policy — the rules that reproduce today's SDK behavior. Shipped
/// as data; here as a const so tests + the example can load it at runtime.
pub const DEFAULT_POLICY_JSON: &str = r#"{
  "pageBytes": 4096,
  "partition": { "strategy": "bottom-up-bump" },
  "carveOut": {
    "strategy": "top-down-bump",
    "regionRanking": ["cacheable-match", "smaller-first"],
    "endpointId": { "hash": "fnv1a-32", "srcMask": 1024, "dstOffset": 1 }
  },
  "memoryMap": { "tcmSuffix": "_{CORE}_", "tcmCacheable": false },
  "kconfig": { "socSymbolPrefix": "ALP_SOC_" }
}"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn default_policy() -> Policy {
        load_policy(DEFAULT_POLICY_JSON).unwrap()
    }

    fn sdk_entries() -> Vec<(String, u64)> {
        vec![
            ("settings".to_string(), 64),
            ("app_data".to_string(), 128),
            ("mcuboot_scratch".to_string(), 32),
        ]
    }

    // PROOF 1: rules loaded from DATA reproduce the SDK's exact offsets.
    #[test]
    fn default_policy_reproduces_sdk_partition_offsets() {
        let p = default_policy();
        let parts = allocate_partitions(&sdk_entries(), 8192, &p);
        let by: std::collections::BTreeMap<_, _> = parts
            .iter()
            .map(|(n, b, s)| (n.clone(), (*b, *s)))
            .collect();
        assert_eq!(by["app_data"], (0, 128));
        assert_eq!(by["mcuboot_scratch"], (128, 32));
        assert_eq!(by["settings"], (160, 64));
    }

    // PROOF 2: change the strategy DATA → the engine's output changes. Same
    // entries, top-down policy → allocated from the top of the device.
    #[test]
    fn topdown_policy_changes_offsets() {
        let json = DEFAULT_POLICY_JSON.replace("bottom-up-bump", "top-down-bump");
        let p = load_policy(&json).unwrap();
        let parts = allocate_partitions(&sdk_entries(), 8192, &p);
        let by: std::collections::BTreeMap<_, _> = parts
            .iter()
            .map(|(n, b, s)| (n.clone(), (*b, *s)))
            .collect();
        // name-sorted: app_data first → top-128KiB; then mcuboot_scratch; then settings.
        assert_eq!(by["app_data"], (8192 - 128, 128)); // 8064
        assert_eq!(by["mcuboot_scratch"], (8192 - 128 - 32, 32)); // 8032
        assert_eq!(by["settings"], (8192 - 128 - 32 - 64, 64)); // 7968
        // ...and it genuinely differs from the default (bottom-up) layout.
        assert_ne!(by["app_data"].0, 0);
    }

    // PROOF 3: page size is data-driven — a bigger page changes alignment.
    #[test]
    fn page_size_from_policy_changes_alignment() {
        let json = DEFAULT_POLICY_JSON.replace("\"pageBytes\": 4096", "\"pageBytes\": 8192");
        let p = load_policy(&json).unwrap();
        // 32 KiB entry aligns up to 8 KiB page anyway (32 is a multiple); use a
        // 4 KiB entry that's NOT an 8 KiB multiple to see the rounding shift.
        let parts = allocate_partitions(&[("a".to_string(), 4), ("b".to_string(), 4)], 1024, &p);
        let by: std::collections::BTreeMap<_, _> = parts
            .iter()
            .map(|(n, b, s)| (n.clone(), (*b, *s)))
            .collect();
        // 4 KiB rounds up to the 8 KiB page → size_kib 8, b starts at 8 not 4.
        assert_eq!(by["a"], (0, 8));
        assert_eq!(by["b"], (8, 8));
    }

    // PROOF 4: endpoint-id scheme is data-driven (default reproduces SDK mask).
    #[test]
    fn endpoint_ids_from_policy() {
        let p = default_policy();
        let (src, dst) = endpoint_ids("telemetry", &p);
        assert_eq!(src & 0xFFFF_FF00, 0x400); // SDK: src_mask 0x400
        assert_eq!(dst, src + 1);

        // Change the mask DATA → IDs move.
        let json = DEFAULT_POLICY_JSON.replace("\"srcMask\": 1024", "\"srcMask\": 1280"); // 0x500
        let p2 = load_policy(&json).unwrap();
        let (src2, _) = endpoint_ids("telemetry", &p2);
        assert_eq!(src2 & 0xFFFF_FF00, 0x500);
    }

    // PROOF 5: region ranking is data-driven — flipping to larger-first reverses.
    #[test]
    fn region_ranking_from_policy() {
        let regions = [(1024u64, false), (256u64, false)]; // sizes; neither cacheable
        let p = default_policy(); // cacheable-match, smaller-first
        assert_eq!(rank_regions(&regions, false, &p)[0], 1); // 256 (smaller) first

        let json = DEFAULT_POLICY_JSON.replace("\"smaller-first\"", "\"larger-first\"");
        let p2 = load_policy(&json).unwrap();
        assert_eq!(rank_regions(&regions, false, &p2)[0], 0); // 1024 (larger) first
    }

    // PROOF 6: TCM convention + Kconfig rule are data-driven.
    #[test]
    fn tcm_and_kconfig_from_policy() {
        let p = default_policy();
        let cores = vec!["m55_he".to_string(), "m55_hp".to_string()];
        let (acc, cacheable) = derive_tcm_region("SRAM_M55_HE_ITCM", &cores, &p);
        assert_eq!(acc, vec!["m55_he".to_string()]);
        assert!(!cacheable); // tcmCacheable: false
        assert_eq!(
            kconfig_for_silicon("alif:ensemble:e7", &p),
            "ALP_SOC_ALIF_ENSEMBLE_E7"
        );

        // Change the prefix DATA → the symbol changes.
        let json = DEFAULT_POLICY_JSON.replace("\"ALP_SOC_\"", "\"MYVENDOR_SOC_\"");
        let p2 = load_policy(&json).unwrap();
        assert_eq!(
            kconfig_for_silicon("alif:ensemble:e7", &p2),
            "MYVENDOR_SOC_ALIF_ENSEMBLE_E7"
        );
    }

    // PROOF 7: an unknown strategy in the DATA is a hard load error, never silent.
    #[test]
    fn unknown_strategy_is_a_load_error() {
        let json = DEFAULT_POLICY_JSON.replace("bottom-up-bump", "buddy-allocator-9000");
        let err = load_policy(&json).unwrap_err();
        assert!(err.contains("invalid build policy"), "got: {err}");
    }

    // The default policy round-trips structurally.
    #[test]
    fn default_policy_loads() {
        let p = default_policy();
        assert_eq!(p.page_bytes, 4096);
        assert_eq!(p.partition.strategy, AllocStrategy::BottomUpBump);
        assert_eq!(p.carve_out.strategy, AllocStrategy::TopDownBump);
    }
}
