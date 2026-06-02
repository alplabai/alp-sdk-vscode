// SPDX-License-Identifier: Apache-2.0
use crate::exit::ExitCode;

pub struct CommandRun {
    pub exit: ExitCode,
    /// Human text (stderr-bound); empty in JSON mode.
    pub text: Vec<String>,
    /// JSON document (stdout-bound) in JSON mode.
    pub json: Option<String>,
}

pub mod generate;
pub mod validate;
