// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { collectProjectContext } from "../project/vscodeAdapter";
import { log, reportError } from "../util";

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
          const message =
            "Alp: no workspace folder is open — cannot remove west initialization.";
          log(`[removeWestInit] aborted: ${message}`);
          void vscode.window.showErrorMessage(message);
          return;
        }

        const westDir = path.join(root, ".west");

        if (!fs.existsSync(westDir)) {
          void vscode.window.showInformationMessage(
            "No .west/ directory found — workspace is already uninitialized.",
          );
          return;
        }

        const answer = await vscode.window.showWarningMessage(
          `Remove west initialization from "${root}"? ` +
            `The ${westDir} directory will be deleted. ` +
            "Your project source files will not be affected. " +
            "You can re-initialize by running Bootstrap.",
          { modal: true },
          "Remove",
        );

        if (answer !== "Remove") {
          log(`[removeWestInit] cancelled by user for ${westDir}`);
          return;
        }

        try {
          fs.rmSync(westDir, { recursive: true, force: true });
          log(`[removeWestInit] removed ${westDir}`);
          void vscode.window.showInformationMessage(
            "West initialization removed. " +
              "Run Bootstrap to re-initialize the workspace.",
          );
          void vscode.commands.executeCommand("alp.ideHub.refresh");
        } catch (err) {
          const message = `Alp: failed to remove ${westDir}: ${String(err)}`;
          log(`[removeWestInit] ${message}`);
          void reportError(message);
        }
      },
    ),
  ];
}
