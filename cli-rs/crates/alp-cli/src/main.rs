// SPDX-License-Identifier: Apache-2.0
//! `alp` — ALP CLI (Rust). Phase 0-3: validate + generate scaffolding.
//!
//! Output contract (CLI.md §3.2):
//!   * JSON mode writes exactly one JSON document to stdout.
//!   * Human-readable text goes to stderr.

mod cli;
mod commands;
mod envelope;
mod exit;
mod util;

use clap::Parser;

use cli::{Cli, Command};
use commands::CommandRun;

fn main() {
    let args = Cli::parse();
    let global = args.global;

    let run: CommandRun = match args.command {
        Command::Validate(args) => commands::validate::run(&global, &args),
        Command::Generate => commands::generate::run(&global),
        Command::Init(args) => commands::init::run(&global, &args),
        Command::Scaffold(args) => commands::scaffold::run(&global, &args),
        Command::Doctor(args) => commands::doctor::run(&global, &args),
        Command::Completion(args) => commands::completion::run(&global, &args),
        Command::Diff => commands::diff::run(&global),
        Command::Presets => commands::presets::run(&global),
        Command::Explain(args) => commands::explain::run(&global, &args),
        Command::Inspect(args) => commands::inspect::run(&global, &args),
        Command::Trace(args) => commands::trace::run(&global, &args),
        Command::DebugConfig(args) => commands::debug_config::run(&global, &args),
        Command::SupportBundle(args) => commands::support_bundle::run(&global, &args),
        Command::Sdk(args) => commands::sdk::run(&global, &args),
        Command::Bootstrap(args) => commands::bootstrap::run(&global, &args),
    };

    emit(&global.format, run.json.as_deref(), &run.text);
    std::process::exit(run.exit.code());
}

fn emit(format: &cli::Format, json: Option<&str>, text: &[String]) {
    match format {
        cli::Format::Json => {
            if let Some(doc) = json {
                println!("{doc}");
            }
        }
        cli::Format::Text => {
            for line in text {
                eprintln!("{line}");
            }
        }
    }
}
