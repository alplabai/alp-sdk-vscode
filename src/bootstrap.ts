// SPDX-License-Identifier: Apache-2.0
//
// `alp.installDependencies` delegates to the native CLI's `tan bootstrap`,
// which reads the SDK's own `metadata/bootstrap.json` and drives venv/west/pip
// itself (a native cross-platform Rust implementation — tan-cli#49 — it no
// longer shells the SDK's POSIX `scripts/bootstrap.sh`) in a live terminal.
// This replaces the extension's former private venv/pip plan — one bootstrap,
// owned by the CLI. OS-specific toolchains (Zephyr SDK, Yocto host packages,
// vendor compilers) are beyond bootstrap's scope and are surfaced by the build
// preflight (`tan doctor --build`) instead.
//
// win32 pre-flight: tan itself is the single source of truth for whether a
// project can bootstrap on this host — not a guess re-derived here. tan
// resolves each core's runtime from the SoM topology in the SDK metadata
// (`som.sku` -> `<sdkRoot>/metadata/e1m_modules/<sku>.yaml` `topology:`);
// `board.yaml` alone does NOT carry that (a per-core `os:` there is only an
// override, mostly used as `os: "off"`), so parsing board.yaml here would
// miss every real Yocto-only project and let a doomed terminal spawn anyway.
// So: run `tan bootstrap --no-pip --no-west --format json` first — the SAME
// gate a real run hits, made side-effect-free by those two flags (tan-cli's
// `bootstrap/mod.rs` never creates the venv when both are set) — and act on
// tan's own verdict. Two DISTINCT, EXPLICITLY-PARSED verdicts stop the real
// terminal spawn, checked in this order (a host-level dead end outranks a
// fixable tool gap): a host-level refusal (`bootstrapHostVerdict`,
// service.ts — Yocto-only / an old tan) gets a legible warning + the
// one-click "Reopen in WSL" affordance; a prerequisite refusal
// (`prerequisitesMissingIssue`, service.ts — its `PREREQ_CODES` set: a
// required tool like ninja/cmake isn't on PATH, or `python`/`python3` can't
// run or is too old) gets tan's own message logged + shown verbatim in an
// error notification — no re-parsing it (tan's `failure()` space-joins its
// lines into one, so a regex hunting `<tool> -> <command>` structure in it
// is unreliable; see bootstrapPlan.ts for the real fix). Anything short of
// one of those two verdicts — a call that fails, can't resolve a binary,
// times out, or returns nothing recognisable — always falls through to
// running for real; never block a working setup on a failed probe. Any
// OTHER refusal renders legibly in the terminal itself (see util.ts's
// `runInTerminal`), so this pre-flight only needs to catch the dead ends a
// live terminal can't recover from by retrying.

import * as vscode from "vscode";

import {
  bootstrapHostVerdict,
  prerequisitesMissingIssue,
} from "./alpCli/service";
import { runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { BOOTSTRAP_RUN_NAME } from "./ideHub/messages";
import { CANCELLED, runAlpWithProgress } from "./loader";
import {
  isCancellation,
  planFailure,
  planPrecondition,
} from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log } from "./util";

/** Offer VS Code's Remote-WSL "Reopen in WSL"; if that extension isn't
 *  installed the command is absent and executeCommand rejects — fall back to
 *  the Marketplace page so the user can install it.
 *
 *  The command SUCCEEDING rejects this await too: reopening reloads the window
 *  into a WSL remote, which tears this extension host down and cancels every
 *  pending main-thread reply with a CancellationError (`name` and `message`
 *  both "Canceled") — structurally the same teardown as the workspace-replacing
 *  `vscode.openFolder`. Unguarded, the customer who HAS Remote-WSL and takes
 *  the offer gets a browser tab telling them to install what they just used. */
