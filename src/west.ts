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

import { WestWorkspaceContext } from "@alp-sdk/core/west/models";
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
import { isCliBehind, SUPPORTED_CLI_VERSION } from "./alpCli/service";
import { isRenesasSku, somCliFloorWarning } from "./alpCli/somCliFloor";
import { planFailure, planPrecondition } from "./notify/service";
import { notify, notifyAsync } from "./notify/vscodeAdapter";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import {
  collectWestWorkspaceContext,
  executeWestPlan,
  nativeSimOverlayExists,
} from "./west/vscodeAdapter";
import {
  parseSystemManifest,
  zephyrCoreIds,
} from "@alp-sdk/core/systemManifest/service";
import { BUILD_RUN_NAME, FLASH_RUN_NAME, log } from "./util";

/** The directory a `tan` run should use, or undefined when nothing resolves one
 *  (no folder open and no `alpSdk.westCwd`) — in which case the run must be
 *  refused, never spawned with an inherited cwd. Takes an already-collected
 *  context so a caller that needs both doesn't resolve the project twice. */
function westCwd(
  context: WestWorkspaceContext = collectWestWorkspaceContext(),
): string | undefined {
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
 * to build. Returns `undefined` when the user cancels that prompt — or when
 * nothing resolves a cwd at all, which is refused here rather than in each of
 * the five callers: `tan build/image/flash/clean/renode` all WRITE where they
 * run, and with no folder open the child inherits the extension host's own
 * directory (on Windows, the VS Code install directory) and drops a `build/`
 * there. `cwd` is narrowed to `string` on the way out so the guard cannot be
 * bypassed by a later caller. Same builder the sibling sites use (bootstrap.ts,
 * toolchain.ts, wizard.ts, debug.ts, ideHub/workspaceCommands.ts).
 *
 * `operation` is the verb phrase `planPrecondition` renders into "Open a folder
 * to <operation>.", so it is per-command, not per-resolver.
 *
 * @callers 5 resolveOrchestratorTarget
 */
async function resolveOrchestratorTarget(
  fallbackExample: string,
  operation: string,
): Promise<{ appArg: string[]; cwd: string; active: boolean } | undefined> {
  const projectCtx = collectWestWorkspaceContext();
  const root = westCwd(projectCtx);
  if (!root) {
    await notify(planPrecondition("noWorkspace", { operation }));
    return undefined;
  }

  const projectRoot =
    projectCtx.boardYamlPath && fs.existsSync(projectCtx.boardYamlPath)
      ? path.dirname(projectCtx.boardYamlPath)
      : undefined;
  if (projectRoot) return { appArg: [], cwd: projectRoot, active: true };

  const app = await pickAppPath(fallbackExample);
  if (!app) return undefined;
  return { appArg: [app], cwd: root, active: false };
}

// ── CLI-backed orchestrator workflow (tan build/image/flash/clean/renode) ─────

/** The SoM SKU declared by the `board.yaml` at `cwd`, or null when there is no
 *  readable project there — no file, unparseable YAML, or a board that declares
 *  no `som`. Every one of those means "say nothing", never "assume a SKU".
 *
 *  Same shape as `zephyrCoresOf` below, and for the same reason: the `fs` read
 *  lives here while the parse is `@alp-sdk/core`'s, so this file holds no
 *  second copy of the board-config rules. */
function somSkuOf(cwd: string): string | null {
  const boardYaml = path.join(cwd, "board.yaml");
  if (!fs.existsSync(boardYaml)) return null;
  try {
    return (
      parseBoardConfig(fs.readFileSync(boardYaml, "utf8")).som?.sku ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Say so BEFORE a build this tan cannot configure (#502).
 *
 * Scoped to `build` because that is where the abort was measured and where the
 * customer is left with a Kconfig error naming neither their CLI nor their SoM.
 *
 * The probe is deliberately behind the SKU check: `probeTanVersion` spawns the
 * CLI, and there is no reason to pay that on every Alif or NXP build to answer
 * a question only Renesas can fail. Fire-and-forget (`notifyAsync`) — this is
 * an explanation, not a gate, so the build the customer asked for still starts
 * immediately.
 */
async function warnIfCliCannotBuildSom(
  context: vscode.ExtensionContext,
  cwd: string,
): Promise<void> {
  const sku = somSkuOf(cwd);
  if (!sku || !isRenesasSku(sku)) return;

  const warning = somCliFloorWarning(sku, await probeTanVersion(context));
  if (!warning) return;

  log(`[build] ${warning.detail}`);
  notifyAsync(
    planFailure({
      operation: "Build",
      cause: warning.cause,
      detail: warning.detail,
      severity: "warning",
      actions: [{ id: "updateCli", title: `Use tan ${SUPPORTED_CLI_VERSION}` }],
      dedupeKey: "som-cli-floor",
    }),
  );
}

async function alpBuild(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/peripheral-io/gpio-button-led",
    "build this project",
  );
  if (!target) return;
  await warnIfCliCannotBuildSom(context, target.cwd);
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
  // BUILD_RUN_NAME, not a literal: the debug `preLaunchTask` build dispatches
  // under the same name, and only one shared name makes the "already running"
  // guard refuse the second of two builds over one `build/` directory.
  await runAlpStreamed(context, args, {
    name: BUILD_RUN_NAME,
    cwd: target.cwd,
  });
}

// Image/Flash/Clean, like Build, stream to the "Alp SDK" channel instead of a
// terminal: a `tan` terminal dies when the process exits, so its output (and,
// critically for flash, the per-slice failure reasons — e.g. "backend
// zephyr_west_flash needs west on PATH") scrolls away, leaving only a cryptic
// "failed to launch". Channel mode keeps the full log + verdict. All three are
// non-interactive because the streamed child gets no TTY at all, so no TTY is
// lost. Renode streams too: `tan renode` boots Renode HEADLESS as a smoke test
// and reads no stdin, and its most common outcome on a real project is a
// PRE-BOOT refusal — e.g. "system-manifest.yaml has 2 zephyr slices (cores
// [\"m55_hp\", \"m55_he\"]); the Renode smoke boots a single-Zephyr-slice
// system" — which the dying terminal swallowed whole, surfacing to the user as
// a bare "failed to launch (exit code: 1)" with no reason anywhere.
async function alpImage(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "build a flash image",
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
    "flash this device",
  );
  if (!target) return;
  // No confirm flag here on purpose, and the reason is not the one tan's
  // `--help` gives. `tan flash --help` says a bare run "previews, writes
  // nothing, exits non-zero"; measured against tan v0.6.0 that holds for only
  // three of the six backends (tan-cli#796), and a Zephyr slice is programmed
  // by this argv exactly as written. What stands between this line and the
  // write is `gateFlashDispatch` (`src/flash/gate.ts`), which shows the
  // customer what the manifest says is about to be programmed and spawns
  // nothing until they accept. `--confirm` here would additionally arm the
  // three backends that DO honour it — an irreversible write nobody asked for
  // — and `test/flash.dispatch.test.js` fails the build if anyone writes it.
  await runAlpStreamed(context, ["flash", ...target.appArg], {
    name: FLASH_RUN_NAME,
    cwd: target.cwd,
  });
}

async function alpClean(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "clean this project",
  );
  if (!target) return;
  await runAlpStreamed(context, ["clean", ...target.appArg], {
    name: "Alp Clean",
    cwd: target.cwd,
  });
}

/** First `tan` carrying `renode --core` (tan-cli#63, which shipped in v0.4.0 —
 *  v0.3.2 was never published). Below this the flag is a parse error, not an
 *  ignored argument.
 *
 *  BEHIND `SUPPORTED_CLI_VERSION` (0.4.0), so a managed install always clears
 *  it and the picker is reachable — the #367 state, where the pin sat at 0.3.1
 *  and this floor was unreachable for everyone but a local build, is over.
 *  This floor still earns its keep for the binaries the pin does not govern: an
 *  `alpSdk.cliPath` or `localBuild` tan can be any version, and the check is
 *  against the PROBED one. It is deliberately not `SUPPORTED_CLI_VERSION`: a
 *  feature gate compares against what is running, never against what this
 *  build would download. */
const RENODE_CORE_CLI_VERSION = "0.3.2";

/** The Zephyr `core_id`s of the post-build manifest under `cwd`, in manifest
 *  order. Empty pre-build, on a parse failure, or for an all-Yocto project —
 *  every one of which means "don't prompt, let the CLI speak".
 *
 *  Only the `fs` read lives here; the selection is `zephyrCoreIds` in
 *  `@alp-sdk/core`. Reading and parsing this file had grown three hand-rolled
 *  copies, which docs/ARCHITECTURE_RULES.md §2 forbids as "cross-slice
 *  copy-paste of domain rules" — and a non-exported function doing its own IO
 *  in a surface file
 *  cannot be tested at all. */
function zephyrCoresOf(cwd: string): string[] {
  const manifestPath = path.join(cwd, "build", "system-manifest.yaml");
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return zephyrCoreIds(
      parseSystemManifest(fs.readFileSync(manifestPath, "utf8")),
    );
  } catch {
    return [];
  }
}

/** Which core the Renode smoke should boot: `null` = pass no `--core` (the CLI
 *  picks the project's only Zephyr slice, or refuses with its own message), a
 *  string = the user's choice, `undefined` = the user dismissed the picker.
 *
 *  The manifest is read FIRST and the CLI version probed only if a picker could
 *  actually appear: `probeTanVersion` spawns `tan --version` with a 3 s timeout,
 *  which on a single-slice project is pure cost on every Renode click, for a
 *  question whose answer cannot change the outcome. */
async function pickRenodeCore(
  context: vscode.ExtensionContext,
  cwd: string | undefined,
): Promise<string | null | undefined> {
  const cores = cwd ? zephyrCoresOf(cwd) : [];
  if (cores.length < 2) return null;

  // `tan renode --core` only exists from RENODE_CORE_CLI_VERSION on. Sending it
  // to an older binary turns an explanatory refusal ("system-manifest.yaml has
  // 2 zephyr slices … the Renode smoke boots a single-Zephyr-slice system")
  // into clap's `unexpected argument '--core'` — strictly worse.
  const version = await probeTanVersion(context);
  if (!version) {
    // Either unreadable, or the managed binary has not been downloaded yet
    // (probeTanVersion never fetches). Staying silent is the safe fallback —
    // multi-slice just gets the CLI's own refusal — but it is invisible
    // without this line, so a first-ever Renode run on a multicore project
    // does not look like the picker is broken.
    log(
      "[renode] tan version not readable yet (not downloaded?); not offering the core picker",
    );
    return null;
  }
  if (isCliBehind(version, RENODE_CORE_CLI_VERSION)) {
    log(
      `[renode] tan ${version} predates --core (${RENODE_CORE_CLI_VERSION}); not offering the core picker`,
    );
    return null;
  }

  const picked = await vscode.window.showQuickPick(cores, {
    title: "Renode: which core to boot?",
    placeHolder: "The Renode smoke boots one Zephyr slice at a time",
  });
  if (!picked) {
    // Fires AFTER the user engaged with a prompt, so a completely silent
    // no-op reads as a broken button.
    log("[renode] core picker dismissed — nothing run");
    return undefined;
  }
  return picked;
}

async function alpRenode(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "run this project in Renode",
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
  const plan = createWestFlashPlan(collectWestWorkspaceContext());
  // Run it under the SHARED flash name, not the plan's own "Alp · Flash": this
  // programs the same board as `tan flash`, and two names are two reservations
  // — i.e. two programmers writing at once. The plan is rebuilt, not mutated.
  void executeWestPlan({ ...plan, terminalName: FLASH_RUN_NAME });
}

function westUpdate(): void {
  void executeWestPlan(createWestUpdatePlan(collectWestWorkspaceContext()));
}

async function westRunNativeSim(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Its OWN guard, not the resolver's: this command never calls
  // `resolveOrchestratorTarget`, so deleting either one leaves the other path
  // still spawning `tan` with an inherited cwd. It sits ahead of the overlay
  // generation so that `tan generate` never runs against an arbitrary
  // directory either.
  const root = westCwd();
  if (!root) {
    await notify(
      planPrecondition("noWorkspace", { operation: "run this project" }),
    );
    return;
  }
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
    cwd: root,
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

  // `interactive: true`: both callers (`westRunNativeSim`'s "Alp: Run" and
  // `startDebugging`'s "Alp: Debug", `debug.ts`) are explicit user actions.
  const { outcome } = await runAlpCommand(
    context,
    ["generate", "--target", "native-sim-overlay"],
    undefined,
    { interactive: true },
  );
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
