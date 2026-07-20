// SPDX-License-Identifier: Apache-2.0

import { validateBoardYamlLocally } from "@alp-sdk/core/validation/service";

/**
 * Pure wrapper around the SHALLOW structural pre-check, used by the state
 * query to fill `AlpIdeState.workspace.boardYamlValid` / `boardIssueCount`.
 *
 * Deliberately reuses only `validateBoardYamlLocally` (v2 structural checks:
 * bare top-level `os:`, missing `cores:`) rather than the deeper validation
 * behind `alp.validateBoardYaml` (the CLI's Python validator) or the LSP's
 * `checkE1mCompliance` — the state query runs on every window focus / save /
 * settings edit, far too often to spawn a process or load the pinmux table.
 * The cost of that tradeoff: a board.yaml that is structurally well-formed but
 * fails deeper (bad `som.sku`, E1M pin/compliance violations) reads as valid
 * here, so the ladder can advance to "ready" while `alp.validateBoardYaml` /
 * the Problems panel still flag it; the build CTA then fails loudly at the
 * CLI's own validate step (fail-safe, no silent bad build). Upgrade path if
 * that gap matters: feed the LSP's published E1M diagnostics back into
 * `AlpIdeState` and count those instead.
 *
 * A half-typed board.yaml can throw during YAML parsing; that must not crash
 * the state refresh, so it's reported as one issue.
 */
export function deriveBoardValidity(boardYamlText: string): {
  boardYamlValid: boolean;
  boardIssueCount: number;
} {
  try {
    const { issues } = validateBoardYamlLocally(boardYamlText);
    return {
      boardYamlValid: issues.length === 0,
      boardIssueCount: issues.length,
    };
  } catch {
    return { boardYamlValid: false, boardIssueCount: 1 };
  }
}
