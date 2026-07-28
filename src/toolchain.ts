// SPDX-License-Identifier: Apache-2.0
//
// What is left of the toolchain surface after the dependency panel took over
// the report: the FIX dispatch (`runToolchainFix` → `fixCommand`, live plumbing
// the panel's rows call into) and the one gap that has no per-row fix — a
// missing or manifest-broken Zephyr workspace (#349), whose repair is a whole
// `tan bootstrap` run.
//
// DELETED HERE, do not bring back — `mapCliDoctorToReport`, which turned the
// `tan doctor --build` envelope into a `ToolchainReport`:
//
//   - it attached NO `fixId` to any row, while the view gated its Fix button on
//     exactly `check.fixId` — so every advertised one-click fix was dead on
//     every machine where tan resolves. Rows now carry a planned `action`
//     (`@alp-sdk/core/deps/planner`), which is asserted by a test;
//   - it derived `required: c.status !== "warn"` and then `ok: fail === 0`.
//     tan caps an ABSENT PATH tool at `warn` (tan-cli#103), so that verdict
//     printed "All required tools present" with `ninja` missing. The planner
//     emits tan's `summary` verbatim and NO `ok`/`required` at all.
//
// Both were re-derivations of facts tan owns. The replacement reads tan.

import {
  BootstrapHost,
  fixCommand,
  InstallGuide,
  ToolchainFixId,
} from "@alp-sdk/core/toolchain/bootstrapPlan";
import {
  WestManifestStatus,
  westManifestLogLine,
  westManifestWarning,
} from "@alp-sdk/core/sdk/service";
import * as vscode from "vscode";
import { runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { BOOTSTRAP_RUN_NAME } from "./ideHub/messages";
import type { NotificationPlan } from "./notify/models";
import { planFailure, planSuccess } from "./notify/service";
import { notify, notifyAsync } from "./notify/vscodeAdapter";
import { log } from "./util";

function host(): BootstrapHost {
  return process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "linux";
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
  if (result.kind === "bootstrap") {
    // `alp bootstrap` installs west + Zephyr's Python deps into a venv (PEP-668
    // safe). If the CLI can't be resolved, runAlpInTerminal surfaces a clear
    // error + Open Settings action rather than silently failing.
    void vscode.commands.executeCommand("alp.installDependencies");
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
    // Both choices stay, and NEITHER touches the clipboard until it is picked —
    // copying on sight clobbers whatever the user had copied even when they
    // then decline. The command itself rides in `detail` (channel-only): VS Code
    // renders no `\n` in a notification title, so the old `Install command:\n…`
    // arrived as one run-on line, and the user has just read it in the
    // QuickPick's detail line anyway.
    //
    // `notify` returns the ActionId, not the title, so the two buttons need two
    // DISTINCT caller-handled ids (both are `run`-less in the presenter's table,
    // which is what makes the pick come back here and gate the side effect).
    // TODO: a dedicated `copyCommand` id with a presenter `run` would drop this
    // branch entirely — it belongs in `notify/models.ts`, not in a call site.
    const choice = await notify(
      planFailure({
        operation: "Installing the tool",
        cause: "Install command ready — run it in a terminal, or copy it?",
        detail: pick.command,
        severity: "info",
        actions: [
          { id: "startAnyway", title: "Run in Terminal" },
          { id: "custom", title: "Copy" },
        ],
      }),
    );
    if (choice === "startAnyway") {
      const term = vscode.window.createTerminal({ name: "Alp: install tool" });
      term.show(true);
      term.sendText(pick.command);
    } else if (choice === "custom") {
      await vscode.env.clipboard.writeText(pick.command);
    }
    return;
  }
  await vscode.env.clipboard.writeText(pick.command);
  // Transient success with nothing to act on — the status bar, not a toast the
  // user has to dismiss.
  notifyAsync(
    planSuccess(
      `Copied the install command for ${pick.label.replace(/^\$\([^)]*\)\s*/, "")}.`,
    ),
  );
}

/** Offer to bootstrap a missing — or manifest-broken — Zephyr workspace via
 *  `alp doctor --build --fix` (streams live in a terminal). After it finishes
 *  the shared state refresh repaints the dependency panel.
 *
 *  Called by `src/deps/panel.ts` off the report it already has, so this costs
 *  no CLI run of its own. */
export async function offerBootstrapFix(
  context: vscode.ExtensionContext,
  /** The open folder to bootstrap IN. Required — `tan doctor --build --fix`
   *  creates a venv and a west workspace in its working directory, so there is
   *  no safe default; the caller withholds the whole offer when there is none. */
  cwd: string,
  dangling?: WestManifestStatus | null,
): Promise<void> {
  // A workspace that EXISTS but points its manifest at a directory that is gone
  // needs a different sentence than one that was never bootstrapped — "no Zephyr
  // workspace yet" is simply false there, and the user would dismiss it.
  if (dangling) {
    log(`[toolchain] ${westManifestLogLine(dangling)}`, "warn");
  }

  // Two distinct sentences: "the manifest dangles" and "there is no workspace"
  // need different words or the user dismisses the wrong one. The dangling one
  // is `westManifestWarning`'s — the single source of that sentence, shared with
  // `sdk/activeSdk.ts`, so one condition never gets two customer wordings — and
  // it is spelled as a plan literal for the same reason that file gives: naming
  // `topdir` and `manifestPath` IS the diagnosis here, and `planFailure`'s
  // absolute-path scrub would demote the whole sentence into the channel and
  // leave the user a bare "Bootstrap failed." with no paths to repair by hand.
  const plan: NotificationPlan = dangling
    ? {
        severity: "warning",
        channel: "toast",
        message: westManifestWarning(dangling) as string,
        actions: [{ id: "custom", title: "Bootstrap now" }],
      }
    : planFailure({
        operation: "Bootstrap",
        cause:
          "No Zephyr workspace yet — a build can't start until one is bootstrapped.",
        severity: "warning",
        actions: [{ id: "custom", title: "Bootstrap now" }],
      });
  const choice = await notify(plan);
  if (choice !== "custom") return;

  // `tan doctor --build --fix` bootstraps ONLY when its own `workspace` check
  // fails (re-verified against the pinned tan v0.4.0: `doctor.rs`
  // `run_build_readiness` gates the bootstrap on
  // `c.name == "workspace" && c.status == Fail`). A workspace that exists but dangles
  // passes that check, so `--fix` would print a green report and repair
  // nothing. Run `tan bootstrap` directly for that case — it reconciles the
  // manifest pointer (tan-cli #31), unless it reuses a `$ZEPHYR_BASE`
  // workspace, which the logged line above spells out.
  if (dangling) {
    await vscode.commands.executeCommand("alp.installDependencies");
    return;
  }
  await runAlpInTerminal(context, ["doctor", "--build", "--fix"], {
    // Same run name as `tan bootstrap` (src/bootstrap.ts) on purpose: this
    // fix bootstraps too, so it must take the same reservation and light the
    // same "bootstrapping, don't build yet" gate.
    name: BOOTSTRAP_RUN_NAME,
    cwd,
  });
}
