// SPDX-License-Identifier: Apache-2.0
//! Rust mirror of `packages/alp-core/src/sdkCatalogue/{parse,derive}.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};
use std::collections::BTreeMap;

/// A System-on-Module (SoM) preset derived from an SDK `som` definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SomPreset {
    /// Module SKU, e.g. `E1M-AEN701`.
    pub sku: String,
    /// Human-readable module name (falls back to `sku` when absent).
    pub display_name: String,
    /// SoM family key used to match boards and chips, e.g. `aen`.
    pub family: String,
    /// Silicon identifier, e.g. `alif-e7`.
    pub silicon: String,
    /// Optional silicon variant suffix.
    #[serde(default)]
    pub silicon_variant: Option<String>,
    /// Preferred inference backend id (from `inference.preferred_backend`).
    #[serde(default)]
    pub preferred_backend: Option<String>,
    /// Capability flags keyed by name (e.g. `deepx_dx`).
    #[serde(default)]
    pub capabilities: BTreeMap<String, bool>,
    /// Default board `name` to preselect, if any.
    #[serde(default)]
    pub default_board: Option<String>,
    /// Core ids declared under `topology`, in map order.
    #[serde(default)]
    pub topology_core_ids: Vec<String>,
    /// Per-core topology entries.
    #[serde(default)]
    pub topology: Vec<TopologyCore>,
    /// On-module string entries (excludes the `silicon` key).
    #[serde(default)]
    pub on_module: Vec<String>,
    /// DRAM/flash sizing, when declared under `memory`.
    #[serde(default)]
    pub memory: Option<MemorySpec>,
    /// Whether the SoM is marked preliminary (from `status.preliminary`).
    #[serde(default)]
    pub preliminary: bool,
    /// Pin/pad routing entries from `pad_routes`.
    #[serde(default)]
    pub pad_routes: Vec<PadRoute>,
    /// I2C devices flattened from `on_module.i2c_devices`.
    #[serde(default)]
    pub i2c_devices: Vec<I2cDevice>,
}

/// A single pad-routing entry mapping an E1M pad to a dispatch target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PadRoute {
    /// E1M pad name (required; entries without it are dropped on parse).
    pub e1m: String,
    /// Dispatch destination identifier.
    pub dispatch: String,
    /// Optional specific dispatch pin.
    #[serde(default)]
    pub dispatch_pin: Option<String>,
    /// Optional free-form documentation note.
    #[serde(default)]
    pub doc: Option<String>,
}

/// An on-module I2C device, keyed by the bus it sits on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct I2cDevice {
    /// I2C bus key, e.g. `i2c0`.
    pub bus: String,
    /// Chip identifier (required; entries without it are skipped on parse).
    pub chip: String,
    /// Optional role label (e.g. `sensor`).
    #[serde(default)]
    pub role: Option<String>,
    /// Optional 7-bit address (from `address_7bit`).
    #[serde(default)]
    pub address: Option<String>,
}

/// One core entry within a SoM's `topology` map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyCore {
    /// Core id (the topology map key), e.g. `m55_hp`.
    pub id: String,
    /// Optional application source path for this core.
    #[serde(default)]
    pub app: Option<String>,
    /// Optional image name/target.
    #[serde(default)]
    pub image: Option<String>,
    /// Optional machine identifier.
    #[serde(default)]
    pub machine: Option<String>,
    /// Optional board override for this core.
    #[serde(default)]
    pub board: Option<String>,
    /// Optional toolchain override for this core.
    #[serde(default)]
    pub toolchain: Option<String>,
}

/// DRAM/flash sizing for a SoM, in megabits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorySpec {
    /// DRAM size in megabits.
    #[serde(default)]
    pub dram_mbit: Option<u32>,
    /// Flash size in megabits.
    #[serde(default)]
    pub flash_mbit: Option<u32>,
}

/// A board preset derived from an SDK `board` definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardPreset {
    /// Board `name` slug, e.g. `e1m-evk`.
    pub name: String,
    /// Human-readable board name (falls back to `name`).
    pub display_name: String,
    /// SoM family keys this board can host.
    #[serde(default)]
    pub hosts_som_families: Vec<String>,
    /// Default chip-population flags keyed by chip id.
    #[serde(default)]
    pub populated: BTreeMap<String, bool>,
}

