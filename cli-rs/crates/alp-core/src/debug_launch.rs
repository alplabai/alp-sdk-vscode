// SPDX-License-Identifier: Apache-2.0
//! Debug launch-config generation — a port of TS `createDebugProfile` +
//! `debugProfileToLaunchDraft` + `createLaunchPreview` and the `launchJsonCore`
//! merge plan. Produces VS Code `launch.json` drafts for `alp debug-config`.
//!
//! Relies on `serde_json`'s `preserve_order` feature so emitted JSON keeps the
//! same key order as the TypeScript CLI.

use serde_json::{Value, json};

use crate::debug::{DebugServerKind, DebugTargetKind, is_server_supported_for_target};

fn server_label(server: DebugServerKind) -> &'static str {
    match server {
        DebugServerKind::Jlink => "J-Link",
        DebugServerKind::Openocd => "OpenOCD",
        DebugServerKind::Pyocd => "pyOCD",
        DebugServerKind::Gdbserver => "gdbserver",
        DebugServerKind::None => "local",
    }
}

/// Build the VS Code launch configuration draft for a target/server, mirroring
/// TS `createDebugProfile` → `debugProfileToLaunchDraft`. Errors (with the TS
/// message) when the server is not valid for the target.
pub fn create_launch_draft(
    target: DebugTargetKind,
    server: DebugServerKind,
) -> Result<Value, String> {
    if !is_server_supported_for_target(target, server) {
        return Err(format!(
            "Unsupported debug backend '{}' for target '{}'.",
            server.as_str(),
            target.as_str()
        ));
    }

    let draft = match target {
        DebugTargetKind::ZephyrMcu => {
            let name = format!("ALP: Zephyr Debug ({})", server_label(server));
            match server {
                DebugServerKind::Openocd => json!({
                    "name": name,
                    "type": "cortex-debug",
                    "request": "launch",
                    "cwd": "${workspaceFolder}",
                    "executable": "${workspaceFolder}/build/app/zephyr/zephyr.elf",
                    "runToEntryPoint": "main",
                    "preLaunchTask": "alp: build active target",
                    "svdFile": "<resolved-svd>",
                    "svdPath": "<resolved-svd>",
                    "servertype": "openocd",
                    "configFiles": ["<resolved-openocd-board-cfg>"],
                }),
                DebugServerKind::Pyocd => json!({
                    "name": name,
                    "type": "cortex-debug",
                    "request": "launch",
                    "cwd": "${workspaceFolder}",
                    "executable": "${workspaceFolder}/build/app/zephyr/zephyr.elf",
                    "runToEntryPoint": "main",
                    "preLaunchTask": "alp: build active target",
                    "svdFile": "<resolved-svd>",
                    "svdPath": "<resolved-svd>",
                    "servertype": "pyocd",
                    "targetId": "<resolved-target-id>",
                }),
                _ => json!({
                    "name": name,
                    "type": "cortex-debug",
                    "request": "launch",
                    "cwd": "${workspaceFolder}",
                    "executable": "${workspaceFolder}/build/app/zephyr/zephyr.elf",
                    "runToEntryPoint": "main",
                    "preLaunchTask": "alp: build active target",
                    "svdFile": "<resolved-svd>",
                    "svdPath": "<resolved-svd>",
                    "servertype": "jlink",
                    "device": "<resolved-device>",
                    "interface": "swd",
                }),
            }
        }
        DebugTargetKind::BaremetalMcu => json!({
            "name": format!("ALP: Baremetal Debug ({})", server_label(server)),
            "type": "cortex-debug",
            "request": "launch",
            "servertype": server.as_str(),
            "cwd": "${workspaceFolder}",
            "executable": "${workspaceFolder}/build/baremetal/app.elf",
            "device": "<resolved-device>",
            "interface": "swd",
            "preLaunchTask": "alp: build baremetal target",
            "svdFile": "<resolved-svd>",
            "svdPath": "<resolved-svd>",
        }),
        DebugTargetKind::YoctoUserspace => json!({
            "name": "ALP: Yocto Remote Debug",
            "type": "cppdbg",
            "request": "launch",
            "program": "${workspaceFolder}/build/yocto/app",
            "cwd": "${workspaceFolder}",
            "MIMode": "gdb",
            "miDebuggerServerAddress": "<host>:<port>",
            "miDebuggerPath": "<resolved-gdb>",
            "setupCommands": [{ "text": "-enable-pretty-printing" }],
            "preLaunchTask": "alp: deploy and start gdbserver",
        }),
        DebugTargetKind::NativeHost => json!({
            "name": "ALP: Native Sim Debug",
            "type": "codelldb",
            "request": "launch",
            "program": "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
            "cwd": "${workspaceFolder}",
            "preLaunchTask": "alp: build native_sim target",
        }),
    };
    Ok(draft)
}

