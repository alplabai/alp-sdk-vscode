// SPDX-License-Identifier: Apache-2.0
//! Debug `doctor` domain — a port of the TypeScript `@alp-sdk/core/debug`
//! doctor logic (`buildDoctorReport`, `serverChoicesForTarget`, and the
//! runtime-capability/workspace-context adapters).
//!
//! All logic here is pure: runtime capabilities and `board.yaml` existence are
//! injected as predicates, so doctor parity with the TS implementation is
//! guaranteed by deterministic unit tests rather than by the (machine-
//! dependent) golden-fixture harness.

use serde::Serialize;

use crate::project::ProjectContext;

/// Class of debug target a project produces; drives which servers and checks apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DebugTargetKind {
    /// Zephyr RTOS firmware on an MCU.
    ZephyrMcu,
    /// Bare-metal firmware on an MCU.
    BaremetalMcu,
    /// A userspace process on a Yocto/Linux image.
    YoctoUserspace,
    /// A native executable on the host machine.
    NativeHost,
}

impl DebugTargetKind {
    /// The kebab-case wire string for this kind (matches the serde representation).
    pub fn as_str(self) -> &'static str {
        match self {
            DebugTargetKind::ZephyrMcu => "zephyr-mcu",
            DebugTargetKind::BaremetalMcu => "baremetal-mcu",
            DebugTargetKind::YoctoUserspace => "yocto-userspace",
            DebugTargetKind::NativeHost => "native-host",
        }
    }
}

/// Debug-server / GDB backend used to attach to a target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugServerKind {
    /// SEGGER J-Link GDB server.
    Jlink,
    /// OpenOCD.
    Openocd,
    /// pyOCD.
    Pyocd,
    /// A remote `gdbserver` (Yocto userspace).
    Gdbserver,
    /// No server (native-host debugging).
    None,
}

impl DebugServerKind {
    /// The lowercase wire string for this kind (matches the serde representation).
    pub fn as_str(self) -> &'static str {
        match self {
            DebugServerKind::Jlink => "jlink",
            DebugServerKind::Openocd => "openocd",
            DebugServerKind::Pyocd => "pyocd",
            DebugServerKind::Gdbserver => "gdbserver",
            DebugServerKind::None => "none",
        }
    }
}

/// Outcome of a single doctor check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
    /// Check passed.
    Pass,
    /// Non-fatal issue (degraded but usable).
    Warn,
    /// Blocking failure.
    Fail,
}

/// Parse `--target-kind`. Mirrors TS `parseTargetKind`: an absent/empty value
/// defaults to `native-host`; an unknown value is an error.
pub fn parse_target_kind(raw: Option<&str>) -> Result<DebugTargetKind, String> {
    match raw.unwrap_or("") {
        "" | "native-host" => Ok(DebugTargetKind::NativeHost),
        "zephyr-mcu" => Ok(DebugTargetKind::ZephyrMcu),
        "baremetal-mcu" => Ok(DebugTargetKind::BaremetalMcu),
        "yocto-userspace" => Ok(DebugTargetKind::YoctoUserspace),
        other => Err(format!(
            "Unsupported --target-kind '{other}'. Allowed values: zephyr-mcu, baremetal-mcu, yocto-userspace, native-host."
        )),
    }
}

/// Parse `--server`. Mirrors TS `parseServerKind`: absent/empty defaults to
/// `none`; an unknown value is an error.
pub fn parse_server_kind(raw: Option<&str>) -> Result<DebugServerKind, String> {
    match raw.unwrap_or("") {
        "" | "none" => Ok(DebugServerKind::None),
        "jlink" => Ok(DebugServerKind::Jlink),
        "openocd" => Ok(DebugServerKind::Openocd),
        "pyocd" => Ok(DebugServerKind::Pyocd),
        "gdbserver" => Ok(DebugServerKind::Gdbserver),
        other => Err(format!(
            "Unsupported --server '{other}'. Allowed values: jlink, openocd, pyocd, gdbserver, none."
        )),
    }
}

/// The debug servers valid for a given target kind.
pub fn server_choices_for_target(target: DebugTargetKind) -> &'static [DebugServerKind] {
    match target {
        DebugTargetKind::ZephyrMcu | DebugTargetKind::BaremetalMcu => &[
            DebugServerKind::Jlink,
            DebugServerKind::Openocd,
            DebugServerKind::Pyocd,
        ],
        DebugTargetKind::YoctoUserspace => &[DebugServerKind::Gdbserver],
        DebugTargetKind::NativeHost => &[DebugServerKind::None],
    }
}

