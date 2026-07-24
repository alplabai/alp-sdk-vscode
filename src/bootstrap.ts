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
    // Native Windows can't bootstrap: `tan bootstrap` orchestrates the SDK's
    // POSIX bootstrap.sh (west install + west init/update + Zephyr pip) and
    // refuses on win32 ("bootstrap: not supported on native Windows. Use
    // WSL2"). Shelling it anyway spawns a terminal whose shell (tan.exe) exits
    // 1 immediately, so VS Code shows its generic "failed to launch (exit
    // code: 1)" and hides tan's real guidance. Surface it directly instead of
    // launching a doomed terminal.
    if (process.platform === "win32") {
      const LEARN = "Learn more";
      void vscode.window
        .showWarningMessage(
          "Alp: Bootstrap doesn't run on native Windows yet — for now, set up " +
            "the build environment (west + Zephyr + Python) under WSL2 " +
            "(Ubuntu): open your project in a WSL2 window and run Bootstrap " +
            "there. Native Windows support is planned.",
          LEARN,
        )
        .then((pick) => {
          if (pick === LEARN) {
            void vscode.env.openExternal(
              vscode.Uri.parse(
                "https://github.com/alplabai/alp-sdk-vscode#readme",
              ),
            );
          }
        });
      return;
    }
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
