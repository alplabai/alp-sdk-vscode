// SPDX-License-Identifier: Apache-2.0

import {
  BootstrapHost,
  fixCommand,
  InstallGuide,
  ToolchainFixId,
} from "@alp-sdk/core/toolchain/bootstrapPlan";
import {
  analyzeToolchain,
  ToolchainReport,
} from "@alp-sdk/core/toolchain/doctor";
import * as vscode from "vscode";
import { showToolchainDoctorPanel } from "./toolchain/doctorPanel";
import { collectToolchainInputs } from "./toolchain/vscodeAdapter";
import { log } from "./util";

function host(): BootstrapHost {
  return process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";
}

function statusGlyph(status: string): string {
  return status === "ok" ? "OK " : status === "warn" ? "~~ " : "!! ";
}

export function runToolchainFix(fixId: ToolchainFixId): void {
  const result = fixCommand(fixId, host());
  if (result.kind === "pointer") {
    void vscode.env.openExternal(vscode.Uri.parse(result.pointer.url));
    return;
  }
  if (result.kind === "guide") {
    void showInstallGuide(result.guide);
    return;
  }
  const term = vscode.window.createTerminal({ name: "Alp toolchain fix" });
  term.show(true);
  term.sendText(`# ${result.step.description}`);
  term.sendText(result.step.command);
}

/**
 * Per-OS install menu for tools whose install differs by platform (e.g. GDB).
 * The current host's option can be run in a terminal; the others are copy-only,
 * and a docs entry links the relevant guide.
 */
async function showInstallGuide(guide: InstallGuide): Promise<void> {
  const current = host();
  type GuideItem = vscode.QuickPickItem & {
    command?: string;
    os?: BootstrapHost;
  };
  const items: GuideItem[] = guide.options.map((option) => ({
    label: option.os === current ? `$(check) ${option.label}` : option.label,
    description: option.os === current ? "your OS" : undefined,
    detail: option.command,
    command: option.command,
    os: option.os,
  }));
  items.push({
    label: "$(link-external) Open debugging docs",
    detail: guide.docUrl,
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: guide.title,
    placeHolder: "Run on this OS, or copy the command for another platform",
    matchOnDetail: true,
  });
  if (!pick) return;
  if (!pick.command) {
    void vscode.env.openExternal(vscode.Uri.parse(guide.docUrl));
    return;
  }
  if (pick.os === current) {
    const choice = await vscode.window.showInformationMessage(
      `Install command:\n${pick.command}`,
      "Run in Terminal",
      "Copy",
    );
    if (choice === "Run in Terminal") {
      const term = vscode.window.createTerminal({ name: "Alp: install tool" });
      term.show(true);
      term.sendText(pick.command);
    } else if (choice === "Copy") {
      await vscode.env.clipboard.writeText(pick.command);
    }
    return;
  }
  await vscode.env.clipboard.writeText(pick.command);
  void vscode.window.showInformationMessage(
    `Copied the install command for ${pick.label.replace(/^\$\([^)]*\)\s*/, "")}.`,
  );
}

function reportToOutput(report: ToolchainReport): void {
  log("── Alp toolchain doctor ──");
  for (const c of report.checks) {
    log(`  ${statusGlyph(c.status)}${c.label}: ${c.detail}`);
  }
  log(
    `  → ${report.ok ? "toolchain OK" : `${report.missingRequired} required item(s) missing`}`,
  );
}

export function buildToolchainReport(): ToolchainReport {
  return analyzeToolchain(collectToolchainInputs());
}

function registerDoctorCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand("alp.toolchainDoctor", () => {
    const report = buildToolchainReport();
    reportToOutput(report);
    showToolchainDoctorPanel(context);
  });
}

export function registerToolchainCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [registerDoctorCommand(context)];
}