/// Whether `server` is among the valid choices for `target`.
pub fn is_server_supported_for_target(target: DebugTargetKind, server: DebugServerKind) -> bool {
    server_choices_for_target(target).contains(&server)
}

/// Which VS Code debugger extensions are installed in the host.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebuggerExtensionsState {
    /// `marus25.cortex-debug` is installed.
    pub cortex_debug: bool,
    /// `mcu-debug.peripheral-viewer` is installed.
    pub peripheral_viewer: bool,
    /// `mcu-debug.memory-view` is installed.
    pub memory_view: bool,
    /// `ms-vscode.cpptools` is installed.
    pub cpp_tools: bool,
    /// `vadimcn.vscode-lldb` is installed.
    #[serde(rename = "codeLLDB")]
    pub code_lldb: bool,
}

/// Probed availability of debug tooling on the host (PATH lookups + interpreter).
#[derive(Debug, Clone)]
pub struct DebugRuntimeCapabilities {
    /// The configured Python interpreter is on PATH.
    pub python_available: bool,
    /// Resolved J-Link GDB-server executable name, if found.
    pub jlink_executable: Option<String>,
    /// Resolved OpenOCD executable name, if found.
    pub open_ocd_executable: Option<String>,
    /// Resolved pyOCD executable name, if found.
    pub pyocd_executable: Option<String>,
    /// Resolved GDB executable name, if found.
    pub gdb_executable: Option<String>,
    /// Resolved LLDB executable name, if found.
    pub lldb_executable: Option<String>,
}

/// Context fed to `build_doctor_report`. Serialized (camelCase) only inside the
/// support-bundle file; the doctor/inspect envelopes emit derived reports, not
/// the context itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugWorkspaceContext {
    /// ISO-8601 timestamp the context was created.
    pub generated_at: String,
    /// Active workspace folder, if any.
    pub workspace_root: Option<String>,
    /// Resolved alp-sdk checkout root.
    pub sdk_root: Option<String>,
    /// Resolved `board.yaml` path.
    pub board_yaml_path: Option<String>,
    /// Working directory used for `west` commands.
    pub west_cwd: Option<String>,
    /// Python interpreter used for loader/validation scripts.
    pub python_binary: String,
    /// Whether `board.yaml` exists at the resolved path (probed).
    pub board_yaml_exists: bool,
    /// Installed-extension state for the host.
    pub debugger_extensions: DebuggerExtensionsState,
}

/// Mirror of TS `createDebugWorkspaceContext`: `board.yaml` existence is probed
/// via the injected predicate only when a path resolved.
pub fn create_debug_workspace_context(
    project: &ProjectContext,
    generated_at: String,
    board_yaml_exists: impl Fn(&str) -> bool,
    debugger_extensions: DebuggerExtensionsState,
) -> DebugWorkspaceContext {
    let exists = match &project.board_yaml_path {
        Some(path) => board_yaml_exists(path),
        None => false,
    };
    DebugWorkspaceContext {
        generated_at,
        workspace_root: project.workspace_root.clone(),
        sdk_root: project.sdk_root.clone(),
        board_yaml_path: project.board_yaml_path.clone(),
        west_cwd: project.west_cwd.clone(),
        python_binary: project.python_binary.clone(),
        board_yaml_exists: exists,
        debugger_extensions,
    }
}

// ───────────────────────── inspect: resolved values ─────────────────────────

/// Where a resolved `alp inspect` value originated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugValueSource {
    /// Derived from the active workspace folder.
    Workspace,
    /// From an explicit extension/user setting.
    Setting,
    /// A built-in default.
    Default,
    /// Probed at runtime (e.g. file existence).
    Runtime,
    /// Computed from other values.
    Derived,
    /// Could not be resolved.
    Unresolved,
}

/// A single resolved project value surfaced by `alp inspect`.
#[derive(Debug, Clone, Serialize)]
pub struct DebugResolvedValue {
    /// Stable key (e.g. `workspaceRoot`).
    pub key: String,
    /// The resolved value (string, bool, or null).
    pub value: serde_json::Value,
    /// How the value was obtained.
    pub source: DebugValueSource,
    /// Human-readable explanation.
    pub detail: String,
}

