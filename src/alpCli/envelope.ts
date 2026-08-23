// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { runAlpCommand } from "./vscodeAdapter";

/**
 * Run a CLI envelope command and return its `data`, or `undefined` on any
 * failure (unresolvable binary, unknown subcommand, non-zero exit, …).
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
export async function fetchEnvelopeData(
  context: vscode.ExtensionContext,
  args: string[],
  cwd?: string,
): Promise<unknown> {
  try {
    const { outcome } = await runAlpCommand(context, args, cwd);
    return outcome.envelope?.data;
  } catch {
    return undefined;
  }
}
