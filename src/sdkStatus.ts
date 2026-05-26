// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { collectProjectContext } from "./project/vscodeAdapter";
import { probeTool } from "./toolchain/vscodeAdapter";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { loadBoardConfigFromFile } from "./configurator/boardIo";
import { log, showOutput } from "./util";

interface Check { label: string; value: string; ok: boolean; }

function gatherStatus(): Check[] {
  const project = collectProjectContext();
  const catalogue = loadSdkCatalogue(project.sdkRoot ?? null, log);
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  const sdkOk = !!project.sdkRoot && fs.existsSync(path.join(project.sdkRoot, "metadata"));
  const py = probeTool(pythonCmd, ["--version"]);
  const west = probeTool("west", ["--version"]);

  return [
    { label: "alp-sdk", value: project.sdkRoot ?? "not set (alpSdk.path)", ok: sdkOk },
    { label: "SDK version", value: catalogue.sdkVersion ?? "unknown", ok: !!catalogue.sdkVersion },
    {
      label: "Catalogue",
      value: `${catalogue.soms.length} SoMs · ${catalogue.boards.length} boards · ${catalogue.chips.length} chips · ${catalogue.libraries.length} libraries`,
      ok: catalogue.soms.length > 0,
    },
    { label: "Python", value: py.detail ?? "not found on PATH", ok: py.present },
    { label: "west", value: west.detail ?? "not found on PATH", ok: west.present },
  ];
}

function registerStatusCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.sdkStatus", async () => {
    const checks = gatherStatus();
    log("── Alp SDK status ──");
    for (const c of checks) log(`  ${c.ok ? "OK " : "!! "}${c.label}: ${c.value}`);
    const allOk = checks.every((c) => c.ok);
    const summary = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join("   ");
    const pick = await vscode.window.showInformationMessage(
      `Alp SDK status — ${summary}`,
      "Show details",
      allOk ? "" : "Install dependencies",
      "Settings",
    );
    if (pick === "Show details") showOutput();
    else if (pick === "Install dependencies") void vscode.commands.executeCommand("alp.installDependencies");
    else if (pick === "Settings") void vscode.commands.executeCommand("workbench.action.openSettings", "alpSdk");
  });
}

function registerDocsCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.openSomDocs", async () => {
    const project = collectProjectContext();
    const sku = project.boardYamlPath ? (loadBoardConfigFromFile(project.boardYamlPath).som?.sku ?? "") : "";
    const base = vscode.workspace
      .getConfiguration("alpSdk")
      .get<string>("docsBaseUrl", "https://alplab.ai")
      .replace(/\/+$/, "");
    const items: { label: string; url: string }[] = [
      { label: "Alp SDK documentation", url: `${base}/docs` },
    ];
    if (sku) items.push({ label: `Product page — ${sku}`, url: `${base}/products/${sku.toLowerCase()}` });
    const pick = await vscode.window.showQuickPick(items.map((i) => i.label), { placeHolder: "Open Alp documentation" });
    const chosen = items.find((i) => i.label === pick);
    if (chosen) void vscode.env.openExternal(vscode.Uri.parse(chosen.url));
  });
}

export function registerSdkStatusCommands(): vscode.Disposable[] {
  return [registerStatusCommand(), registerDocsCommand()];
}
