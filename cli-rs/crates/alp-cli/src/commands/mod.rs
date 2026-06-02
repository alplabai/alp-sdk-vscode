// SPDX-License-Identifier: Apache-2.0
use crate::exit::ExitCode;

pub struct CommandRun {
    pub exit: ExitCode,
    /// Human text (stderr-bound); empty in JSON mode.
    pub text: Vec<String>,
    /// JSON document (stdout-bound) in JSON mode.
    pub json: Option<String>,
}

pub mod completion;
pub mod debug_config;
pub mod diff;
pub mod doctor;
pub mod explain;
pub mod generate;
pub mod init;
pub mod inspect;
pub mod presets;
pub mod scaffold;
pub mod sdk;
pub mod support_bundle;
pub mod trace;
pub mod validate;
