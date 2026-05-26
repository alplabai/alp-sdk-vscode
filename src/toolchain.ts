// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { analyzeToolchain, ToolchainReport } from "@alp-sdk/core/toolchain/doctor";
import { fixCommand, ToolchainFixId, BootstrapHost } from "@alp-sdk/core/toolchain/bootstrapPlan";
import { collectToolchainInputs } from "./toolchain/vscodeAdapter";
import { log, showOutput } from "./util";

function host(): BootstrapHost {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
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
  const term = vscode.window.createTerminal({ name: "Alp toolchain fix" });
  term.show(true);
  term.sendText(`# ${result.step.description}`);
  term.sendText(result.step.command);
}

function reportToOutput(report: ToolchainReport): void {
  log("── Alp toolchain doctor ──");
  for (const c of report.checks) {
    log(`  ${statusGlyph(c.status)}${c.label}: ${c.detail}`);
  }
  log(`  → ${report.ok ? "toolchain OK" : `${report.missingRequired} required item(s) missing`}`);
}

export function buildToolchainReport(): ToolchainReport {
  return analyzeToolchain(collectToolchainInputs());
}

function registerDoctorCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.toolchainDoctor", async () => {
    const report = buildToolchainReport();
    reportToOutput(report);
    const firstFix = report.checks.find((c) => c.status === "missing" && c.fixId);
    const summary = report.ok
      ? "Toolchain OK"
      : `Toolchain — ${report.missingRequired} required item(s) missing`;
    const actions = ["Show report", firstFix ? "Fix missing" : "", "Settings"].filter(Boolean);
    const pick = await vscode.window.showInformationMessage(summary, ...actions);
    if (pick === "Show report") showOutput();
    else if (pick === "Fix missing" && firstFix?.fixId) runToolchainFix(firstFix.fixId);
    else if (pick === "Settings") void vscode.commands.executeCommand("workbench.action.openSettings", "alpSdk");
  });
}

export function registerToolchainCommands(): vscode.Disposable[] {
  return [registerDoctorCommand()];
}
