// SPDX-License-Identifier: Apache-2.0
//! **LOCAL SPIKE demo — not for dev.** A runnable application that *loads the
//! rules from data first, then runs the engine on them.*
//!
//!   cargo run -p alp-core --example policy_engine_demo
//!   cargo run -p alp-core --example policy_engine_demo -- crates/alp-core/examples/policy.topdown.json
//!
//! With no argument it loads the built-in default policy (reproduces the SDK
//! layout); pass a policy JSON path to watch the SAME inputs produce a DIFFERENT
//! layout — proving the engine is driven by the loaded rules, not hardcoded.

use alp_core::policy_engine_spike::{
    DEFAULT_POLICY_JSON, allocate_partitions, endpoint_ids, kconfig_for_silicon, load_policy,
};

fn main() {
    // 1. LOAD THE RULES (from a file if given, else the built-in default).
    let (source, json) = match std::env::args().nth(1) {
        Some(path) => {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read policy {path}: {e}"));
            (path, text)
        }
        None => (
            "<built-in default>".to_string(),
            DEFAULT_POLICY_JSON.to_string(),
        ),
    };
    let policy = match load_policy(&json) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("policy load failed: {e}");
            std::process::exit(2);
        }
    };

    println!("== rules loaded from: {source} ==");
    println!(
        "  page={}B  partition={:?}  carveOut={:?}  kconfigPrefix={:?}",
        policy.page_bytes,
        policy.partition.strategy,
        policy.carve_out.strategy,
        policy.kconfig.soc_symbol_prefix
    );

    // 2. RUN THE ENGINE ON THE LOADED RULES — same inputs every run.
    let entries = vec![
        ("settings".to_string(), 64u64),
        ("app_data".to_string(), 128),
        ("mcuboot_scratch".to_string(), 32),
    ];
    let capacity_kib = 8192;

    println!("\n== partitions (capacity {capacity_kib} KiB) ==");
    for (name, base_kib, size_kib) in allocate_partitions(&entries, capacity_kib, &policy) {
        println!("  {name:<16} @ {base_kib:>5} KiB  ({size_kib} KiB)");
    }

    println!("\n== endpoint ids ==");
    for name in ["telemetry", "control"] {
        let (src, dst) = endpoint_ids(name, &policy);
        println!("  {name:<10} src=0x{src:04x} dst=0x{dst:04x}");
    }

    println!("\n== kconfig symbol ==");
    println!(
        "  alif:ensemble:e7 -> {}",
        kconfig_for_silicon("alif:ensemble:e7", &policy)
    );
}