async function reopenInWsl(): Promise<void> {
  try {
    await vscode.commands.executeCommand("remote-wsl.reopenInWSL");
  } catch (err) {
    if (isCancellation(err)) {
      log("[bootstrap] reopening in WSL, window closing");
      return;
    }
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
  const runBootstrap = async () => {
    const workspaceRoot = collectProjectContext().workspaceRoot ?? undefined;
    // No folder open = no cwd to hand the child. `runAlpInTerminal` would pass
    // `cwd: undefined`, so `tan bootstrap` would inherit the extension host's
    // own working directory (on Windows, the VS Code install directory) and
    // create a venv / west workspace there. Same builder the four sibling
    // sites use (wizard.ts, debug.ts x2, ideHub/workspaceCommands.ts). It sits
    // BEFORE the win32 pre-flight so that probe never runs against an
    // arbitrary directory either — and the pre-flight's fall-through rule
    // ("anything unrecognised runs for real") means it could not have stopped
    // the real run anyway.
    if (!workspaceRoot) {
      await notify(
        planPrecondition("noWorkspace", {
          operation: "bootstrap the toolchain",
        }),
      );
      return;
    }
    if (process.platform === "win32") {
      // Side-effect-free and ~440ms warm, but with no CLI cached yet it
      // triggers a full download-on-demand first, which needs both a
      // visible "something is happening" signal and a way out -- hence the
      // shared cancellable-progress wrapper (see loader.ts).
      const preflight = await runAlpWithProgress(
        context,
        ["bootstrap", "--no-pip", "--no-west"],
        "Alp: checking whether this project can bootstrap on Windows…",
        workspaceRoot,
      );
      if (preflight === CANCELLED) {
        return; // user cancelled the pre-flight check itself; do nothing.
      }
      const { outcome, raw, source } = preflight;

      // Host-level dead end first: it outranks a fixable tool gap (a
      // Yocto-only project can't run here at all, no matter what's on PATH).
      const verdict = bootstrapHostVerdict(outcome.envelope);
      if (verdict.refuse) {
        log(
          `[bootstrap] win32 pre-flight: tan refuses to bootstrap this project here — ` +
            `${verdict.message} (source: ${source})` +
            (raw.stderr.trim()
              ? `\n[bootstrap]   stderr: ${raw.stderr.trim()}`
              : ""),
          "warn",
        );
        // tan's own wording already says WHY and to re-run under WSL2/Linux;
        // add the one thing it can't know — keep the project on the WSL
        // filesystem, not the Windows drive mount — plus the one-click fix.
        //
        // The severity is the pre-flight outcome's, never hand-picked here:
        // whether tan's refusal is a validation exit (warning) or a harder
        // failure (error) is tan's verdict to make, not this call site's.
        // "Reopen in WSL" is a `custom` action, so it has no `run` in the
        // presenter's table and the pick still comes back to gate the reopen.
        //
        // The literal "/mnt/c" stays OUT of `cause`: `planFailure` demotes any
        // cause carrying an absolute path into `detail` and replaces the
        // sentence with a bare "Bootstrap failed.", which would throw away
        // tan's own explanation. It rides `detail` instead, which the appended
        // "Show Output" reaches.
        const plan = planFailure({
          operation: "Bootstrap",
          cause:
            `Alp: ${verdict.message} Keep the project on the WSL filesystem ` +
            "(~/…), not the mounted Windows drive, for build speed.",
          detail:
            "Inside WSL the Windows drive is mounted at /mnt/c; building there " +
            "goes through the 9p bridge and is much slower than ~/.",
          severity: outcome.severity,
          actions: [{ id: "custom", title: "Reopen in WSL" }],
        });
        // Not awaited: this notification must not hold `alp.installDependencies`
        // open until the user dismisses it.
        void notify(plan).then((pick) => {
          if (pick === "custom") void reopenInWsl();
        });
        return;
      }

      // An EXPLICIT, PARSED prerequisite-refusal issue
      // (`prerequisitesMissingIssue`'s `PREREQ_CODES` — a missing tool, or a
      // `python`/`python3` that can't run or is too old, tan-cli#78/#81) is
      // a verdict tan already reached — spawning the real run would just
      // repeat the identical failure. This is deliberately narrower than
      // "the probe didn't come back clean": a probe that failed to run,
      // couldn't resolve a binary, timed out, or returned an envelope with
      // no such issue is NOT this verdict (`prerequisitesMissingIssue`
      // returns null for all of those) and falls through to the real run
      // below, same as ever — only one of those exact, parsed issues stops
      // the terminal spawn.
      const prereqIssue = prerequisitesMissingIssue(outcome.envelope);
      if (prereqIssue) {
        // `isEnvelope` (service.ts) only checks `issues` is an array, never
        // each issue's shape — guard once, use everywhere below, so a
        // message-less issue can't throw instead of falling through.
        const message = prereqIssue.message ?? "";
        log(
          `[bootstrap] win32 pre-flight: tan refuses to bootstrap — missing ` +
            `prerequisites (source: ${source})\n[bootstrap]   ${message.replace(/\n/g, "\n[bootstrap]   ")}` +
            (raw.stderr.trim()
              ? `\n[bootstrap]   stderr: ${raw.stderr.trim()}`
              : ""),
          "warn",
        );
        // tan's `failure()` space-joins its lines into one wall of text, so
        // `message` is a raw diagnostic, not a sentence — it goes to the
        // channel as `detail` (the `log` call just above already put the same
        // text there) and the doctor panel names the missing tools one click
        // away. A tool that isn't installed yet on a first run is a warning,
        // not an error dump.
        void notify(
          planFailure({
            operation: "Bootstrap",
            cause:
              "Alp: bootstrap needs build tools that aren't installed yet.",
            detail: message,
            severity: "warning",
            actions: [{ id: "runDoctor" }],
          }),
        );
        return;
      }
      // Clear, a mixed-board advisory, or an unresolvable/unrelated outcome —
      // all fall through to the real run below.
    }
    return runAlpInTerminal(context, ["bootstrap"], {
      name: BOOTSTRAP_RUN_NAME,
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
