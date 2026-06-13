// SPDX-License-Identifier: Apache-2.0
//! Stable exit codes — identical to the TypeScript CLI's `CLI_EXIT_CODE`.

// The full set is part of the CLI contract; later phases construct the rest.
/// Stable process exit codes for the `alp` CLI, fixed by the output contract.
/// Each discriminant is the literal `i32` the process exits with.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitCode {
    /// Command completed successfully.
    Success = 0,
    /// Generic runtime failure (e.g. I/O or subprocess error).
    RuntimeFailure = 1,
    /// Input failed schema/semantic validation.
    ValidationFailure = 2,
    /// Failed to write generated output.
    WriteFailure = 3,
    /// `doctor` reported an unhealthy environment.
    DoctorFailure = 4,
    /// Unexpected internal error (bug / unreachable state).
    InternalFailure = 5,
}

impl ExitCode {
    /// Returns the underlying `i32` discriminant for `std::process::exit`.
    pub fn code(self) -> i32 {
        self as i32
    }
}