/// A chip definition derived from an SDK `chip` definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChipDef {
    /// Chip identifier slug.
    pub chip_id: String,
    /// Human-readable chip name (falls back to `chip_id`).
    pub display_name: String,
    /// SoM families this chip applies to.
    #[serde(default)]
    pub families: Vec<String>,
    /// Optional vendor name.
    #[serde(default)]
    pub vendor: Option<String>,
    /// Optional bus the chip sits on.
    #[serde(default)]
    pub bus: Option<String>,
    /// Optional driver maturity status.
    #[serde(default)]
    pub driver_status: Option<String>,
    /// Optional Kconfig symbol mapping, present only when non-empty.
    #[serde(default)]
    pub kconfig: Option<ChipKconfig>,
}

/// Per-target Kconfig symbol names that enable a chip's driver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChipKconfig {
    /// Zephyr Kconfig symbol, e.g. `CONFIG_CHIP_A`.
    #[serde(default)]
    pub zephyr: Option<String>,
    /// Baremetal Kconfig symbol.
    #[serde(default)]
    pub baremetal: Option<String>,
}

/// One core group within a SoC specification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SocCore {
    /// Core id, e.g. `m55_hp`.
    pub id: String,
    /// Core type, e.g. `m55` (serialized as `type`).
    pub r#type: String,
    /// Number of cores in this group (defaults to 1 on parse).
    pub count: u32,
    /// Optional clock frequency in MHz.
    #[serde(default)]
    pub freq_mhz: Option<u32>,
}

/// A SoC specification parsed from its JSON definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SocSpec {
    /// SoC reference id (from the JSON `ref` field).
    pub ref_id: String,
    /// Vendor name.
    pub vendor: String,
    /// SoC family.
    pub family: String,
    /// Part number.
    pub part: String,
    /// Core groups making up the SoC.
    #[serde(default)]
    pub cores: Vec<SocCore>,
}

/// The aggregated SDK catalogue of SoMs, boards, chips, and SoCs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SdkCatalogue {
    /// All SoM presets.
    #[serde(default)]
    pub soms: Vec<SomPreset>,
    /// All board presets.
    #[serde(default)]
    pub boards: Vec<BoardPreset>,
    /// All chip definitions.
    #[serde(default)]
    pub chips: Vec<ChipDef>,
    /// All SoC specifications.
    #[serde(default)]
    pub socs: Vec<SocSpec>,
    /// Optional SDK version stamp.
    #[serde(default)]
    pub sdk_version: Option<String>,
}

/// Availability of a named inference accelerator for a given SoM.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceleratorAvail {
    /// Accelerator id, e.g. `ethos_u`, `drpai`, `deepx_dxm1`, `cpu`.
    pub id: String,
    /// Human-readable accelerator label.
    pub label: String,
    /// Whether this accelerator is available on the SoM.
    pub available: bool,
}

/// A chip available to a SoM together with its effective enabled state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChipChoice {
    /// Chip identifier slug.
    pub chip_id: String,
    /// Human-readable chip name.
    pub display_name: String,
    /// Optional vendor name.
    #[serde(default)]
    pub vendor: Option<String>,
    /// Optional bus the chip sits on.
    #[serde(default)]
    pub bus: Option<String>,
    /// Optional driver maturity status.
    #[serde(default)]
    pub driver_status: Option<String>,
    /// Whether the chip is populated/enabled after applying overlays.
    pub enabled: bool,
}

fn som_by_sku<'a>(catalogue: &'a SdkCatalogue, sku: &str) -> Option<&'a SomPreset> {
    catalogue.soms.iter().find(|s| s.sku == sku)
}

fn yget<'a>(map: &'a Mapping, key: &str) -> Option<&'a YamlValue> {
    map.get(YamlValue::String(key.to_string()))
}

fn is_tbd(value: &str) -> bool {
    value.trim() == "TBD"
}

fn str_clean(value: Option<&YamlValue>) -> Option<String> {
    value
        .and_then(YamlValue::as_str)
        .map(str::to_string)
        .filter(|s| !is_tbd(s))
}

fn num_u32(value: Option<&YamlValue>) -> Option<u32> {
    value
        .and_then(YamlValue::as_i64)
        .and_then(|n| u32::try_from(n).ok())
}

fn bool_map(value: Option<&YamlValue>) -> BTreeMap<String, bool> {
    let mut out = BTreeMap::new();
    let Some(map) = value.and_then(YamlValue::as_mapping) else {
        return out;
    };

    for (k, v) in map {
        if let Some(key) = k.as_str() {
            out.insert(key.to_string(), v.as_bool().unwrap_or(false));
        }
    }
    out
}

