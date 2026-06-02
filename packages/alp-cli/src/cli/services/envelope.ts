// SPDX-License-Identifier: Apache-2.0

import {
  CLI_EXIT_CODE,
  CliEnvelope,
  CliExecutionResult,
  CliFormat,
  CliIssue,
} from "../models";

export function createFailureResult<TData>(
  command: string,
  format: CliFormat,
  exitCode: number,
  textLines: string[],
  issues: CliIssue[],
  data: TData,
): CliExecutionResult<TData> {
  return {
    format,
    exitCode,
    textLines: format === "json" ? [] : textLines,
    envelope: createEnvelope(
      command,
      {
        root: null,
        boardYaml: null,
      },
      data,
      issues,
      exitCode,
    ),
  };
}

export function createEnvelope<TData>(
  command: string,
  project: { root: string | null; boardYaml: string | null },
  data: TData,
  issues: readonly CliIssue[],
  exitCode: number,
): CliEnvelope<TData> {
  return {
    command,
    ok: exitCode === CLI_EXIT_CODE.success,
    exitCode,
    project,
    data,
    issues: [...issues],
  };
}
