// SPDX-License-Identifier: Apache-2.0
//! Template registry, file-content generators, and planning logic.

use super::models::{
    FeatureFileSpec, ModuleScaffoldInput, ModuleScaffoldPlan, ModuleTemplateDefinition,
    ModuleTemplateId, WizardFeatureFlags, WizardPlan, WizardPlanInput, WizardPlannedFile,
    WizardTemplateDefinition, WizardTemplateId,
};

// ---------------------------------------------------------------------------
// Static template registry
// ---------------------------------------------------------------------------

static TEMPLATE_DEFINITIONS: &[WizardTemplateDefinition] = &[
    WizardTemplateDefinition {
        id: WizardTemplateId::MinimalApp,
        label: "Minimal app",
        description: "Smallest baseline project with a simple main loop.",
        libs: &[],
        features: None,
        prj_conf_extras: &[],
        feature_files: &[FeatureFileSpec {
            path: "src/features/app_bootstrap.c",
            unit_name: "app_bootstrap",
            todo_line: "TODO: register app services and initialize runtime modules.",
        }],
        body_line1: "ALP minimal starter boot",
        body_line2: "TODO: add your application logic",
        explanation: &[
            "Minimal template keeps generated code intentionally small and neutral.",
            "Use this baseline when you want full control over feature bring-up order.",
        ],
    },
    WizardTemplateDefinition {
        id: WizardTemplateId::SensorStarter,
        label: "Sensor starter",
        description: "Sensor polling skeleton with diagnostics-friendly logging.",
        libs: &["fmt"],
        features: None,
        prj_conf_extras: &["CONFIG_SENSOR=y", "CONFIG_I2C=y"],
        feature_files: &[FeatureFileSpec {
            path: "src/features/sensor_pipeline.c",
            unit_name: "sensor_pipeline",
            todo_line: "TODO: initialize bus, read sensors, normalize values for app flow.",
        }],
        body_line1: "ALP sensor starter boot",
        body_line2: "TODO: initialize sensor bus and polling loop",
        explanation: &[
            "src/main.c includes a sensor-oriented TODO path for bus init and polling.",
            "Use this when your first milestone is sensor bring-up and deterministic sampling.",
        ],
    },
    WizardTemplateDefinition {
        id: WizardTemplateId::IotStarter,
        label: "IoT starter",
        description: "Connectivity-oriented starter with Wi-Fi and MQTT defaults.",
        libs: &["mbedtls", "fmt"],
        features: Some(WizardFeatureFlags {
            wifi: true,
            mqtt: true,
            ble: false,
            tls: true,
        }),
        prj_conf_extras: &[
            "CONFIG_NETWORKING=y",
            "CONFIG_NET_IPV4=y",
            "CONFIG_MQTT_LIB=y",
            "CONFIG_MBEDTLS=y",
        ],
        feature_files: &[FeatureFileSpec {
            path: "src/features/connectivity_pipeline.c",
            unit_name: "connectivity_pipeline",
            todo_line: "TODO: bring up Wi-Fi, establish MQTT session, and publish telemetry.",
        }],
        body_line1: "ALP IoT starter boot",
        body_line2: "TODO: connect Wi-Fi and start MQTT session",
        explanation: &[
            "Starter defaults include Wi-Fi, MQTT, and TLS-friendly settings in board.yaml.",
            "src/main.c highlights connectivity boot and MQTT session bring-up steps.",
        ],
    },
    WizardTemplateDefinition {
        id: WizardTemplateId::EdgeAiStarter,
        label: "Edge AI starter",
        description: "Inference-first starter with arena sizing and backend hints.",
        libs: &["cmsis_dsp", "etl"],
        features: None,
        prj_conf_extras: &["CONFIG_CMSIS_DSP=y", "CONFIG_CBPRINTF_FP_SUPPORT=y"],
        feature_files: &[FeatureFileSpec {
            path: "src/features/inference_pipeline.c",
            unit_name: "inference_pipeline",
            todo_line: "TODO: map input tensors, execute inference, and decode model output.",
        }],
        body_line1: "ALP edge AI starter boot",
        body_line2: "TODO: load model and run inference loop",
        explanation: &[
            "board.yaml includes an inference block with arena defaults for initial runs.",
            "src/main.c points to model-load and inference-loop integration work.",
        ],
    },
    WizardTemplateDefinition {
        id: WizardTemplateId::BoardDiagnostics,
        label: "Board diagnostics",
        description: "Bring-up oriented starter for board and peripheral checks.",
        libs: &["fmt", "doctest"],
        features: None,
        prj_conf_extras: &["CONFIG_LOG=y", "LOG_MODE_DEFERRED=y", "LOG_DEFAULT_LEVEL=4"],
        feature_files: &[FeatureFileSpec {
            path: "src/features/diagnostics_checks.c",
            unit_name: "diagnostics_checks",
            todo_line: "TODO: run board bring-up checks and report failing subsystems.",
        }],
        body_line1: "ALP board diagnostics starter boot",
        body_line2: "TODO: run bring-up checks and report failures",
        explanation: &[
            "Template enables diagnostics-friendly defaults for bring-up and fault tracking.",
            "src/main.c is oriented toward check-list style board validation routines.",
        ],
    },
    WizardTemplateDefinition {
        id: WizardTemplateId::HostToolingStarter,
        label: "Host tooling starter",
        description: "Monorepo scaffold for a host-side ALP tool: shared core package, standalone CLI, and VS Code extension surface.",
        libs: &[],
        features: None,
        prj_conf_extras: &[],
        feature_files: &[],
        body_line1: "",
        body_line2: "",
        explanation: &[
            "Scaffolds a monorepo with packages/core (shared domain), packages/cli (standalone npm CLI), and root src/ (VS Code extension).",
            "Follows the one-core-many-surfaces principle: validation, generation, and scaffolding logic lives in the core package.",
            "File generation for this template is planned and not yet available.",
        ],
    },
];

