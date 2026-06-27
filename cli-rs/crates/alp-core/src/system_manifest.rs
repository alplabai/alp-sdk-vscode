// SPDX-License-Identifier: Apache-2.0
//! The ALP **system manifest** (`build/system-manifest.yaml`) — the single
//! derived projection of a `board.yaml` that `west alp-build` emits, and the
//! IDE/tool CONTRACT for a (possibly multi-image) project. Tools read THIS for
//! folder layout + build/flash wiring instead of re-deriving from board.yaml +
//! the SoM presets.
//!
//! Vendored schema: `schemas/system-manifest-v1.schema.json` (alp-sdk v0.7.0;
//! verified unchanged through v0.8.0 — the `--emit system-manifest` contract did
//! not move, so the tolerant reader stays valid).
//!
//! TOLERANT READER (the stability policy negotiated in alp-sdk#106):
//! `schema_version` 1 is additive-only; a breaking change ships as v2 through a
//! deprecation cycle. So we never `deny_unknown_fields` (a newer SDK's additive
//! fields are ignored, not rejected), and fields the schema marks "required"
//! but the emitter omits for `off`/`pending` slices (`flash_method`/
//! `flash_args`) are modeled `Option`.

use serde::{Deserialize, Serialize};

/// The schema major this CLI consumes. A different value is rejected rather
/// than silently mis-applied.
pub const SYSTEM_MANIFEST_SCHEMA_VERSION: u32 = 1;

/// Resolved hardware identity for the project.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct HwInfo {
    /// Resolved board SKU (e.g. `E1M-AEN701`).
    #[serde(default)]
    pub sku: String,
    /// System-on-Module hardware revision, if declared.
    #[serde(default)]
    pub som_hw_rev: Option<String>,
    /// Carrier/EVK board name, if declared.
    #[serde(default)]
    pub board_name: Option<String>,
    /// Carrier/EVK board hardware revision, if declared.
    #[serde(default)]
    pub board_hw_rev: Option<String>,
    /// Resolved silicon id (e.g. `alif:ensemble:e7`), if declared.
    #[serde(default)]
    pub silicon: Option<String>,
}

/// One per-core image: its runtime + the build/flash wiring the IDE needs to
/// build, run, debug, and flash it without re-deriving anything.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slice {
    /// Core identifier this image targets (e.g. `m55_hp`, `a32_cluster`).
    pub core_id: String,
    /// Resolved runtime (`zephyr` | `yocto` | `baremetal` | `off`); the
    /// value-set is owned by `board.schema.json` `cores.<core>.os`.
    pub os: String,
    /// Application source path or app/recipe name for this image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    /// Yocto image name, when `os` is `yocto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// Yocto machine, when `os` is `yocto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine: Option<String>,
    /// Zephyr board target, when `os` is `zephyr`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board: Option<String>,
    /// Resolved toolchain id for building this image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolchain: Option<String>,
    /// Build output directory for this image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_dir: Option<String>,
    /// Path to the built firmware/image artefact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_artefact: Option<String>,
    /// Build/flash status (e.g. `pending`, `built`, `blocked`).
    #[serde(default)]
    pub status: String,
    /// Path to this slice's build log, if produced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    /// Human-readable explanation when `status` indicates a problem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Schema-required, but the emitter omits it for `off`/`pending` slices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flash_method: Option<String>,
    /// Method-specific (shape varies by `flash_method`); kept opaque.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flash_args: Option<serde_yaml::Value>,
}

impl Slice {
    /// A slice that participates in build/flash (its core isn't `off`).
    pub fn is_active(&self) -> bool {
        self.os != "off"
    }
}

