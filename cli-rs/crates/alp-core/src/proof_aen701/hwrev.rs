// SPDX-License-Identifier: Apache-2.0
//! **FORWARD-SPEC (a proposed mechanism, NOT a byte-for-byte reproduction)** —
//! the per-`(sku, hw_rev)` routing-override layer for alp-sdk#235's SoM
//! hardware-revision axis.
//!
//! ## What is already real (reproduced elsewhere in the bench)
//! v0.8.1's `--emit` ALREADY threads `hw_rev` into the manifest envelope
//! (`hw_info.som_hw_rev` / `board_hw_rev`) — `build_system_manifest` reproduces
//! that byte-for-byte (see the `*_system_manifest_matches_sdk_emit` tests). So the
//! prerequisite alpCaner named — *"if your engine threads hw_rev from the
//! oracle"* — is met.
//!
//! ## What v0.8.1 does NOT do (verified live against `--emit`)
//! Forcing a board.yaml from `r1`→`r2` changes ONLY the stamp string; the emitted
//! config is byte-identical (`hw_rev_is_stamped_but_config_is_rev_agnostic`
//! encodes this). The public `hw-revisions.yaml` carries the rev table + a human
//! `changes:` log, but there is no per-rev ROUTING delta and the resolver never
//! consumes one. The real two-rev delta is PUBLIC on the SDK's `dev`
//! (`hw-revisions-v1`: r2's `changes:` — `IO8`→WIFI_GPIO30, `IO10`→WIFI_GPIO35
//! both now CC3501E, `IO21` unrouted); only the raw netlist CSV (`2626-R2`) is
//! private. But that delta is human `changes:` PROSE, not machine-readable
//! routing, and `--emit` still doesn't apply it — so the emitted config is
//! rev-agnostic regardless.
//!
//! ## What this module adds
//! The missing applier: overlay a revision's `pad_route_overrides` onto the SoM's
//! base `pad_routes`, so an old-rev customer's build emits the old pinout
//! automatically. The bundle shape EXTENDS `hw-revisions-v1` with a
//! machine-readable `pad_route_overrides:` field. The bench's E7-era board_def
//! carries different CC3501E pads than R2's IO8/IO10/IO21, so the `r2` fixture
//! re-routes IO16/17/18 — the same mechanism on bench-renderable pads. This is
//! ready to gate byte-for-byte the moment the SDK makes the per-rev delta
//! machine-readable and applies it at emit — until then it is a spec against the
//! seam, not a reproduction.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::metadata::{PadRoute, SomPreset};

/// A SoM family's hardware-revision table — mirrors the SDK's
/// `metadata/e1m_modules/<family>/hw-revisions.yaml`, extended with
/// `pad_route_overrides` (the forward-spec addition).
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct HwRevisions {
    #[serde(default)]
    pub(crate) family: Option<String>,
    pub(crate) hw_revisions: BTreeMap<String, RevSpec>,
}

/// One revision's record. `status` + `changes` already exist in the SDK's table;
/// `pad_route_overrides` is the machine-readable routing delta this proposal adds.
#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct RevSpec {
    #[serde(default)]
    pub(crate) status: Option<String>,
    #[serde(default)]
    pub(crate) changes: Vec<String>,
    /// Per-rev pad-route overrides: each entry REPLACES (matched by `e1m`) the
    /// SoM's base dispatch for that pad on this revision; a pad absent here keeps
    /// its base routing. A new pad is appended.
    #[serde(default)]
    pub(crate) pad_route_overrides: Vec<PadRoute>,
}

/// Return a copy of `som` with its `pad_routes` overlaid by `rev`'s overrides.
/// An unknown `rev`, or a rev with no `pad_route_overrides`, returns the SoM
/// unchanged — i.e. the baseline (`r1`) emits exactly today's routing.
pub(crate) fn apply_hw_rev(som: &SomPreset, table: &HwRevisions, rev: &str) -> SomPreset {
    let mut out = som.clone();
    let Some(spec) = table.hw_revisions.get(rev) else {
        return out;
    };
    for ov in &spec.pad_route_overrides {
        match out.pad_routes.iter_mut().find(|pr| pr.e1m == ov.e1m) {
            Some(existing) => *existing = ov.clone(),
            None => out.pad_routes.push(ov.clone()),
        }
    }
    out
}
