// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan's navigation-only host actions (#484): open the board
// config, copy a finding's text, and open the Board Configurator at one ipc
// or storage entry. None of them writes anything — split out of
// `buildPlanPanel.ts` so the panel stays under the file-size cap.

import * as vscode from "vscode";
import {
  CONFIGURATOR_VIEW_TYPE,
  focusRegistry,
  isFocusEntryTarget,
} from "../configurator/focusRegistry";
import { planFailure, planPrecondition } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log } from "../util";

/**
 * Open the project's board.yaml — a blocked finding (an IPC link's row, a
 * ghost on the memory strip) asks for this so the customer can jump
 * straight to the one file every declared carve-out and partition comes from
 * (`MemoryUnresolved` itself carries no per-finding path — see its own
 * doc). #484.
 *
 * THE PATH IS `collectProjectContext().boardYamlPath`, NEVER a webview
 * string and NEVER `path.join(workspaceRoot, "board.yaml")` — the latter
 * silently gets two real configurations wrong:
 *
 *  - `alpSdk.boardYamlPath` (`"scope": "resource"`, settable per folder)
 *    can be relative (joined against the root, same as a hardcoded
 *    literal would be — no bug there) OR ABSOLUTE, in which case
 *    `resolveBoardYamlPath` (`@alp-sdk/core/project/service`) RESETS to
 *    it rather than joining — a customer who has pointed the setting
 *    somewhere outside the workspace entirely (a shared board file, say)
 *    would have this button open the wrong, non-existent
 *    `<root>/board.yaml` instead.
 *  - In a multi-root workspace, `resolveWorkspaceRoot` picks whichever
 *    folder actually contains the configured board.yaml, which need not
 *    be `workspaceFolders[0]` — the exact bug class `ideHub/vscodeAdapter
 *    .ts`'s own `boardYamlExists` resolution already warns about next
 *    door ("NOT workspaceFolders[0] + a hardcoded \"board.yaml\"").
 *
 * `collectProjectContext()` already resolves both correctly (it is the
 * SAME call `boardYamlPath` reaches every other surface through — see
 * `src/lsp/commands.ts`'s `resolveBoardYamlUri`, `src/statusBar.ts`,
 * `src/loader.ts`), so reading its `.boardYamlPath` field directly is the
 * fix — not re-deriving a path this extension has already resolved once.
 *
 * NOT RUN THROUGH A WEBVIEW-STRING CONTAINMENT CHECK, DELIBERATELY.
 * `boardYamlPath` is a path the HOST already resolved, never a string the
 * webview supplied, and a legitimately configured absolute
 * `alpSdk.boardYamlPath` can sit outside the workspace root by design —
 * validating a host-resolved value as though it were an untrusted webview
 * string would refuse the customer's own valid configuration. (The sibling
 * `openWorkspaceFile` handler that DID validate a webview-supplied path was
 * deleted outright — it had no product caller and existed only to keep its
 * own tests green. See the commit message for the two containment traps its
 * removal costs.)
 *
 * BOTH FAILURE PATHS ARE USER-VISIBLE, not log-only (#484). A raw `log()`
 * call reaches only the "Alp SDK" output channel, which nothing surfaces
 * on its own — a customer whose project has no board.yaml yet, or whose
 * editor refuses to open the resolved file (missing, a directory, a
 * binary), saw a button that did nothing and no way to learn why. Both
 * paths now go through `notifyAsync`, the
 * same mechanism every other user-facing failure in this file uses
 * (`requireWorkspace`, `handleMaterialiseBuildPlan`'s failure branches):
 *
 *  - No `boardYamlPath` resolved is `planPrecondition("noBoardYaml")` —
 *    the exact "No board.yaml in this folder yet." toast (with its
 *    existing "New Project" / "Setup" actions) every other no-board.yaml
 *    surface in this extension already shows; reusing it rather than
 *    inventing new copy. Always severity "warning" (`planPrecondition`'s
 *    own contract) — a project with no board.yaml yet is a first-run
 *    state, not a fault.
 *  - A `showTextDocument` rejection is `planFailure(...)`, default
 *    severity "error" — an unexpected failure to complete a real action,
 *    not a precondition. `planFailure`'s own backstop keeps the raw
 *    `String(err)` (which can carry the file's own absolute path, e.g. a
 *    Node `ENOENT` message) out of the customer-facing toast, demoting it
 *    to the log-only `detail` when it looks like exactly that.
 *
 * The two `log()` calls this replaced are gone, not duplicated: `present()`
 * (`src/notify/vscodeAdapter.ts`) already writes every notification's
 * message to the SAME output channel at a severity-derived level as part
 * of showing it, so a second manual `log()` here would double-log the
 * identical line — this file's OWN other failure branches (e.g.
 * `handleMaterialiseBuildPlan`'s `shapeError` case) already rely on
 * exactly that and call `notifyAsync` alone. An earlier version's two
 * different ad hoc log levels ("info" for the refusal, "warn" for the
 * failed open) are what "consistent" replaces: both are now derived from
 * the SAME two purpose-built planners, chosen for what each state
 * actually is, not left as two unrelated defaults nobody had reasoned
 * about.
 */