static MODULE_TEMPLATE_DEFINITIONS: &[ModuleTemplateDefinition] = &[
    ModuleTemplateDefinition {
        id: ModuleTemplateId::SensorDriver,
        label: "Sensor driver module",
        description: "Adds a source/header pair for sensor acquisition logic.",
        function_prefix: "alp_sensor",
        explanation: &[
            "Use {nm}_run to place sensor polling and conversion logic.",
            "Keep hardware-specific register access isolated from upper-level app flow.",
        ],
    },
    ModuleTemplateDefinition {
        id: ModuleTemplateId::ConnectivityService,
        label: "Connectivity service module",
        description: "Adds module skeleton for network/session orchestration.",
        function_prefix: "alp_conn",
        explanation: &[
            "Use {nm}_init for stack/session initialization.",
            "Keep retry/backoff and transport health checks localized in this module.",
        ],
    },
    ModuleTemplateDefinition {
        id: ModuleTemplateId::InferenceStage,
        label: "Inference stage module",
        description: "Adds module skeleton for model pre/post processing path.",
        function_prefix: "alp_infer",
        explanation: &[
            "Use {nm}_run to host pre-process, infer, and post-process calls.",
            "Keep model IO shaping and feature extraction close to this module boundary.",
        ],
    },
    ModuleTemplateDefinition {
        id: ModuleTemplateId::DiagnosticsCheck,
        label: "Diagnostics check module",
        description: "Adds bring-up and runtime health-check module scaffold.",
        function_prefix: "alp_diag",
        explanation: &[
            "Use {nm}_run for periodic health checks and error probes.",
            "Keep board bring-up assertions and diagnostics output in this module.",
        ],
    },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn list_wizard_templates() -> Vec<&'static WizardTemplateDefinition> {
    TEMPLATE_DEFINITIONS.iter().collect()
}

pub fn list_module_templates() -> Vec<&'static ModuleTemplateDefinition> {
    MODULE_TEMPLATE_DEFINITIONS.iter().collect()
}

pub fn normalize_module_name(name: &str) -> Result<String, String> {
    let lower = name.trim().to_lowercase();

    // Replace sequences of [^a-z0-9] with a single underscore, no leading/trailing.
    let mut result = String::new();
    let mut in_sep = false;
    for ch in lower.chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            if in_sep && !result.is_empty() {
                result.push('_');
            }
            result.push(ch);
            in_sep = false;
        } else {
            in_sep = true;
        }
    }

    if result.is_empty() {
        Err("Module name is empty after normalization.".to_string())
    } else {
        Ok(result)
    }
}

pub fn create_wizard_plan(input: &WizardPlanInput) -> WizardPlan {
    create_wizard_plan_with_cores(input, &[])
}

/// Like `create_wizard_plan`, but scaffolds a heterogeneous project across the
/// given `(core_id, os)` cores: companion cores + a default RPMsg channel land
/// in board.yaml. An empty slice is the single-(app-)core default.
pub fn create_wizard_plan_with_cores(
    input: &WizardPlanInput,
    cores: &[(String, String)],
) -> WizardPlan {
    let def = TEMPLATE_DEFINITIONS
        .iter()
        .find(|d| d.id == input.template_id)
        .expect("template id must exist in registry");

    let files = if def.id == WizardTemplateId::HostToolingStarter {
        gen_host_tooling_files()
    } else {
        gen_c_project_files(def, input.som_sku.as_deref(), cores)
    };

    WizardPlan {
        template_id: input.template_id,
        files,
    }
}

pub fn create_module_scaffold_plan(
    input: &ModuleScaffoldInput,
) -> Result<ModuleScaffoldPlan, String> {
    let normalized_name = normalize_module_name(&input.module_name)?;
    let def = MODULE_TEMPLATE_DEFINITIONS
        .iter()
        .find(|d| d.id == input.template_id)
        .expect("module template id must exist in registry");

    let files = gen_module_files(def, &normalized_name);
    Ok(ModuleScaffoldPlan {
        template_id: input.template_id,
        normalized_name,
        files,
    })
}