/// An inter-core link (rpmsg / mailbox) with its resolved carve-out. A blocked
/// link carries `status: blocked` + `reason`. Extra carve-out fields beyond the
/// schema's `required` set are tolerated (the schema is `additionalProperties:
/// true` here) and ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IpcLink {
    /// Link name.
    pub name: String,
    /// Transport kind (e.g. `rpmsg`, `mailbox`).
    pub kind: String,
    /// Core ids participating in the link.
    #[serde(default)]
    pub endpoints: Vec<String>,
    /// Link status (e.g. `blocked`), when not implicitly OK.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Explanation when `status` is `blocked`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// An on-module helper MCU (e.g. the GD32 bridge) that ships its own firmware.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HelperMcu {
    /// Helper MCU name.
    pub name: String,
    /// Chip part id (e.g. `cc3501e`).
    pub chip: String,
    /// Path to the helper's firmware image, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firmware_path: Option<String>,
    /// Flash method id for this helper, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flash_method: Option<String>,
    /// An object, or the string `"TBD"` when the recipe isn't finalized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flash_args: Option<serde_yaml::Value>,
}

/// The whole manifest — the deserialization target for `build/system-manifest.yaml`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemManifest {
    /// Schema major version; guarded against `SYSTEM_MANIFEST_SCHEMA_VERSION`.
    pub schema_version: u32,
    /// Identifier of the tool/script that emitted this manifest.
    #[serde(default)]
    pub generated_by: String,
    /// Resolved hardware identity.
    #[serde(default)]
    pub hw_info: HwInfo,
    /// Per-core images.
    #[serde(default)]
    pub slices: Vec<Slice>,
    /// Inter-core links.
    #[serde(default)]
    pub ipc: Vec<IpcLink>,
    /// On-module helper MCUs.
    #[serde(default)]
    pub helper_mcus: Vec<HelperMcu>,
    /// Inter-image boot sequencing — opaque until a SoM declares `boot_order`.
    #[serde(default)]
    pub boot_order: Vec<serde_yaml::Value>,
    /// Resolved storage partitions — present only when the project declares storage.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub storage: Vec<serde_yaml::Value>,
}

impl SystemManifest {
    /// Slices whose core participates in build/flash (`os != off`).
    pub fn active_slices(&self) -> impl Iterator<Item = &Slice> {
        self.slices.iter().filter(|s| s.is_active())
    }

    /// The slice for a given core id, if present.
    pub fn slice_for_core(&self, core_id: &str) -> Option<&Slice> {
        self.slices.iter().find(|s| s.core_id == core_id)
    }
}

/// Why a system-manifest could not be consumed.
#[derive(Debug, thiserror::Error)]
pub enum SystemManifestError {
    /// The document is not valid YAML or doesn't match the manifest shape.
    #[error("system-manifest is not valid YAML: {0}")]
    Parse(String),
    /// `schema_version` differs from the version this CLI consumes.
    #[error(
        "unsupported system-manifest schema_version {found} (this CLI consumes v{supported}); \
         upgrade the CLI or the SDK so the versions match"
    )]
    UnsupportedSchemaVersion { found: u32, supported: u32 },
}

/// Parse + version-guard a `system-manifest.yaml` document. Pure: no IO.
/// Tolerant — unknown additive-v1 fields are ignored.
pub fn parse_system_manifest(yaml: &str) -> Result<SystemManifest, SystemManifestError> {
    let manifest: SystemManifest =
        serde_yaml::from_str(yaml).map_err(|e| SystemManifestError::Parse(e.to_string()))?;
    if manifest.schema_version != SYSTEM_MANIFEST_SCHEMA_VERSION {
        return Err(SystemManifestError::UnsupportedSchemaVersion {
            found: manifest.schema_version,
            supported: SYSTEM_MANIFEST_SCHEMA_VERSION,
        });
    }
    Ok(manifest)
}