export async function openBoardYaml(): Promise<void> {
  const boardYamlPath = collectProjectContext().boardYamlPath;
  if (!boardYamlPath) {
    notifyAsync(planPrecondition("noBoardYaml"));
    return;
  }
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(boardYamlPath));
  } catch (err) {
    notifyAsync(
      planFailure({
        operation: "Opening board.yaml",
        cause: String(err),
      }),
    );
  }
}

/**
 * Open the Board Configurator on the project's board.yaml at one ipc or
 * storage entry (#484). NAVIGATION ONLY: the Build Plan never writes
 * board.yaml — the Configurator is the one writer, and it opens with the
 * entry's size field focused so the reader edits it there.
 *
 * The path is `collectProjectContext().boardYamlPath`, the same resolver
 * and the same `noBoardYaml` precondition `openBoardYaml` uses; the
 * webview names only the section and the entry, and both are narrowed by
 * `isFocusEntryTarget` before anything opens. The focus is queued BEFORE
 * the open (the panel may become ready during it) and withdrawn if the
 * open fails, so a stale request never lands on a later, unrelated open.
 */
export async function openInConfigurator(msg: unknown): Promise<void> {
  if (!isFocusEntryTarget(msg)) {
    log(`[build-plan] openInConfigurator: malformed request ignored`);
    return;
  }
  const boardYamlPath = collectProjectContext().boardYamlPath;
  if (!boardYamlPath) {
    notifyAsync(planPrecondition("noBoardYaml"));
    return;
  }
  // ONE Uri, and its `fsPath` everywhere below: the Configurator registers
  // its panel under `document.uri.fsPath`, so the request must be keyed by
  // the same spelling (a Windows drive letter is `c:` there).
  const uri = vscode.Uri.file(boardYamlPath);
  focusRegistry.requestConfiguratorFocus(uri.fsPath, {
    section: msg.section,
    name: msg.name,
  });
  try {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      CONFIGURATOR_VIEW_TYPE,
    );
    // An already-open, already-ready Configurator takes it now that its tab
    // is visible; a new one takes it when it reports ready.
    focusRegistry.deliverPendingFocus(uri.fsPath);
  } catch (err) {
    focusRegistry.takePendingFocus(uri.fsPath);
    notifyAsync(
      planFailure({
        operation: "Opening the board configurator",
        cause: String(err),
      }),
    );
  }
}

/**
 * Put a finding's text on the system clipboard.
 *
 * THE REJECTION IS USER-VISIBLE, for the same reason `openBoardYaml`'s is.
 * `vscode.env.clipboard.writeText` returns a promise that really does
 * reject — an unfocused window, a remote or web host with no clipboard
 * permission, another process holding the OS clipboard — and a bare `void`
 * on it turned every one of those into an unhandled rejection in the
 * extension host: the Copy button on a blocked finding did nothing, with
 * nothing on screen and nothing in the output channel to look up.
 *
 * There is no precondition half to mirror here. `openBoardYaml` has one
 * because it needs a host-resolved path that may not exist yet;
 * `CopyTextMessage` carries its own text, so the only way this can fail is
 * the write itself. `planFailure`'s default severity "error" is right for
 * that — a real action that could not be completed, not a first-run state —
 * and its backstop keeps a raw `String(err)` (a clipboard `EBUSY`, say) out
 * of the customer-facing sentence, demoting it to the log-only `detail`.
 *
 * No success notification: the copied text is already on screen in the row
 * the button sits on, and a toast per copy is noise. The failure is the
 * only thing the customer cannot otherwise see.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await vscode.env.clipboard.writeText(text);
  } catch (err) {
    notifyAsync(
      planFailure({
        operation: "Copying to the clipboard",
        cause: String(err),
      }),
    );
  }
}
