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
    Validate,
    /// Generate build artifacts from board.yaml (alp.conf, overlay, args, yocto).
    Generate,
    /// Initialize a new ALP project from a template.
    Init(InitArgs),
    /// Scaffold a module into an existing project.
    Scaffold(ScaffoldArgs),
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