/// The static advisory notes attached to a launch preview (TS `createLaunchPreview`).
pub fn launch_preview_notes() -> Vec<String> {
    vec![
        "This is a draft launch configuration generated by the extension.".to_string(),
        "Placeholder fields such as <resolved-device> still need project-specific resolution."
            .to_string(),
        "The long-term target is to resolve these values from the shared debug model.".to_string(),
    ]
}

/// The `launch.json`-shaped preview document: `{version, configurations:[draft]}`.
pub fn launch_preview_document(draft: Value) -> Value {
    json!({
        "version": "0.2.0",
        "configurations": [draft],
    })
}

/// Result of merging a draft into `launch.json`: the serialized document plus
/// whether a same-named configuration was overwritten.
#[derive(Debug)]
pub struct LaunchJsonWritePlan {
    /// Pretty-printed `launch.json` content, trailing newline included.
    pub content: String,
    /// `true` if an existing same-named configuration was replaced; `false` if appended.
    pub replaced: bool,
}

/// Merge `draft` into an existing `launch.json` (or a fresh document), replacing
/// any configuration with the same `name`. Mirrors TS `createLaunchJsonWritePlan`.
pub fn create_launch_json_write_plan(
    existing_content: Option<&str>,
    draft: &Value,
) -> Result<LaunchJsonWritePlan, String> {
    let mut document = parse_launch_json_or_default(existing_content)?;
    let next_name = configuration_name(draft)?;

    let configs = document
        .get_mut("configurations")
        .and_then(Value::as_array_mut)
        .expect("configurations is always an array");

    let existing_index = configs
        .iter()
        .position(|c| c.get("name").and_then(Value::as_str) == Some(next_name));

    let replaced = match existing_index {
        Some(index) => {
            configs[index] = draft.clone();
            true
        }
        None => {
            configs.push(draft.clone());
            false
        }
    };

    let content = format!(
        "{}\n",
        serde_json::to_string_pretty(&document).expect("launch document is serializable")
    );
    Ok(LaunchJsonWritePlan { content, replaced })
}

fn parse_launch_json_or_default(content: Option<&str>) -> Result<Value, String> {
    let trimmed = content.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(json!({ "version": "0.2.0", "configurations": [] }));
    }

    let parsed: Value = serde_json::from_str(trimmed)
        .map_err(|_| "Alp: .vscode/launch.json is not valid JSON.".to_string())?;
    let Value::Object(mut candidate) = parsed else {
        return Err("Alp: .vscode/launch.json must be a JSON object.".to_string());
    };

    let version = match candidate.get("version").and_then(Value::as_str) {
        Some(v) if !v.trim().is_empty() => Value::String(v.to_string()),
        _ => Value::String("0.2.0".to_string()),
    };
    let configurations = match candidate.get("configurations") {
        Some(Value::Array(entries)) => {
            Value::Array(entries.iter().filter(|e| e.is_object()).cloned().collect())
        }
        _ => Value::Array(Vec::new()),
    };

    // {...candidate, version, configurations}: keep order, override the two keys.
    candidate.insert("version".to_string(), version);
    candidate.insert("configurations".to_string(), configurations);
    Ok(Value::Object(candidate))
}