pub fn create_scaffold_tree_preview(files: &[WizardPlannedFile]) -> String {
    let mut paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
    paths.sort();

    let mut s = String::from(".\n");
    let count = paths.len();
    for (i, path) in paths.iter().enumerate() {
        if i + 1 == count {
            s.push_str(&format!("`-- {path}\n"));
        } else {
            s.push_str(&format!("|-- {path}\n"));
        }
    }
    s
}

// ---------------------------------------------------------------------------
// C-project file generators
// ---------------------------------------------------------------------------

fn gen_c_project_files(
    def: &WizardTemplateDefinition,
    som_sku: Option<&str>,
    cores: &[(String, String)],
) -> Vec<WizardPlannedFile> {
    let mut files = vec![
        WizardPlannedFile {
            relative_path: "board.yaml".to_string(),
            content: gen_board_yaml(def, som_sku, cores),
        },
        WizardPlannedFile {
            relative_path: "README.md".to_string(),
            content: gen_readme(def, som_sku),
        },
        WizardPlannedFile {
            relative_path: "prj.conf".to_string(),
            content: gen_prj_conf(def),
        },
        WizardPlannedFile {
            relative_path: "CMakeLists.txt".to_string(),
            content: gen_root_cmake().to_string(),
        },
        WizardPlannedFile {
            relative_path: "src/CMakeLists.txt".to_string(),
            content: gen_src_cmake(def),
        },
        WizardPlannedFile {
            relative_path: "include/app/app.h".to_string(),
            content: gen_app_header().to_string(),
        },
        WizardPlannedFile {
            relative_path: "src/main.c".to_string(),
            content: gen_main_c(def),
        },
    ];

    for spec in def.feature_files {
        files.push(WizardPlannedFile {
            relative_path: spec.path.to_string(),
            content: gen_feature_file(spec.unit_name, spec.todo_line),
        });
    }

    if def.id == WizardTemplateId::IotStarter {
        files.push(WizardPlannedFile {
            relative_path: "config/iot.env.example".to_string(),
            content: gen_iot_env_example().to_string(),
        });
    }

    files
}

/// Canonical Zephyr app-core id for a SoM family, taken from the SoM preset's
/// `topology:`. `alp init` is SDK-free, so this maps by SKU prefix; the value is
/// re-checked against the SoM catalogue by `alp validate` once an SDK resolves.
pub fn app_core_for_sku(sku: &str) -> &'static str {
    if sku.starts_with("E1M-V2N") || sku.starts_with("E1M-V2M") {
        "m33_sm" // Renesas RZ/V2N, RZ/V2M
    } else if sku.starts_with("E1M-NX9") {
        "m33" // NXP
    } else {
        "m55_hp" // Alif Ensemble (E1M-AEN*) + default
    }
}

/// Best-effort runtime for a core id when the topology gives no `board:` /
/// `machine:` hint: a Cortex-A-looking id (`a<digit>` at a word start, e.g.
/// `a55_cluster`) runs Linux (yocto); everything else defaults to Zephyr.
/// Single owner of this heuristic — `alp presets` and `alp init` both use it,
/// and it mirrors the IDE configurator's silicon-class gating.
pub fn infer_runtime_for_core_id(id: &str) -> &'static str {
    let lower = id.to_lowercase();
    let bytes = lower.as_bytes();
    let mut word_start = true;
    for (i, &b) in bytes.iter().enumerate() {
        if word_start && b == b'a' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit) {
            return "yocto";
        }
        word_start = b == b'_' || b == b'-';
    }
    "zephyr"
}

