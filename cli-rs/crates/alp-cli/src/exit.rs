// SPDX-License-Identifier: Apache-2.0
//! Stable exit codes — identical to the TypeScript CLI's `CLI_EXIT_CODE`.

// The full set is part of the CLI contract; later phases construct the rest.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitCode {
    Success = 0,
    RuntimeFailure = 1,
    ValidationFailure = 2,
    WriteFailure = 3,
    DoctorFailure = 4,
    InternalFailure = 5,
}

impl ExitCode {
    pub fn code(self) -> i32 {
        self as i32
    }
}