/// Mirror of TS `collectResolvedValues`: the project-context fields surfaced by
/// `alp inspect`, each tagged with a source + human detail.
pub fn collect_resolved_values(context: &DebugWorkspaceContext) -> Vec<DebugResolvedValue> {
    use serde_json::Value;

    let opt_value = |v: &Option<String>| match v {
        Some(s) => Value::String(s.clone()),
        None => Value::Null,
    };

    vec![
        DebugResolvedValue {
            key: "workspaceRoot".to_string(),
            value: opt_value(&context.workspace_root),
            source: if context.workspace_root.is_some() {
                DebugValueSource::Workspace
            } else {
                DebugValueSource::Unresolved
            },
            detail: if context.workspace_root.is_some() {
                "Resolved from the active workspace folder."
            } else {
                "No workspace folder is open."
            }
            .to_string(),
        },
        DebugResolvedValue {
            key: "sdkRoot".to_string(),
            value: opt_value(&context.sdk_root),
            source: if context.sdk_root.is_some() {
                DebugValueSource::Workspace
            } else {
                DebugValueSource::Unresolved
            },
            detail: if context.sdk_root.is_some() {
                "Resolved alp-sdk root used for scripts and schemas."
            } else {
                "Set alpSdk.path when automatic discovery is ambiguous."
            }
            .to_string(),
        },
        DebugResolvedValue {
            key: "boardYamlPath".to_string(),
            value: opt_value(&context.board_yaml_path),
            source: if context.board_yaml_path.is_some() {
                DebugValueSource::Setting
            } else {
                DebugValueSource::Unresolved
            },
            detail: if context.board_yaml_path.is_some() {
                "Resolved board.yaml path from project settings."
            } else {
                "board.yaml path is unresolved."
            }
            .to_string(),
        },
        DebugResolvedValue {
            key: "boardYamlExists".to_string(),
            value: serde_json::Value::Bool(context.board_yaml_exists),
            source: DebugValueSource::Runtime,
            detail: if context.board_yaml_exists {
                "board.yaml exists at the resolved path."
            } else {
                "board.yaml is missing at the resolved path."
            }
            .to_string(),
        },
        DebugResolvedValue {
            key: "westCwd".to_string(),
            value: opt_value(&context.west_cwd),
            source: if context.west_cwd.is_some() {
                DebugValueSource::Setting
            } else {
                DebugValueSource::Default
            },
            detail: if context.west_cwd.is_some() {
                "Working directory used for west commands."
            } else {
                "Defaults to the workspace root."
            }
            .to_string(),
        },
        DebugResolvedValue {
            key: "pythonBinary".to_string(),
            value: serde_json::Value::String(context.python_binary.clone()),
            source: if context.python_binary == "python3" || context.python_binary == "python" {
                DebugValueSource::Default
            } else {
                DebugValueSource::Setting
            },
            detail: "Interpreter used for loader and validation scripts.".to_string(),
        },
    ]
}

// ───────────────────────── trace: generation decisions ─────────────────────

/// Result of a single generation decision in an `alp trace`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugTraceOutcome {
    /// Output was planned but not written.
    Planned,
    /// Output was written to disk.
    Written,
    /// Generation failed.
    Failed,
}

/// One generation decision recorded by `alp trace`.
#[derive(Debug, Clone, Serialize)]
pub struct DebugGenerationTraceDecision {
    /// Identifier of the artifact (e.g. `zephyr-conf`).
    pub key: String,
    /// What happened to the artifact.
    pub outcome: DebugTraceOutcome,
    /// Target path, when an output path applies.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// Human-readable explanation.
    pub detail: String,
}

/// Mirror of TS `collectRuntimeCapabilitiesFromCommands`.
pub fn collect_runtime_capabilities_from_commands(
    project: &ProjectContext,
    command_on_path: impl Fn(&str) -> bool,
) -> DebugRuntimeCapabilities {
    let first_available = |commands: &[&str]| -> Option<String> {
        commands
            .iter()
            .find(|c| command_on_path(c))
            .map(|c| (*c).to_string())
    };

    DebugRuntimeCapabilities {
        python_available: command_on_path(&project.python_binary),
        jlink_executable: first_available(&["JLinkGDBServerCL", "JLinkGDBServer"]),
        open_ocd_executable: first_available(&["openocd"]),
        pyocd_executable: first_available(&["pyocd"]),
        gdb_executable: first_available(&["gdb", "arm-none-eabi-gdb"]),
        lldb_executable: first_available(&["lldb-dap", "lldb"]),
    }
}

