// SPDX-License-Identifier: Apache-2.0
//
// `alp.installShellCompletion` (#621): a customer-facing door onto
// `tan completion --shell {bash,zsh,fish}`. Before this, the only caller in
// the whole tree was the dev-side surface-capture script — nobody running the
// extension had a way to get `tan <TAB>` working in their own shell.
//
// Verified against the pinned tan 0.6.0 (SDK v0.16.0-rc1, this session):
// `tan completion --shell <shell> --format json` returns the SAME envelope
// shape as every other CLI-only verb (`command/ok/exitCode/project/data/
// issues`) with `data: {schemaVersion, shell, script}` — so this goes through
// `runAlpCommand` like any other envelope command, never a raw spawn. Also
// measured: `--shell` defaults to "bash" when omitted; an unsupported value
// comes back `ok:false`, exit 1, `data.script:""`, issue code
// `completion.shell-unsupported` — which is why the shell picker below only
// ever offers the three tan actually supports, so that branch is never live
// here; and a `--sdk-root` ahead of the command changes nothing (same script,
// byte for byte) — this really is a project-independent command.
//
// The write side is the one decision tan has no opinion on: where a script
// lands on THIS machine. Only fish has an unambiguous, XDG-respecting,
// auto-loaded completions directory that is safe to write a whole new file
// into without ever touching something the customer already owns
// (`$XDG_CONFIG_HOME/fish/completions/tan.fish`, falling back to
// `~/.config/fish/completions/tan.fish` — fish's own convention, not a guess
// made up here). bash and zsh have no equivalent single answer: bash's
// user-completions directory only exists if the bash-completion package is
// installed, and zsh's is whatever the customer's own `$fpath` says, which
// this process cannot read without sourcing their rc file. Both of those go
// through the conservative path the issue itself names as the safe default:
// an untitled editor holding the script plus a one-line instruction, never a
// guess at a write target and never an append to a profile the customer owns.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { runAlpCommand } from "./alpCli/vscodeAdapter";
import { readOnlyProjectCwd } from "./project/vscodeAdapter";
import {
  planCliOutcome,
  planConfirm,
  planFailure,
  planSuccess,
} from "./notify/service";
import { notify, notifyAsync } from "./notify/vscodeAdapter";
import { log } from "./util";

/** The three shells `tan completion --shell` accepts (docs/CLI.md §4.10,
 *  confirmed against the pinned binary). Any other value this process could
 *  plausibly detect ($SHELL=/bin/sh, PowerShell, cmd.exe — tan has no
 *  completion for any of them) falls through to the QuickPick, which offers
 *  exactly these three and nothing else. */
export type CompletionShell = "bash" | "zsh" | "fish";
const SUPPORTED_SHELLS: readonly CompletionShell[] = ["bash", "zsh", "fish"];

interface CompletionEnvelopeData {
  schemaVersion: string;
  shell: string;
  script: string;
}

/**
 * Boundary check on the untrusted `data` payload — same discipline as
 * `alpCli/doctor.ts`'s `isDoctorEnvelopeData`. Narrow, never cast: a future
 * tan that renames or drops `script` must fail this and be treated as a
 * failure, never hand an empty or half-shaped string to `fs.writeFileSync` or
 * to the customer as if it were a real completion script.
 */
export function isCompletionEnvelopeData(
  value: unknown,
): value is CompletionEnvelopeData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.schemaVersion === "string" &&
    typeof data.shell === "string" &&
    typeof data.script === "string"
  );
}

/**
 * Read the customer's shell off `$SHELL` — set by every POSIX login shell,
 * including Git Bash and WSL on Windows, and normally absent on a bare
 * cmd.exe/PowerShell host. Takes `env` as a parameter rather than reading
 * `process.env` itself so this stays a pure function to test.
 *
 * Returns null on anything this extension cannot map to one of the three tan
 * supports — including a real but uncovered shell such as `/bin/sh` — rather
 * than guess. The caller's job on null is to ASK, never to default to bash:
 * that is the one behaviour the issue explicitly rules out ("do not guess
 * silently").
 */