/// Deterministic, human-readable summary lines (text-mode `alp build`). Pure.
pub fn summarize_manifest(m: &SystemManifest) -> Vec<String> {
    let mut lines = vec![format!(
        "system-manifest: {} — {} slice(s), {} active, {} ipc, {} helper mcu(s)",
        m.hw_info.sku,
        m.slices.len(),
        m.active_slices().count(),
        m.ipc.len(),
        m.helper_mcus.len(),
    )];
    for s in &m.slices {
        let target = s
            .board
            .as_deref()
            .or(s.machine.as_deref())
            .or(s.image.as_deref())
            .unwrap_or("-");
        lines.push(format!(
            "  {} [{}] {} ({})",
            s.core_id, s.os, s.status, target
        ));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    // The real `--emit system-manifest` output for the heterogeneous AEN701
    // example: an `off` A-core slice WITHOUT flash_method/flash_args, two Zephyr
    // slices WITH them, and a helper MCU whose flash_args is the string "TBD"
    // plus an undeclared `note` field — all the tolerant-reader corner cases.
    const AEN701: &str = r#"
schema_version: 1
generated_by: scripts/alp_orchestrate.py
hw_info:
  sku: E1M-AEN701
  som_hw_rev: r1
  board_name: E1M-EVK
  board_hw_rev: r1
  silicon: alif:ensemble:e7
slices:
- core_id: a32_cluster
  os: 'off'
  app: alp-image-edge
  machine: e1m-aen701-a32
  toolchain: poky-glibc
  status: pending
- core_id: m55_hp
  os: zephyr
  app: ./src
  board: alp_e1m_aen701_m55_hp
  toolchain: arm-zephyr-eabi
  status: pending
  flash_method: zephyr_west_flash
  flash_args:
    runner: openocd
- core_id: m55_he
  os: zephyr
  app: alp-stock-shim
  board: alp_e1m_aen701_m55_he
  toolchain: arm-zephyr-eabi
  status: pending
  flash_method: zephyr_west_flash
  flash_args:
    runner: openocd
ipc: []
helper_mcus:
- name: cc3501e_otp
  chip: cc3501e
  firmware_path: TBD
  flash_method: TBD
  flash_args: TBD
  note: firmware_path TBD; populated when the upstream firmware release lands
boot_order: []
"#;

    #[test]
    fn parses_the_real_aen701_manifest() {
        let m = parse_system_manifest(AEN701).expect("valid manifest");
        assert_eq!(m.schema_version, 1);
        assert_eq!(m.generated_by, "scripts/alp_orchestrate.py");
        assert_eq!(m.hw_info.sku, "E1M-AEN701");
        assert_eq!(m.hw_info.silicon.as_deref(), Some("alif:ensemble:e7"));
        assert_eq!(m.slices.len(), 3);

        // The `off` slice omits flash_method/flash_args — tolerated as None.
        let a32 = m.slice_for_core("a32_cluster").expect("a32 slice");
        assert_eq!(a32.os, "off");
        assert!(a32.flash_method.is_none());
        assert!(!a32.is_active());

        // An active Zephyr slice carries the flash wiring.
        let hp = m.slice_for_core("m55_hp").expect("m55_hp slice");
        assert_eq!(hp.flash_method.as_deref(), Some("zephyr_west_flash"));
        assert!(hp.is_active());
        assert_eq!(m.active_slices().count(), 2);

        // Helper MCU keeps its string flash_args; the undeclared `note` is ignored.
        assert_eq!(m.helper_mcus.len(), 1);
        assert_eq!(m.helper_mcus[0].chip, "cc3501e");
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let yaml = AEN701.replace("schema_version: 1", "schema_version: 2");
        let err = parse_system_manifest(&yaml).unwrap_err();
        assert!(matches!(
            err,
            SystemManifestError::UnsupportedSchemaVersion { found: 2, .. }
        ));
    }

    #[test]
    fn tolerates_unknown_additive_fields() {
        // A future additive-v1 block at the root must be ignored, not rejected.
        let yaml = format!("{AEN701}\nfuture_block:\n  anything: 1\n");
        let m = parse_system_manifest(&yaml).expect("unknown fields tolerated");
        assert_eq!(m.slices.len(), 3);
    }

    #[test]
    fn round_trips_through_serde() {
        let m = parse_system_manifest(AEN701).unwrap();
        let yaml = serde_yaml::to_string(&m).unwrap();
        let reparsed = parse_system_manifest(&yaml).unwrap();
        assert_eq!(m, reparsed);
    }
}
