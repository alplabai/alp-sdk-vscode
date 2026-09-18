// SPDX-License-Identifier: Apache-2.0
//
// Build/flash commands. The orchestrator-backed workflow (build/image/flash/
// clean/run) delegates to the native `tan` CLI (ADR-0020: tan is the
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
  collectFlashReadinessWarnings,
  describeFlashReadiness,
  flashReadinessModalDetail,
} from "@alp-sdk/core/deps/flashReadiness";
import { WestWorkspaceContext } from "@alp-sdk/core/west/models";
import {
  createWestFlashPlan,
  createWestUpdatePlan,
} from "@alp-sdk/core/west/service";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import {
  runAlpCommand,
  runAlpInTerminal,
  runAlpStreamed,
} from "./alpCli/vscodeAdapter";
import { warnIfCliCannotBuildSom } from "./build/somCliFloorGuard";
import { planConfirm, planPrecondition } from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
import {
  collectWestWorkspaceContext,
  executeWestPlan,
  nativeSimOverlayExists,
} from "./west/vscodeAdapter";
import { BUILD_RUN_NAME, FLASH_RUN_NAME, log } from "./util";

/** The directory a `tan` run should use, or undefined when nothing resolves one
 *  (no folder open and no `alpSdk.westCwd`) — in which case the run must be
 *  refused, never spawned with an inherited cwd. Takes an already-collected
 *  context so a caller that needs both doesn't resolve the project twice. */
export function westCwd(
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
 * Where an orchestrator command (build/image/flash/clean) should run.
 *
 * When the workspace holds a real board.yaml, the command targets that project
 * directly — no app-path prompt. Every `tan` orchestrator subcommand defaults
 * its app/project to the current directory (the unified "run from the project
 * dir" convention), so we run from the project root and pass no app argument.
 *
 * Only when no project is open do we fall back to prompting for an example app
 * to build. Returns `undefined` when the user cancels that prompt — or when
 * nothing resolves a cwd at all, which is refused here rather than in each of
 * the four callers: `tan build/image/flash/clean` all WRITE where they
 * run, and with no folder open the child inherits the extension host's own
 * directory (on Windows, the VS Code install directory) and drops a `build/`
 * there. `cwd` is narrowed to `string` on the way out so the guard cannot be
 * bypassed by a later caller. Same builder the sibling sites use (bootstrap.ts,
 * toolchain.ts, wizard.ts, debug.ts, ideHub/workspaceCommands.ts).
 *
 * `operation` is the verb phrase `planPrecondition` renders into "Open a folder
 * to <operation>.", so it is per-command, not per-resolver.
 *
 * @callers 4 resolveOrchestratorTarget
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

// ── CLI-backed orchestrator workflow (tan build/image/flash/clean) ───────────

async function alpBuild(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/peripheral-io/gpio-button-led",
    "build this project",
  );
  if (!target) return;
  await warnIfCliCannotBuildSom(context, target.cwd);
  // `tan build` has no positional app_path — project scope resolves from
  // `--project` (which defaults to the cwd; MEASURED, `tan build --help` at
  // the pinned 0.6.0). Active project: a bare `build` from the project root.
  // Fallback: point `--project` at the chosen example (a bare positional is a
  // parse error, exit 2 — MEASURED, not assumed — not silently ignored).
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
// lost.
//
// `tan renode` used to be a fifth streamed command, and the paragraph above
// cited its pre-boot refusal as the clearest case of a reason the dying
// terminal swallowed. tan v0.6.0 REMOVED the verb (tan-cli#848) along with all
// 27 `renode.*` issue codes, so the example is gone with it — the argument it
// illustrated is unchanged and still holds for build/image/flash/clean.
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
  if (!(await confirmFlashReadiness(context, target.cwd))) return;
  await runAlpStreamed(context, ["flash", ...target.appArg], {
    name: FLASH_RUN_NAME,
    cwd: target.cwd,
  });
}

/**
 * Ask `tan doctor` whether this host can actually program the part, and let the
 * customer decide when it says no (#615).
 *
 * tan already works this out and says so precisely — on this bench host,
 * `jlink` comes back `warn` with "J-Link V9.26 … predates V9.46, which is where
 * Alif's MRAM flash loader became built in" and a `fix` of "Upgrade the SEGGER
 * J-Link pack to V9.46+." — and until now it said it only inside the
 * Dependencies panel, which a customer about to flash need never have opened.
 * On AEN hardware that is the difference between a flash that programs the part
 * and one that does not.
 *
 * MODAL, not a toast, for the reason the rest of this flash path is modal: a
 * corner notification is easy to miss or auto-dismiss, and the cost of missing
 * this one is a bench slot spent on a write that cannot land. It is a CONFIRM
 * and not a refusal because the warning is not universal — `jlink` is about
 * Alif's Flow D, and a customer flashing a Renesas part is right to continue.
 *
 * Returns `true` — flash — for every outcome except an explicit decline. A
 * doctor that could not run, answered nothing, or reported no flash-relevant
 * problem must never stand between a customer and their board; "tan did not
 * tell us" is not "tan said no".
 */
async function confirmFlashReadiness(
  context: vscode.ExtensionContext,
  cwd: string,
): Promise<boolean> {
  let res;
  try {
    res = await runAlpCommand(context, ["doctor"], cwd, {
      interactive: false,
    });
  } catch {
    return true;
  }
  const envelope = res.outcome.envelope;
  if (!envelope) return true;

  const data = envelope.data as { checks?: unknown } | undefined;
  const warnings = collectFlashReadinessWarnings(data?.checks);
  if (warnings.length === 0) return true;

  log(`[flash] readiness: ${warnings.map((w) => w.name).join(", ")}`, "warn");
  const picked = await notify(
    planConfirm({
      message: describeFlashReadiness(warnings),
      // tan's own detail and fix, on the dialog. `present` logs `modalDetail`
      // as well, so the record survives whichever way the customer clicks.
      modalDetail: flashReadinessModalDetail(warnings),
      confirm: { id: "applyChanges" },
    }),
  );
  return picked === "applyChanges";
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
  //
  // `root`, not `undefined` — this WRITES `boards/native_sim_native_64.
  // overlay` (#605's class of defect, found on a later review pass). An
  // omitted cwd reached `child_process.spawn` unset and the child inherited
  // the extension host's own directory, so the overlay landed there instead
  // of under the project `root` this same function already resolved two
  // lines up for the `nativeSimOverlayExists(root)` check just above — and
  // since `outcome.ok` still comes back true (`tan generate` genuinely wrote
  // A file, just not where this function later looks for one),
  // `nativeSimOverlayExists(root)` stays false and this regenerated on every
  // single native_sim run, silently, with the app never picking up the
  // overlay it wrote.
  const { outcome } = await runAlpCommand(
    context,
    ["generate", "--target", "native-sim-overlay"],
    root,
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
  ];
}
