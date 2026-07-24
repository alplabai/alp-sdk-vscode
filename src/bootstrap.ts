// SPDX-License-Identifier: Apache-2.0
//
// `alp.installDependencies` delegates to the native CLI's `alp bootstrap`,
// which orchestrates the SDK's own `scripts/bootstrap.sh` (west install +
// `west init/update` + Zephyr Python requirements) in a live terminal. This
// replaces the extension's former private venv/pip plan — one bootstrap, owned
// by the SDK. OS-specific toolchains (Zephyr SDK, Yocto host packages, vendor
// compilers) are beyond bootstrap.sh's scope and are surfaced by the build
// preflight (`alp doctor --build`) instead.

import * as fs from "fs";
import { load as loadYaml } from "js-yaml";
import * as vscode from "vscode";

import { boardUsesYocto } from "@alp-sdk/core/board/backend";
import { runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

/** True when the open project has a Yocto core — read board.yaml, parse, inspect
 *  cores. Best-effort: a missing/unparseable board.yaml is treated as not-Yocto
 *  (Zephyr/baremetal), so the message only claims "Yocto" when it's certain. */
function projectUsesYocto(): boolean {
  try {
    const boardYamlPath = collectProjectContext().boardYamlPath;
    if (!boardYamlPath || !fs.existsSync(boardYamlPath)) return false;
    return boardUsesYocto(loadYaml(fs.readFileSync(boardYamlPath, "utf8")));
  } catch {
    return false;
  }
}

/** Offer VS Code's Remote-WSL "Reopen in WSL"; if that extension isn't
 *  installed the command is absent and executeCommand rejects — fall back to
 *  the Marketplace page so the user can install it. */
async function reopenInWsl(): Promise<void> {
  try {
    await vscode.commands.executeCommand("remote-wsl.reopenInWSL");
  } catch {
    void vscode.env.openExternal(
      vscode.Uri.parse(
        "https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl",
      ),
    );
  }
}

export function registerBootstrapCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  const runBootstrap = () => {
    // Native Windows can't bootstrap: `tan bootstrap` orchestrates the SDK's
    // POSIX bootstrap.sh (west install + west init/update + Zephyr pip) and
    // refuses on win32. Rather than shell a doomed terminal (whose shell IS
    // tan.exe, so its exit-1 shows as a cryptic "failed to launch"), guide the
    // user to WSL2 — via a ONE-CLICK "Reopen in WSL" (VS Code Remote-WSL), the
    // clean path: the extension host + project + tools all run natively-Linux
    // inside WSL, no Windows<->WSL path translation or slow /mnt/c builds.
    // Message is backend-aware: Yocto/BitBake is Linux-only (WSL2 permanently);
    // Zephyr/baremetal can eventually go native-Windows (planned).
    if (process.platform === "win32") {
      const REOPEN = "Reopen in WSL";
      const yocto = projectUsesYocto();
      const message = yocto
        ? "Alp: Yocto builds require Linux — reopen this project in WSL2 " +
          "(Ubuntu) to bootstrap and build. Keep the project on the WSL " +
          "filesystem (~/…), not /mnt/c, for build speed."
        : "Alp: Bootstrap doesn't run on native Windows yet — reopen in WSL2 " +
          "(Ubuntu) to set up the build environment now (native Windows " +
          "support is planned). Keep the project on the WSL filesystem (~/…), " +
          "not /mnt/c, for build speed.";
      void vscode.window.showWarningMessage(message, REOPEN).then((pick) => {
        if (pick === REOPEN) void reopenInWsl();
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
