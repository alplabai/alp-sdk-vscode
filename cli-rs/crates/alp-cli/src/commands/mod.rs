// SPDX-License-Identifier: Apache-2.0
//! Command dispatch root for the `alp` CLI: declares the per-command sub-modules
//! and the shared `CommandRun` result every command's `run` returns.
use crate::exit::ExitCode;

/// Uniform outcome of running a command: exit code plus the human/JSON output split.
pub struct CommandRun {
    /// Process exit code conveying success or the failure class.
    pub exit: ExitCode,
    /// Human text (stderr-bound); empty in JSON mode.
    pub text: Vec<String>,
    /// JSON document (stdout-bound) in JSON mode.
    pub json: Option<String>,
}

/// `alp bootstrap` — per-OS toolchain/SDK bootstrap orchestration.
pub mod bootstrap;
/// `alp build` (and `image`/`flash`/`clean`/`renode`) — `west` build workflows.
pub mod build;
/// `alp completion` — shell completion script generation.
pub mod completion;
/// `alp debug-config` — debug/launch configuration drafting.
pub mod debug_config;
/// `alp diff` — show how `board.yaml` normalization changes the effective config.
pub mod diff;
/// `alp doctor` — diagnose debug readiness (`--build` runs the build-readiness preflight).
pub mod doctor;
/// `alp explain` — explain a project/module template or a generation target.
pub mod explain;
/// `alp generate` — Zephyr conf / DTS overlay / CMake args / Yocto conf codegen.
pub mod generate;
/// `alp init` — new-project scaffolding (including heterogeneous cores).
pub mod init;
/// `alp inspect` — inspect resolved project/debug context values.
pub mod inspect;
/// `alp presets` — list SDK presets (SKUs/SoMs, carriers) + built-in catalogue defaults.
pub mod presets;
/// `alp scaffold` — scaffold a module into an existing project.
pub mod scaffold;
/// `alp sdk` — SDK release listing/management.
pub mod sdk;
/// `alp support-bundle` — collect a diagnostics support bundle.
pub mod support_bundle;
/// `alp trace` — trace the generation decisions a build would make.
pub mod trace;
/// `alp validate` — schema-aware `board.yaml` validation.
pub mod validate;