/// Emit a board.yaml conforming to the SDK board schema (v0.6+): `som` + `cores`
/// are the only required top-level keys; population/OS is per-core. Template
/// extras (libraries, connectivity, inference tuning) live under the app core's
/// `core_entry`; project-wide diagnostics is a sanctioned top-level key.
fn gen_board_yaml(
    def: &WizardTemplateDefinition,
    som_sku: Option<&str>,
    cores: &[(String, String)],
) -> String {
    let sku = som_sku.unwrap_or("E1M-AEN701");
    let core = app_core_for_sku(sku);

    let mut s = String::new();
    s.push_str("# Generated by the ALP SDK `alp init`.\n");
    s.push_str("# board.yaml describes hardware: the SoM SKU + per-core app map.\n");
    s.push_str("# Validate it with `alp validate` once an SDK is resolved.\n\n");
    s.push_str("som:\n");
    s.push_str(&format!("  sku: {sku}\n"));
    s.push_str("cores:\n");
    s.push_str(&format!("  {core}:\n"));
    s.push_str("    os: zephyr\n");
    s.push_str("    app: ./src\n");

    if !def.libs.is_empty() {
        s.push_str("    libraries:\n");
        for lib in def.libs {
            s.push_str(&format!("      - {lib}\n"));
        }
    }

    if let Some(f) = &def.features {
        s.push_str("    iot:\n");
        s.push_str(&format!("      wifi: {}\n", f.wifi));
        s.push_str(&format!("      mqtt: {}\n", f.mqtt));
        s.push_str(&format!("      ble: {}\n", f.ble));
        s.push_str(&format!("      tls: {}\n", f.tls));
    }

    if def.id == WizardTemplateId::EdgeAiStarter {
        // Backend is silicon-determined (SoM `capabilities:`); only the
        // app-level arena budget is a board.yaml knob.
        s.push_str("    inference:\n");
        s.push_str("      default_arena_kib: 256\n");
    }

    // Companion cores (heterogeneous `--cores`): emit each core other than the
    // app core. A `yocto` (Cortex-A) core boots the stock Linux image; a
    // Zephyr/baremetal companion gets NO `app:` — it boots the SDK's stock
    // shim, since the canonical layout names each app folder after its core ID
    // and the scaffold creates only `./src` (the app core's). With no
    // `--cores` this loop is empty (single-core default).
    for (id, os) in cores {
        if id == core {
            continue;
        }
        s.push_str(&format!("  {id}:\n"));
        s.push_str(&format!("    os: {os}\n"));
        if os == "yocto" {
            s.push_str("    image: alp-image-edge\n");
        }
    }

    // A default RPMsg channel links the app core to its first ACTIVE companion
    // (ipc endpoints must all have `os != off` per the board schema).
    if let Some((companion, _)) = cores.iter().find(|(id, os)| id != core && os != "off") {
        s.push_str("\nipc:\n");
        s.push_str("  - kind: rpmsg\n");
        s.push_str("    name: alp_default_rpmsg\n");
        s.push_str(&format!("    endpoints: [{core}, {companion}]\n"));
        s.push_str("    carve_out_kb: 512\n");
    }

    if def.id == WizardTemplateId::BoardDiagnostics {
        s.push_str("diagnostics:\n");
        s.push_str("  last_error: true\n");
        s.push_str("  log_level: debug\n");
    }

    s
}

fn gen_readme(def: &WizardTemplateDefinition, som_sku: Option<&str>) -> String {
    let sku = som_sku.unwrap_or("E1M-AEN701");
    let mut s = String::new();
    s.push_str("# ALP Starter Project\n\n");
    s.push_str(&format!("Template: {}\n", def.id.as_str()));
    s.push_str(&format!("SoM: {sku}\n"));
    s.push_str(&format!("App core: {} (Zephyr)\n\n", app_core_for_sku(sku)));
    s.push_str("## Generated Starter Notes\n\n");
    for line in def.explanation {
        s.push_str(&format!("- {line}\n"));
    }
    s.push_str("\n## Next Steps\n\n");
    s.push_str("- Run Alp: Validate board.yaml.\n");
    s.push_str("- Run Alp: Generate all to produce derived outputs under build/generated/.\n");
    s.push_str("- Extend source files under src/features/ for your target behavior.\n\n");
    s.push_str("This workspace was generated by Alp: New Project Wizard.\n");
    s.push_str("Use Alp commands to validate, generate, and build outputs.\n");
    s
}

fn gen_prj_conf(def: &WizardTemplateDefinition) -> String {
    let mut s = String::new();
    s.push_str("CONFIG_ASSERT=y\n");
    s.push_str("CONFIG_NEWLIB_LIBC=y\n");
    for line in def.prj_conf_extras {
        s.push_str(line);
        s.push('\n');
    }
    s
}

fn gen_root_cmake() -> &'static str {
    "cmake_minimum_required(VERSION 3.20)\n\
     project(alp_starter C)\n\
     \n\
     add_subdirectory(src)\n"
}

fn gen_src_cmake(def: &WizardTemplateDefinition) -> String {
    let mut s = String::from("set(ALP_APP_SOURCES\n  main.c\n");
    for spec in def.feature_files {
        let rel = spec.path.strip_prefix("src/").unwrap_or(spec.path);
        s.push_str(&format!("  {rel}\n"));
    }
    s.push_str(")\n\nadd_executable(alp_app ${ALP_APP_SOURCES})\n");
    s.push_str("target_include_directories(alp_app PRIVATE ../include)\n");
    s
}

fn gen_app_header() -> &'static str {
    "// SPDX-License-Identifier: Apache-2.0\n\
     \n\
     #ifndef ALP_APP_APP_H\n\
     #define ALP_APP_APP_H\n\
     \n\
     int alp_app_init(void);\n\
     int alp_app_run(void);\n\
     \n\
     #endif /* ALP_APP_APP_H */\n"
}

