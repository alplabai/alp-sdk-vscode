// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { planForHost, BootstrapHost, BootstrapOs } from "@alp-sdk/core/toolchain/bootstrapPlan";

async function pickOs(): Promise<"zephyr" | "yocto" | "baremetal" | null> {
    const items: vscode.QuickPickItem[] = [
        { label: "zephyr",    description: "Zephyr RTOS (west + Zephyr SDK)" },
        { label: "yocto",     description: "Yocto / OpenEmbedded user-space (Linux host required)" },
        { label: "baremetal", description: "No OS; vendor toolchains (Alif / Renesas / NXP)" },
    ];
    const pick = await vscode.window.showQuickPick(items, {
        title: "Alp: Which OS path do you want to bootstrap for?",
        placeHolder: "Pick the os: value matching your board.yaml.",
    });
    return (pick?.label as "zephyr" | "yocto" | "baremetal" | undefined) ?? null;
}

async function runBootstrap(): Promise<void> {
    const os = await pickOs();
    if (!os) return;

    const host: BootstrapHost =
        process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
    const plan = planForHost(host, os as BootstrapOs);

    const term = vscode.window.createTerminal({ name: plan.title });
    term.show(true);
    term.sendText(`# ${plan.title}`);
    for (const step of plan.steps) {
        term.sendText(`# ${step.description}`);
        term.sendText(step.command);
    }

    if (plan.pointers.length > 0) {
        term.sendText("# Manual follow-ups (license-walled / vendor-specific):");
        for (const p of plan.pointers) {
            term.sendText(`#   - ${p.name}: ${p.url}`);
        }
    }
}

export function registerBootstrapCommand(): vscode.Disposable {
    return vscode.commands.registerCommand("alp.installDependencies", () => runBootstrap());
}
