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
//
// DELETED LATER, same reason (#468): the `ToolchainReport` type named above,
// with `analyzeToolchain` (`@alp-sdk/core/toolchain/doctor`) and the probe
// module that fed it (`src/toolchain/vscodeAdapter.ts` —
// `collectToolchainInputs`, `probeTool`, `probeExtractor`, `probeSevenZip`,
// `detectZephyrSdkDir`). Nothing had called that chain since the Toolchain
// Doctor panel went; its `sevenZip` verdict now comes from tan's own check row,
// read and never re-probed (`src/deps/vscodeAdapter.ts`), and its
// `ZEPHYR_SDK_INSTALL_DIR` sniffing was the exact env-guessing ADR 0021 §5 sets
// out to stop. Do not revive it to consume the plan's toolchain paths — that
// consumer belongs where the build actually spawns.

import {
  BootstrapHost,
  bootstrapHost,
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
import { runBootstrapInTerminal } from "./bootstrap";
import type { NotificationPlan } from "./notify/models";
import { planFailure, planSuccess } from "./notify/service";
import { notify, notifyAsync } from "./notify/vscodeAdapter";
import { readOnlyProjectCwd } from "./project/vscodeAdapter";
import { log, runInTerminal } from "./util";

/**
 * The run name every toolchain-fix install claims, so a second press is
 * refused by `isRunActive` rather than starting a racing installer, and so
 * `awaitRun` has something to wait on (#466 §2).
 *
 * ONE name for all of them, deliberately: these installs mutate the same
 * machine-wide toolchain, so two at once is the thing to prevent — not two of
 * the same fix. It is distinct from `ZEPHYR_SDK_RUN_NAME`, whose own comment
 * explains why that one keeps a separate name.
 */
export const TOOLCHAIN_FIX_RUN_NAME = "Alp: toolchain fix";

export function runToolchainFix(fixId: ToolchainFixId): void {
  const result = fixCommand(fixId, bootstrapHost());
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
  // A TASK, not a bare terminal (#466 §2). The line still reaches a shell
  // verbatim — `runInTerminal`'s `command` form is a `ShellExecution`, so
  // nothing is split on whitespace and no quoted argument is mangled, which was
  // the only reason this was a `sendText` terminal. What a task adds is the
  // pair a raw terminal cannot give: an exit code, so a sequential "Fix all"
  // can wait for this step before starting the next, and a reservation under
  // `TOOLCHAIN_FIX_RUN_NAME`, so a second press is refused with a message
  // instead of starting a racing installer.
  //
  // `result.step.description` is dropped rather than echoed as a `#` line: a
  // ShellExecution runs ONE command, and PowerShell — the default Windows
  // profile — does not read `#` the way a POSIX shell does. It was never
  // load-bearing; the same text is already the button's tooltip.
  runInTerminal({
    name: TOOLCHAIN_FIX_RUN_NAME,
    command: result.step.command,
    // A toolchain install is machine-wide, but a cwd still has to be stated:
    // `undefined` inherits the extension host's own, which on Windows is the
    // VS Code INSTALL DIRECTORY.
    //
    // This line USED TO BE `workspaceFolders?.[0]?.uri.fsPath`, which broke
    // the rule the comment above it states — with no folder open it evaluates
    // to exactly the `undefined` being warned against — and re-derived the
    // root per call site, which `docs/ARCHITECTURE_RULES.md` §3 forbids
    // (`workspaceFolders[0]` and `collectProjectContext` disagree on a
    // multi-root workspace). `readOnlyProjectCwd()` is the one seam for
    // "a project-scoped cwd, or a real directory that is nobody's project"
    // (#605).
    cwd: readOnlyProjectCwd(),
  });
}

/**
 * Per-OS install menu for tools whose install differs by platform (e.g. GDB).
 * The current host's option can be run in a terminal; the others are copy-only,
 * and a docs entry links the relevant guide.
 */
async function showInstallGuide(guide: InstallGuide): Promise<void> {
  const current = bootstrapHost();
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
 *  `tan bootstrap` (streams live in a terminal). After it finishes the shared
 *  state refresh repaints the dependency panel.
 *
 *  Called by `src/deps/panel.ts` off the report it already has, so this costs
 *  no CLI run of its own. */
export async function offerBootstrapFix(
  context: vscode.ExtensionContext,
  /** The open folder to bootstrap IN. Required — `tan bootstrap`
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

  // The dangling case never reaches `--fix` at all, and the reason is the
  // MEASURED, universal one below rather than tan's now-retired internal
  // gating logic: every doctor spawn from this extension goes through
  // `runAlpCommand`, which appends `--format json`, and tan's own `--fix`
  // help text says that alone disables it ("Only in an interactive, non-CI,
  // text-mode run") — confirmed by spawning `tan doctor --fix --format json`
  // and reading back `doctor.fix-suppressed` (see the non-dangling branch
  // below for the exact probe). That holds whatever tan's internal decision
  // about a dangling manifest specifically would have been, so this repo does
  // not need to re-derive that old Rust-era condition to know `--fix` cannot
  // repair it from here. So the dangling case routes to
  // `alp.installDependencies` instead: it reconciles the manifest pointer
  // (tan-cli #31), unless it reuses a `$ZEPHYR_BASE` workspace, which the
  // logged line above spells out.
  if (dangling) {
    await vscode.commands.executeCommand("alp.installDependencies");
    return;
  }
  // The remaining case — no Zephyr workspace at all — is exactly what `tan
  // bootstrap` creates, and NOT something `doctor --fix` can do. `--fix` DOES
  // still exist at the pinned `SUPPORTED_CLI_VERSION`: tan 0.6.0's
  // `tan doctor --help` lists `--project --sdk-root --board-yaml --build
  // --fix --format --non-interactive --ci --no-color --help`. The claim that
  // stood here — that the Python `tan` has no `--fix` at all and exits 2 with
  // `No such option: --fix` and a `cli`-usage envelope — was simply false.
  // Two MEASURED reasons `--fix` still cannot serve this call site:
  //   1. Scope. Its own help text: "Run the manifest's own install command
  //      (ADR 0021) for any hostPrerequisites tool this host is missing, when
  //      it needs no elevation." That installs missing host TOOLS; it never
  //      creates a west/Zephyr workspace, which is `tan bootstrap`'s job.
  //   2. Mode. Same help text: "Only in an interactive, non-CI, text-mode run
  //      (--non-interactive/--ci/--format json all disable it)". Every doctor
  //      spawn in this extension goes through `runAlpCommand`, which appends
  //      `--format json` (`src/alpCli/adapterCore.ts`), so a `--fix` sent from
  //      here is refused before it repairs anything. Measured: `tan doctor
  //      --project <tmp> --fix --format json` → exit 4, a real doctor
  //      envelope, plus the warning issue `doctor.fix-suppressed`: "`--fix`
  //      was requested but not run: `--format json` (no terminal to prompt
  //      on). Re-run `tan doctor --fix` from a real, interactive terminal,
  //      without --ci/--non-interactive/--format json, to allow it."
  // So this calls `tan bootstrap` directly — the verb that actually creates
  // the workspace, in a terminal the user can watch. `runBootstrapInTerminal`
  // (src/bootstrap.ts) is the SAME dispatch `alp.installDependencies` uses —
  // same run name/reservation, and the SAME post-bootstrap `tan sdk current`
  // reconciliation (#604/#614), so this offer doesn't skip it just because it
  // reached bootstrap a different way.
  await runBootstrapInTerminal(context, cwd);
}