fn gen_main_c(def: &WizardTemplateDefinition) -> String {
    let mut s = String::new();
    s.push_str("// SPDX-License-Identifier: Apache-2.0\n\n");
    s.push_str("#include \"app/app.h\"\n");
    s.push_str("#include <stdio.h>\n\n");
    s.push_str("int alp_app_init(void) {\n");
    s.push_str("  // TODO: initialize app-level services.\n");
    s.push_str("  return 0;\n");
    s.push_str("}\n\n");
    s.push_str("int alp_app_run(void) {\n");
    s.push_str("  // TODO: execute one app cycle.\n");
    s.push_str("  return 0;\n");
    s.push_str("}\n\n");
    s.push_str("int main(void) {\n");
    s.push_str("  if (alp_app_init() != 0) {\n");
    s.push_str("    puts(\"alp_app_init failed\");\n");
    s.push_str("    return 1;\n");
    s.push_str("  }\n\n");
    s.push_str("  if (alp_app_run() != 0) {\n");
    s.push_str("    puts(\"alp_app_run failed\");\n");
    s.push_str("    return 1;\n");
    s.push_str("  }\n\n");
    s.push_str(&format!("  puts(\"{}\");\n", def.body_line1));
    s.push_str(&format!("  puts(\"{}\");\n", def.body_line2));
    s.push_str("  return 0;\n");
    s.push_str("}\n");
    s
}

fn gen_feature_file(unit_name: &str, todo_line: &str) -> String {
    format!(
        "// SPDX-License-Identifier: Apache-2.0\n\
         \n\
         #include <stdio.h>\n\
         \n\
         int {unit_name}_step(void) {{\n\
         \x20\x20// {todo_line}\n\
         \x20\x20return 0;\n\
         }}\n"
    )
}

fn gen_iot_env_example() -> &'static str {
    "# Copy to iot.env and provide real values.\n\
     WIFI_SSID=<ssid>\n\
     WIFI_PASSWORD=<password>\n\
     MQTT_ENDPOINT=<host>\n\
     MQTT_PORT=8883\n"
}

// ---------------------------------------------------------------------------
// Host-tooling-starter (TS monorepo) generators
// ---------------------------------------------------------------------------

fn gen_host_tooling_files() -> Vec<WizardPlannedFile> {
    vec![
        WizardPlannedFile {
            relative_path: "package.json".to_string(),
            content: concat!(
                r#"{"name":"my-alp-tool","version":"0.1.0","private":true,"#,
                r#""scripts":{"compile":"tsc --build && pnpm --filter ./packages/cli run compile","#,
                r#""test":"node --test test/*.test.js","clean":"tsc --build --clean"},"#,
                r#""devDependencies":{"typescript":"^5.5.0"},"engines":{"node":">=18"}}"#,
            )
            .to_string(),
        },
        WizardPlannedFile {
            relative_path: "pnpm-workspace.yaml".to_string(),
            content: "packages:\n  - \"packages/*\"\n".to_string(),
        },
        WizardPlannedFile {
            relative_path: "tsconfig.json".to_string(),
            content: r#"{"files":[],"references":[{"path":"./packages/core"},{"path":"./packages/cli"}]}"#
                .to_string(),
        },
        WizardPlannedFile {
            relative_path: ".gitignore".to_string(),
            content: "node_modules/\ndist/\nout/\n*.js.map\n.env\n".to_string(),
        },
        WizardPlannedFile {
            relative_path: "README.md".to_string(),
            content: gen_host_tooling_readme(),
        },
        WizardPlannedFile {
            relative_path: "packages/core/package.json".to_string(),
            content: concat!(
                r#"{"name":"my-alp-tool-core","version":"0.1.0","private":true,"#,
                r#""main":"dist/index.js","types":"dist/index.d.ts","#,
                r#""scripts":{"compile":"tsc --build"},"#,
                r#""devDependencies":{"typescript":"^5.5.0"}}"#,
            )
            .to_string(),
        },
        WizardPlannedFile {
            relative_path: "packages/core/tsconfig.json".to_string(),
            content: concat!(
                r#"{"compilerOptions":{"target":"ES2020","module":"commonjs","#,
                r#""declaration":true,"outDir":"./dist","strict":true,"composite":true},"#,
                r#""include":["src/**/*.ts"]}"#,
            )
            .to_string(),
        },
        WizardPlannedFile {
            relative_path: "packages/core/src/index.ts".to_string(),
            content: "// Core shared domain logic\nexport {};\n".to_string(),
        },
        WizardPlannedFile {
            relative_path: "packages/cli/package.json".to_string(),
            content: concat!(
                r#"{"name":"my-alp-tool-cli","version":"0.1.0","private":true,"#,
                r#""bin":{"my-alp-tool":"dist/cli/main.js"},"#,
                r#""scripts":{"compile":"tsc --build"},"#,
                r#""dependencies":{"my-alp-tool-core":"workspace:*"},"#,
                r#""devDependencies":{"typescript":"^5.5.0"}}"#,
            )
            .to_string(),
        },
        WizardPlannedFile {
            relative_path: "packages/cli/tsconfig.json".to_string(),
            content: concat!(
                r#"{"compilerOptions":{"target":"ES2020","module":"commonjs","#,
                r#""declaration":true,"outDir":"./dist","strict":true,"composite":true},"#,
                r#""references":[{"path":"../core"}],"include":["src/**/*.ts"]}"#,
            )
            .to_string(),
        },
        WizardPlannedFile {
            relative_path: "packages/cli/src/cli/main.ts".to_string(),
            content: "// CLI entry point\n\
                      import process from \"process\";\n\
                      \n\
                      async function main(): Promise<void> {\n\
                      \x20\x20// TODO: implement CLI logic.\n\
                      \x20\x20console.log(\"my-alp-tool\");\n\
                      }\n\
                      \n\
                      main().catch((err) => {\n\
                      \x20\x20console.error(err);\n\
                      \x20\x20process.exit(1);\n\
                      });\n"
                .to_string(),
        },
        WizardPlannedFile {
            relative_path: "src/extension.ts".to_string(),
            content: "// VS Code extension entry point\n\
                      import * as vscode from \"vscode\";\n\
                      \n\
                      export function activate(context: vscode.ExtensionContext): void {\n\
                      \x20\x20// TODO: register commands and providers.\n\
                      }\n\
                      \n\
                      export function deactivate(): void {}\n"
                .to_string(),
        },
    ]
}

