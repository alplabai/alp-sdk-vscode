// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { AlpIssue } from "./models";
import { runAlpCommand } from "./vscodeAdapter";

/** What `fetchEnvelopeResult` hands back: `data` ALONGSIDE `ok` and
 *  `issues` — the two things this file's earlier, since-deleted `data`-only
 *  helper threw away (#611). `ok` is `false` for both a genuine CLI failure
 *  (unresolvable binary, unknown subcommand, non-zero exit, a thrown
 *  exception) and a missing envelope — the two are indistinguishable to a
 *  caller that only wants "did tan actually answer". `issues` is `[]` in
 *  both cases, never `undefined`, so a caller can iterate it
 *  unconditionally. */
export interface EnvelopeResult {
  data: unknown;
  ok: boolean;
  issues: AlpIssue[];
}

/**
 * Run a CLI envelope command and return `{ data, ok, issues }` rather than
 * bare `data` — so a caller decides what to do with a non-ok result or a
 * carried `issues[]` instead of having both dropped for it (#611).
 *
 * Deliberately NOT `{ interactive: true }`. Every caller fires off something
 * the user did to an editor — starting the LSP, editing an `alpSdk` setting,
 * opening a prj.conf, opening a board.yaml — and none of those is the customer
 * asking to download a tan CLI. An interactive resolution here would pop ADR
 * 0021's consent modal out of opening an editor tab.
 *
 * Callers must also treat a RESOLVED envelope carefully: several verbs report
 * an unresolved SDK as a success. `presets` exits 0 with `ok: true`, omits the
 * `sdk` key entirely, returns empty lists, and flags it only through
 * `issues[].code` — so an empty result is not evidence of an empty catalogue.
 */
export async function fetchEnvelopeResult(
  context: vscode.ExtensionContext,
  args: string[],
  cwd?: string,
): Promise<EnvelopeResult> {
  try {
    const { outcome } = await runAlpCommand(context, args, cwd);
    const envelope = outcome.envelope;
    return {
      data: envelope?.data,
      ok: envelope?.ok ?? false,
      issues: envelope?.issues ?? [],
    };
  } catch {
    return { data: undefined, ok: false, issues: [] };
  }
}
