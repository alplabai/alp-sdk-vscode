// SPDX-License-Identifier: Apache-2.0

import { validateBoardYamlLocally } from "@alp-sdk/core/validation/service";

/**
 * Pure wrapper around the existing structural validator, used by the state
 * query to fill `AlpIdeState.workspace.boardYamlValid` / `boardIssueCount`.
 * Reuses `validateBoardYamlLocally` (the same cheap check the LSP already
 * runs for diagnostics) rather than shelling the CLI validator — the state
 * query runs on every window focus / save / settings edit, far too often to
 * spawn a process. A half-typed board.yaml can throw during YAML parsing;
 * that must not crash the state refresh, so it's reported as one issue.
 */
export function deriveBoardValidity(boardYamlText: string): {
  boardYamlValid: boolean;
  boardIssueCount: number;
} {
  try {
    const { issues } = validateBoardYamlLocally(boardYamlText);
    return { boardYamlValid: issues.length === 0, boardIssueCount: issues.length };
  } catch {
    return { boardYamlValid: false, boardIssueCount: 1 };
  }
}
