// SPDX-License-Identifier: Apache-2.0
//! Built-in preset catalogue defaults — a port of TS
//! `createEmptyPresetCatalogue`. SKUs/carriers come from the SDK metadata tree
//! (read by the CLI); the lists below are the SDK-independent defaults.

/// SDK-independent preset defaults (libraries, inference backends, log levels,
/// OS choices). SKUs and carriers are discovered separately from the SDK root.
pub struct PresetCatalogueDefaults {
    /// Selectable third-party library identifiers (e.g. `etl`, `lvgl`).
    pub libraries: Vec<String>,
    /// Inference backend choices (e.g. `auto`, `cpu`, `ethos_u`).
    pub inference_backends: Vec<String>,
    /// Log verbosity levels, ordered most to least severe.
    pub log_levels: Vec<String>,
    /// Target OS choices (`zephyr`, `yocto`, `baremetal`).
    pub os_choices: Vec<String>,
}

/// Builds the `PresetCatalogueDefaults` with the fixed SDK-independent defaults.
pub fn empty_preset_catalogue() -> PresetCatalogueDefaults {
    let owned = |items: &[&str]| items.iter().map(|s| (*s).to_string()).collect();
    PresetCatalogueDefaults {
        libraries: owned(&[
            "etl",
            "fmt",
            "nlohmann_json",
            "doctest",
            "lvgl",
            "mbedtls",
            "cmsis_dsp",
            "littlefs",
        ]),
        inference_backends: owned(&["auto", "cpu", "ethos_u", "drpai", "deepx_dx"]),
        log_levels: owned(&["error", "warn", "info", "debug", "trace"]),
        os_choices: owned(&["zephyr", "yocto", "baremetal"]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_ts_catalogue() {
        let catalogue = empty_preset_catalogue();
        assert_eq!(catalogue.libraries.first().map(String::as_str), Some("etl"));
        assert_eq!(catalogue.libraries.len(), 8);
        assert_eq!(catalogue.inference_backends.len(), 5);
        assert_eq!(
            catalogue.log_levels,
            vec!["error", "warn", "info", "debug", "trace"]
        );
        assert_eq!(catalogue.os_choices, vec!["zephyr", "yocto", "baremetal"]);
    }
}