/// A single doctor check with its status and an optional remediation.
#[derive(Debug, Clone, Serialize)]
pub struct DoctorCheck {
    /// Stable check name (e.g. `boardYaml`).
    pub name: String,
    /// The check outcome.
    pub status: DoctorStatus,
    /// Human-readable detail for the outcome.
    pub detail: String,
    /// Suggested fix; omitted from JSON when absent (e.g. on `Pass`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

impl DoctorCheck {
    fn new(name: &str, status: DoctorStatus, detail: String, fix: Option<String>) -> Self {
        Self {
            name: name.to_string(),
            status,
            detail,
            fix,
        }
    }
}

/// Per-status check counts for a doctor report.
#[derive(Debug, Clone, Serialize)]
pub struct DoctorSummary {
    /// Number of passing checks.
    pub pass: u32,
    /// Number of warning checks.
    pub warn: u32,
    /// Number of failing checks.
    pub fail: u32,
}

/// Full `alp doctor` report for a target/server combination.
#[derive(Debug, Clone, Serialize)]
pub struct DoctorReport {
    /// ISO-8601 timestamp the report was generated.
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    /// Target kind the report was run for.
    #[serde(rename = "targetKind")]
    pub target_kind: DebugTargetKind,
    /// Server backend the report was run for.
    pub server: DebugServerKind,
    /// Aggregate pass/warn/fail counts.
    pub summary: DoctorSummary,
    /// Individual checks in evaluation order.
    pub checks: Vec<DoctorCheck>,
    /// Deduplicated remediation steps for non-passing checks.
    #[serde(rename = "nextSteps")]
    pub next_steps: Vec<String>,
}

/// A companion viewer extension surfaced as an MCU debug-readiness check.
/// Mirror of one TS `MCU_COMPANION_VIEWERS` entry.
struct McuCompanionViewer {
    /// Reads the installed flag for this viewer from the probed extensions state.
    installed: fn(&DebuggerExtensionsState) -> bool,
    /// Stable check name (e.g. `peripheralViewerExtension`).
    name: &'static str,
    /// Detail shown when the viewer is installed.
    installed_detail: &'static str,
    /// Detail shown when the viewer is missing.
    missing_detail: &'static str,
    /// Remediation shown when the viewer is missing.
    fix: &'static str,
}

/// Mirror of TS `MCU_COMPANION_VIEWERS`: the SVD-backed debug companion viewers
/// (`mcu-debug.peripheral-viewer`, `mcu-debug.memory-view`) checked for MCU targets.
const MCU_COMPANION_VIEWERS: [McuCompanionViewer; 2] = [
    McuCompanionViewer {
        installed: |ext| ext.peripheral_viewer,
        name: "peripheralViewerExtension",
        installed_detail: "mcu-debug.peripheral-viewer is installed.",
        missing_detail: "mcu-debug.peripheral-viewer is not installed.",
        fix: "Install mcu-debug.peripheral-viewer for SVD-backed peripheral/register views.",
    },
    McuCompanionViewer {
        installed: |ext| ext.memory_view,
        name: "memoryViewExtension",
        installed_detail: "mcu-debug.memory-view is installed.",
        missing_detail: "mcu-debug.memory-view is not installed.",
        fix: "Install mcu-debug.memory-view for low-level memory inspection.",
    },
];

/// Mirror of TS `createMcuCompanionViewerDoctorChecks`: one `pass`/`warn` check
/// per MCU companion viewer, warning (never failing) when a viewer is missing.
fn create_mcu_companion_viewer_checks(extensions: &DebuggerExtensionsState) -> Vec<DoctorCheck> {
    MCU_COMPANION_VIEWERS
        .iter()
        .map(|viewer| {
            let installed = (viewer.installed)(extensions);
            DoctorCheck::new(
                viewer.name,
                status_pass_warn(installed),
                if installed {
                    viewer.installed_detail
                } else {
                    viewer.missing_detail
                }
                .to_string(),
                fix_when(!installed, viewer.fix),
            )
        })
        .collect()
}

/// Mirror of TS `buildDoctorReport`.
pub fn build_doctor_report(
    context: &DebugWorkspaceContext,
    target: DebugTargetKind,
    server: DebugServerKind,
    runtime: &DebugRuntimeCapabilities,
) -> DoctorReport {
    let has_workspace = is_present(&context.workspace_root);
    let has_sdk = is_present(&context.sdk_root);

    let mut checks: Vec<DoctorCheck> = vec![
        DoctorCheck::new(
            "workspaceRoot",
            status_pass_fail(has_workspace),
            context
                .workspace_root
                .clone()
                .unwrap_or_else(|| "No workspace folder is open.".to_string()),
            fix_when(
                !has_workspace,
                "Open a workspace containing an ALP project.",
            ),
        ),
        DoctorCheck::new(
            "sdkRoot",
            status_pass_fail(has_sdk),
            context.sdk_root.clone().unwrap_or_else(|| {
                "The extension could not resolve an alp-sdk checkout.".to_string()
            }),
            fix_when(
                !has_sdk,
                "Configure alpSdk.path or open a workspace near an alp-sdk checkout.",
            ),
        ),
        DoctorCheck::new(
            "boardYaml",
            status_pass_fail(context.board_yaml_exists),
            context
                .board_yaml_path
                .clone()
                .unwrap_or_else(|| "board.yaml path is unresolved.".to_string()),
            fix_when(
                !context.board_yaml_exists,
                "Create board.yaml or configure alpSdk.boardYamlPath.",
            ),
        ),
        DoctorCheck::new(
            "python",
            status_pass_warn(runtime.python_available),
            format!("Interpreter probe: {}", context.python_binary),
            fix_when(
                !runtime.python_available,
                "Install the configured Python interpreter or update alpSdk.pythonPath.",
            ),
        ),
    ];

    if !is_server_supported_for_target(target, server) {
        checks.push(DoctorCheck::new(
            "serverCompatibility",
            DoctorStatus::Fail,
            format!(
                "{} is not supported for {}.",
                server.as_str(),
                target.as_str()
            ),
            Some("Pick a supported backend for the selected target class.".to_string()),
        ));
        return finalize_report(context.generated_at.clone(), target, server, checks);
    }

    match target {
        DebugTargetKind::ZephyrMcu | DebugTargetKind::BaremetalMcu => {
            let installed = context.debugger_extensions.cortex_debug;
            checks.push(DoctorCheck::new(
                "cortexDebugExtension",
                status_pass_fail(installed),
                if installed {
                    "marus25.cortex-debug is installed."
                } else {
                    "marus25.cortex-debug is not installed."
                }
                .to_string(),
                fix_when(!installed, "Install marus25.cortex-debug."),
            ));
            checks.extend(create_mcu_companion_viewer_checks(
                &context.debugger_extensions,
            ));
            checks.push(create_backend_check(server, runtime));
        }
        DebugTargetKind::YoctoUserspace => {
            let installed = context.debugger_extensions.cpp_tools;
            checks.push(DoctorCheck::new(
                "cppToolsExtension",
                status_pass_fail(installed),
                if installed {
                    "ms-vscode.cpptools is installed."
                } else {
                    "ms-vscode.cpptools is not installed."
                }
                .to_string(),
                fix_when(!installed, "Install ms-vscode.cpptools."),
            ));
            let gdb = runtime.gdb_executable.clone();
            checks.push(DoctorCheck::new(
                "gdb",
                status_pass_warn(gdb.is_some()),
                gdb.unwrap_or_else(|| "No local gdb executable was found on PATH.".to_string()),
                fix_when(
                    runtime.gdb_executable.is_none(),
                    "Install gdb locally for symbolized remote debugging.",
                ),
            ));
        }
        DebugTargetKind::NativeHost => {
            let installed = context.debugger_extensions.code_lldb;
            checks.push(DoctorCheck::new(
                "codeLLDBExtension",
                status_pass_fail(installed),
                if installed {
                    "vadimcn.vscode-lldb is installed."
                } else {
                    "vadimcn.vscode-lldb is not installed."
                }
                .to_string(),
                fix_when(!installed, "Install vadimcn.vscode-lldb."),
            ));
            let lldb = runtime.lldb_executable.clone();
            checks.push(DoctorCheck::new(
                "lldb",
                status_pass_warn(lldb.is_some()),
                lldb.unwrap_or_else(|| "No local LLDB executable was found on PATH.".to_string()),
                fix_when(
                    runtime.lldb_executable.is_none(),
                    "Install LLDB or lldb-dap for native-host debug flows.",
                ),
            ));
        }
    }

    finalize_report(context.generated_at.clone(), target, server, checks)
}

fn create_backend_check(
    server: DebugServerKind,
    runtime: &DebugRuntimeCapabilities,
) -> DoctorCheck {
    let executable = resolve_backend_executable(server, runtime);
    let found = executable.is_some();
    DoctorCheck::new(
        &format!("{}Backend", server.as_str()),
        status_pass_warn(found),
        executable
            .unwrap_or_else(|| format!("No {} executable was found on PATH.", server.as_str())),
        fix_when_owned(
            !found,
            format!("Install {} and make sure it is on PATH.", server.as_str()),
        ),
    )
}

fn resolve_backend_executable(
    server: DebugServerKind,
    runtime: &DebugRuntimeCapabilities,
) -> Option<String> {
    match server {
        DebugServerKind::Jlink => runtime.jlink_executable.clone(),
        DebugServerKind::Openocd => runtime.open_ocd_executable.clone(),
        DebugServerKind::Pyocd => runtime.pyocd_executable.clone(),
        DebugServerKind::Gdbserver => runtime.gdb_executable.clone(),
        DebugServerKind::None => runtime.lldb_executable.clone(),
    }
}

fn finalize_report(
    generated_at: String,
    target: DebugTargetKind,
    server: DebugServerKind,
    checks: Vec<DoctorCheck>,
) -> DoctorReport {
    let summary = DoctorSummary {
        pass: count_status(&checks, DoctorStatus::Pass),
        warn: count_status(&checks, DoctorStatus::Warn),
        fail: count_status(&checks, DoctorStatus::Fail),
    };
    let next_steps = unique_next_steps(&checks);
    DoctorReport {
        generated_at,
        target_kind: target,
        server,
        summary,
        checks,
        next_steps,
    }
}

fn count_status(checks: &[DoctorCheck], status: DoctorStatus) -> u32 {
    checks.iter().filter(|c| c.status == status).count() as u32
}

fn unique_next_steps(checks: &[DoctorCheck]) -> Vec<String> {
    let mut steps: Vec<String> = Vec::new();
    for check in checks {
        if check.status == DoctorStatus::Pass {
            continue;
        }
        if let Some(fix) = &check.fix {
            if !steps.contains(fix) {
                steps.push(fix.clone());
            }
        }
    }
    steps
}

fn is_present(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|s| !s.is_empty())
}