export function detectShellFromEnv(
  env: NodeJS.ProcessEnv,
): CompletionShell | null {
  const shellPath = env.SHELL;
  if (!shellPath) return null;
  const base = path.basename(shellPath).toLowerCase();
  return (SUPPORTED_SHELLS as readonly string[]).includes(base)
    ? (base as CompletionShell)
    : null;
}

/**
 * fish's own convention (not this extension's guess): one file per command
 * under its XDG config dir, auto-loaded on shell start with no `source` line
 * needed. `env`/`homedir` are parameters for the same reason as
 * `detectShellFromEnv` — a pure function to test.
 */
export function fishCompletionPath(
  env: NodeJS.ProcessEnv,
  homedir: string,
): string {
  const configHome =
    env.XDG_CONFIG_HOME?.trim() || path.join(homedir, ".config");
  return path.join(configHome, "fish", "completions", "tan.fish");
}

/** One line, per the issue's own fallback shape — where THIS shell's own
 *  documentation says a completion script belongs, not a directory this
 *  process would otherwise have to guess. */
const MANUAL_PLACEMENT_INSTRUCTION: Record<CompletionShell, string> = {
  bash:
    "# tan completion for bash. Source this file from ~/.bashrc (or, if you " +
    "have the bash-completion package installed, place it in its user " +
    "completions directory instead), then open a new shell.",
  zsh:
    "# tan completion for zsh. Save this file somewhere on your $fpath " +
    "(for example as `_tan` under ~/.zsh/completions), then run " +
    "`autoload -U compinit && compinit` and open a new shell.",
  fish:
    "# tan completion for fish. Save this file as " +
    "~/.config/fish/completions/tan.fish ($XDG_CONFIG_HOME/fish/completions " +
    "instead if you set that) — fish auto-loads it, no sourcing needed.",
};

/** The conservative shape: no filesystem write, no guess at where the script
 *  belongs — just the script and one line telling the customer where their
 *  own shell's documentation says to put it. */