fn configuration_name(configuration: &Value) -> Result<&str, String> {
    match configuration.get("name").and_then(Value::as_str) {
        Some(name) if !name.trim().is_empty() => Ok(name),
        _ => Err("Alp: debug launch draft is missing a valid name.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_server_errors() {
        let err =
            create_launch_draft(DebugTargetKind::NativeHost, DebugServerKind::Jlink).unwrap_err();
        assert!(err.contains("Unsupported debug backend 'jlink' for target 'native-host'"));
    }

    #[test]
    fn zephyr_jlink_draft_key_order_preserved() {
        let draft =
            create_launch_draft(DebugTargetKind::ZephyrMcu, DebugServerKind::Jlink).unwrap();
        let json = serde_json::to_string(&draft).unwrap();
        // Keys must stay in insertion order (preserve_order), not sorted.
        assert!(json.starts_with(
            "{\"name\":\"ALP: Zephyr Debug (J-Link)\",\"type\":\"cortex-debug\",\"request\":\"launch\""
        ));
        assert!(json.ends_with(
            "\"servertype\":\"jlink\",\"device\":\"<resolved-device>\",\"interface\":\"swd\"}"
        ));
    }

    #[test]
    fn zephyr_drafts_emit_svd_file_and_path_before_servertype() {
        for server in [
            DebugServerKind::Jlink,
            DebugServerKind::Openocd,
            DebugServerKind::Pyocd,
        ] {
            let draft = create_launch_draft(DebugTargetKind::ZephyrMcu, server).unwrap();
            assert_eq!(draft["svdFile"], "<resolved-svd>");
            assert_eq!(draft["svdPath"], "<resolved-svd>");
            // Key order: svdFile + svdPath sit after preLaunchTask, before servertype.
            let json = serde_json::to_string(&draft).unwrap();
            assert!(json.contains(
                "\"preLaunchTask\":\"alp: build active target\",\"svdFile\":\"<resolved-svd>\",\"svdPath\":\"<resolved-svd>\",\"servertype\":"
            ));
        }
    }

    #[test]
    fn baremetal_draft_emits_svd_file_and_path_after_prelaunch() {
        let draft =
            create_launch_draft(DebugTargetKind::BaremetalMcu, DebugServerKind::Jlink).unwrap();
        assert_eq!(draft["svdFile"], "<resolved-svd>");
        assert_eq!(draft["svdPath"], "<resolved-svd>");
        let json = serde_json::to_string(&draft).unwrap();
        assert!(json.ends_with(
            "\"preLaunchTask\":\"alp: build baremetal target\",\"svdFile\":\"<resolved-svd>\",\"svdPath\":\"<resolved-svd>\"}"
        ));
    }

    #[test]
    fn non_mcu_drafts_omit_svd_fields() {
        for (target, server) in [
            (DebugTargetKind::YoctoUserspace, DebugServerKind::Gdbserver),
            (DebugTargetKind::NativeHost, DebugServerKind::None),
        ] {
            let draft = create_launch_draft(target, server).unwrap();
            assert!(draft.get("svdFile").is_none());
            assert!(draft.get("svdPath").is_none());
        }
    }

    #[test]
    fn write_plan_appends_then_replaces_by_name() {
        let draft =
            create_launch_draft(DebugTargetKind::NativeHost, DebugServerKind::None).unwrap();
        let plan = create_launch_json_write_plan(None, &draft).unwrap();
        assert!(!plan.replaced);
        assert!(plan.content.ends_with("\n"));
        assert!(plan.content.contains("\"version\": \"0.2.0\""));

        // Re-applying the same-named config replaces it (still one entry).
        let plan2 = create_launch_json_write_plan(Some(&plan.content), &draft).unwrap();
        assert!(plan2.replaced);
        let doc: Value = serde_json::from_str(&plan2.content).unwrap();
        assert_eq!(doc["configurations"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn preserves_unknown_top_level_keys() {
        let existing = "{\"version\":\"0.1.0\",\"inputs\":[],\"configurations\":[]}";
        let draft =
            create_launch_draft(DebugTargetKind::NativeHost, DebugServerKind::None).unwrap();
        let plan = create_launch_json_write_plan(Some(existing), &draft).unwrap();
        // `inputs` is preserved; version kept as the (valid) existing value.
        assert!(plan.content.contains("\"inputs\""));
        assert!(plan.content.contains("\"version\": \"0.1.0\""));
    }

    #[test]
    fn invalid_json_errors() {
        let err =
            create_launch_json_write_plan(Some("{not json"), &json!({"name": "x"})).unwrap_err();
        assert!(err.contains("not valid JSON"));
    }
}
