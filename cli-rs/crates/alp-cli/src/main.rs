// SPDX-License-Identifier: Apache-2.0
//! `alp` — ALP CLI (Rust). Phase 0: argument surface + `validate`.
//!
//! Output contract (CLI.md §3.2):
//!   * JSON mode writes exactly one JSON document to stdout.
//!   * Human-readable text goes to stderr.

mod cli;
mod commands;
mod envelope;
mod exit;

use clap::Parser;

use cli::{Cli, Command};
use commands::CommandRun;

fn main() {
    let args = Cli::parse();
    let global = args.global;

    let run: CommandRun = match args.command {
        Command::Validate => commands::validate::run(&global),
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
