// SPDX-License-Identifier: Apache-2.0
//! `alp-core` — shared, IO-free board logic for the ALP toolchain.
//!
//! This crate is the Rust home of the board model, parsing, and
//! validation. It contains no terminal, filesystem-walking, or process
//! logic so it can be reused by the CLI today and (later) bridged to the
//! TypeScript extension/LSP via napi-rs or WASM.

pub mod model;
pub mod validate;

pub use model::BoardModel;
pub use validate::{
    Outcome, ParseError, Severity, ValidationIssue, ValidationResult,
    parse_board_model, validate_board_yaml_local,
};
