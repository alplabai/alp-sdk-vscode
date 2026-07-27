// SPDX-License-Identifier: Apache-2.0

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
import {
  analyzeToolchain,
  DoctorCheck,
  DoctorCheckStatus,
  ToolchainReport,
} from "@alp-sdk/core/toolchain/doctor";
import * as vscode from "vscode";
import { runAlpCommand, runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { danglingWestManifest } from "./environment/vscodeAdapter";
import type { NotificationPlan } from "./notify/models";
import { planFailure, planSuccess } from "./notify/service";
import { notify, notifyAsync } from "./notify/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
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

// ── CLI-backed doctor (single source of truth: `alp doctor --build`) ──────────

/** A check in the CLI's `doctor` envelope `data.checks[]` (see CLI.md). */
interface CliDoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

/** The `data` payload of an `alp doctor --build --format json` envelope. */
interface CliDoctorData {
  checks: CliDoctorCheck[];
  summary: { pass: number; warn: number; fail: number };
  nextSteps: string[];
}

/** CLI check status → the webview's tri-state. `fail` is a hard-required miss. */
const CLI_STATUS: Record<CliDoctorCheck["status"], DoctorCheckStatus> = {
  pass: "ok",
  warn: "warn",
  fail: "missing",
};

/** Human labels for the CLI's terse check ids; unknown ids fall back to the id. */
const CLI_LABELS: Readonly<Record<string, string>> = {
  sdk: "alp-sdk",
  boardYaml: "board.yaml",
  workspace: "Zephyr workspace",
  westResolved: "west (workspace)",
  west: "west",
  cmake: "CMake",
  ninja: "Ninja",
  zephyrSdk: "Zephyr SDK",
  bitbake: "BitBake",
  dd: "dd",
  vendorToolchain: "Vendor toolchain",
  sdkProvenance: "SDK provenance",
};

/** Validate the untrusted envelope `data` before mapping it (boundary check). */
function isCliDoctorData(value: unknown): value is CliDoctorData {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  const summary = o.summary as Record<string, unknown> | undefined;
  if (
    !Array.isArray(o.checks) ||
    !summary ||
    typeof summary.fail !== "number"
  ) {
    return false;
  }
  return o.checks.every((c) => {
    const cc = c as Record<string, unknown>;
    return (
      typeof cc.name === "string" &&
      typeof cc.status === "string" &&
      typeof cc.detail === "string"
    );
  });
}

/** Map the CLI doctor report onto the webview's `ToolchainReport` shape so the
 *  existing panel renders it unchanged. The CLI drives fixes itself
 *  (`doctor --build --fix`), so no per-check `fixId` is attached.
 *
 *  When `dangling` is set, the CLI's `workspace` check is downgraded to
 *  missing: the CLI only asks whether a workspace RESOLVES, and one whose
 *  `.west/config` manifest names a directory that is gone resolves fine while
 *  being unbuildable (#349). Leaving it green would have the panel report
 *  "toolchain OK" at the same moment the toast says the workspace is broken. */
function mapCliDoctorToReport(
  data: CliDoctorData,
  dangling?: WestManifestStatus | null,
): ToolchainReport {
  const checks: DoctorCheck[] = data.checks.map((c) => {
    const overridden = dangling && c.name === "workspace";
    return {
      id: c.name,
      label: CLI_LABELS[c.name] ?? c.name,
      status: overridden ? "missing" : (CLI_STATUS[c.status] ?? "warn"),
      detail: overridden
        ? `${c.detail} — but its manifest points at "${dangling.manifestPath}", which no longer exists (${dangling.configPath}).`
        : c.fix
          ? `${c.detail} — ${c.fix}`
          : c.detail,
      required: overridden ? true : c.status !== "warn",
    };
  });
  // A dangling manifest that the CLI did NOT already count as a failure adds one.
  const extraFail =
    dangling &&
    !data.checks.some((c) => c.name === "workspace" && c.status === "fail")
      ? 1
      : 0;
  const missingRequired = data.summary.fail + extraFail;
  return { checks, ok: missingRequired === 0, missingRequired };
}

/**
 * Build the toolchain report from the native CLI (`alp doctor --build`), the
 * single source of truth for build readiness. Falls back to the in-process
 * checks when the CLI is unavailable or emits no usable envelope, so the panel
 * always shows something. `canFix` is true when the only-fixable gap — a missing
 * Zephyr workspace — is present, which `alp doctor --build --fix` can bootstrap.
 */
export async function buildToolchainReportViaCli(
  context: vscode.ExtensionContext,
): Promise<{
  report: ToolchainReport;
  fromCli: boolean;
  canFix: boolean;
  dangling?: WestManifestStatus | null;
  reason?: string;
}> {
  // #349: "workspace: fail" only covers a workspace that is ABSENT. A present
  // one whose `.west/config` manifest names a directory that is gone is just as
  // unbuildable, and an ambient `$ZEPHYR_BASE` pointing at any unrelated Zephyr
  // checkout is enough to keep that check passing — which is why the offer
  // never appeared for the workspace that was actually broken. Probed on both
  // branches: the local filesystem answers this whether or not the CLI ran.
  const dangling = danglingWestManifest(collectProjectContext().sdkRoot);

  const { outcome } = await runAlpCommand(context, ["doctor", "--build"]);
  const data = outcome.envelope?.data;
  if (outcome.envelope && isCliDoctorData(data)) {
    const canFix =
      data.checks.some((c) => c.name === "workspace" && c.status === "fail") ||
      dangling !== null;
    return {
      report: mapCliDoctorToReport(data, dangling),
      fromCli: true,
      canFix,
      dangling,
    };
  }
  const reason = `CLI build gate did not run (${outcome.message}); showing local in-process checks only.`;
  log(`[toolchain] ${reason}`);
  return {
    report: buildToolchainReport(),
    fromCli: false,
    canFix: dangling !== null,
    dangling,
    reason,
  };
}

/** Offer to bootstrap a missing — or manifest-broken — Zephyr workspace via
 *  `alp doctor --build --fix` (streams live in a terminal). After it finishes
 *  the user re-runs the panel's "Re-run" to see the green report. */
async function offerBootstrapFix(
  context: vscode.ExtensionContext,
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
  // fails (tan-cli v0.3.1 `doctor.rs`). A workspace that exists but dangles
  // passes that check, so `--fix` would print a green report and repair
  // nothing. Run `tan bootstrap` directly for that case — it reconciles the
  // manifest pointer (tan-cli #31), unless it reuses a `$ZEPHYR_BASE`
  // workspace, which the logged line above spells out.
  if (dangling) {
    await vscode.commands.executeCommand("alp.installDependencies");
    return;
  }
  await runAlpInTerminal(context, ["doctor", "--build", "--fix"], {
    name: "Alp Bootstrap",
  });
}

function registerDoctorCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand("alp.toolchainDoctor", async () => {
    const { report, canFix, dangling } =
      await buildToolchainReportViaCli(context);
    reportToOutput(report);
    showToolchainDoctorPanel(context);
    // Not gated on `fromCli` any more: a dangling manifest is detected locally,
    // and its fix (`tan bootstrap`) is worth offering even when the doctor
    // envelope was unusable.
    if (canFix) {
      void offerBootstrapFix(context, dangling);
    }
  });
}

export function registerToolchainCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [registerDoctorCommand(context)];
}
