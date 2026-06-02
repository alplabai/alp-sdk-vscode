// SPDX-License-Identifier: Apache-2.0
//! Command-line surface (clap derive). Global flags mirror CLI.md §3.1.

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "alp",
    version,
    about = "ALP CLI — board configuration, generation, and project tooling.",
    propagate_version = true
)]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalArgs,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Clone, Args)]
pub struct GlobalArgs {
    /// Project root (defaults to current directory).
    #[arg(long, global = true, value_name = "PATH")]
    pub project: Option<String>,

    /// Explicit board.yaml path (overrides project resolution).
    #[arg(long = "board-yaml", global = true, value_name = "PATH")]
    pub board_yaml: Option<String>,

    /// alp-sdk checkout root.
    #[arg(long = "sdk-root", global = true, value_name = "PATH")]
    pub sdk_root: Option<String>,

    /// Generation target (e.g. zephyr-conf, dts-overlay, cmake-args, yocto-conf).
    #[arg(long, global = true, value_name = "EMIT")]
    pub target: Option<String>,

    /// Run command against all relevant targets.
    #[arg(long, global = true)]
    pub all: bool,

    /// Output format.
    #[arg(long, global = true, value_enum, default_value_t = Format::Text)]
    pub format: Format,

    #[arg(long, global = true)]
    pub verbose: bool,

    #[arg(long, global = true)]
    pub quiet: bool,

    #[arg(long = "no-color", global = true)]
    pub no_color: bool,

    #[arg(long = "non-interactive", global = true)]
    pub non_interactive: bool,

    /// CI mode: implies non-interactive and disables color.
    #[arg(long, global = true)]
    pub ci: bool,
}

impl GlobalArgs {
    pub fn is_json(&self) -> bool {
        matches!(self.format, Format::Json)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Format {
    Text,
    Json,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Validate schema and semantic rules for the active project.
    Validate(ValidateArgs),
    /// Generate build artifacts from board.yaml (alp.conf, overlay, args, yocto).
    Generate,
    /// Initialize a new ALP project from a template.
    Init(InitArgs),
    /// Scaffold a module into an existing project.
    Scaffold(ScaffoldArgs),
    /// Diagnose debug readiness for a target/server combination.
    Doctor(DoctorArgs),
    /// Emit a shell completion script (bash, zsh, or fish).
    Completion(CompletionArgs),
    /// Show how board.yaml normalization changes the effective config.
    Diff,
    /// List SDK presets (SKUs, carriers) and built-in catalogue defaults.
    Presets,
    /// Explain a project/module template or a generation target.
    Explain(ExplainArgs),
    /// Inspect resolved project/debug context values.
    Inspect(InspectArgs),
    /// Trace the generation decisions a build would make.
    Trace(TraceArgs),
    /// Generate or preview a VS Code launch.json debug configuration.
    DebugConfig(DebugConfigArgs),
    /// Export a diagnostic support bundle (inspect + trace + doctor).
    SupportBundle(SupportBundleArgs),
    /// Manage local SDK installs (list, install, current, switch).
    Sdk(SdkArgs),
}

#[derive(Debug, Args)]
pub struct SdkArgs {
    /// Subcommand: list, install, current, or switch.
    #[arg(value_name = "SUBCOMMAND")]
    pub subcommand: Option<String>,
    /// Positional argument (version for install, version|path for switch).
    #[arg(value_name = "ARG")]
    pub arg: Option<String>,
    /// Cache root for `install` (default: ~/.alp/sdk-cache).
    #[arg(long)]
    pub destination: Option<String>,
}

#[derive(Debug, Args)]
pub struct SupportBundleArgs {
    /// Debug target class (zephyr-mcu, baremetal-mcu, yocto-userspace, native-host).
    #[arg(long = "target-kind", value_name = "KIND")]
    pub target_kind: Option<String>,
    /// Debug server backend (jlink, openocd, pyocd, gdbserver, none).
    #[arg(long, value_name = "SERVER")]
    pub server: Option<String>,
    /// Limit generation tracing to this config key path.
    #[arg(long)]
    pub path: Option<String>,
    /// Output directory for the bundle (default: <workspace>/.alp-support).
    #[arg(long)]
    pub destination: Option<String>,
}

#[derive(Debug, Args)]
pub struct DebugConfigArgs {
    /// Debug target class (zephyr-mcu, baremetal-mcu, yocto-userspace, native-host).
    #[arg(long = "target-kind", value_name = "KIND")]
    pub target_kind: Option<String>,
    /// Debug server backend (jlink, openocd, pyocd, gdbserver, none).
    #[arg(long, value_name = "SERVER")]
    pub server: Option<String>,
    /// Print the launch configuration without writing launch.json.
    #[arg(long)]
    pub preview: bool,
}

#[derive(Debug, Args)]
pub struct ExplainArgs {
    /// Template id to explain (project or module template).
    #[arg(long)]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct InspectArgs {
    /// Limit output to resolved values under this key path.
    #[arg(long)]
    pub path: Option<String>,
    /// Include source + detail metadata for each value.
    #[arg(long = "show-origin")]
    pub show_origin: bool,
}

#[derive(Debug, Args)]
pub struct TraceArgs {
    /// Limit tracing to this config key path.
    #[arg(long)]
    pub path: Option<String>,
}

#[derive(Debug, Args)]
pub struct CompletionArgs {
    /// Target shell (bash, zsh, or fish). Defaults to bash.
    #[arg(long, value_name = "SHELL")]
    pub shell: Option<String>,
}

#[derive(Debug, Args)]
pub struct DoctorArgs {
    /// Debug target class (zephyr-mcu, baremetal-mcu, yocto-userspace, native-host).
    #[arg(long = "target-kind", value_name = "KIND")]
    pub target_kind: Option<String>,
    /// Debug server backend (jlink, openocd, pyocd, gdbserver, none).
    #[arg(long, value_name = "SERVER")]
    pub server: Option<String>,
}

#[derive(Debug, Args)]
pub struct ValidateArgs {
    /// Run the offline structural validator only (no Python SDK spawn).
    #[arg(long)]
    pub offline: bool,
}

#[derive(Debug, Args)]
pub struct InitArgs {
    /// Project template id (e.g. minimal-app, sensor-starter).
    #[arg(long)]
    pub template: Option<String>,
    /// Project name; creates a sub-directory when provided.
    #[arg(long)]
    pub name: Option<String>,
    /// Destination directory (default: current directory or --project).
    #[arg(long)]
    pub destination: Option<String>,
    /// Show planned files without writing anything.
    #[arg(long)]
    pub preview: bool,
    /// Allow overwriting existing files.
    #[arg(long)]
    pub force: bool,
}

#[derive(Debug, Args)]
pub struct ScaffoldArgs {
    /// Module template id (e.g. sensor-driver, connectivity-service).
    #[arg(long)]
    pub template: Option<String>,
    /// Module name (required).
    #[arg(long)]
    pub name: Option<String>,
    /// Destination project root (default: current directory or --project).
    #[arg(long)]
    pub destination: Option<String>,
    /// Show planned files without writing anything.
    #[arg(long)]
    pub preview: bool,
    /// Allow overwriting existing files.
    #[arg(long)]
    pub force: bool,
}