fn str_list(value: Option<&YamlValue>) -> Vec<String> {
    value
        .and_then(YamlValue::as_sequence)
        .map(|seq| {
            seq.iter()
                .filter_map(YamlValue::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Parse a single board definition (YAML) into a `BoardPreset`, dropping `TBD` strings.
pub fn parse_board_preset(text: &str) -> Result<BoardPreset, serde_yaml::Error> {
    let root: YamlValue = serde_yaml::from_str(text)?;
    let map = root.as_mapping().cloned().unwrap_or_default();
    let name = str_clean(yget(&map, "name")).unwrap_or_default();
    let display_name = str_clean(yget(&map, "display_name")).unwrap_or_else(|| name.clone());

    Ok(BoardPreset {
        name,
        display_name,
        hosts_som_families: str_list(yget(&map, "hosts_som_families")),
        populated: bool_map(yget(&map, "populated")),
    })
}

/// Parse a single chip definition (YAML) into a `ChipDef`; `kconfig` stays `None` when empty.
pub fn parse_chip_def(text: &str) -> Result<ChipDef, serde_yaml::Error> {
    let root: YamlValue = serde_yaml::from_str(text)?;
    let map = root.as_mapping().cloned().unwrap_or_default();
    let chip_id = str_clean(yget(&map, "chip_id")).unwrap_or_default();
    let display_name = str_clean(yget(&map, "display_name")).unwrap_or_else(|| chip_id.clone());

    let kconfig = yget(&map, "kconfig")
        .and_then(YamlValue::as_mapping)
        .map(|kc| ChipKconfig {
            zephyr: str_clean(yget(kc, "zephyr")),
            baremetal: str_clean(yget(kc, "baremetal")),
        })
        .and_then(|k| {
            if k.zephyr.is_some() || k.baremetal.is_some() {
                Some(k)
            } else {
                None
            }
        });

    Ok(ChipDef {
        chip_id,
        display_name,
        vendor: str_clean(yget(&map, "vendor")),
        bus: str_clean(yget(&map, "bus")),
        driver_status: str_clean(yget(&map, "driver_status")),
        families: str_list(yget(&map, "families")),
        kconfig,
    })
}

/// Parse a single SoC specification (JSON) into a `SocSpec`.
pub fn parse_soc_spec(text: &str) -> Result<SocSpec, serde_json::Error> {
    let root: JsonValue = serde_json::from_str(text)?;
    let cores = root
        .get("cores")
        .and_then(JsonValue::as_array)
        .map(|arr| {
            arr.iter()
                .map(|c| SocCore {
                    id: c
                        .get("id")
                        .and_then(JsonValue::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    r#type: c
                        .get("type")
                        .and_then(JsonValue::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    count: c
                        .get("count")
                        .and_then(JsonValue::as_u64)
                        .and_then(|n| u32::try_from(n).ok())
                        .unwrap_or(1),
                    freq_mhz: c
                        .get("freq_mhz")
                        .and_then(JsonValue::as_u64)
                        .and_then(|n| u32::try_from(n).ok()),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SocSpec {
        ref_id: root
            .get("ref")
            .and_then(JsonValue::as_str)
            .unwrap_or_default()
            .to_string(),
        vendor: root
            .get("vendor")
            .and_then(JsonValue::as_str)
            .unwrap_or_default()
            .to_string(),
        family: root
            .get("family")
            .and_then(JsonValue::as_str)
            .unwrap_or_default()
            .to_string(),
        part: root
            .get("part")
            .and_then(JsonValue::as_str)
            .unwrap_or_default()
            .to_string(),
        cores,
    })
}

/// Parse a single SoM definition (YAML) into a `SomPreset`, flattening topology,
/// memory, pad routes, and `on_module.i2c_devices`.
pub fn parse_som_preset(text: &str) -> Result<SomPreset, serde_yaml::Error> {
    let root: YamlValue = serde_yaml::from_str(text)?;
    let map = root.as_mapping().cloned().unwrap_or_default();

    let inference_map = yget(&map, "inference").and_then(YamlValue::as_mapping);
    let topology_map = yget(&map, "topology").and_then(YamlValue::as_mapping);
    let on_module_map = yget(&map, "on_module").and_then(YamlValue::as_mapping);
    let memory_map = yget(&map, "memory").and_then(YamlValue::as_mapping);
    let status_map = yget(&map, "status").and_then(YamlValue::as_mapping);

    let dram_mbit = num_u32(memory_map.and_then(|m| yget(m, "dram_mbit")));
    let flash_mbit = num_u32(memory_map.and_then(|m| yget(m, "flash_mbit")));
    let memory = if dram_mbit.is_some() || flash_mbit.is_some() {
        Some(MemorySpec {
            dram_mbit,
            flash_mbit,
        })
    } else {
        None
    };

    let pad_routes = yget(&map, "pad_routes")
        .and_then(YamlValue::as_sequence)
        .map(|routes| {
            routes
                .iter()
                .filter_map(YamlValue::as_mapping)
                .filter_map(|route| {
                    let e1m = str_clean(yget(route, "e1m"))?;
                    Some(PadRoute {
                        e1m,
                        dispatch: str_clean(yget(route, "dispatch")).unwrap_or_default(),
                        dispatch_pin: str_clean(yget(route, "dispatch_pin")),
                        doc: str_clean(yget(route, "doc")),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut i2c_devices = Vec::new();
    if let Some(i2c_map) = on_module_map
        .and_then(|m| yget(m, "i2c_devices"))
        .and_then(YamlValue::as_mapping)
    {
        for (bus_key, bus_def) in i2c_map {
            let Some(bus) = bus_key.as_str() else {
                continue;
            };
            let devices = bus_def
                .as_mapping()
                .and_then(|d| yget(d, "devices"))
                .and_then(YamlValue::as_sequence)
                .cloned()
                .unwrap_or_default();
            for dev in devices {
                let Some(dev_map) = dev.as_mapping() else {
                    continue;
                };
                let Some(chip) = str_clean(yget(dev_map, "chip")) else {
                    continue;
                };
                i2c_devices.push(I2cDevice {
                    bus: bus.to_string(),
                    chip,
                    role: str_clean(yget(dev_map, "role")),
                    address: str_clean(yget(dev_map, "address_7bit")),
                });
            }
        }
    }

    let topology = topology_map
        .map(|topology| {
            topology
                .iter()
                .filter_map(|(id, node)| {
                    let id = id.as_str()?.to_string();
                    let node_map = node.as_mapping();
                    Some(TopologyCore {
                        id,
                        app: node_map.and_then(|m| str_clean(yget(m, "app"))),
                        image: node_map.and_then(|m| str_clean(yget(m, "image"))),
                        machine: node_map.and_then(|m| str_clean(yget(m, "machine"))),
                        board: node_map.and_then(|m| str_clean(yget(m, "board"))),
                        toolchain: node_map.and_then(|m| str_clean(yget(m, "toolchain"))),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let topology_core_ids = topology_map
        .map(|topology| {
            topology
                .keys()
                .filter_map(YamlValue::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let on_module = on_module_map
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| {
                    let key = k.as_str()?;
                    if key == "silicon" {
                        return None;
                    }
                    str_clean(Some(v))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SomPreset {
        sku: str_clean(yget(&map, "sku")).unwrap_or_default(),
        display_name: str_clean(yget(&map, "display_name"))
            .or_else(|| str_clean(yget(&map, "sku")))
            .unwrap_or_default(),
        family: str_clean(yget(&map, "family")).unwrap_or_default(),
        silicon: str_clean(yget(&map, "silicon")).unwrap_or_default(),
        silicon_variant: str_clean(yget(&map, "silicon_variant")),
        preferred_backend: inference_map.and_then(|m| str_clean(yget(m, "preferred_backend"))),
        capabilities: bool_map(yget(&map, "capabilities")),
        default_board: str_clean(yget(&map, "default_board")),
        topology_core_ids,
        topology,
        on_module,
        memory,
        preliminary: status_map
            .and_then(|m| yget(m, "preliminary"))
            .and_then(YamlValue::as_bool)
            .unwrap_or(false),
        pad_routes,
        i2c_devices,
    })
}

/// Boards in `catalogue` whose `hosts_som_families` include the SoM's family for `sku`.
pub fn boards_for_som(catalogue: &SdkCatalogue, sku: &str) -> Vec<BoardPreset> {
    let Some(som) = som_by_sku(catalogue, sku) else {
        return Vec::new();
    };

    catalogue
        .boards
        .iter()
        .filter(|b| b.hosts_som_families.iter().any(|f| f == &som.family))
        .cloned()
        .collect()
}

/// Topology core ids for the SoM identified by `sku`, or empty if unknown.
pub fn core_ids_for_som(catalogue: &SdkCatalogue, sku: &str) -> Vec<String> {
    som_by_sku(catalogue, sku)
        .map(|s| s.topology_core_ids.clone())
        .unwrap_or_default()
}

/// The board's default chip-population map (a clone of `populated`).
pub fn chip_defaults(board: &BoardPreset) -> BTreeMap<String, bool> {
    board.populated.clone()
}

/// Merge a board's default population with a per-board override map, override winning.
pub fn effective_populated(
    selected_preset: Option<&BoardPreset>,
    board_populated: Option<&BTreeMap<String, bool>>,
) -> BTreeMap<String, bool> {
    let mut out = selected_preset.map(chip_defaults).unwrap_or_default();
    if let Some(populated) = board_populated {
        for (key, value) in populated {
            out.insert(key.clone(), *value);
        }
    }
    out
}

/// Chips available to `sku`, each tagged with its enabled state after applying overlays.
pub fn effective_chip_choices(
    catalogue: &SdkCatalogue,
    sku: &str,
    selected_preset: Option<&BoardPreset>,
    board_populated: Option<&BTreeMap<String, bool>>,
) -> Vec<ChipChoice> {
    let effective = effective_populated(selected_preset, board_populated);
    chips_for_som(catalogue, sku)
        .into_iter()
        .map(|chip| ChipChoice {
            enabled: effective.get(&chip.chip_id).copied().unwrap_or(false),
            chip_id: chip.chip_id,
            display_name: chip.display_name,
            vendor: chip.vendor,
            bus: chip.bus,
            driver_status: chip.driver_status,
        })
        .collect()
}

/// Availability of the known accelerators for `som`, derived from its preferred
/// backend and `deepx_dx` capability; `cpu` is always available.
pub fn accelerator_availability(som: &SomPreset) -> Vec<AcceleratorAvail> {
    let preferred_backend = som.preferred_backend.as_deref();
    let has_deepx = som.capabilities.get("deepx_dx").copied().unwrap_or(false);
    vec![
        AcceleratorAvail {
            id: "ethos_u".to_string(),
            label: "Ethos-U".to_string(),
            available: preferred_backend == Some("ethos_u"),
        },
        AcceleratorAvail {
            id: "drpai".to_string(),
            label: "DRP-AI".to_string(),
            available: preferred_backend == Some("drpai"),
        },
        AcceleratorAvail {
            id: "deepx_dxm1".to_string(),
            label: "DeepX DX-M1".to_string(),
            available: has_deepx || preferred_backend == Some("deepx_dxm1"),
        },
        AcceleratorAvail {
            id: "cpu".to_string(),
            label: "CPU fallback".to_string(),
            available: true,
        },
    ]
}

/// Map a SoM SKU prefix to its chip family key, or `None` if unrecognized.
pub fn chip_family_for_sku(sku: &str) -> Option<&'static str> {
    if sku.starts_with("E1M-AEN") {
        return Some("aen");
    }
    if sku.starts_with("E1M-NX9") {
        return Some("imx93");
    }
    if sku.starts_with("E1M-V2M") {
        return Some("v2n-m1");
    }
    if sku.starts_with("E1M-V2N") {
        return Some("v2n");
    }
    None
}

/// Chips in `catalogue` whose `families` include the chip family resolved from `sku`.
pub fn chips_for_som(catalogue: &SdkCatalogue, sku: &str) -> Vec<ChipDef> {
    let Some(family) = chip_family_for_sku(sku) else {
        return Vec::new();
    };

    catalogue
        .chips
        .iter()
        .filter(|chip| chip.families.iter().any(|f| f == family))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_catalogue() -> SdkCatalogue {
        SdkCatalogue {
            soms: vec![
                SomPreset {
                    sku: "E1M-AEN701".to_string(),
                    display_name: "E1M-AEN701".to_string(),
                    family: "aen".to_string(),
                    silicon: "alif-e7".to_string(),
                    silicon_variant: None,
                    preferred_backend: Some("ethos_u".to_string()),
                    capabilities: BTreeMap::from([("deepx_dx".to_string(), true)]),
                    default_board: None,
                    topology_core_ids: vec!["m55_hp".to_string()],
                    topology: vec![],
                    on_module: vec![],
                    memory: None,
                    preliminary: false,
                    pad_routes: vec![],
                    i2c_devices: vec![],
                },
                SomPreset {
                    sku: "E1M-OTHER".to_string(),
                    display_name: "E1M-OTHER".to_string(),
                    family: "other".to_string(),
                    silicon: "x".to_string(),
                    silicon_variant: None,
                    preferred_backend: None,
                    capabilities: BTreeMap::new(),
                    default_board: None,
                    topology_core_ids: vec![],
                    topology: vec![],
                    on_module: vec![],
                    memory: None,
                    preliminary: false,
                    pad_routes: vec![],
                    i2c_devices: vec![],
                },
            ],
            boards: vec![BoardPreset {
                name: "e1m-evk".to_string(),
                display_name: "E1M EVK".to_string(),
                hosts_som_families: vec!["aen".to_string()],
                populated: BTreeMap::from([("chip-a".to_string(), true)]),
            }],
            chips: vec![
                ChipDef {
                    chip_id: "chip-a".to_string(),
                    display_name: "Chip A".to_string(),
                    families: vec!["aen".to_string()],
                    vendor: None,
                    bus: None,
                    driver_status: None,
                    kconfig: None,
                },
                ChipDef {
                    chip_id: "chip-b".to_string(),
                    display_name: "Chip B".to_string(),
                    families: vec!["v2n".to_string()],
                    vendor: None,
                    bus: None,
                    driver_status: None,
                    kconfig: None,
                },
            ],
            socs: vec![],
            sdk_version: None,
        }
    }

    #[test]
    fn derives_board_and_core_helpers() {
        let c = fixture_catalogue();
        assert_eq!(boards_for_som(&c, "E1M-AEN701").len(), 1);
        assert_eq!(
            core_ids_for_som(&c, "E1M-AEN701"),
            vec!["m55_hp".to_string()]
        );
        assert!(boards_for_som(&c, "UNKNOWN").is_empty());
    }

    #[test]
    fn derives_accelerator_and_chip_helpers() {
        let c = fixture_catalogue();
        let som = &c.soms[0];
        let avail = accelerator_availability(som);
        assert!(avail.iter().any(|a| a.id == "ethos_u" && a.available));
        assert!(avail.iter().any(|a| a.id == "deepx_dxm1" && a.available));
        assert_eq!(chip_family_for_sku("E1M-AEN701"), Some("aen"));
        assert_eq!(chips_for_som(&c, "E1M-AEN701").len(), 1);
    }

    #[test]
    fn parses_board_chip_som_and_soc() {
        let board = parse_board_preset(
            "name: e1m-evk\ndisplay_name: E1M EVK\nhosts_som_families: [aen]\npopulated: { chip-a: true }\n",
        )
        .unwrap();
        assert_eq!(board.name, "e1m-evk");
        assert_eq!(board.display_name, "E1M EVK");

        let chip = parse_chip_def(
            "chip_id: chip-a\ndisplay_name: Chip A\nvendor: TBD\nfamilies: [aen]\nkconfig:\n  zephyr: CONFIG_CHIP_A\n",
        )
        .unwrap();
        assert_eq!(chip.vendor, None);
        assert_eq!(
            chip.kconfig.as_ref().and_then(|k| k.zephyr.clone()),
            Some("CONFIG_CHIP_A".to_string())
        );

        let som = parse_som_preset(
            "sku: E1M-AEN701\ndisplay_name: E1M AEN701\nfamily: aen\nsilicon: alif-e7\ninference:\n  preferred_backend: ethos_u\ncapabilities: { deepx_dx: true }\ntopology:\n  m55_hp: { app: ./src }\non_module:\n  i2c_devices:\n    i2c0:\n      devices:\n        - chip: ina236\n          role: sensor\n          address_7bit: '0x40'\nstatus:\n  preliminary: true\n",
        )
        .unwrap();
        assert_eq!(som.topology_core_ids, vec!["m55_hp".to_string()]);
        assert_eq!(som.i2c_devices.len(), 1);
        assert!(som.preliminary);

        let soc = parse_soc_spec("{\"ref\":\"soc-ref\",\"vendor\":\"v\",\"family\":\"f\",\"part\":\"p\",\"cores\":[{\"id\":\"m55_hp\",\"type\":\"m55\",\"count\":2,\"freq_mhz\":400}]}").unwrap();
        assert_eq!(soc.ref_id, "soc-ref");
        assert_eq!(soc.cores[0].count, 2);
    }

    #[test]
    fn computes_effective_chip_overlays() {
        let c = fixture_catalogue();
        let board = &c.boards[0];
        let overlay = BTreeMap::from([("chip-a".to_string(), false)]);
        let choices = effective_chip_choices(&c, "E1M-AEN701", Some(board), Some(&overlay));
        assert_eq!(choices.len(), 1);
        assert!(!choices[0].enabled);

        let merged = effective_populated(Some(board), Some(&overlay));
        assert_eq!(merged.get("chip-a"), Some(&false));
    }
}