fn gen_host_tooling_readme() -> String {
    "# my-alp-tool\n\
     \n\
     Generated by Alp: New Project Wizard.\n\
     \n\
     ## Workspace Layout\n\
     \n\
     - `packages/core` — shared domain logic\n\
     - `packages/cli` — standalone npm CLI\n\
     - `src/extension.ts` — VS Code extension entry point\n\
     \n\
     ## Getting Started\n\
     \n\
     ```bash\n\
     pnpm install\n\
     pnpm run compile\n\
     ```\n\
     \n\
     ## License\n\
     \n\
     Apache-2.0\n"
        .to_string()
}

// ---------------------------------------------------------------------------
// Module scaffold generators
// ---------------------------------------------------------------------------

fn gen_module_files(def: &ModuleTemplateDefinition, nm: &str) -> Vec<WizardPlannedFile> {
    vec![
        WizardPlannedFile {
            relative_path: format!("include/modules/{nm}.h"),
            content: gen_module_header(def.function_prefix, nm),
        },
        WizardPlannedFile {
            relative_path: format!("src/modules/{nm}/{nm}.c"),
            content: gen_module_c(def.function_prefix, nm),
        },
        WizardPlannedFile {
            relative_path: format!("src/modules/{nm}/README.md"),
            content: gen_module_readme(def, nm),
        },
    ]
}

fn gen_module_header(prefix: &str, nm: &str) -> String {
    let upper = nm.to_uppercase();
    format!(
        "// SPDX-License-Identifier: Apache-2.0\n\
         \n\
         #ifndef ALP_MODULES_{upper}_H\n\
         #define ALP_MODULES_{upper}_H\n\
         \n\
         int {prefix}_{nm}_init(void);\n\
         int {prefix}_{nm}_run(void);\n\
         \n\
         #endif /* ALP_MODULES_{upper}_H */\n"
    )
}

fn gen_module_c(prefix: &str, nm: &str) -> String {
    format!(
        "// SPDX-License-Identifier: Apache-2.0\n\
         \n\
         #include \"modules/{nm}.h\"\n\
         \n\
         // Board context: unavailable\n\
         \n\
         int {prefix}_{nm}_init(void) {{\n\
         \x20\x20// TODO: initialize module dependencies.\n\
         \x20\x20return 0;\n\
         }}\n\
         \n\
         int {prefix}_{nm}_run(void) {{\n\
         \x20\x20// TODO: implement module main behavior.\n\
         \x20\x20return 0;\n\
         }}\n"
    )
}

