// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import {
  planConfirm,
  planFailure,
  planPrecondition,
  planSuccess,
} from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log } from "../util";

/**
 * Register workspace lifecycle commands:
 *  - alp.switchWorkspace  → opens VS Code folder picker
 *  - alp.removeWestInit   → deletes .west/ with a modal confirmation
 */
export function registerWorkspaceCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.switchWorkspace", () => {
      void vscode.commands.executeCommand("vscode.openFolder");
    }),

    vscode.commands.registerCommand(
      "alp.removeWestInit",
      async (): Promise<void> => {
        // Resolve the SAME active root every other command uses
        // (collectProjectContext → resolveProjectContext: the multi-root
        // folder holding board.yaml, falling back to the first folder only
        // when none matches) — never workspaceFolders[0] directly. Blindly
        // deleting folders[0]/.west/ in a multi-root workspace can wipe the
        // wrong folder's west checkout (data loss), so an unresolved root
        // (no workspace open) aborts instead of guessing.
        const root = collectProjectContext().workspaceRoot;
        if (!root) {
          // No folder open is a precondition, not a failure — and Open Folder
          // (alp.switchWorkspace, registered above) resolves it in one click.
          log("[removeWestInit] aborted: no workspace folder is open");
          notifyAsync(
            planPrecondition("noWorkspace", {
              operation: "remove west initialization",
            }),
          );
          return;
        }

        const westDir = path.join(root, ".west");

        if (!fs.existsSync(westDir)) {
          notifyAsync(
            planSuccess(
              "Alp: no .west/ directory found — workspace is already uninitialized.",
            ),
          );
          return;
        }

        // Stays a modal, and the path + consequence stay ON the dialog
        // (`modalDetail`, not the channel-only `detail`) — this pick gates an
        // irreversible recursive delete. `deleteFromDisk` has no `run` in the
        // presenter's table, so the pick comes back here; `title` keeps the
        // button's original "Remove" wording.
        const answer = await notify(
          planConfirm({
            message: "Remove west initialization from this workspace?",
            modalDetail:
              `The ${westDir} directory will be deleted. ` +
              "Your project source files will not be affected. " +
              "You can re-initialize by running Bootstrap.",
            confirm: { id: "deleteFromDisk", title: "Remove" },
          }),
        );

        if (answer !== "deleteFromDisk") {
          log(`[removeWestInit] cancelled by user for ${westDir}`);
          return;
        }

        try {
          fs.rmSync(westDir, { recursive: true, force: true });
          log(`[removeWestInit] removed ${westDir}`);
          // The text already names the next step; now a button carries it
          // (`bootstrap` runs alp.installDependencies) instead of sending the
          // user to the command palette straight after a destructive delete.
          notifyAsync({
            severity: "info",
            channel: "toast",
            message:
              "West initialization removed. " +
              "Run Bootstrap to re-initialize the workspace.",
            actions: [{ id: "bootstrap" }],
          });
          void vscode.commands.executeCommand("alp.ideHub.refresh");
        } catch (err) {
          // The real cause in customer terms; fs.rmSync's EBUSY/EPERM/ENOENT and
          // the absolute path go to `detail`, which only the channel sees.
          notifyAsync(
            planFailure({
              operation: "Removing the west initialization",
              cause:
                "Alp: couldn't delete the .west directory — close anything " +
                "holding it open (a running west or build task), then try again.",
              detail: `[removeWestInit] ${westDir}: ${String(err)}`,
            }),
          );
        }
      },
    ),
  ];
}
