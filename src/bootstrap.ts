// SPDX-License-Identifier: Apache-2.0
//
// `alp.installDependencies` delegates to the native CLI's `alp bootstrap`,
// which orchestrates the SDK's own `scripts/bootstrap.sh` (west install +
// `west init/update` + Zephyr Python requirements) in a live terminal. This
// replaces the extension's former private venv/pip plan — one bootstrap, owned
// by the SDK. OS-specific toolchains (Zephyr SDK, Yocto host packages, vendor
// compilers) are beyond bootstrap.sh's scope and are surfaced by the build
// preflight (`alp doctor --build`) instead.

import * as vscode from "vscode";

import { runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

export function registerBootstrapCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  const runBootstrap = () => {
    const workspaceRoot = collectProjectContext().workspaceRoot ?? undefined;
    return runAlpInTerminal(context, ["bootstrap"], {
      name: "Alp Bootstrap",
      cwd: workspaceRoot,
    });
  };
  return [
    // Palette / Setup view command.
    vscode.commands.registerCommand("alp.installDependencies", runBootstrap),
    // Same flow, under the id the webview posts from the "Initialize Workspace"
    // (Setup flow) and "Activate workspace" (West workspaces) buttons. Without
    // this registration those buttons silently no-op'd.
    vscode.commands.registerCommand("alp.bootstrap", runBootstrap),
  ];
}