fn gen_module_readme(def: &ModuleTemplateDefinition, nm: &str) -> String {
    let mut s = String::new();
    s.push_str("# ALP Module Scaffold\n\n");
    s.push_str(&format!("Template: {}\n", def.id.as_str()));
    s.push_str(&format!("Module: {nm}\n\n"));
    s.push_str("## Notes\n\n");
    for line in def.explanation {
        let expanded = line.replace("{nm}", nm);
        s.push_str(&format!("- {expanded}\n"));
    }
    s.push_str("\nGenerated by Alp: Scaffold module.\n");
    s
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_normal_name() {
        assert_eq!(normalize_module_name("my_sensor").unwrap(), "my_sensor");
    }

    #[test]
    fn normalize_name_with_spaces() {
        assert_eq!(
            normalize_module_name("My Sensor Driver").unwrap(),
            "my_sensor_driver"
        );
    }

    #[test]
    fn normalize_empty_name_errors() {
        assert!(normalize_module_name("").is_err());
        assert!(normalize_module_name("   ").is_err());
        assert!(normalize_module_name("---").is_err());
    }

    #[test]
    fn list_templates_has_six_entries() {
        assert_eq!(list_wizard_templates().len(), 6);
    }

    #[test]
    fn list_module_templates_has_four_entries() {
        assert_eq!(list_module_templates().len(), 4);
    }

    #[test]
    fn wizard_plan_minimal_generates_expected_files() {
        let plan = create_wizard_plan(&WizardPlanInput {
            template_id: WizardTemplateId::MinimalApp,
            project_name: String::new(),
            destination: ".".to_string(),
            som_sku: None,
        });
        let paths: Vec<&str> = plan
            .files
            .iter()
            .map(|f| f.relative_path.as_str())
            .collect();
        assert!(paths.contains(&"board.yaml"));
        assert!(paths.contains(&"src/main.c"));
        assert!(paths.contains(&"CMakeLists.txt"));
    }

    fn board_yaml_of(plan: &WizardPlan) -> &str {
        plan.files
            .iter()
            .find(|f| f.relative_path == "board.yaml")
            .map(|f| f.content.as_str())
            .expect("board.yaml is generated")
    }

    #[test]
    fn som_sku_defaults_when_unset() {
        let plan = create_wizard_plan(&WizardPlanInput {
            template_id: WizardTemplateId::MinimalApp,
            project_name: String::new(),
            destination: ".".to_string(),
            som_sku: None,
        });
        assert!(board_yaml_of(&plan).contains("sku: E1M-AEN701"));
    }

    #[test]
    fn som_sku_overrides_board_yaml() {
        let plan = create_wizard_plan(&WizardPlanInput {
            template_id: WizardTemplateId::SensorStarter,
            project_name: String::new(),
            destination: ".".to_string(),
            som_sku: Some("E1M-V2N101".to_string()),
        });
        let board = board_yaml_of(&plan);
        assert!(board.contains("sku: E1M-V2N101"));
        assert!(!board.contains("E1M-AEN701"));
    }

    #[test]
    fn cores_scaffold_emits_companion_core_and_ipc() {
        let plan = create_wizard_plan_with_cores(
            &WizardPlanInput {
                template_id: WizardTemplateId::MinimalApp,
                project_name: String::new(),
                destination: ".".to_string(),
                som_sku: Some("E1M-V2N101".to_string()),
            },
            &[
                ("m33_sm".to_string(), "zephyr".to_string()),
                ("a55_cluster".to_string(), "yocto".to_string()),
            ],
        );
        let board = board_yaml_of(&plan);
        // App (Cortex-M) core + the Yocto companion + a default RPMsg channel.
        assert!(board.contains("  m33_sm:"));
        assert!(board.contains("  a55_cluster:"));
        assert!(board.contains("os: yocto"));
        assert!(board.contains("image: alp-image-edge"));
        assert!(board.contains("ipc:"));
        assert!(board.contains("name: alp_default_rpmsg"));
        assert!(board.contains("endpoints: [m33_sm, a55_cluster]"));
    }

    #[test]
    fn default_plan_is_single_core_no_ipc() {
        let plan = create_wizard_plan(&WizardPlanInput {
            template_id: WizardTemplateId::MinimalApp,
            project_name: String::new(),
            destination: ".".to_string(),
            som_sku: Some("E1M-V2N101".to_string()),
        });
        let board = board_yaml_of(&plan);
        assert!(!board.contains("ipc:"));
        assert!(!board.contains("a55_cluster"));
    }

    #[test]
    fn zephyr_companion_boots_stock_shim_not_the_app_dir() {
        let plan = create_wizard_plan_with_cores(
            &WizardPlanInput {
                template_id: WizardTemplateId::MinimalApp,
                project_name: String::new(),
                destination: ".".to_string(),
                som_sku: Some("E1M-AEN701".to_string()),
            },
            &[
                ("m55_hp".to_string(), "zephyr".to_string()),
                ("m55_he".to_string(), "zephyr".to_string()),
            ],
        );
        let board = board_yaml_of(&plan);
        // Only the app core builds from ./src; a Zephyr companion gets no
        // `app:` (it boots the SDK's stock shim) — two cores must never share
        // one source dir.
        assert_eq!(board.matches("app: ./src").count(), 1);
        assert!(board.contains("  m55_he:\n    os: zephyr"));
        assert!(board.contains("endpoints: [m55_hp, m55_he]"));
    }

    #[test]
    fn off_companion_is_never_an_ipc_endpoint() {
        let plan = create_wizard_plan_with_cores(
            &WizardPlanInput {
                template_id: WizardTemplateId::MinimalApp,
                project_name: String::new(),
                destination: ".".to_string(),
                som_sku: Some("E1M-AEN701".to_string()),
            },
            &[
                ("m55_hp".to_string(), "zephyr".to_string()),
                ("m55_he".to_string(), "off".to_string()),
            ],
        );
        let board = board_yaml_of(&plan);
        assert!(board.contains("  m55_he:\n    os: off"));
        // No active companion -> no default IPC channel at all.
        assert!(!board.contains("ipc:"));
    }

    #[test]
    fn runtime_inference_keys_on_silicon_class_word_starts() {
        assert_eq!(infer_runtime_for_core_id("a55_cluster"), "yocto");
        assert_eq!(infer_runtime_for_core_id("a32_cluster"), "yocto");
        assert_eq!(infer_runtime_for_core_id("m33_sm"), "zephyr");
        // 'a' not followed by a digit is NOT Cortex-A (the old starts_with('a')
        // heuristic misclassified ids like this as yocto).
        assert_eq!(infer_runtime_for_core_id("audio_dsp"), "zephyr");
    }

    #[test]
    fn board_yaml_conforms_to_v06_schema_shape() {
        // Schema-sanctioned top-level keys (board.schema.json, additionalProperties:false).
        const ALLOWED_TOP: &[&str] = &[
            "name",
            "description",
            "preset",
            "hw_rev",
            "som",
            "cores",
            "populated",
            "e1m_routes",
            "pins",
            "ipc",
            "diagnostics",
            "storage",
            "security",
            "boot",
            "ota",
            "chips",
            "features",
        ];

        // One per SoM family: the app core must match the family's topology.
        let cases = [
            (WizardTemplateId::IotStarter, None, "m55_hp"),
            (
                WizardTemplateId::EdgeAiStarter,
                Some("E1M-V2N101".to_string()),
                "m33_sm",
            ),
            (
                WizardTemplateId::BoardDiagnostics,
                Some("E1M-NX9101".to_string()),
                "m33",
            ),
        ];

        for (template_id, som_sku, want_core) in cases {
            let plan = create_wizard_plan(&WizardPlanInput {
                template_id,
                project_name: String::new(),
                destination: ".".to_string(),
                som_sku,
            });
            let yaml = board_yaml_of(&plan);
            let doc: serde_yaml::Value =
                serde_yaml::from_str(yaml).expect("generated board.yaml parses as YAML");
            let map = doc.as_mapping().expect("board.yaml is a mapping");

            // Required keys present; pre-v0.6 keys gone.
            assert!(map.contains_key("som"), "missing som:\n{yaml}");
            assert!(map.contains_key("cores"), "missing cores:\n{yaml}");
            for forbidden in [
                "schema_version",
                "carrier",
                "os",
                "libraries",
                "iot",
                "inference",
            ] {
                assert!(
                    !map.contains_key(forbidden),
                    "forbidden top-level `{forbidden}`:\n{yaml}"
                );
            }
            for key in map.keys() {
                let key = key.as_str().unwrap_or_default();
                assert!(
                    ALLOWED_TOP.contains(&key),
                    "non-schema top-level key `{key}`:\n{yaml}"
                );
            }

            // cores: non-empty, contains the family's app core.
            let cores = map
                .get("cores")
                .and_then(|c| c.as_mapping())
                .expect("cores is a mapping");
            assert!(!cores.is_empty(), "cores must be non-empty:\n{yaml}");
            assert!(
                cores.contains_key(want_core),
                "expected app core `{want_core}`:\n{yaml}"
            );
        }
    }

    #[test]
    fn scaffold_preview_sorted_order() {
        let files = vec![
            WizardPlannedFile {
                relative_path: "src/main.c".to_string(),
                content: String::new(),
            },
            WizardPlannedFile {
                relative_path: "board.yaml".to_string(),
                content: String::new(),
            },
        ];
        let tree = create_scaffold_tree_preview(&files);
        assert!(tree.starts_with(".\n"));
        assert!(tree.contains("|-- board.yaml"));
        assert!(tree.contains("`-- src/main.c"));
    }

    #[test]
    fn module_scaffold_plan_normalizes_and_generates() {
        let plan = create_module_scaffold_plan(&ModuleScaffoldInput {
            template_id: ModuleTemplateId::SensorDriver,
            module_name: "My Sensor".to_string(),
            destination: ".".to_string(),
        })
        .unwrap();
        assert_eq!(plan.normalized_name, "my_sensor");
        assert_eq!(plan.files.len(), 3);
    }

    #[test]
    fn module_scaffold_invalid_name_errors() {
        let result = create_module_scaffold_plan(&ModuleScaffoldInput {
            template_id: ModuleTemplateId::DiagnosticsCheck,
            module_name: "---".to_string(),
            destination: ".".to_string(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn iot_starter_has_env_example() {
        let plan = create_wizard_plan(&WizardPlanInput {
            template_id: WizardTemplateId::IotStarter,
            project_name: String::new(),
            destination: ".".to_string(),
            som_sku: None,
        });
        let paths: Vec<&str> = plan
            .files
            .iter()
            .map(|f| f.relative_path.as_str())
            .collect();
        assert!(paths.contains(&"config/iot.env.example"));
    }

    #[test]
    fn host_tooling_starter_generates_ts_files() {
        let plan = create_wizard_plan(&WizardPlanInput {
            template_id: WizardTemplateId::HostToolingStarter,
            project_name: String::new(),
            destination: ".".to_string(),
            som_sku: None,
        });
        let paths: Vec<&str> = plan
            .files
            .iter()
            .map(|f| f.relative_path.as_str())
            .collect();
        assert!(paths.contains(&"package.json"));
        assert!(paths.contains(&"src/extension.ts"));
        assert!(paths.contains(&"packages/core/src/index.ts"));
    }
}
