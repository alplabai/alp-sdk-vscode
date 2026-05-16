// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

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
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          void vscode.window.showWarningMessage("No workspace folder is open.");
          return;
        }

        const root = folders[0].uri.fsPath;
        const westDir = path.join(root, ".west");

        if (!fs.existsSync(westDir)) {
          void vscode.window.showInformationMessage(
            "No .west/ directory found — workspace is already uninitialized.",
          );
          return;
        }

        const answer = await vscode.window.showWarningMessage(
          "Remove west initialization? " +
            "The .west/ directory will be deleted. " +
            "Your project source files will not be affected. " +
            "You can re-initialize by running Bootstrap.",
          { modal: true },
          "Remove",
        );

        if (answer !== "Remove") return;

        try {
          fs.rmSync(westDir, { recursive: true, force: true });
          void vscode.window.showInformationMessage(
            "West initialization removed. " +
              "Run Bootstrap to re-initialize the workspace.",
          );
          void vscode.commands.executeCommand("alp.ideHub.refresh");
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Failed to remove .west/: ${String(err)}`,
          );
        }
      },
    ),
  ];
}