fn status_pass_fail(ok: bool) -> DoctorStatus {
    if ok {
        DoctorStatus::Pass
    } else {
        DoctorStatus::Fail
    }
}

fn status_pass_warn(ok: bool) -> DoctorStatus {
    if ok {
        DoctorStatus::Pass
    } else {
        DoctorStatus::Warn
    }
}

fn fix_when(unhealthy: bool, fix: &str) -> Option<String> {
    unhealthy.then(|| fix.to_string())
}

fn fix_when_owned(unhealthy: bool, fix: String) -> Option<String> {
    unhealthy.then_some(fix)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extensions_all_installed() -> DebuggerExtensionsState {
        DebuggerExtensionsState {
            cortex_debug: true,
            peripheral_viewer: true,
            memory_view: true,
            cpp_tools: true,
            code_lldb: true,
        }
    }

    fn healthy_context() -> DebugWorkspaceContext {
        DebugWorkspaceContext {
            generated_at: "1970-01-01T00:00:00.000Z".to_string(),
            workspace_root: Some("/work/proj".to_string()),
            sdk_root: Some("/work/alp-sdk".to_string()),
            board_yaml_path: Some("/work/proj/board.yaml".to_string()),
            west_cwd: Some("/work/proj".to_string()),
            python_binary: "python3".to_string(),
            board_yaml_exists: true,
            debugger_extensions: extensions_all_installed(),
        }
    }

    fn runtime_all_present() -> DebugRuntimeCapabilities {
        DebugRuntimeCapabilities {
            python_available: true,
            jlink_executable: Some("JLinkGDBServerCL".to_string()),
            open_ocd_executable: Some("openocd".to_string()),
            pyocd_executable: Some("pyocd".to_string()),
            gdb_executable: Some("gdb".to_string()),
            lldb_executable: Some("lldb".to_string()),
        }
    }

    fn runtime_none() -> DebugRuntimeCapabilities {
        DebugRuntimeCapabilities {
            python_available: false,
            jlink_executable: None,
            open_ocd_executable: None,
            pyocd_executable: None,
            gdb_executable: None,
            lldb_executable: None,
        }
    }

    #[test]
    fn parse_defaults_match_ts() {
        assert_eq!(
            parse_target_kind(None).unwrap(),
            DebugTargetKind::NativeHost
        );
        assert_eq!(
            parse_target_kind(Some("")).unwrap(),
            DebugTargetKind::NativeHost
        );
        assert_eq!(parse_server_kind(None).unwrap(), DebugServerKind::None);
        assert_eq!(
            parse_target_kind(Some("zephyr-mcu")).unwrap(),
            DebugTargetKind::ZephyrMcu
        );
    }

    #[test]
    fn parse_unknown_values_error_with_ts_message() {
        let err = parse_target_kind(Some("bogus")).unwrap_err();
        assert!(err.contains("Unsupported --target-kind 'bogus'"));
        assert!(err.contains("zephyr-mcu, baremetal-mcu, yocto-userspace, native-host"));
        let err = parse_server_kind(Some("bogus")).unwrap_err();
        assert!(err.contains("Unsupported --server 'bogus'"));
    }

    #[test]
    fn server_support_matrix() {
        assert!(is_server_supported_for_target(
            DebugTargetKind::ZephyrMcu,
            DebugServerKind::Jlink
        ));
        assert!(!is_server_supported_for_target(
            DebugTargetKind::NativeHost,
            DebugServerKind::Jlink
        ));
        assert!(is_server_supported_for_target(
            DebugTargetKind::YoctoUserspace,
            DebugServerKind::Gdbserver
        ));
    }

    #[test]
    fn native_host_all_green_passes() {
        let report = build_doctor_report(
            &healthy_context(),
            DebugTargetKind::NativeHost,
            DebugServerKind::None,
            &runtime_all_present(),
        );
        // 4 base checks + codeLLDBExtension + lldb = 6 checks, all pass.
        assert_eq!(report.checks.len(), 6);
        assert_eq!(report.summary.pass, 6);
        assert_eq!(report.summary.warn, 0);
        assert_eq!(report.summary.fail, 0);
        assert!(report.next_steps.is_empty());
        assert_eq!(report.target_kind, DebugTargetKind::NativeHost);
    }

    #[test]
    fn zephyr_with_missing_runtime_warns_backend() {
        let report = build_doctor_report(
            &healthy_context(),
            DebugTargetKind::ZephyrMcu,
            DebugServerKind::Jlink,
            &runtime_none(),
        );
        // 4 base (python warn) + cortexDebugExtension pass + jlinkBackend warn.
        let backend = report
            .checks
            .iter()
            .find(|c| c.name == "jlinkBackend")
            .expect("backend check present");
        assert_eq!(backend.status, DoctorStatus::Warn);
        assert!(backend.detail.contains("No jlink executable"));
        // python warn + backend warn.
        assert_eq!(report.summary.warn, 2);
        assert_eq!(report.summary.fail, 0);
        assert!(
            report
                .next_steps
                .iter()
                .any(|s| s.contains("Install jlink"))
        );
    }

    #[test]
    fn missing_workspace_and_sdk_fail() {
        let mut ctx = healthy_context();
        ctx.workspace_root = None;
        ctx.sdk_root = None;
        ctx.board_yaml_exists = false;
        let report = build_doctor_report(
            &ctx,
            DebugTargetKind::NativeHost,
            DebugServerKind::None,
            &runtime_all_present(),
        );
        assert_eq!(report.summary.fail, 3); // workspaceRoot, sdkRoot, boardYaml
        let workspace = &report.checks[0];
        assert_eq!(workspace.status, DoctorStatus::Fail);
        assert_eq!(workspace.detail, "No workspace folder is open.");
        assert!(workspace.fix.is_some());
    }

    #[test]
    fn unsupported_server_branch_short_circuits() {
        let report = build_doctor_report(
            &healthy_context(),
            DebugTargetKind::NativeHost,
            DebugServerKind::Jlink,
            &runtime_all_present(),
        );
        let compat = report.checks.last().expect("a check present");
        assert_eq!(compat.name, "serverCompatibility");
        assert_eq!(compat.status, DoctorStatus::Fail);
        assert_eq!(compat.detail, "jlink is not supported for native-host.");
        assert_eq!(report.summary.fail, 1);
        // base 4 checks + serverCompatibility, no target-specific checks.
        assert_eq!(report.checks.len(), 5);
    }

    #[test]
    fn report_serializes_with_contract_field_names() {
        let report = build_doctor_report(
            &healthy_context(),
            DebugTargetKind::NativeHost,
            DebugServerKind::None,
            &runtime_all_present(),
        );
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"generatedAt\":\"1970-01-01T00:00:00.000Z\""));
        assert!(json.contains("\"targetKind\":\"native-host\""));
        assert!(json.contains("\"server\":\"none\""));
        assert!(json.contains("\"nextSteps\":[]"));
        // pass checks omit the optional `fix` field.
        assert!(!json.contains("\"fix\""));
    }

    fn extensions_missing_viewers() -> DebuggerExtensionsState {
        DebuggerExtensionsState {
            cortex_debug: true,
            peripheral_viewer: false,
            memory_view: false,
            cpp_tools: true,
            code_lldb: true,
        }
    }

    #[test]
    fn extensions_state_serializes_new_viewer_fields_as_camel_case() {
        let json = serde_json::to_string(&extensions_all_installed()).unwrap();
        assert!(json.contains("\"cortexDebug\":true"));
        assert!(json.contains("\"peripheralViewer\":true"));
        assert!(json.contains("\"memoryView\":true"));
        assert!(json.contains("\"cppTools\":true"));
        assert!(json.contains("\"codeLLDB\":true"));
    }

    #[test]
    fn zephyr_emits_companion_viewer_checks_between_cortex_and_backend() {
        let report = build_doctor_report(
            &healthy_context(),
            DebugTargetKind::ZephyrMcu,
            DebugServerKind::Jlink,
            &runtime_all_present(),
        );
        let names: Vec<&str> = report.checks.iter().map(|c| c.name.as_str()).collect();
        // Ordering: cortexDebugExtension, then the two viewers, then the backend.
        let cortex = names.iter().position(|n| *n == "cortexDebugExtension");
        let peripheral = names.iter().position(|n| *n == "peripheralViewerExtension");
        let memory = names.iter().position(|n| *n == "memoryViewExtension");
        let backend = names.iter().position(|n| *n == "jlinkBackend");
        assert!(cortex < peripheral);
        assert!(peripheral < memory);
        assert!(memory < backend);

        let peripheral_check = &report.checks[peripheral.unwrap()];
        assert_eq!(peripheral_check.status, DoctorStatus::Pass);
        assert_eq!(
            peripheral_check.detail,
            "mcu-debug.peripheral-viewer is installed."
        );
        assert!(peripheral_check.fix.is_none());

        let memory_check = &report.checks[memory.unwrap()];
        assert_eq!(memory_check.status, DoctorStatus::Pass);
        assert_eq!(memory_check.detail, "mcu-debug.memory-view is installed.");
        assert!(memory_check.fix.is_none());
    }

    #[test]
    fn baremetal_missing_companion_viewers_warn_with_fix() {
        let mut ctx = healthy_context();
        ctx.debugger_extensions = extensions_missing_viewers();
        let report = build_doctor_report(
            &ctx,
            DebugTargetKind::BaremetalMcu,
            DebugServerKind::Openocd,
            &runtime_all_present(),
        );
        let peripheral = report
            .checks
            .iter()
            .find(|c| c.name == "peripheralViewerExtension")
            .expect("peripheral viewer check present");
        assert_eq!(peripheral.status, DoctorStatus::Warn);
        assert_eq!(
            peripheral.detail,
            "mcu-debug.peripheral-viewer is not installed."
        );
        assert_eq!(
            peripheral.fix.as_deref(),
            Some("Install mcu-debug.peripheral-viewer for SVD-backed peripheral/register views.")
        );

        let memory = report
            .checks
            .iter()
            .find(|c| c.name == "memoryViewExtension")
            .expect("memory view check present");
        assert_eq!(memory.status, DoctorStatus::Warn);
        assert_eq!(memory.detail, "mcu-debug.memory-view is not installed.");
        assert_eq!(
            memory.fix.as_deref(),
            Some("Install mcu-debug.memory-view for low-level memory inspection.")
        );

        // Both missing-viewer fixes surface as deduplicated next steps.
        assert!(
            report
                .next_steps
                .iter()
                .any(|s| s.contains("mcu-debug.peripheral-viewer"))
        );
        assert!(
            report
                .next_steps
                .iter()
                .any(|s| s.contains("mcu-debug.memory-view"))
        );
    }

    #[test]
    fn non_mcu_targets_omit_companion_viewer_checks() {
        for (target, server) in [
            (DebugTargetKind::YoctoUserspace, DebugServerKind::Gdbserver),
            (DebugTargetKind::NativeHost, DebugServerKind::None),
        ] {
            let report =
                build_doctor_report(&healthy_context(), target, server, &runtime_all_present());
            assert!(
                !report
                    .checks
                    .iter()
                    .any(|c| c.name == "peripheralViewerExtension"),
                "{} must not emit peripheralViewerExtension",
                target.as_str()
            );
            assert!(
                !report
                    .checks
                    .iter()
                    .any(|c| c.name == "memoryViewExtension"),
                "{} must not emit memoryViewExtension",
                target.as_str()
            );
        }
    }
}
