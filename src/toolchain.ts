// SPDX-License-Identifier: Apache-2.0

import {
  BootstrapHost,
  fixCommand,
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