async function showScriptForManualPlacement(
  shell: CompletionShell,
  script: string,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: `${MANUAL_PLACEMENT_INSTRUCTION[shell]}\n${script}`,
    language: "shellscript",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * fish only: offer to write the whole completion file in place, gated on an
 * explicit confirm naming the exact path — this repo's house rule for any
 * write into a place the customer's shell reads from. A decline, or the write
 * itself failing, falls back to the same untitled-editor shape bash/zsh
 * always use, so the click is never a dead end.
 *
 * This is a whole-file write of a file dedicated to exactly this purpose
 * (fish's own completions/ directory), never an append — it does not touch
 * ~/.config/fish/config.fish or anything else the customer already owns.
 */
async function offerFishInstall(script: string): Promise<void> {
  const target = fishCompletionPath(process.env, os.homedir());
  const exists = fs.existsSync(target);
  const answer = await notify(
    planConfirm({
      message: "Install tan completion for fish?",
      modalDetail:
        (exists
          ? `This will overwrite the existing file at ${target}.`
          : `This will create a new file at ${target}.`) +
        " Fish auto-loads every file under its completions/ directory as a " +
        "whole file — nothing else on your machine is touched.",
      confirm: { id: "custom", title: "Install" },
    }),
  );
  if (answer !== "custom") {
    log(
      `[completion] fish install declined (${target}) — showing the script instead`,
    );
    await showScriptForManualPlacement("fish", script);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, script, "utf8");
    log(`[completion] wrote fish completion to ${target}`);
    notifyAsync(
      planSuccess(
        "Alp: tan completion installed for fish. Open a new fish shell to pick it up.",
      ),
    );
  } catch (err) {
    log(`[completion] failed to write ${target}: ${String(err)}`, "warn");
    notifyAsync(
      planFailure({
        operation: "Installing the fish completion file",
        cause: "Alp: couldn't write the fish completion file.",
        detail: `[completion] ${target}: ${String(err)}`,
      }),
    );
    await showScriptForManualPlacement("fish", script);
  }
}

/**
 * Detect the shell from `$SHELL`; ask via QuickPick when that comes back
 * null rather than default to bash. Returns undefined on a dismissed picker,
 * which the caller treats as "nothing to do" — the same shape as every other
 * cancellable picker in this extension (e.g. `west.ts`'s `pickRenodeCore`).
 */
async function resolveShell(): Promise<CompletionShell | undefined> {
  const detected = detectShellFromEnv(process.env);
  if (detected) return detected;

  const picked = await vscode.window.showQuickPick(
    SUPPORTED_SHELLS.map((shell) => ({ label: shell, shell })),
    {
      title: "Alp: install tan shell completion",
      placeHolder:
        "Could not detect your shell from $SHELL — which one do you use?",
    },
  );
  if (!picked) {
    log("[completion] shell picker dismissed — nothing installed");
    return undefined;
  }
  return picked.shell;
}

/**
 * `alp.installShellCompletion`: fetch `tan completion --shell <shell>` and
 * either install it (fish only, behind a confirm) or hand it to the customer
 * to place themselves (bash, zsh, and a declined/failed fish install).
 *
 * `cwd: undefined` — like `sdk list` (`src/deps/vscodeAdapter.ts`), this is a
 * global operation with no project of its own; see the file header for the
 * measurement backing that.
 *
 * `interactive: true`: this only runs from a direct command-palette click,
 * never from a background re-derive, so it is exactly the case
 * `runAlpCommand`'s own doc says should opt in.
 */
export async function installShellCompletion(
  context: vscode.ExtensionContext,
): Promise<void> {
  const shell = await resolveShell();
  if (!shell) return;

  const { outcome } = await runAlpCommand(
    context,
    ["completion", "--shell", shell],
    // `readOnlyProjectCwd()`, not `undefined` (#605). `completion` emits a
    // static script and does not read the project, so this is the one spawn in
    // this file where cwd genuinely changes nothing — but "changes nothing
    // today" is not a reason to inherit the extension host's directory, and
    // the AST gate rightly refuses to special-case a verb on that argument.
    readOnlyProjectCwd(),
    { interactive: true },
  );

  // Every issue reaches the channel on every outcome, ok or not — this
  // repo's own rule (see `loader.ts`'s `logIssues`). `planCliOutcome` below
  // only ever puts `issues[0]` on the toast.
  for (const issue of outcome.envelope?.issues ?? []) {
    log(`[completion] ${issue.severity}: ${issue.message}`);
  }

  if (!outcome.ok || !outcome.envelope) {
    // No retry loop here (nothing to retry into) — fire-and-forget, same as
    // `sdkManagerMessages.ts`'s "Fetching the SDK list".
    notifyAsync(
      planCliOutcome(outcome, {
        operation: "Fetching the tan shell completion script",
      }),
    );
    return;
  }

  const data = outcome.envelope.data;
  if (!isCompletionEnvelopeData(data) || !data.script.trim()) {
    // ok:true with a shape this extension can't read is NOT a success —
    // narrow, never cast. Reporting "finished" here off a bare `?? ""` would
    // be exactly the false-success shape this repo's house rules warn about.
    log(
      `[completion] tan returned ok but an unreadable payload: ${JSON.stringify(data)}`,
      "warn",
    );
    notifyAsync(
      planFailure({
        operation: "Fetching the tan shell completion script",
        cause:
          "Alp: tan didn't return a completion script this extension could read.",
        detail: `[completion] unexpected data shape: ${JSON.stringify(data)}`,
      }),
    );
    return;
  }

  if (shell === "fish") {
    await offerFishInstall(data.script);
    return;
  }
  await showScriptForManualPlacement(shell, data.script);
}
