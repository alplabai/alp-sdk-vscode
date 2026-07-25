// SPDX-License-Identifier: Apache-2.0
//
// Build/flash commands. The orchestrator-backed workflow (build/image/flash/
// clean/renode/run) delegates to the native `tan` CLI (ADR-0020: tan is the
// sole executor + whole user command surface) — board.yaml validation,
// per-core generation, and the Zephyr/Yocto/baremetal dispatch all live behind
// tan, not here (see EXTENSION_CLI_INTEGRATION.md §6a). board.yaml diagnostics
// still surface live via the in-process LSP, so no pre-build check is
// duplicated here.
//
// The plain `west flash/update` commands are vanilla Zephyr west subcommands
// (not the retired `west alp-*` driver) with no tan equivalent, so they stay as
// direct west terminal invocations.

import {
  createWestFlashPlan,
  createWestUpdatePlan,
} from "@alp-sdk/core/west/service";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import {
  probeTanVersion,
  runAlpCommand,
  runAlpInTerminal,
  runAlpStreamed,
} from "./alpCli/vscodeAdapter";
import { isCliBehind } from "./alpCli/service";
import {
  collectWestWorkspaceContext,
  executeWestPlan,
  nativeSimOverlayExists,
} from "./west/vscodeAdapter";
import { parseSystemManifest } from "@alp-sdk/core/systemManifest/service";
import { log } from "./util";

function westCwd(): string | undefined {
  const context = collectWestWorkspaceContext();
  return context.westCwd ?? context.workspaceRoot ?? undefined;
}

async function pickAppPath(value: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value,
  });
}

/**
 * Where an orchestrator command (build/image/flash/clean/renode) should run.
 *
 * When the workspace holds a real board.yaml, the command targets that project
 * directly — no app-path prompt. Every `tan` orchestrator subcommand defaults
 * its app/project to the current directory (the unified "run from the project
 * dir" convention), so we run from the project root and pass no app argument.
 *
 * Only when no project is open do we fall back to prompting for an example app
 * to build. Returns `undefined` when the user cancels that prompt.
 */
async function resolveOrchestratorTarget(
  fallbackExample: string,
): Promise<
  { appArg: string[]; cwd: string | undefined; active: boolean } | undefined
> {
  const projectCtx = collectWestWorkspaceContext();
  const projectRoot =
    projectCtx.boardYamlPath && fs.existsSync(projectCtx.boardYamlPath)
      ? path.dirname(projectCtx.boardYamlPath)
      : undefined;
  if (projectRoot) return { appArg: [], cwd: projectRoot, active: true };

  const app = await pickAppPath(fallbackExample);
  if (!app) return undefined;
  return { appArg: [app], cwd: westCwd(), active: false };
}

// ── CLI-backed orchestrator workflow (tan build/image/flash/clean/renode) ─────

async function alpBuild(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/peripheral-io/gpio-button-led",
  );
  if (!target) return;
  // `tan build` (cli.rs BuildArgs) has no positional app_path — project scope
  // resolves from `--project` (which defaults to the cwd). Active project: a
  // bare `build` from the project root. Fallback: point `--project` at the
  // chosen example (a bare positional would be a parse error, not ignored).
  const args = target.active
    ? ["build"]
    : ["--project", ...target.appArg, "build"];
  // Channel mode (not terminal): a `tan` terminal dies when the process exits,
  // scrolling the build result away; streaming to the "Alp SDK" output channel
  // keeps the full log + verdict. Build is non-interactive, so no TTY is lost.
  await runAlpStreamed(context, args, { name: "Alp Build", cwd: target.cwd });
}

// Image/Flash/Clean, like Build, stream to the "Alp SDK" channel instead of a
// terminal: a `tan` terminal dies when the process exits, so its output (and,
// critically for flash, the per-slice failure reasons — e.g. "backend
// zephyr_west_flash needs west on PATH") scrolls away, leaving only a cryptic
// "failed to launch". Channel mode keeps the full log + verdict. All three are
// non-interactive (runAlpStreamed forces `--non-interactive`), so no TTY is
// lost. Renode streams too: `tan renode` boots Renode HEADLESS as a smoke test
// and reads no stdin, and its most common outcome on a real project is a
// PRE-BOOT refusal — e.g. "system-manifest.yaml has 2 zephyr slices (cores
// [\"m55_hp\", \"m55_he\"]); the Renode smoke boots a single-Zephyr-slice
// system" — which the dying terminal swallowed whole, surfacing to the user as
// a bare "failed to launch (exit code: 1)" with no reason anywhere.
async function alpImage(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
  );
  if (!target) return;
  await runAlpStreamed(context, ["image", ...target.appArg], {
    name: "Alp Image",
    cwd: target.cwd,
  });
}

async function alpFlash(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
  );
  if (!target) return;
  await runAlpStreamed(context, ["flash", ...target.appArg], {
    name: "Alp Flash",
    cwd: target.cwd,
  });
}

async function alpClean(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
  );
  if (!target) return;
  await runAlpStreamed(context, ["clean", ...target.appArg], {
    name: "Alp Clean",
    cwd: target.cwd,
  });
}

/** First `tan` carrying `renode --core` (tan-cli#63). Below this the flag is a
 *  parse error, not an ignored argument. */
const RENODE_CORE_CLI_VERSION = "0.3.2";

/** The Zephyr `core_id`s of the post-build manifest under `cwd`, in manifest
 *  order. Empty pre-build, on a parse failure, or for an all-Yocto project —
 *  every one of which means "don't prompt, let the CLI speak". */
