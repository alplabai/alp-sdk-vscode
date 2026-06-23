// SPDX-License-Identifier: Apache-2.0
//! **BUNDLE layer** — the per-SoM bundle's loaded surface. A bundle is the
//! versioned `som/<SKU>/` folder bundling metadata (`som.yaml`), policy
//! (`policy.json`), and output templates (`templates/*.tmpl`). The engine loads
//! `bundle.yaml` (the [`BundleManifest`]) FIRST: it checks the manifest
//! `schemaVersion`, each layer's `schema`, and the `sdkCompatRange` (load-time,
//! before touching any layer), then resolves each layer by its declared `path`.
//! This module also holds the loaded [`Templates`] the writer fills.

use serde::Deserialize;

use super::macros::check_schema_version;
use super::pinmux::SUPPORTED_PIN_POLICY_SCHEMA;
use super::policy::SUPPORTED_POLICY_SCHEMA;

/// The SoM bundle's output TEMPLATES (`templates/*.tmpl`) — the shapes the engine
/// fills. Loaded from the bundle alongside its policy + metadata.
pub(crate) struct Templates {
    pub(crate) local_conf: String,
    pub(crate) kconfig: String,
    pub(crate) system_ipc_h: String,
    pub(crate) dts_reservations: String,
    pub(crate) dts_partitions: String,
    /// MCUboot sysbuild conf banner (P3); emitted into the build-plan only when
    /// the board declares a `boot:` block.
    pub(crate) sysbuild_conf: String,
    /// TF-M sysbuild conf banner (P2); emitted only when `security.psa.tfm: true`.
    pub(crate) tfm_sysbuild_conf: String,
}

// --- the bundle.yaml manifest (the engine's entry gate) ---

/// Manifest formats / per-layer schemas this engine understands. A bundle
/// declaring a different version is rejected (the per-layer versioning is what
/// makes a SoM bundle safe to evolve independently of the engine).
pub(crate) const SUPPORTED_BUNDLE_SCHEMA: u32 = 1;
pub(crate) const SUPPORTED_METADATA_SCHEMA: u32 = 1;
pub(crate) const SUPPORTED_TEMPLATE_SCHEMA: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundleManifest {
    /// The manifest FORMAT version (this file), engine-checked.
    pub(crate) schema_version: u32,
    pub(crate) som: String,
    /// CONTENT semver — independent of the SDK version.
    pub(crate) bundle_version: String,
    /// Which SDK releases this bundle serves (semver range), checked at load time.
    pub(crate) sdk_compat_range: String,
    pub(crate) layers: BundleLayers,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundleLayers {
    pub(crate) metadata: LayerRef,
    pub(crate) policy: LayerRef,
    /// The pin/peripheral validation rules — a SEPARATE layer from the build
    /// policy (silicon pin facts + their rules are their own concern).
    pub(crate) pin_policy: LayerRef,
    pub(crate) templates: TemplateLayers,
}

/// A single layer: where it lives (stable `path`) + its independent `schema`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LayerRef {
    pub(crate) path: String,
    pub(crate) schema: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TemplateLayers {
    pub(crate) local_conf: LayerRef,
    pub(crate) kconfig: LayerRef,
    pub(crate) system_ipc_h: LayerRef,
    pub(crate) dts_reservations: LayerRef,
    pub(crate) dts_partitions: LayerRef,
}

impl BundleManifest {
    /// Every template layer as `(name, LayerRef)`, for uniform schema-checking
    /// and path resolution.
    pub(crate) fn template_layers(&self) -> [(&'static str, &LayerRef); 5] {
        let t = &self.layers.templates;
        [
            ("template:localConf", &t.local_conf),
            ("template:kconfig", &t.kconfig),
            ("template:systemIpcH", &t.system_ipc_h),
            ("template:dtsReservations", &t.dts_reservations),
            ("template:dtsPartitions", &t.dts_partitions),
        ]
    }
}

/// Load + GATE a SoM `bundle.yaml`: validate the manifest format, every layer
/// schema, and the SDK-compat range BEFORE any layer is read. `sdk_version` is
/// the running SDK release (e.g. `"0.7.0"`). Mirrors npm peerDependencies /
/// Yocto `LAYERSERIES_COMPAT`: incompatibility is one clear early error, not a
/// runtime surprise.
pub(crate) fn load_bundle(yaml: &str, sdk_version: &str) -> Result<BundleManifest, String> {
    let m: BundleManifest =
        serde_yaml::from_str(yaml).map_err(|e| format!("invalid bundle.yaml: {e}"))?;
    check_schema_version!("bundle", m.schema_version, SUPPORTED_BUNDLE_SCHEMA);
    check_schema_version!(
        "metadata",
        m.layers.metadata.schema,
        SUPPORTED_METADATA_SCHEMA
    );
    check_schema_version!("policy", m.layers.policy.schema, SUPPORTED_POLICY_SCHEMA);
    check_schema_version!(
        "pin-policy",
        m.layers.pin_policy.schema,
        SUPPORTED_PIN_POLICY_SCHEMA
    );
    for (name, layer) in m.template_layers() {
        check_schema_version!(name, layer.schema, SUPPORTED_TEMPLATE_SCHEMA);
    }
    if !sdk_satisfies(&m.sdk_compat_range, sdk_version) {
        return Err(format!(
            "bundle '{}' serves SDK {} but the engine is running SDK {} — refusing to mis-serve; \
             pick a bundle whose sdkCompatRange covers {}",
            m.som, m.sdk_compat_range, sdk_version, sdk_version
        ));
    }
    Ok(m)
}

/// Parse a dotted version `a.b.c` (a missing patch defaults to 0; a leading `v`
/// is tolerated) into a comparable tuple.
fn parse_ver(v: &str) -> Option<(u32, u32, u32)> {
    let mut it = v.trim().trim_start_matches('v').split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next().unwrap_or("0").parse().ok()?;
    let patch = it.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// Does `sdk_version` satisfy a comma-separated semver `range` (e.g.
/// `">=0.6.0,<1.0.0"`)? Supports the `>=`, `<=`, `>`, `<`, `=` comparators; a
/// bare version means `=`. (A focused subset of the semver grammar — enough for
/// the load-time gate without pulling a dependency.)
fn sdk_satisfies(range: &str, sdk_version: &str) -> bool {
    let Some(sv) = parse_ver(sdk_version) else {
        return false;
    };
    range.split(',').all(|clause| {
        let clause = clause.trim();
        let (op, rest) = if let Some(r) = clause.strip_prefix(">=") {
            (">=", r)
        } else if let Some(r) = clause.strip_prefix("<=") {
            ("<=", r)
        } else if let Some(r) = clause.strip_prefix('>') {
            (">", r)
        } else if let Some(r) = clause.strip_prefix('<') {
            ("<", r)
        } else if let Some(r) = clause.strip_prefix('=') {
            ("=", r)
        } else {
            ("=", clause)
        };
        match parse_ver(rest) {
            Some(rv) => match op {
                ">=" => sv >= rv,
                "<=" => sv <= rv,
                ">" => sv > rv,
                "<" => sv < rv,
                _ => sv == rv,
            },
            None => false,
        }
    })
}
