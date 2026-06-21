// SPDX-License-Identifier: Apache-2.0
//! **PROOF BENCH** (branch `proof/pmt-aen701`). Reproduce the SDK's
//! `alp_orchestrate.py --emit` for **E1M-AEN701** from **policy / metadata /
//! template DATA alone**, parity-gated against the real SDK emit captured under
//! `spike_fixtures/oracle/`. Thesis: per-silicon build knowledge is DATA, not
//! hardcoded code (issue alplabai/alp-sdk#235).
//!
//! **Architecture (not just a proof):** each SoM ships a self-contained, versioned
//! bundle under `spike_fixtures/som/<SKU>/` — `bundle.yaml` (per-layer schema
//! versions), `policy.json` (the build rules, `schemaVersion`-checked), `som.yaml`
//! (metadata), and `templates/*.tmpl` (every output shape, as DATA). The engine
//! holds **no** silicon/board/OS knowledge and **no output text**: it resolves a
//! SoM, version-checks the policy, computes the CONFIG lists/vars, and fills the
//! bundle templates. A new silicon = a new bundle folder; a generic engine + the
//! shared metadata (SoC/board) do the rest. Swapping a policy value changes the
//! output with no code change (`policy_change_alters_output`); the default bundle
//! reproduces the SDK emit byte-for-byte (Stages A–F).
//!
//! **Module map** (parser → writer, dependencies point downward):
//! - PARSER (deserialize): [`metadata`] (board.yaml / SoM / board / SoC structs),
//!   [`policy`] (rules-as-data + the `schemaVersion` gate), [`bundle`] (the loaded
//!   `Templates` + — next — the `bundle.yaml` manifest).
//! - WRITER (render): [`template`] (the domain-free `{{var}}`/`{{#if}}`/`{{#each}}`
//!   engine), [`render`] (per-output generators), [`assemble`] (build-plan +
//!   system-manifest assembly).
#![allow(dead_code)] // proof bench: the engine's only caller is its #[cfg(test)] parity suite
#![allow(clippy::too_many_arguments)] // assemblers take the 4 metadata inputs + policy + runtime paths

pub(crate) mod macros; // declarative macros, imported by path (not #[macro_use])
// PARSER layer (deserialize → structs + version gates + semantic validation)
pub(crate) mod bundle;
pub(crate) mod metadata;
pub(crate) mod policy;
pub(crate) mod validate;
// WRITER layer (data → config-file strings)
pub(crate) mod assemble;
pub(crate) mod render;
pub(crate) mod template;

// Each module imports the specific siblings it depends on (`use super::<m>::*`);
// dependencies point downward (writer → parser → models), never the reverse.

#[cfg(test)]
mod tests;