function zephyrCoresOf(cwd: string): string[] {
  const manifestPath = path.join(cwd, "build", "system-manifest.yaml");
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const manifest = parseSystemManifest(fs.readFileSync(manifestPath, "utf8"));
    return manifest.slices
      .filter((slice) => slice.os === "zephyr")
      .map((slice) => slice.core_id);
  } catch {
    return [];
  }
}

/** Which core the Renode smoke should boot: `null` = pass no `--core` (the CLI
 *  picks the project's only Zephyr slice), a string = the user's choice,
 *  `undefined` = the user dismissed the picker, so run nothing.
 *
 *  The smoke boots ONE Zephyr slice, so a multicore project (an E1M-AEN801's
 *  `m55_hp` + `m55_he`) used to be refused outright. Asking here turns that
 *  dead end into a choice. Only asked when there really is a choice: with 0 or
 *  1 Zephyr slices no flag is sent, so the CLI's own message stays the single
 *  source of truth for every not-buildable case. */
async function pickRenodeCore(
  context: vscode.ExtensionContext,
  cwd: string | undefined,
): Promise<string | null | undefined> {
  // `tan renode --core` only exists from RENODE_CORE_CLI_VERSION on. Sending it
  // to an older binary turns an explanatory refusal ("system-manifest.yaml has
  // 2 zephyr slices … the Renode smoke boots a single-Zephyr-slice system")
  // into clap's `unexpected argument '--core'` — a strictly worse message. When
  // the version can't be read at all we also stay quiet: an unprompted no-op
  // beats a QuickPick whose answer the CLI would reject.
  const version = await probeTanVersion(context);
  if (!version || isCliBehind(version, RENODE_CORE_CLI_VERSION)) {
    if (version) {
      log(
        `[renode] tan ${version} predates --core (${RENODE_CORE_CLI_VERSION}); not offering the core picker`,
      );
    }
    return null;
  }
  const cores = cwd ? zephyrCoresOf(cwd) : [];
  if (cores.length < 2) return null;
  const picked = await vscode.window.showQuickPick(cores, {
    title: "Renode: which core to boot?",
    placeHolder: "The Renode smoke boots one Zephyr slice at a time",
  });
  return picked ?? undefined;
}

async function alpRenode(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
  );
  if (!target) return;
  const core = await pickRenodeCore(context, target.cwd);
  if (core === undefined) return;
  // `--core` needs a tan that carries it (tan-cli#63). Sending it only in the
  // multi-slice case keeps an older CLI no worse off than before: that case
  // was already a hard refusal there, and a single-slice project never sees
  // the flag at all.
  const coreArg = core === null ? [] : ["--core", core];
  await runAlpStreamed(context, ["renode", ...target.appArg, ...coreArg], {
    name: "Alp Renode",
    cwd: target.cwd,
  });
}

// ── legacy plain-west commands (no CLI equivalent yet) ────────────────────────

function westFlash(): void {
  executeWestPlan(createWestFlashPlan(collectWestWorkspaceContext()));
}

function westUpdate(): void {
  executeWestPlan(createWestUpdatePlan(collectWestWorkspaceContext()));
}

async function westRunNativeSim(
  context: vscode.ExtensionContext,
): Promise<void> {
  await ensureNativeSimOverlay(context);
  // Route through the CLI (`tan run`) so the SDK owns the board target and
  // build dir — a bare `west build -t run` has no `-b`/`-d`, so it aborts on an
  // unbuilt project or reuses a prior silicon `build/` dir, and never lands the
  // binary where the native_sim debug config looks (issue #131).
  //
  // native_sim is a HOST target: `tan run` (no `--flash`) builds + executes the
  // native_sim binary. Flashing needs EXPLICIT consent — a hardware target uses
  // `tan run --flash` (build + flash). This Run action is native_sim only, so
  // it never passes `--flash`; hardware programming is the separate Flash
  // action (`tan flash`, alp.westAlpFlash).
  await runAlpInTerminal(context, ["run"], {
    name: "Alp Run (native_sim)",
    cwd: westCwd(),
  });
}

/** Generate `boards/native_sim_native_64.overlay` on demand before a native_sim
 *  run so a GPIO app resolves its pins under host emulation (issue #86).
 *  Best-effort: a non-GPIO app doesn't need it, and an older SDK may not ship
 *  the emit, so a failure is logged and the run proceeds regardless. Idempotent
 *  (no-op when the overlay already exists) and fail-soft (generation failure
 *  is logged, never thrown) — safe to call from both the Run and Debug paths. */
export async function ensureNativeSimOverlay(
  context: vscode.ExtensionContext,
): Promise<void> {
  const root = collectWestWorkspaceContext().workspaceRoot;
  if (!root || nativeSimOverlayExists(root)) return;

  const { outcome } = await runAlpCommand(context, [
    "generate",
    "--target",
    "native-sim-overlay",
  ]);
  if (!outcome.ok) {
    log(`[native_sim] overlay generation skipped: ${outcome.message}`);
  }
}

export function registerWestCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => alpBuild(context)),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westUpdate", () => westUpdate()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(context),
    ),
    vscode.commands.registerCommand("alp.westAlpImage", () =>
      alpImage(context),
    ),
    vscode.commands.registerCommand("alp.westAlpFlash", () =>
      alpFlash(context),
    ),
    vscode.commands.registerCommand("alp.westAlpClean", () =>
      alpClean(context),
    ),
    vscode.commands.registerCommand("alp.westAlpRenode", () =>
      alpRenode(context),
    ),
  ];
}
